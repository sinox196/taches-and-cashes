import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initDb, DEFAULT_LEAVE_ENTITLEMENT } from './src/server/database.js';
import { STAFF_ROLES, DASHBOARD_ROLES, HR_APPROVER_ROLES } from './src/constants/roles.js';
import {
  DEFAULT_AWAY_AFTER_MINUTES, OFFLINE_AFTER_MS, clampAwayMinutes, type PresenceState,
} from './src/constants/presence.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-local-dev';

/** DD/MM/YYYY — the format time entries are stored and grouped by. */
const formatDateFR = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

/** HH:mm, 24h. */
const formatTimeFR = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Users are stored with `permissions` JSON-stringified; the API always returns an array. */
const publicUser = (u: any) => {
  const { password, permissions, ...rest } = u;
  return { ...rest, permissions: JSON.parse(permissions || '[]') };
};

// NaN must not pass: `typeof NaN === 'number'`, so an absent field read as
// Number(undefined) used to flow straight into the money cascade and turn
// totalNetToPay into NaN, stored as null — a document with no amount at all.
const num = (v: any, fallback: number) =>
  (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
/** Money is carried to the millime (3 decimals) at every step. */
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Attaches the admin-set annual leave allowance and its consumption to a user payload. */
const withLeaveBalance = (user: any, balances: any[]) => {
  const b = balances.find((x: any) => x.userId === user.id);
  const entitlement = b ? b.entitlement : DEFAULT_LEAVE_ENTITLEMENT;
  const used = b ? b.used : 0;
  return { ...user, soldeConge: entitlement, congesUtilises: used, congesRestants: entitlement - used };
};

/**
 * The employer hourly cost of a collaborator:
 *
 *   charges = salaireBrut * (CNSS + TFP + FOPROLOS + accident) / 100
 *   total   = salaireBrut + charges + primes non cotisables
 *   rate    = total / (regimeHoraire * 4.33)
 *
 * Percentages fall back to the global defaults when not overridden per user.
 * Returns `null` when the collaborator has no salary configured — callers must
 * NOT substitute a placeholder: an invented cost is worse than no cost.
 */
const employerHourlyRate = (user: any, settings: any): number | null => {
  if (!user) return null;
  if (typeof user.coutHoraireEmployeur === 'number' && user.coutHoraireEmployeur > 0) {
    return user.coutHoraireEmployeur;
  }
  const salaire = num(user.salaireBrut, 0);
  const regime = num(user.regimeHoraire, 0);
  if (salaire <= 0 || regime <= 0) return null;

  const g = settings?.employerCharges ?? {};
  const pct =
    num(user.cnss, num(g.cnss, 16.57)) +
    num(user.tfp, num(g.tfp, 2)) +
    num(user.foprolos, num(g.foprolos, 1)) +
    num(user.accidentTravail, num(g.accidentTravail, 0.5));

  const total = salaire + salaire * (pct / 100) + num(user.primesFraisNonCotisables, 0);
  const heuresMensuelles = regime * 4.33;
  return heuresMensuelles > 0 ? total / heuresMensuelles : null;
};

/** DD/MM/YYYY (how entries are stored) → epoch ms. */
const parseFrenchDateTs = (dateStr: string) => {
  if (!dateStr) return 0;
  const parts = dateStr.split('/');
  if (parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00Z`).getTime();
  return 0;
};

/**
 * The dashboard's date / collaborator / client filters, in one place so the
 * summary endpoint and the per-client drill-down apply exactly the same rules.
 */
const filterKpiEntries = (entries: any[], body: any) => {
  const startTs = body?.startDate ? new Date(body.startDate).getTime() : 0;
  const endTs = body?.endDate ? new Date(body.endDate).getTime() + 86400000 - 1 : Infinity;
  const userIds: any[] = body?.filterUserIds || [];
  const clientIds: any[] = body?.filterClientIds || [];
  return entries.filter((t: any) => {
    const ts = parseFrenchDateTs(t.date);
    if (ts < startTs || ts > endTs) return false;
    if (userIds.length > 0 && !userIds.includes(t.userId)) return false;
    if (clientIds.length > 0 && !clientIds.includes(t.clientId)) return false;
    return true;
  });
};

/** Bucket key used to group entries by client (falls back to the stored name). */
const clientBucketKey = (t: any) =>
  t.clientId != null ? String(t.clientId) : `name:${t.client || 'Sans client'}`;

/** Seconds a task has accrued, including the currently-running stretch. */
const accruedSeconds = (t: any) => {
  let s = t.dureeSeconds || 0;
  if (t.statut === 'RUNNING' && t.lastStartedAt) {
    s += Math.floor((Date.now() - t.lastStartedAt) / 1000);
  }
  return s;
};

async function startServer() {
  const app = express();
  // Railway (and Render) assign the port at runtime and expect the app to bind
  // whatever they put in $PORT; a hardcoded one fails their health check and
  // the deploy never goes live. 3000 stays the local default.
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Initialize SQLite database
  const db = await initDb();

  // ---------------------------------------------------------
  // Auth & API Routes
  // ---------------------------------------------------------

  // POST /api/login
  app.post('/api/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      const user = await db.get('SELECT * FROM users WHERE username = ?', username);
      
      if (!user) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }
      
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
      
      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          permissions: JSON.parse(user.permissions),
          salaireBrut: user.salaireBrut,
          regimeHoraire: user.regimeHoraire
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Authentication Middleware
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(' ')[1] || req.query.token;
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch (e) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  // GET /api/me
  app.get('/api/me', authenticate, async (req: any, res: any) => {
    try {
      const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
      if (!user) {
         res.status(404).json({ error: 'User not found' });
         return;
      }
      res.json({
        id: user.id,
        username: user.username,
        role: user.role,
        permissions: JSON.parse(user.permissions),
        salaireBrut: user.salaireBrut,
        regimeHoraire: user.regimeHoraire
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // RBAC Middleware
  const requirePermission = (permission: string) => {
    return (req: any, res: any, next: any) => {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      // We should check the database to get the freshest permissions
      db.get('SELECT * FROM users WHERE id = ?', req.user.id).then((user: any) => {
        if (!user) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const hasPerm = user.role === 'ADMIN' || JSON.parse(user.permissions).includes(permission);
        if (!hasPerm) {
          return res.status(403).json({ error: 'Forbidden: Missing permission ' + permission });
        }
        next();
      }).catch(() => {
        res.status(500).json({ error: 'Internal server error' });
      });
    };
  };

  // GET /api/settings
  app.get('/api/settings', authenticate, requirePermission('ADMIN'), async (req: any, res: any) => {
    try {
      const settings = await db.getSettings();
      res.json(settings || {});
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/settings
  app.put('/api/settings', authenticate, requirePermission('ADMIN'), async (req: any, res: any) => {
    try {
      const updates = req.body;
      const updated = await db.updateSettings(updates);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // User Management API Routes
  // ---------------------------------------------------------

  // GET /api/users
  app.get('/api/users', authenticate, requirePermission('MANAGE_USERS'), async (req: any, res: any) => {
    try {
      const users = await db.getAllUsers();
      const balances = await db.getAllLeaveBalances();
      // Don't send passwords to client. Same shape as POST/PUT responses so the
      // list can be updated in place after a create/edit.
      res.json(users.map((u: any) => withLeaveBalance(publicUser(u), balances)));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/users
  app.post('/api/users', authenticate, requirePermission('MANAGE_USERS'), async (req: any, res: any) => {
    try {
      const { username, password, role, permissions, salaireBrut, regimeHoraire, cnss, tfp, foprolos, accidentTravail, primesFraisNonCotisables, soldeConge } = req.body;

      const existing = await db.get('SELECT * FROM users WHERE username = ?', username);
      if (existing) {
        return res.status(400).json({ error: 'Username already exists' });
      }
      
      const hashed = await bcrypt.hash(password, 10);

      const simSalaire = typeof salaireBrut === 'number' ? salaireBrut : 0;
      const simRegime = typeof regimeHoraire === 'number' ? regimeHoraire : 0;
      const totalChargesPct = (typeof cnss === 'number' ? cnss : 0) + 
                              (typeof tfp === 'number' ? tfp : 0) + 
                              (typeof foprolos === 'number' ? foprolos : 0) + 
                              (typeof accidentTravail === 'number' ? accidentTravail : 0);
      const montantsCharges = simSalaire * (totalChargesPct / 100);
      const simPrimes = typeof primesFraisNonCotisables === 'number' ? primesFraisNonCotisables : 0;
      const coutTotalEmployeur = simSalaire + montantsCharges + simPrimes;
      const heuresMensuelles = simRegime * 4.33;
      const coutHoraireEmployeur = heuresMensuelles > 0 ? coutTotalEmployeur / heuresMensuelles : 0;

      const newUser = await db.createUser({
        id: Date.now(),
        username,
        password: hashed,
        role,
        permissions: JSON.stringify(permissions || []),
        salaireBrut,
        regimeHoraire,
        cnss,
        tfp,
        foprolos,
        accidentTravail,
        primesFraisNonCotisables,
        coutTotalEmployeur,
        coutHoraireEmployeur
      });
      
      // The admin sets the annual leave allowance from this same form.
      await db.updateLeaveBalance(newUser.id, {
        entitlement: num(soldeConge, DEFAULT_LEAVE_ENTITLEMENT),
        used: 0,
      });

      res.json(withLeaveBalance(publicUser(newUser), await db.getAllLeaveBalances()));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  // PUT /api/users/:id
  app.put('/api/users/:id', authenticate, requirePermission('MANAGE_USERS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { role, permissions, password, salaireBrut, regimeHoraire, cnss, tfp, foprolos, accidentTravail, primesFraisNonCotisables, soldeConge } = req.body;
      
      const simSalaire = typeof salaireBrut === 'number' ? salaireBrut : 0;
      const simRegime = typeof regimeHoraire === 'number' ? regimeHoraire : 0;
      const totalChargesPct = (typeof cnss === 'number' ? cnss : 0) + 
                              (typeof tfp === 'number' ? tfp : 0) + 
                              (typeof foprolos === 'number' ? foprolos : 0) + 
                              (typeof accidentTravail === 'number' ? accidentTravail : 0);
      const montantsCharges = simSalaire * (totalChargesPct / 100);
      const simPrimes = typeof primesFraisNonCotisables === 'number' ? primesFraisNonCotisables : 0;
      const coutTotalEmployeur = simSalaire + montantsCharges + simPrimes;
      const heuresMensuelles = simRegime * 4.33;
      const coutHoraireEmployeur = heuresMensuelles > 0 ? coutTotalEmployeur / heuresMensuelles : 0;

      const updates: any = { 
        role, 
        permissions: JSON.stringify(permissions || []), 
        salaireBrut, 
        regimeHoraire, 
        cnss, 
        tfp, 
        foprolos, 
        accidentTravail,
        primesFraisNonCotisables,
        coutTotalEmployeur,
        coutHoraireEmployeur
      };
      
      if (password) {
        updates.password = await bcrypt.hash(password, 10);
      }
      
      const updatedUser = await db.updateUser(id, updates);
      if (!updatedUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Changing the allowance never touches days already consumed.
      if (typeof soldeConge === 'number') {
        await db.updateLeaveBalance(id, { entitlement: soldeConge });
      }

      res.json(withLeaveBalance(publicUser(updatedUser), await db.getAllLeaveBalances()));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  // DELETE /api/users/:id
  app.delete('/api/users/:id', authenticate, requirePermission('MANAGE_USERS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await db.deleteUser(id);
      if (!success) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });


  // ---------------------------------------------------------
  // Clients API Routes
  // ---------------------------------------------------------

  // GET /api/clients
  app.get('/api/clients', authenticate, requirePermission('VIEW_CLIENTS'), async (req: any, res: any) => {
    try {
      let clients = await db.getAllClients();

      // Parse filters
      let filters: Record<string, string> = {};
      if (req.query.filters) {
        try {
          filters = JSON.parse(req.query.filters);
        } catch (e) {
          // ignore
        }
      }

      // 1. Global Search (q)
      const q = (req.query.q || '').toLowerCase();
      if (q) {
        clients = clients.filter((c: any) => {
          return (
            (c.name && c.name.toLowerCase().includes(q)) ||
            (c.email && c.email.toLowerCase().includes(q)) ||
            (c.phone && c.phone.toLowerCase().includes(q)) ||
            (c.city && c.city.toLowerCase().includes(q)) ||
            (c.taxId && c.taxId.toLowerCase().includes(q))
          );
        });
      }

      // 2. Column Filters
      for (const [key, value] of Object.entries(filters)) {
        if (!value) continue;
        const lowerVal = value.toString().toLowerCase();
        
        clients = clients.filter((c: any) => {
          let fieldVal = c[key];
          
          // Check custom fields if not found directly
          if (fieldVal === undefined && c.customFields) {
            fieldVal = c.customFields[key];
          }

          if (fieldVal === undefined || fieldVal === null) return false;

          // exact match for status or type, otherwise partial match
          if (key === 'status' || key === 'type') {
             return fieldVal.toString().toLowerCase() === lowerVal;
          }

          return fieldVal.toString().toLowerCase().includes(lowerVal);
        });
      }

      // 3. Sorting
      const sortField = req.query.sortField || 'createdAt';
      const sortDir = req.query.sortDir || 'desc';

      clients.sort((a, b) => {
        let valA = a[sortField];
        if (valA === undefined && a.customFields) valA = a.customFields[sortField];
        
        let valB = b[sortField];
        if (valB === undefined && b.customFields) valB = b.customFields[sortField];

        if (valA === valB) return 0;
        if (valA === undefined || valA === null) return sortDir === 'asc' ? -1 : 1;
        if (valB === undefined || valB === null) return sortDir === 'asc' ? 1 : -1;

        if (typeof valA === 'string' && typeof valB === 'string') {
          return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        
        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });

      // 4. Pagination
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 100; // default to 100, or maybe we just return all if no pagination passed?
      
      // If client didn't explicitly request pagination, maybe return array to preserve backward compatibility? 
      // The user wants "Do not load the entire Clients database... Use pagination".
      // We will ALWAYS return pagination wrapper if page/limit is provided, else we return array.
      if (req.query.page) {
        const total = clients.length;
        const startIndex = (page - 1) * limit;
        const paginated = clients.slice(startIndex, startIndex + limit);
        res.json({ data: paginated, total, page, limit });
      } else {
        res.json(clients);
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/clients/fields
  app.get('/api/clients/fields', authenticate, requirePermission('VIEW_CLIENTS'), async (req: any, res: any) => {
    try {
      const clients = await db.getAllClients();
      const customFieldKeys = new Set<string>();
      clients.forEach((c: any) => {
        if (c.customFields) {
          Object.keys(c.customFields).forEach(k => customFieldKeys.add(k));
        }
      });
      res.json(Array.from(customFieldKeys));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/clients/:id
  app.get('/api/clients/:id', authenticate, requirePermission('VIEW_CLIENTS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const client = await db.getClientById(id);
      if (!client) {
        return res.status(404).json({ error: 'Client not found' });
      }
      res.json(client);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/clients
  
// --- KPI DASHBOARD ENDPOINT ---

// --- KPI SEARCH ENDPOINTS ---
app.get('/api/kpi/users/search', authenticate, async (req: any, res: any) => {
  if (!DASHBOARD_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const q = (req.query.q || '').toLowerCase();
  let users = await db.getAllUsers();
  users = users.filter((u: any) => u.role !== 'ADMIN');
  if (q) {
    users = users.filter((u: any) => 
      u.username.toLowerCase().includes(q) || 
      (u.fullName && u.fullName.toLowerCase().includes(q))
    );
  }
  // limit to 10 for autocomplete
  res.json(users.slice(0, 10).map((u: any) => ({ id: u.id, name: u.fullName || u.username, role: u.role })));
});

app.get('/api/kpi/clients/search', authenticate, async (req: any, res: any) => {
  if (!DASHBOARD_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const q = (req.query.q || '').toLowerCase();
  let clients = await db.getAllClients();
  if (q) {
    clients = clients.filter((c: any) => c.name.toLowerCase().includes(q));
  }
  // limit to 10
  res.json(clients.slice(0, 10).map((c: any) => ({ id: c.id, name: c.name })));
});

/**
 * Tasks behind one client's row on the dashboard, under the same filters.
 * Loaded on expand so the summary payload stays small no matter how many
 * clients and entries exist.
 */
app.post('/api/kpi/client-tasks', authenticate, async (req: any, res: any) => {
  try {
    if (!DASHBOARD_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: 'A client key is required' });

    const isAdminViewer = req.user.role === 'ADMIN';
    const allUsers = await db.getAllUsers();
    const usersById = new Map<number, any>(allUsers.map((u: any) => [u.id, u]));

    const entries = filterKpiEntries(await db.getAllTimeEntries() || [], req.body)
      .filter((t: any) => clientBucketKey(t) === String(key))
      .sort((a: any, b: any) => accruedSeconds(b) - accruedSeconds(a));

    const LIMIT = 200;
    const truncated = Math.max(0, entries.length - LIMIT);

    const tasks = entries.slice(0, LIMIT).map((t: any) => {
      const secs = accruedSeconds(t);
      const rate = typeof t.hourlyRate === 'number' ? t.hourlyRate : null;
      const user = usersById.get(t.userId);
      const row: any = {
        id: t.id,
        date: t.date,
        userName: user ? (user.fullName || user.username) : 'Inconnu',
        description: t.description || '',
        mission: t.pole || '',
        taskType: t.taskType || '',
        statut: t.statut,
        dureeSeconds: secs,
        dureeFormatted: `${Math.floor(secs / 3600)}h${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}`,
      };
      if (isAdminViewer) row.cost = rate === null ? null : (secs / 3600) * rate;
      return row;
    });

    res.json({ tasks, total: entries.length, truncated });
  } catch (error) {
    console.error('KPI client-tasks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Tasks behind one collaborator, under the dashboard filters. Loaded on open. */
app.post('/api/kpi/employee-tasks', authenticate, async (req: any, res: any) => {
  try {
    if (!DASHBOARD_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const userId = Number(req.body?.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'A userId is required' });

    const isAdminViewer = req.user.role === 'ADMIN';
    const clients = await db.getAllClients() || [];
    const clientsById = new Map<number, any>(clients.map((c: any) => [c.id, c]));

    const entries = filterKpiEntries(await db.getAllTimeEntries() || [], req.body)
      .filter((t: any) => t.userId === userId)
      .sort((a: any, b: any) => accruedSeconds(b) - accruedSeconds(a));

    const LIMIT = 200;
    const truncated = Math.max(0, entries.length - LIMIT);

    const tasks = entries.slice(0, LIMIT).map((t: any) => {
      const secs = accruedSeconds(t);
      const rate = typeof t.hourlyRate === 'number' ? t.hourlyRate : null;
      const row: any = {
        id: t.id,
        date: t.date,
        clientId: t.clientId ?? null,
        client: (t.clientId != null ? clientsById.get(t.clientId)?.name : null) || t.client || 'Sans client',
        description: t.description || '',
        pole: t.pole || '',
        taskType: t.taskType || '',
        statut: t.statut,
        heureDebut: t.heureDebut || '',
        heureFin: t.heureFin || '',
        dureeSeconds: secs,
        dureeFormatted: `${Math.floor(secs / 3600)}h${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}`,
      };
      if (isAdminViewer) row.cost = rate === null ? null : (secs / 3600) * rate;
      return row;
    });

    res.json({ tasks, total: entries.length, truncated });
  } catch (error) {
    console.error('KPI employee-tasks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/kpi/dashboard', authenticate, async (req: any, res: any) => {
  try {
    // ADMIN/SUPERVISEUR see the whole team dashboard. Everyone else (COLLABORATOR,
    // STAGIAIRE) gets the same endpoint but pinned to their own id server-side —
    // a collaborator sending a different filterUserIds in the body still only
    // ever gets their own data back.
    const isTeamViewer = DASHBOARD_ROLES.includes(req.user.role);
    if (!isTeamViewer) {
      req.body.filterUserIds = [req.user.id];
    }

    const { startDate, endDate, filterUserIds, filterClientIds } = req.body;

    const parseFrenchDate = (dateStr: string) => {
      // Date in DD/MM/YYYY
      if (!dateStr) return 0;
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        return new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00Z`).getTime();
      }
      return 0;
    };

    const parseIsoDate = (dateStr: string) => {
      if (!dateStr) return 0;
      return new Date(dateStr).getTime();
    };

    const startTs = startDate ? parseIsoDate(startDate) : 0;
    const endTs = endDate ? parseIsoDate(endDate) + 86400000 - 1 : Infinity; // Include the whole end day

    // Get all base data
    const allUsers = await db.getAllUsers();
    let timeEntries = await db.getAllTimeEntries() || [];
    let leaveRequests = await db.getAllLeaveRequests() || [];
    let authorizations = await db.getAllAbsenceAuthorizations() || [];
    let clients = await db.getAllClients() || [];
    let leaveBalances = await db.getAllLeaveBalances() || [];

    // Filter time entries (shared with the per-client drill-down endpoint)
    timeEntries = filterKpiEntries(timeEntries, req.body);

    // Filter leave requests
    leaveRequests = leaveRequests.filter((l: any) => {
      const tsStart = parseIsoDate(l.startDate);
      const tsEnd = parseIsoDate(l.endDate);
      // Overlap logic
      if (tsEnd < startTs || tsStart > endTs) return false;
      if (filterUserIds && filterUserIds.length > 0 && !filterUserIds.includes(l.userId)) return false;
      return true;
    });

    // Filter authorizations
    authorizations = authorizations.filter((a: any) => {
      const ts = parseIsoDate(a.date);
      if (ts < startTs || ts > endTs) return false;
      if (filterUserIds && filterUserIds.length > 0 && !filterUserIds.includes(a.userId)) return false;
      return true;
    });

    const employees = allUsers.filter((u: any) => STAFF_ROLES.includes(u.role));
    
    const kpiSettings = await db.getSettings();
    const isAdminViewer = req.user.role === 'ADMIN';

    // Index once instead of scanning allUsers/clients per task. With thousands
    // of entries the repeated .find() calls were the dominant cost here.
    const usersById = new Map<number, any>(allUsers.map((u: any) => [u.id, u]));
    const clientsById = new Map<number, any>(clients.map((c: any) => [c.id, c]));
    const userLabel = (id: number) => {
      const u = usersById.get(id);
      return u ? (u.fullName || u.username) : 'Inconnu';
    };

    // Each task is costed at the rate snapshotted when it was created, so a
    // salary change only affects work logged after it.
    const taskRate = (t: any) => (typeof t.hourlyRate === 'number' ? t.hourlyRate : null);
    const taskCost = (t: any) => {
      const rate = taskRate(t);
      return rate === null ? null : (accruedSeconds(t) / 3600) * rate;
    };

    const globalDurationSeconds = timeEntries.reduce(
      (sum: number, t: any) => sum + accruedSeconds(t), 0);

    // Tasks logged while the collaborator had no employer cost configured are
    // excluded rather than priced at a guess; `tasksWithoutRate` says how many.
    let tasksWithoutRate = 0;
    const globalCost = timeEntries.reduce((sum: number, t: any) => {
      const c = taskCost(t);
      if (c === null) { tasksWithoutRate++; return sum; }
      return sum + c;
    }, 0);
    
    const gHours = Math.floor(globalDurationSeconds / 3600);
    const gMins = Math.floor((globalDurationSeconds % 3600) / 60);

    // Calculate global stats
    const globalStats = {
      totalCollaborators: employees.filter((u: any) => u.role === 'COLLABORATOR').length,
      totalSupervisors: employees.filter((u: any) => u.role === 'SUPERVISEUR').length,
      totalHeadcount: employees.length,
      // Headcount per role, so a newly added role shows up without a code change here.
      headcountByRole: STAFF_ROLES.reduce((acc: Record<string, number>, roleId: string) => {
        acc[roleId] = employees.filter((u: any) => u.role === roleId).length;
        return acc;
      }, {}),
      totalTasks: timeEntries.length,
      completedTasks: timeEntries.filter((t: any) => t.statut === 'COMPLETED').length,
      inProgressTasks: timeEntries.filter((t: any) => t.statut === 'RUNNING').length,
      pausedTasks: timeEntries.filter((t: any) => t.statut === 'PAUSED').length,
      clientsHandled: new Set(timeEntries.filter((t: any) => t.clientId).map((t: any) => t.clientId)).size,
      totalDurationSeconds: globalDurationSeconds,
      totalDurationFormatted: `${gHours}h${String(gMins).padStart(2, '0')}`,
      totalCost: globalCost,
      totalCostFormatted: `${Math.round(globalCost).toLocaleString('fr-FR')} TND`,
      tasksWithoutRate,
      activeLeaves: leaveRequests.filter((l: any) => l.status === 'APPROVED').length,
      activeAuthorizations: authorizations.filter((a: any) => a.status === 'APPROVED').length,
    };

    // Calculate per employee stats
    const employeeStats = employees.map((emp: any) => {
      if (filterUserIds && filterUserIds.length > 0 && !filterUserIds.includes(emp.id)) return null;

      const empTasks = timeEntries.filter((t: any) => t.userId === emp.id);
      const totalTasks = empTasks.length;
      const completedTasks = empTasks.filter((t: any) => t.statut === 'COMPLETED').length;
      const inProgressTasks = empTasks.filter((t: any) => t.statut === 'RUNNING').length;
      const pausedTasks = empTasks.filter((t: any) => t.statut === 'PAUSED').length;

      const totalDurationSeconds = empTasks.reduce(
        (sum: number, t: any) => sum + accruedSeconds(t), 0);

      // Sum of each task at its own historical rate — not this person's current
      // rate applied to all their hours.
      const empUnpricedTasks = empTasks.filter((t: any) => taskCost(t) === null).length;
      const empPricedTasks = empTasks.length - empUnpricedTasks;
      const totalCost = empTasks.reduce((sum: number, t: any) => sum + (taskCost(t) ?? 0), 0);
      // The rate in force *now* — what future tasks will be costed at.
      const currentRate = employerHourlyRate(emp, kpiSettings);
      
      const eHours = Math.floor(totalDurationSeconds / 3600);
      const eMins = Math.floor((totalDurationSeconds % 3600) / 60);
      const totalDurationFormatted = `${eHours}h${String(eMins).padStart(2, '0')}`;
      const totalCostFormatted = `${Math.round(totalCost).toLocaleString('fr-FR')} TND`;
      
      const empClients = new Set();
      const clientTasksCount: any = {};
      empTasks.forEach((t: any) => {
        if (t.clientId) {
          empClients.add(t.clientId);
          clientTasksCount[t.clientId] = (clientTasksCount[t.clientId] || 0) + 1;
        }
      });
      
      const empLeaves = leaveRequests.filter((l: any) => l.userId === emp.id);
      const balance = leaveBalances.find((b: any) => b.userId === emp.id)
        || { entitlement: DEFAULT_LEAVE_ENTITLEMENT, used: 0, available: DEFAULT_LEAVE_ENTITLEMENT };
      
      const empAuths = authorizations.filter((a: any) => a.userId === emp.id);
      const totalAuthDuration = empAuths
        .filter((a: any) => a.status === 'APPROVED')
        .reduce((sum: number, a: any) => sum + (a.duration || 0), 0);

      const clientListDetails = Array.from(empClients).map((cid: any) => {
        const c = clientsById.get(cid);
        return {
          id: cid,
          name: c ? c.name : 'Unknown',
          taskCount: clientTasksCount[cid]
        };
      });

      // The per-task breakdown is NOT inlined: 40 collaborators × their history
      // is the bulk of this payload. The drill-down modal loads it from
      // /api/kpi/employee-tasks when it opens.
      return {
        id: emp.id,
        name: emp.fullName || emp.username,
        role: emp.role,
        department: emp.department || 'N/A',
        totalDurationSeconds,
        totalDurationFormatted,
        totalCost,
        totalCostFormatted,
        // Rate that will apply to *new* tasks; null = not configured.
        hourlyRate: currentRate,
        pricedTasks: empPricedTasks,
        unpricedTasks: empUnpricedTasks,
        tasks: {
          total: totalTasks,
          completed: completedTasks,
          inProgress: inProgressTasks,
          paused: pausedTasks,
          late: 0,
          completionRate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
          totalDurationSeconds,
          totalDurationFormatted,
          totalCost,
          totalCostFormatted
        },
        clients: {
          totalHandled: empClients.size,
          list: clientListDetails
        },
        leaves: {
          totalRequests: empLeaves.length,
          approved: empLeaves.filter((l: any) => l.status === 'APPROVED').length,
          pending: empLeaves.filter((l: any) => l.status === 'PENDING').length,
          rejected: empLeaves.filter((l: any) => l.status === 'REJECTED').length,
          daysTaken: empLeaves.filter((l: any) => l.status === 'APPROVED').reduce((sum: number, l: any) => sum + (l.duration || 0), 0),
          balance: balance
        },
        authorizations: {
          total: empAuths.length,
          approved: empAuths.filter((a: any) => a.status === 'APPROVED').length,
          pending: empAuths.filter((a: any) => a.status === 'PENDING').length,
          rejected: empAuths.filter((a: any) => a.status === 'REJECTED').length,
          totalDuration: totalAuthDuration // in hours
        }
      };
    }).filter(Boolean);

    // A non-team viewer's own row is the only one they may see — other
    // collaborators must not appear even as zero-value rows, since that would
    // leak coworker names to someone with no MANAGE_USERS permission.
    const scopedEmployeeStats = isTeamViewer
      ? employeeStats
      : employeeStats.filter((e: any) => e.id === req.user.id);

    // Company-wide headcount is a team-viewer figure; a personal dashboard
    // only ever needs its own totals, already reflected below.
    if (!isTeamViewer) {
      delete globalStats.totalHeadcount;
      delete globalStats.totalCollaborators;
      delete globalStats.totalSupervisors;
      delete globalStats.headcountByRole;
    }

    // ----- Per-client breakdown: cost, who worked on it, and what they did.
    // Built from the same already-filtered `timeEntries`, so it always reflects
    // the date / collaborator / client filters applied above.
    const clientBuckets = new Map<string, any[]>();
    timeEntries.forEach((t: any) => {
      const key = clientBucketKey(t);
      if (!clientBuckets.has(key)) clientBuckets.set(key, []);
      clientBuckets.get(key)!.push(t);
    });

    // ----- Invoicing per client, under the same filters.
    // Documents carry `clientName` where entries carry `client`, so they are
    // normalised onto the identical bucket key — otherwise a client tracked by
    // name on one side and by id on the other would split into two rows.
    const invoiceBuckets = new Map<string, { netToPay: number; paid: number; count: number }>();
    const allInvoices = await db.getAllInvoices() || [];
    for (const inv of allInvoices) {
      const ts = parseIsoDate(inv.issueDate);
      if (ts < startTs || ts > endTs) continue;
      if (filterClientIds && filterClientIds.length > 0 && !filterClientIds.includes(inv.clientId)) continue;
      const key = clientBucketKey({ clientId: inv.clientId, client: inv.clientName });
      const acc = invoiceBuckets.get(key) || { netToPay: 0, paid: 0, count: 0 };
      acc.netToPay += num(Number(inv.totalNetToPay), 0);
      acc.paid += num(Number(inv.totalPaid), 0);
      acc.count += 1;
      invoiceBuckets.set(key, acc);
      // A client invoiced in the period but with no tracked time still belongs
      // in the table: otherwise its billing would silently read as zero.
      if (!clientBuckets.has(key)) clientBuckets.set(key, []);
    }

    const clientStats = [...clientBuckets.entries()].map(([key, entries]) => {
      // A bucket with no entries came from an invoice; fall back to that
      // document for the client's identity.
      const invoiceSample = entries.length === 0
        ? allInvoices.find((i: any) =>
            clientBucketKey({ clientId: i.clientId, client: i.clientName }) === key)
        : null;
      const first = entries[0] ?? { clientId: invoiceSample?.clientId ?? null, client: invoiceSample?.clientName || 'Sans client' };
      const clientRecord = first.clientId != null ? clientsById.get(first.clientId) : null;

      const durationSeconds = entries.reduce((s: number, t: any) => s + accruedSeconds(t), 0);
      const unpricedTasks = entries.filter((t: any) => taskCost(t) === null).length;
      const totalCost = entries.reduce((s: number, t: any) => s + (taskCost(t) ?? 0), 0);

      // Who worked on this client, and how much each contributed.
      const byUser = new Map<number, any[]>();
      entries.forEach((t: any) => {
        if (!byUser.has(t.userId)) byUser.set(t.userId, []);
        byUser.get(t.userId)!.push(t);
      });
      const contributors = [...byUser.entries()].map(([userId, userEntries]) => {
        const secs = userEntries.reduce((s: number, t: any) => s + accruedSeconds(t), 0);
        const user = usersById.get(userId);
        return {
          userId,
          name: user ? (user.fullName || user.username) : 'Inconnu',
          role: user ? user.role : null,
          taskCount: userEntries.length,
          durationSeconds: secs,
          durationFormatted: `${Math.floor(secs / 3600)}h${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}`,
          cost: userEntries.reduce((s: number, t: any) => s + (taskCost(t) ?? 0), 0),
        };
      }).sort((a, b) => b.durationSeconds - a.durationSeconds);

      // The task list is deliberately NOT included here. With hundreds of
      // clients it would mean serialising the whole history on every dashboard
      // load; the rows below fetch it from /api/kpi/client-tasks on expand.
      return {
        id: first.clientId ?? key,
        key,
        name: clientRecord ? clientRecord.name : (first.client || 'Sans client'),
        taskCount: entries.length,
        completedTasks: entries.filter((t: any) => t.statut === 'COMPLETED').length,
        durationSeconds,
        durationFormatted: `${Math.floor(durationSeconds / 3600)}h${String(Math.floor((durationSeconds % 3600) / 60)).padStart(2, '0')}`,
        totalCost,
        totalCostFormatted: `${Math.round(totalCost).toLocaleString('fr-FR')} TND`,
        unpricedTasks,
        contributors,
        // Billing for the same client over the same period. `remainingToPay`
        // stays derived rather than summed from the documents, so it can never
        // disagree with the two figures shown beside it.
        invoiceCount: invoiceBuckets.get(key)?.count ?? 0,
        netToPay: round3(invoiceBuckets.get(key)?.netToPay ?? 0),
        totalPaid: round3(invoiceBuckets.get(key)?.paid ?? 0),
        remainingToPay: round3((invoiceBuckets.get(key)?.netToPay ?? 0) - (invoiceBuckets.get(key)?.paid ?? 0)),
      };
    }).sort((a, b) => b.totalCost - a.totalCost || b.netToPay - a.netToPay || b.durationSeconds - a.durationSeconds);

    if (isAdminViewer) {
      return res.json({ globalStats, employeeStats, clientStats });
    }

    // Employer cost is admin-only. A supervisor still gets the whole dashboard,
    // just without any money figures — stripped server-side, not merely hidden.
    // Every money field, not just employer cost: what a client was invoiced
    // and has paid is exactly as confidential, and hiding it in the UI alone
    // would still ship it over the wire.
    const stripCost = ({
      totalCost, totalCostFormatted, hourlyRate, cost,
      netToPay, totalPaid, remainingToPay, invoiceCount,
      ...rest
    }: any) => rest;
    res.json({
      globalStats: stripCost({ ...globalStats, tasksWithoutRate: undefined }),
      employeeStats: scopedEmployeeStats.map((e: any) => ({
        ...stripCost(e),
        tasks: stripCost(e.tasks),
      })),
      clientStats: clientStats.map((c: any) => ({
        ...stripCost(c),
        contributors: c.contributors.map(stripCost),
      })),
    });
  } catch (error) {
    console.error('KPI error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


  app.post('/api/clients', authenticate, requirePermission('CREATE_CLIENTS'), async (req: any, res: any) => {
    try {
      const { name, type, email, phone, address, city, country, taxId, status, notes, customFields } = req.body;
      
      if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Client name is required' });
      }

      const newClient = await db.createClient({
        id: Date.now(),
        name: name.trim(),
        type: type || 'Company',
        email: email ? email.trim() : '',
        phone: phone ? phone.trim() : '',
        address: address ? address.trim() : '',
        city: city ? city.trim() : '',
        country: country ? country.trim() : '',
        taxId: taxId ? taxId.trim() : '',
        status: status || 'Active',
        notes: notes || '',
        customFields: customFields || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: req.user.id
      });
      
      res.status(201).json(newClient);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/clients/:id
  app.put('/api/clients/:id', authenticate, requirePermission('EDIT_CLIENTS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, type, email, phone, address, city, country, taxId, status, notes, customFields } = req.body;
      
      if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Client name is required' });
      }

      const updates = {
        name: name.trim(),
        type: type || 'Company',
        email: email ? email.trim() : '',
        phone: phone ? phone.trim() : '',
        address: address ? address.trim() : '',
        city: city ? city.trim() : '',
        country: country ? country.trim() : '',
        taxId: taxId ? taxId.trim() : '',
        status: status || 'Active',
        notes: notes || '',
        customFields: customFields || {},
        updatedAt: new Date().toISOString()
      };
      
      const updated = await db.updateClient(id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Client not found' });
      }
      
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/clients/:id
  app.delete('/api/clients/:id', authenticate, requirePermission('DELETE_CLIENTS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      // For now we'll do soft delete by marking as Inactive to preserve historical data
      const updated = await db.updateClient(id, { status: 'Inactive', updatedAt: new Date().toISOString() });
      if (!updated) {
        return res.status(404).json({ error: 'Client not found' });
      }
      res.json({ success: true, message: 'Client marked as Inactive' });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Services API Routes
  // ---------------------------------------------------------

  // GET /api/services
  app.get('/api/services', authenticate, async (req: any, res: any) => {
    try {
      const services = await db.getAllServices();
      res.json(services);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/services
  app.post('/api/services', authenticate, requirePermission('MANAGE_SERVICES'), async (req: any, res: any) => {
    try {
      const { name, clientId } = req.body;
      if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Service name is required' });
      }

      const newService = await db.createService({
        id: Date.now(),
        name: name.trim(),
        clientId: clientId || null,
        createdAt: new Date().toISOString()
      });
      
      res.status(201).json(newService);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/services/:id
  app.put('/api/services/:id', authenticate, requirePermission('MANAGE_SERVICES'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, clientId } = req.body;
      
      if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Service name is required' });
      }

      const updates = {
        name: name.trim(),
        clientId: clientId || null,
        updatedAt: new Date().toISOString()
      };
      
      const updated = await db.updateService(id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Service not found' });
      }
      
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/services/:id — removes the mission and its types de tâches
  app.delete('/api/services/:id', authenticate, requirePermission('MANAGE_SERVICES'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const removed = await db.deleteService(id);
      if (!removed) return res.status(404).json({ error: 'Service not found' });
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Types de tâches — each belongs to a mission (service)
  // ---------------------------------------------------------

  // GET /api/task-types[?serviceId=]
  app.get('/api/task-types', authenticate, async (req: any, res: any) => {
    try {
      let taskTypes = await db.getAllTaskTypes();
      if (req.query.serviceId) {
        const sid = parseInt(req.query.serviceId, 10);
        taskTypes = taskTypes.filter((t: any) => t.serviceId === sid);
      }
      res.json(taskTypes);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/task-types', authenticate, requirePermission('MANAGE_SERVICES'), async (req: any, res: any) => {
    try {
      const { name, serviceId } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Task type name is required' });
      }
      const sid = parseInt(serviceId, 10);
      if (!Number.isFinite(sid) || !(await db.getServiceById(sid))) {
        return res.status(400).json({ error: 'A valid mission is required' });
      }
      const created = await db.createTaskType({
        id: Date.now(),
        name: name.trim(),
        serviceId: sid,
        createdAt: new Date().toISOString(),
      });
      res.status(201).json(created);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/task-types/:id', authenticate, requirePermission('MANAGE_SERVICES'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, serviceId } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Task type name is required' });
      }
      const updates: any = { name: name.trim(), updatedAt: new Date().toISOString() };
      if (serviceId !== undefined) {
        const sid = parseInt(serviceId, 10);
        if (!Number.isFinite(sid) || !(await db.getServiceById(sid))) {
          return res.status(400).json({ error: 'A valid mission is required' });
        }
        updates.serviceId = sid;
      }
      const updated = await db.updateTaskType(id, updates);
      if (!updated) return res.status(404).json({ error: 'Task type not found' });
      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/task-types/:id', authenticate, requirePermission('MANAGE_SERVICES'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const removed = await db.deleteTaskType(id);
      if (!removed) return res.status(404).json({ error: 'Task type not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Presence (actif / absent / inactif)
  // ---------------------------------------------------------

  /**
   * Deliberately in memory, not in the JSON database: presence is ephemeral and
   * every user heartbeats every 30s, which would rewrite the whole database file
   * dozens of times a minute. Losing it on restart is correct — everyone simply
   * shows as inactive until their next heartbeat lands.
   */
  const presence = new Map<number, { lastSeenAt: number; lastActivityAt: number }>();

  /**
   * The server owns this decision. A client can report how long it has been
   * idle, but it cannot report that its own machine is off — that is only
   * visible here, as heartbeats that stopped arriving.
   */
  /**
   * The away threshold is configurable, and presence is evaluated on every
   * heartbeat from every user, so it is cached rather than re-read from the
   * database each time. A few seconds of staleness after an admin changes it is
   * irrelevant to a 30-minute threshold.
   */
  let awayMsCache = { value: DEFAULT_AWAY_AFTER_MINUTES * 60 * 1000, at: 0 };
  const awayAfterMs = async () => {
    if (Date.now() - awayMsCache.at < 10_000) return awayMsCache.value;
    const settings = await db.getSettings();
    const value = clampAwayMinutes(settings?.awayAfterMinutes ?? DEFAULT_AWAY_AFTER_MINUTES) * 60 * 1000;
    awayMsCache = { value, at: Date.now() };
    return value;
  };

  const presenceStateOf = (
    rec: { lastSeenAt: number; lastActivityAt: number } | undefined,
    awayMs: number,
  ): PresenceState => {
    if (!rec) return 'INACTIVE';
    const now = Date.now();
    if (now - rec.lastSeenAt > OFFLINE_AFTER_MS) return 'INACTIVE';
    if (now - rec.lastActivityAt >= awayMs) return 'AWAY';
    return 'ACTIVE';
  };

  const presenceFor = (userId: number, awayMs: number) => {
    const rec = presence.get(userId);
    const state = presenceStateOf(rec, awayMs);
    return {
      state,
      // Idle time is meaningless once we've lost contact.
      idleMs: rec && state !== 'INACTIVE' ? Date.now() - rec.lastActivityAt : null,
      lastSeenAt: rec ? new Date(rec.lastSeenAt).toISOString() : null,
    };
  };

  /** Heartbeat. `idleMs` = time since this user last touched mouse or keyboard. */
  app.post('/api/presence', authenticate, async (req: any, res: any) => {
    const now = Date.now();
    const awayMs = await awayAfterMs();
    const reported = Number(req.body?.idleMs);
    const idleMs = Number.isFinite(reported) && reported >= 0 ? Math.min(reported, awayMs * 6) : 0;
    presence.set(req.user.id, { lastSeenAt: now, lastActivityAt: now - idleMs });
    res.json({ userId: req.user.id, ...presenceFor(req.user.id, awayMs) });
  });

  /**
   * The away threshold, readable by anyone (the browser needs it to show its
   * own badge without waiting for the next poll) and writable only with
   * MANAGE_PRESENCE_SETTINGS. The server still decides every state — this only
   * tells the client which threshold it is being judged against.
   */
  app.get('/api/presence/settings', authenticate, async (_req: any, res: any) => {
    const settings = await db.getSettings();
    res.json({ awayAfterMinutes: clampAwayMinutes(settings?.awayAfterMinutes ?? DEFAULT_AWAY_AFTER_MINUTES) });
  });

  app.put('/api/presence/settings', authenticate, requirePermission('MANAGE_PRESENCE_SETTINGS'), async (req: any, res: any) => {
    const raw = req.body?.awayAfterMinutes;
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(Number(raw))) {
      return res.status(400).json({ error: 'awayAfterMinutes doit être un nombre de minutes.' });
    }
    const awayAfterMinutes = clampAwayMinutes(raw);
    await db.updateSettings({ awayAfterMinutes });
    awayMsCache = { value: awayAfterMinutes * 60 * 1000, at: Date.now() };
    res.json({ awayAfterMinutes });
  });

  /** Sent on logout / tab close so the user drops to inactive immediately. */
  app.post('/api/presence/offline', authenticate, (req: any, res: any) => {
    presence.delete(req.user.id);
    res.json({ success: true });
  });

  /** Presence of every known user, keyed by id. */
  app.get('/api/presence', authenticate, async (req: any, res: any) => {
    try {
      const users = await db.getAllUsers();
      const awayMs = await awayAfterMs();
      const byUser: Record<string, any> = {};
      for (const u of users) byUser[u.id] = presenceFor(u.id, awayMs);
      res.json(byUser);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Cash / Facturation
  // ---------------------------------------------------------

  /**
   * The totals cascade from the cahier des charges. Computed server-side so a
   * stored document can never disagree with its own lines:
   *   (3)=(1)+(2)   (5)=(3)*(4)   (7)=(3)-(5)+(6)   (10)=(7)+(8)-(9)
   * Under "Suspension de TVA" no VAT is charged, so (2) is zero.
   */
  const computeInvoiceTotals = (invoice: any) => {
    const suspended = invoice.vatRegime === 'SUSPENSION';
    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];


    let totalHT = 0;
    const vatByRate = new Map<number, number>();
    for (const line of lines) {
      const ht = num(Number(line.montantHT), 0);
      totalHT += ht;
      const rate = suspended ? 0 : num(Number(line.vatRate), 0);
      vatByRate.set(rate, (vatByRate.get(rate) || 0) + ht);
    }

    const vatBreakdown = [...vatByRate.entries()]
      .filter(([rate]) => !suspended && rate > 0)
      .map(([rate, base]) => ({ rate, base: round3(base), amount: round3(base * rate) }))
      .sort((a, b) => a.rate - b.rate);

    const totalHTr = round3(totalHT);
    const totalVAT = round3(vatBreakdown.reduce((s, v) => s + v.amount, 0));
    const totalTTC = round3(totalHTr + totalVAT);                                   // (3)
    const withholdingRate = num(Number(invoice.withholdingRate), 0);                // (4)
    const withholdingAmount = round3(totalTTC * withholdingRate);                   // (5)
    const stampDuty = num(Number(invoice.stampDuty), 0);                            // (6)
    const netToPay = round3(totalTTC - withholdingAmount + stampDuty);              // (7)
    const disbursements = num(Number(invoice.disbursements), 0);                    // (8)
    const advances = num(Number(invoice.advances), 0);                              // (9)
    const totalNetToPay = round3(netToPay + disbursements - advances);              // (10)

    return {
      vatBreakdown,
      totalHT: totalHTr,
      totalVAT,
      totalTTC,
      withholdingRate,
      withholdingAmount,
      stampDuty,
      netToPay,
      disbursements,
      advances,
      totalNetToPay,
    };
  };

  /**
   * Encaissements — what the client has actually paid against a document.
   *
   * A document can be settled in several instalments, so this is a *list*, each
   * entry carrying its own amount and date; the two figures shown in the Cash
   * table are derived from it and never stored independently:
   *
   *   totalPaid     = sum of the encaissements
   *   remainingToPay = (10) total net à payer − totalPaid
   *
   * Deliberately outside `computeInvoiceTotals()`, which owns the numbered
   * cascade (1)–(10) of the cahier des charges and stops at (10). Payments come
   * after the document is issued and must not shift any of those numbers.
   *
   * `remainingToPay` may go negative (an overpayment); that is surfaced rather
   * than clamped, because silently showing 0 would hide a real accounting error.
   */
  const normalizePayments = (rawPayments: any): any[] => {
    if (!Array.isArray(rawPayments)) return [];
    return rawPayments
      .map((p: any) => ({
        id: String(p?.id || `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        amount: round3(num(Number(p?.amount), 0)),
        date: String(p?.date || '').slice(0, 10),
        note: String(p?.note || '').trim(),
      }))
      .filter((p: any) => p.date && Number.isFinite(p.amount))
      // Chronological, so the table reads as a payment history.
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
  };

  /**
   * Dates may not decrease along the legal sequence.
   *
   * Numbering and chronology have to agree: invoice n° 2 cannot be dated before
   * n° 1. Two invoices *may* share a date — only going backwards is refused.
   *
   * Both ends are checked, which is what creation alone could not do. A new
   * invoice always takes the highest number, so it only ever had a predecessor;
   * an *edit* sits in the middle of the sequence, and moving n° 2 later than
   * n° 3 breaks the ordering just as surely as moving it before n° 1.
   *
   * Pass `Infinity` as the number for a document being created, before its
   * number is reserved: it is by definition the last one.
   *
   * Returns an error message, or null when the date is acceptable.
   */
  const legalSequenceDateError = (
    allInvoices: any[],
    selfId: string | null,
    number: number,
    issueDate: string,
  ): string | null => {
    const others = allInvoices
      .filter((i: any) => i.documentKind !== 'AUTRE' && i.id !== selfId && i.issueDate)
      .map((i: any) => ({ n: Number(i.number), label: String(i.number), date: String(i.issueDate) }))
      .filter((i: any) => Number.isFinite(i.n));

    const previous = others.filter(i => i.n < number).sort((a, b) => b.n - a.n)[0];
    if (previous && issueDate < previous.date) {
      return `La date ne peut pas précéder celle de la facture n° ${previous.label} (${previous.date}).`;
    }

    const following = others.filter(i => i.n > number).sort((a, b) => a.n - b.n)[0];
    if (following && issueDate > following.date) {
      return `La date ne peut pas suivre celle de la facture n° ${following.label} (${following.date}).`;
    }
    return null;
  };

  const computePaymentState = (totalNetToPay: number, rawPayments: any) => {
    const payments = normalizePayments(rawPayments);
    const totalPaid = round3(payments.reduce((sum: number, p: any) => sum + p.amount, 0));
    return { payments, totalPaid, remainingToPay: round3(totalNetToPay - totalPaid) };
  };

  app.get('/api/invoices', authenticate, requirePermission('VIEW_CASH'), async (req: any, res: any) => {
    try {
      const all = await db.getAllInvoices();
      const q = String(req.query.q || '').toLowerCase();
      const filtered = q
        ? all.filter((i: any) =>
            (i.number || '').toLowerCase().includes(q) ||
            (i.clientName || '').toLowerCase().includes(q) ||
            (i.title || '').toLowerCase().includes(q))
        : all;
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
      const offset = parseInt(req.query.offset, 10) || 0;
      res.json({ data: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/invoices/:id', authenticate, requirePermission('VIEW_CASH'), async (req: any, res: any) => {
    try {
      const invoice = await db.getInvoiceById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Document introuvable' });
      res.json(invoice);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** Peek at the number the next document will get (display only; not reserved). */
  app.get('/api/invoices/meta/next-number', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const settings = await db.getSettings();
      const current = typeof settings.invoiceCounter === 'number' ? settings.invoiceCounter : 0;
      const all = await db.getAllInvoices();
      // Only the legal sequence carries the date rule, so only a *legal*
      // invoice can bound the next one. Returning the newest document of any
      // kind let an autre document — which is exempt — set a floor the server
      // would never have enforced.
      const lastLegal = all.find((i: any) => i.documentKind !== 'AUTRE');
      res.json({
        nextNumber: String(current + 1).padStart(4, '0'),
        lastIssueDate: lastLegal ? lastLegal.issueDate : null,
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/invoices', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const body = req.body || {};
      if (!body.clientId && !body.clientName) {
        return res.status(400).json({ error: 'La raison sociale du client est obligatoire' });
      }
      if (!body.issueDate) {
        return res.status(400).json({ error: 'La date de création est obligatoire' });
      }
      if (!Array.isArray(body.lines) || body.lines.length === 0) {
        return res.status(400).json({ error: 'Au moins une ligne est requise' });
      }
      if (body.lines.some((l: any) => !String(l.designation || '').trim())) {
        return res.status(400).json({ error: 'Chaque ligne doit avoir une désignation' });
      }

      const kind = body.documentKind === 'AUTRE' ? 'AUTRE' : 'FACTURE_LEGALE';
      const all = await db.getAllInvoices();

      // Only a legal invoice is bound to the sequence. "Autre document" carries
      // a free reference (bon de livraison, reçu…), so it neither follows the
      // sequence nor consumes a number from it — doing so would punch gaps in
      // the legal numbering.
      let number: string;
      if (kind === 'AUTRE') {
        number = String(body.number ?? '').trim();
        if (!number) {
          return res.status(400).json({ error: 'Le numéro du document est obligatoire' });
        }
        if (all.some((i: any) => i.number === number)) {
          return res.status(400).json({ error: `Le numéro « ${number} » est déjà utilisé.` });
        }
      } else {
        // The ordering rule belongs to the sequence, so it applies to legal
        // invoices only. A new one is always last, hence Infinity.
        const dateError = legalSequenceDateError(all, null, Infinity, body.issueDate);
        if (dateError) return res.status(400).json({ error: dateError });
      }

      const totals = computeInvoiceTotals(body);
      const paymentState = computePaymentState(totals.totalNetToPay, body.payments);
      if (kind !== 'AUTRE') number = await db.nextInvoiceNumber();

      const invoice = await db.createInvoice({
        id: `inv-${Date.now()}`,
        number,
        documentKind: kind,
        title: String(body.title || 'Facture').trim(),
        billingMode: body.billingMode === 'DETAILLEE' ? 'DETAILLEE' : 'FORFAIT',
        vatRegime: body.vatRegime === 'SUSPENSION' ? 'SUSPENSION' : 'DROIT_COMMUN',
        clientId: body.clientId ?? null,
        clientName: body.clientName || '',
        clientTaxId: body.clientTaxId || '',
        clientAddress: body.clientAddress || '',
        customFields: body.customFields && typeof body.customFields === 'object' ? body.customFields : {},
        issueDate: body.issueDate,
        dueDate: body.dueDate || '',
        showDueDate: body.showDueDate !== false,
        lines: body.lines.map((l: any) => ({
          designation: String(l.designation || '').trim(),
          quantity: num(Number(l.quantity), 1),
          unitPrice: num(Number(l.unitPrice), 0),
          vatRate: num(Number(l.vatRate), 0),
          montantHT: num(Number(l.montantHT), 0),
        })),
        ...totals,
        ...paymentState,
        createdBy: req.user.id,
        createdAt: new Date().toISOString(),
      });

      res.status(201).json(invoice);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/invoices/:id', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const existing = await db.getInvoiceById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Document introuvable' });

      const merged = { ...existing, ...req.body };

      // A legal invoice's number belongs to the sequence and is never
      // reassigned; a free document's may be corrected.
      if (merged.documentKind === 'AUTRE') {
        const wanted = String(req.body?.number ?? existing.number ?? '').trim();
        if (!wanted) {
          return res.status(400).json({ error: 'Le numéro du document est obligatoire' });
        }
        const all = await db.getAllInvoices();
        if (all.some((i: any) => i.id !== existing.id && i.number === wanted)) {
          return res.status(400).json({ error: `Le numéro « ${wanted} » est déjà utilisé.` });
        }
        merged.number = wanted;
      } else {
        merged.number = existing.number;
      }

      if (!merged.clientId && !merged.clientName) {
        return res.status(400).json({ error: 'La raison sociale du client est obligatoire' });
      }
      if (!merged.issueDate) {
        return res.status(400).json({ error: 'La date de création est obligatoire' });
      }
      if (!Array.isArray(merged.lines) || merged.lines.length === 0) {
        return res.status(400).json({ error: 'Au moins une ligne est requise' });
      }
      if (merged.lines.some((l: any) => !String(l.designation || '').trim())) {
        return res.status(400).json({ error: 'Chaque ligne doit avoir une désignation' });
      }
      // Editing bypassed the ordering rule entirely, so a legal invoice created
      // in order could be moved to any date afterwards.
      if (merged.documentKind !== 'AUTRE') {
        const dateError = legalSequenceDateError(
          await db.getAllInvoices(), existing.id, Number(merged.number), merged.issueDate,
        );
        if (dateError) return res.status(400).json({ error: dateError });
      }
      const totals = computeInvoiceTotals(merged);
      const paymentState = computePaymentState(totals.totalNetToPay, merged.payments);

      const updated = await db.updateInvoice(req.params.id, {
        ...merged,
        ...totals,
        ...paymentState,
        updatedAt: new Date().toISOString(),
      });
      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/invoices/:id', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const removed = await db.deleteInvoice(req.params.id);
      if (!removed) return res.status(404).json({ error: 'Document introuvable' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // HR API Routes
  // ---------------------------------------------------------

  // GET Approvers
  app.get('/api/hr/approvers', authenticate, requirePermission('VIEW_HR'), async (req: any, res: any) => {
    try {
      const users = await db.getAllUsers();
      // Allow ADMIN, MANAGER, SUPERVISOR to be approvers
      const approvers = users.filter((u: any) => HR_APPROVER_ROLES.includes(u.role));
      res.json(approvers.map((u: any) => ({ id: u.id, name: u.username, role: u.role })));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET Leave Requests
  app.get('/api/hr/leaves', authenticate, requirePermission('VIEW_HR'), async (req: any, res: any) => {
    try {
      const leaves = await db.getAllLeaveRequests();
      let result = leaves;
      
      if (req.user.role !== 'ADMIN') {
        result = leaves.filter((l: any) => l.userId === req.user.id || l.approverId === req.user.id);
      }
      
      const users = await db.getAllUsers();
      result = result.map((l: any) => ({
        ...l,
        userName: users.find((u: any) => u.id === l.userId)?.username || 'Unknown',
        approverName: users.find((u: any) => u.id === l.approverId)?.username || 'Unknown',
        approvedByName: l.approvedBy ? users.find((u: any) => u.id === l.approvedBy)?.username : null
      }));

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Leave Request
  app.post('/api/hr/leaves', authenticate, requirePermission('CREATE_LEAVE_REQUEST'), async (req: any, res: any) => {
    try {
      const { type, startDate, endDate, duration, reason, approverId } = req.body;
      const leave = await db.createLeaveRequest({
        id: Date.now(),
        userId: req.user.id,
        approverId: Number(approverId),
        type,
        startDate,
        endDate,
        duration: Number(duration),
        reason,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      res.status(201).json(leave);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Approve Leave
  app.post('/api/hr/leaves/:id/approve', authenticate, requirePermission('MANAGE_LEAVE_REQUESTS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const leave = await db.getLeaveRequestById(id);
      if (!leave) return res.status(404).json({ error: 'Not found' });
      
      // Ensure the user is the assigned approver or an Admin
      if (leave.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to approve this request.' });
      }

      if (leave.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      // Deduct balance
      const balance = await db.getLeaveBalanceByUserId(leave.userId);
      if (balance.available < leave.duration) {
        return res.status(400).json({ error: 'Insufficient leave balance' });
      }

      // Only `used` moves; `available` is derived from the admin-set entitlement.
      await db.updateLeaveBalance(leave.userId, { used: balance.used + leave.duration });

      const updated = await db.updateLeaveRequest(id, {
        status: 'APPROVED',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        approverComment: req.body.comment || '',
        updatedAt: new Date().toISOString()
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Reject Leave
  app.post('/api/hr/leaves/:id/reject', authenticate, requirePermission('MANAGE_LEAVE_REQUESTS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { comment } = req.body;
      if (!comment) return res.status(400).json({ error: 'Rejection reason required' });

      const leave = await db.getLeaveRequestById(id);
      if (!leave) return res.status(404).json({ error: 'Not found' });
      
      // Ensure the user is the assigned approver or an Admin
      if (leave.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to reject this request.' });
      }

      if (leave.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      const updated = await db.updateLeaveRequest(id, {
        status: 'REJECTED',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        rejectionReason: comment,
        approverComment: comment,
        updatedAt: new Date().toISOString()
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Cancel Leave
  app.post('/api/hr/leaves/:id/cancel', authenticate, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const leave = await db.getLeaveRequestById(id);
      if (!leave) return res.status(404).json({ error: 'Not found' });
      
      const perms = JSON.parse(req.user.permissions || '[]');
      if (leave.userId !== req.user.id && !perms.includes('MANAGE_LEAVE_REQUESTS')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (leave.status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled' });
      
      // If it was approved, we must restore the balance
      if (leave.status === 'APPROVED') {
        const balance = await db.getLeaveBalanceByUserId(leave.userId);
        await db.updateLeaveBalance(leave.userId, {
          used: Math.max(0, balance.used - leave.duration),
        });
      }

      const updated = await db.updateLeaveRequest(id, {
        status: 'CANCELLED',
        updatedAt: new Date().toISOString()
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET Absence Authorizations
  app.get('/api/hr/authorizations', authenticate, requirePermission('VIEW_HR'), async (req: any, res: any) => {
    try {
      const auths = await db.getAllAbsenceAuthorizations();
      let result = auths;
      
      if (req.user.role !== 'ADMIN') {
        result = auths.filter((a: any) => a.userId === req.user.id || a.approverId === req.user.id);
      }
      
      const users = await db.getAllUsers();
      result = result.map((a: any) => ({
        ...a,
        userName: users.find((u: any) => u.id === a.userId)?.username || 'Unknown',
        approverName: users.find((u: any) => u.id === a.approverId)?.username || 'Unknown',
        approvedByName: a.approvedBy ? users.find((u: any) => u.id === a.approvedBy)?.username : null
      }));
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Absence Authorization
  app.post('/api/hr/authorizations', authenticate, requirePermission('CREATE_ABSENCE_AUTHORIZATION'), async (req: any, res: any) => {
    try {
      const { date, startTime, endTime, duration, reason, comment, approverId } = req.body;
      const auth = await db.createAbsenceAuthorization({
        id: Date.now(),
        userId: req.user.id,
        approverId: Number(approverId),
        date,
        startTime,
        endTime,
        duration: Number(duration),
        reason,
        comment,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      res.status(201).json(auth);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Approve Auth
  app.post('/api/hr/authorizations/:id/approve', authenticate, requirePermission('MANAGE_ABSENCE_AUTHORIZATIONS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const auth = await db.getAbsenceAuthorizationById(id);
      if (!auth) return res.status(404).json({ error: 'Not found' });
      
      if (auth.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to approve this request.' });
      }

      if (auth.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      const updated = await db.updateAbsenceAuthorization(id, {
        status: 'APPROVED',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        approverComment: req.body.comment || '',
        updatedAt: new Date().toISOString()
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Reject Auth
  app.post('/api/hr/authorizations/:id/reject', authenticate, requirePermission('MANAGE_ABSENCE_AUTHORIZATIONS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { comment } = req.body;
      if (!comment) return res.status(400).json({ error: 'Rejection reason required' });

      const auth = await db.getAbsenceAuthorizationById(id);
      if (!auth) return res.status(404).json({ error: 'Not found' });
      
      if (auth.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to reject this request.' });
      }

      if (auth.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      const updated = await db.updateAbsenceAuthorization(id, {
        status: 'REJECTED',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        rejectionReason: comment,
        approverComment: comment,
        updatedAt: new Date().toISOString()
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Cancel Auth
  app.post('/api/hr/authorizations/:id/cancel', authenticate, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const auth = await db.getAbsenceAuthorizationById(id);
      if (!auth) return res.status(404).json({ error: 'Not found' });
      
      const perms = JSON.parse(req.user.permissions || '[]');
      if (auth.userId !== req.user.id && !perms.includes('MANAGE_ABSENCE_AUTHORIZATIONS')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (auth.status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled' });

      const updated = await db.updateAbsenceAuthorization(id, {
        status: 'CANCELLED',
        updatedAt: new Date().toISOString()
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET Leave Balance
  app.get('/api/hr/balance', authenticate, async (req: any, res: any) => {
    try {
      const balance = await db.getLeaveBalanceByUserId(req.user.id);
      res.json(balance);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Chat (direct messages) API Routes & SSE
  // ---------------------------------------------------------

  // Any authenticated user can message any other user — this is a small
  // internal team tool, not a permission-gated feature like Clients or Cash.
  // Connections are kept per-user so a new message is only pushed to the two
  // people involved, never broadcast to everyone like the time-entries feed.
  const chatSseClients = new Map<number, Set<any>>();

  const sendToUser = (userId: number, payload: any) => {
    const conns = chatSseClients.get(userId);
    if (!conns || conns.size === 0) return;
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of conns) res.write(frame);
  };

  // GET /api/messages/contacts — the roster to start a conversation with.
  // Deliberately open to every authenticated user (not gated on MANAGE_USERS),
  // since a collaborator needs to see who they can message.
  app.get('/api/messages/contacts', authenticate, async (req: any, res: any) => {
    try {
      const allUsers = await db.getAllUsers();
      const messages = await db.getAllMessages();
      const contacts = allUsers
        .filter((u: any) => u.id !== req.user.id)
        .map((u: any) => {
          const thread = messages.filter((m: any) =>
            (m.fromUserId === req.user.id && m.toUserId === u.id) ||
            (m.fromUserId === u.id && m.toUserId === req.user.id)
          );
          const last = thread[thread.length - 1];
          const unreadCount = thread.filter((m: any) => m.toUserId === req.user.id && m.fromUserId === u.id && !m.readAt).length;
          return {
            id: u.id,
            username: u.username,
            fullName: u.fullName || u.username,
            role: u.role,
            lastMessage: last ? { body: last.body, createdAt: last.createdAt, fromUserId: last.fromUserId } : null,
            unreadCount,
          };
        })
        .sort((a: any, b: any) => {
          const ta = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
          const tb = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
          if (ta !== tb) return tb - ta;
          return a.fullName.localeCompare(b.fullName);
        });
      res.json(contacts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/messages/unread-count — total across every conversation, for the sidebar badge.
  app.get('/api/messages/unread-count', authenticate, async (req: any, res: any) => {
    try {
      const messages = await db.getAllMessages();
      const count = messages.filter((m: any) => m.toUserId === req.user.id && !m.readAt).length;
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/messages/thread/:userId — the DM thread with one other user.
  // Marks their messages to me as read as a side effect, and tells their
  // live connections (if any) that I've read them.
  app.get('/api/messages/thread/:userId', authenticate, async (req: any, res: any) => {
    try {
      const otherId = parseInt(req.params.userId, 10);
      if (!Number.isFinite(otherId)) return res.status(400).json({ error: 'Invalid userId' });

      const messages = await db.getAllMessages();
      const thread = messages
        .filter((m: any) =>
          (m.fromUserId === req.user.id && m.toUserId === otherId) ||
          (m.fromUserId === otherId && m.toUserId === req.user.id)
        )
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const changed = await db.markMessagesRead(req.user.id, otherId);
      if (changed > 0) {
        sendToUser(otherId, { type: 'read', by: req.user.id });
      }

      res.json(thread);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/messages — send a DM.
  app.post('/api/messages', authenticate, async (req: any, res: any) => {
    try {
      const toUserId = parseInt(req.body?.toUserId, 10);
      const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
      if (!Number.isFinite(toUserId)) return res.status(400).json({ error: 'toUserId is required' });
      if (!body) return res.status(400).json({ error: 'Message body is required' });
      if (body.length > 4000) return res.status(400).json({ error: 'Message too long' });

      const recipient = await db.get('SELECT * FROM users WHERE id = ?', toUserId);
      if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

      const message = await db.createMessage({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromUserId: req.user.id,
        toUserId,
        body,
        createdAt: new Date().toISOString(),
        readAt: null,
      });

      res.status(201).json(message);
      sendToUser(toUserId, { type: 'message', message });
      sendToUser(req.user.id, { type: 'message', message });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/messages/stream — SSE. Pushes new messages and read receipts
  // that involve this user. Token comes from the query string, same reason
  // as the time-entries stream: EventSource can't set an Authorization header.
  app.get('/api/messages/stream', authenticate, (req: any, res: any) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const userId = req.user.id;
    if (!chatSseClients.has(userId)) chatSseClients.set(userId, new Set());
    chatSseClients.get(userId)!.add(res);

    req.on('close', () => {
      const conns = chatSseClients.get(userId);
      if (conns) {
        conns.delete(res);
        if (conns.size === 0) chatSseClients.delete(userId);
      }
    });
  });

  // ---------------------------------------------------------
  // Time Tracking API Routes & SSE
  // ---------------------------------------------------------

  const sseClients = new Set<any>();

  /**
   * Adds the live elapsed time, the owner's name, and the cost of the task.
   *
   * The rate is the one **snapshotted on the entry when it was created**, never
   * the collaborator's current rate: raising a salary must not retroactively
   * re-price work already logged at the old salary.
   *
   * Cost is employer-confidential, so `hourlyRate`/`cost` are only included for
   * admins — stripping them in the UI alone would still leak them over the wire.
   */
  /**
   * An admin's own tasks are not shown to anybody else — they are management
   * work, not part of the team's shared activity feed.
   *
   * Enforced here rather than hidden in the UI, so the rows never reach a
   * non-admin client over the wire, and applied *before* pagination so the
   * page size and the `total` count both describe what the viewer can see.
   */
  const visibleEntriesFor = (entries: any[], viewerIsAdmin: boolean, adminIds: Set<number>) =>
    viewerIsAdmin ? entries : entries.filter((e: any) => !adminIds.has(e.userId));

  const adminUserIds = async () =>
    new Set<number>(
      (await db.getAllUsers()).filter((u: any) => u.role === 'ADMIN').map((u: any) => u.id),
    );

  const enrichEntries = async (entries: any[], forAdmin: boolean) => {
    const users = await db.getAllUsers();
    // Indexed once: a find() in here is a linear scan per task.
    const usersById = new Map<number, any>(users.map((u: any) => [u.id, u]));
    return entries.map((e: any) => {
      const secs = accruedSeconds(e);
      const base = {
        ...e,
        dureeSeconds: secs,
        userName: usersById.get(e.userId)?.username || 'Unknown',
      };
      if (!forAdmin) {
        delete base.hourlyRate;
        return base;
      }
      // null => no employer cost was configured for this person at the time
      const rate = typeof e.hourlyRate === 'number' ? e.hourlyRate : null;
      return { ...base, hourlyRate: rate, cost: rate === null ? null : (secs / 3600) * rate };
    });
  };

  /**
   * How many entries a client holds at once. Entries are stored newest-first,
   * and the UI is a recent-activity view, so a page of this size covers what is
   * on screen. Without a cap, every mutation would push the entire history to
   * every connected user — at dozens of users and thousands of entries that is
   * the single most expensive thing the server does.
   */
  const ENTRIES_PAGE_SIZE = 200;

  const doBroadcast = async () => {
    const raw = await db.getAllTimeEntries();
    const adminIds = await adminUserIds();
    // Two payloads only: admins get the cost fields and every row, everyone
    // else gets neither. Both axes split admin/non-admin, so one frame each.
    const cache: Record<string, string> = {};
    for (const client of sseClients) {
      const key = client.isAdmin ? 'admin' : 'plain';
      if (!cache[key]) {
        const visible = visibleEntriesFor(raw, client.isAdmin, adminIds);
        const data = await enrichEntries(visible.slice(0, ENTRIES_PAGE_SIZE), client.isAdmin);
        cache[key] = `data: ${JSON.stringify({ data, total: visible.length })}\n\n`;
      }
      client.res.write(cache[key]);
    }
  };

  // Coalesce bursts (pausing one task starts another, a save touches several
  // rows) into a single push instead of one per mutation.
  let broadcastTimer: NodeJS.Timeout | null = null;
  const broadcastTimeEntries = () => {
    if (broadcastTimer || sseClients.size === 0) return;
    broadcastTimer = setTimeout(async () => {
      broadcastTimer = null;
      try {
        await doBroadcast();
      } catch (e) {
        console.error('Error broadcasting time entries', e);
      }
    }, 120);
  };

  app.get('/api/time-entries/stream', authenticate, (req: any, res: any) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // flush the headers to establish SSE

    const client = { res, isAdmin: req.user.role === 'ADMIN' };
    sseClients.add(client);
    // Send this client its first frame immediately rather than waiting on the
    // coalescing timer.
    doBroadcast().catch(e => console.error('Error sending initial SSE frame', e));

    req.on('close', () => {
      sseClients.delete(client);
    });
  });

  /**
   * Pauses every other RUNNING entry belonging to `userId`, folding the elapsed
   * time into each one. Keeps the "at most one running task per person"
   * invariant no matter who triggered the change.
   */
  const pauseOtherRunningEntries = async (userId: number, keepId: string) => {
    const all = await db.getAllTimeEntries();
    for (const other of all) {
      if (other.userId !== userId || other.id === keepId || other.statut !== 'RUNNING') continue;
      const elapsed = other.lastStartedAt
        ? Math.floor((Date.now() - other.lastStartedAt) / 1000)
        : 0;
      await db.updateTimeEntry(other.id, {
        statut: 'PAUSED',
        dureeSeconds: (other.dureeSeconds || 0) + elapsed,
        lastStartedAt: null,
        heureFin: '',
      });
    }
  };

  app.get('/api/time-entries', authenticate, async (req: any, res: any) => {
    try {
      const isAdmin = req.user.role === 'ADMIN';
      const all = visibleEntriesFor(await db.getAllTimeEntries(), isAdmin, await adminUserIds());
      const limit = Math.min(parseInt(req.query.limit, 10) || ENTRIES_PAGE_SIZE, 1000);
      const offset = parseInt(req.query.offset, 10) || 0;
      const data = await enrichEntries(all.slice(offset, offset + limit), isAdmin);
      res.json({ data, total: all.length, limit, offset });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/time-entries', authenticate, async (req: any, res: any) => {
    try {
      const userFull = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
      const settings = await db.getSettings() || {};
      // Snapshot the author's employer cost. Reads resolve it live as well, so
      // this is only a record of the rate in force when the task was created.
      const hourlyRate = employerHourlyRate(userFull, settings);

      // Stamp date / heureDebut server-side so the recorded start time can't
      // drift from the client clock or locale. heureFin stays empty until the
      // task is actually completed.
      const now = new Date();
      // The client supplies an id so it can insert the row optimistically, but
      // it must never be *required*: a body without one used to be stored as a
      // row with `id: undefined`, which can then never be updated or deleted
      // (every route looks it up by id) and breaks React's keys in the table.
      const id = req.body.id || `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const statut = req.body.statut ?? 'RUNNING';
      if (statut === 'RUNNING') {
        await pauseOtherRunningEntries(req.user.id, id);
      }
      const entry = await db.createTimeEntry({
        ...req.body,
        id,
        statut,
        date: formatDateFR(now),
        heureDebut: formatTimeFR(now),
        heureFin: '',
        userId: req.user.id,
        hourlyRate: hourlyRate,
        lastStartedAt: Date.now()
      });
      res.json(entry);
      broadcastTimeEntries(); // Broadcast update
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/time-entries/:id', authenticate, async (req: any, res: any) => {
    try {
      const entryId = req.params.id;
      const existing = await db.getTimeEntryById(entryId);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      
      const perms = JSON.parse(req.user.permissions || '[]');
      if (existing.userId !== req.user.id && req.user.role !== 'ADMIN' && !perms.includes('MODIFY')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      let updates = { ...req.body };

      if (req.body.statut === 'RUNNING' && existing.statut !== 'RUNNING') {
         updates.lastStartedAt = Date.now();
         // Back in progress: an end time would be misleading.
         if (updates.heureFin === undefined) updates.heureFin = '';
      } else if (req.body.statut !== 'RUNNING' && existing.statut === 'RUNNING') {
         // Stopping or pausing
         if (existing.lastStartedAt) {
            const added = Math.floor((Date.now() - existing.lastStartedAt) / 1000);
            updates.dureeSeconds = (existing.dureeSeconds || 0) + added;
         }
         updates.lastStartedAt = null;
      }

      // Only a completed task has an end time, and the server stamps it.
      if (req.body.statut === 'COMPLETED' && existing.statut !== 'COMPLETED' && !req.body.heureFin) {
         updates.heureFin = formatTimeFR(new Date());
      } else if (req.body.statut === 'PAUSED') {
         if (updates.heureFin === undefined) updates.heureFin = '';
      }

      // One running task per person. Resuming a task (including an admin
      // resuming someone else's) pauses whatever else that person had running.
      if (req.body.statut === 'RUNNING' && existing.statut !== 'RUNNING') {
        await pauseOtherRunningEntries(existing.userId, entryId);
      }

      const updated = await db.updateTimeEntry(entryId, updates);
      res.json(updated);
      broadcastTimeEntries(); // Broadcast update
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/time-entries/:id', authenticate, async (req: any, res: any) => {
    try {
      const entryId = req.params.id;
      const existing = await db.getTimeEntryById(entryId);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      
      const perms = JSON.parse(req.user.permissions || '[]');
      if (existing.userId !== req.user.id && req.user.role !== 'ADMIN' && !perms.includes('DELETE')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      await db.deleteTimeEntry(entryId);
      res.json({ success: true });
      broadcastTimeEntries(); // Broadcast update
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Vite Middleware & SPA serving
  // ---------------------------------------------------------
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
