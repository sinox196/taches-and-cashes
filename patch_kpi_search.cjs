const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf-8');

const kpiSearchEndpoints = `
// --- KPI SEARCH ENDPOINTS ---
app.get('/api/kpi/users/search', authenticate, async (req: any, res: any) => {
  if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPERVISEUR') {
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
  if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPERVISEUR') {
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
`;

content = content.replace(
  "app.post('/api/kpi/dashboard',",
  kpiSearchEndpoints + "\napp.post('/api/kpi/dashboard',"
);

// Modify kpi/dashboard to accept filterUserIds and filterClientIds (arrays)
const kpiDashboardTarget = `const { startDate, endDate, filterUserId, filterClientId } = req.body;`;
const kpiDashboardReplacement = `const { startDate, endDate, filterUserIds, filterClientIds } = req.body;`;
content = content.replace(kpiDashboardTarget, kpiDashboardReplacement);

// Replace filter logic in kpi/dashboard
content = content.replace(/if \(filterUserId && t\.userId !== filterUserId\) return false;/g, `if (filterUserIds && filterUserIds.length > 0 && !filterUserIds.includes(t.userId)) return false;`);
content = content.replace(/if \(filterClientId && t\.clientId !== filterClientId\) return false;/g, `if (filterClientIds && filterClientIds.length > 0 && !filterClientIds.includes(t.clientId)) return false;`);
content = content.replace(/if \(filterUserId && l\.userId !== filterUserId\) return false;/g, `if (filterUserIds && filterUserIds.length > 0 && !filterUserIds.includes(l.userId)) return false;`);
content = content.replace(/if \(filterUserId && a\.userId !== filterUserId\) return false;/g, `if (filterUserIds && filterUserIds.length > 0 && !filterUserIds.includes(a.userId)) return false;`);
content = content.replace(/if \(filterUserId && emp\.id !== filterUserId\) return null;/g, `if (filterUserIds && filterUserIds.length > 0 && !filterUserIds.includes(emp.id)) return null;`);

fs.writeFileSync('server.ts', content, 'utf-8');
