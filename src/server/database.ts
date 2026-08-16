import fs from 'fs/promises';
import path from 'path';
import bcrypt from 'bcryptjs';

const DB_PATH = path.join(process.cwd(), 'local.db.json');

// In-memory cache
let db: any = {
  users: [],
  clients: [],
  services: [],
  leaveRequests: [],
  absenceAuthorizations: [],
  leaveBalances: [],
  timeEntries: [],
  settings: {
    employerCharges: {
      cnss: 16.57,
      tfp: 1.0,
      foprolos: 1.0,
      accidentTravail: 0.5
    }
  }
};

export async function initDb() {
  try {
    const data = await fs.readFile(DB_PATH, 'utf-8');
    db = JSON.parse(data);
    if (!db.clients) db.clients = [];
    if (!db.services) db.services = [];
    if (!db.leaveRequests) db.leaveRequests = [];
    if (!db.absenceAuthorizations) db.absenceAuthorizations = [];
    if (!db.leaveBalances) db.leaveBalances = [];
    if (!db.timeEntries) db.timeEntries = [];
    if (!db.settings) db.settings = {
      employerCharges: {
        cnss: 16.57,
        tfp: 1.0,
        foprolos: 1.0,
        accidentTravail: 0.5
      }
    };
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, start with empty structure
      db = { users: [], clients: [], services: [], leaveRequests: [], absenceAuthorizations: [], leaveBalances: [], timeEntries: [] };
      await saveDb();
    }
  }

  // Ensure Admin exists
  const adminIndex = db.users.findIndex((u: any) => u.username === 'admin');
  if (adminIndex === -1) {
    const hashed = await bcrypt.hash('admin123', 10);
    db.users.push({
      id: Date.now(),
      username: 'admin',
      password: hashed,
      role: 'ADMIN',
      permissions: JSON.stringify(['VIEW', 'EDIT', 'MODIFY', 'DELETE', 'MANAGE_USERS', 'VIEW_CLIENTS', 'CREATE_CLIENTS', 'EDIT_CLIENTS', 'DELETE_CLIENTS', 'MANAGE_CLIENT_FIELDS', 'MANAGE_SERVICES', 'VIEW_HR', 'CREATE_LEAVE_REQUEST', 'MANAGE_LEAVE_REQUESTS', 'CREATE_ABSENCE_AUTHORIZATION', 'MANAGE_ABSENCE_AUTHORIZATIONS'])
    });
    await saveDb();
    console.log('Created default admin account (admin / admin123)');
  } else {
     // Ensure existing admin has client permissions for backward compatibility in dev
     let perms = JSON.parse(db.users[adminIndex].permissions || '[]');
     if (!perms.includes('VIEW_HR')) {
         if (!perms.includes('VIEW_CLIENTS')) perms.push('VIEW_CLIENTS', 'CREATE_CLIENTS', 'EDIT_CLIENTS', 'DELETE_CLIENTS');
         if (!perms.includes('MANAGE_SERVICES')) perms.push('MANAGE_SERVICES');
         perms.push('VIEW_HR', 'CREATE_LEAVE_REQUEST', 'MANAGE_LEAVE_REQUESTS', 'CREATE_ABSENCE_AUTHORIZATION', 'MANAGE_ABSENCE_AUTHORIZATIONS');
         db.users[adminIndex].permissions = JSON.stringify(perms);
         await saveDb();
     }
  }

  // Ensure Collab exists
  const collabIndex = db.users.findIndex((u: any) => u.username === 'collab');
  if (collabIndex === -1) {
    const hashed = await bcrypt.hash('collab123', 10);
    db.users.push({
      id: Date.now() + 1,
      username: 'collab',
      password: hashed,
      role: 'COLLABORATOR',
      permissions: JSON.stringify(['VIEW', 'EDIT', 'MODIFY', 'DELETE', 'VIEW_CLIENTS', 'VIEW_HR', 'CREATE_LEAVE_REQUEST', 'CREATE_ABSENCE_AUTHORIZATION'])
    });
    await saveDb();
    console.log('Created default collab account (collab / collab123)');
  } else {
     // Ensure existing collab has VIEW_CLIENTS
     let perms = JSON.parse(db.users[collabIndex].permissions || '[]');
     if (!perms.includes('VIEW_HR')) {
         if (!perms.includes('VIEW_CLIENTS')) perms.push('VIEW_CLIENTS');
         perms.push('VIEW_HR', 'CREATE_LEAVE_REQUEST', 'CREATE_ABSENCE_AUTHORIZATION');
         db.users[collabIndex].permissions = JSON.stringify(perms);
         await saveDb();
     }
  }

  return {
    get: async (sql: string, param: any) => {
      if (sql.includes('WHERE username = ?')) {
        return db.users.find((u: any) => u.username === param);
      }
      if (sql.includes('WHERE id = ?')) {
        return db.users.find((u: any) => u.id === param);
      }
      return null;
    },
    getAllUsers: async () => {
      return db.users;
    },
    createUser: async (user: any) => {
      db.users.push(user);
      await saveDb();
      return user;
    },
    updateUser: async (id: number, updates: any) => {
      const index = db.users.findIndex((u: any) => u.id === id);
      if (index !== -1) {
        db.users[index] = { ...db.users[index], ...updates };
        await saveDb();
        return db.users[index];
      }
      return null;
    },
    deleteUser: async (id: number) => {
      const index = db.users.findIndex((u: any) => u.id === id);
      if (index !== -1) {
        db.users.splice(index, 1);
        await saveDb();
        return true;
      }
      return false;
    },
    // Client CRUD
    getAllClients: async () => {
      return db.clients;
    },
    getClientById: async (id: number) => {
      return db.clients.find((c: any) => c.id === id);
    },
    createClient: async (client: any) => {
      db.clients.push(client);
      await saveDb();
      return client;
    },
    updateClient: async (id: number, updates: any) => {
      const index = db.clients.findIndex((c: any) => c.id === id);
      if (index !== -1) {
        db.clients[index] = { ...db.clients[index], ...updates };
        await saveDb();
        return db.clients[index];
      }
      return null;
    },
    deleteClient: async (id: number) => {
      const index = db.clients.findIndex((c: any) => c.id === id);
      if (index !== -1) {
        // Soft delete logic can be handled at API level, but we provide this just in case
        db.clients.splice(index, 1);
        await saveDb();
        return true;
      }
      return false;
    },
    // Service CRUD
    getAllServices: async () => {
      return db.services;
    },
    getServiceById: async (id: number) => {
      return db.services.find((s: any) => s.id === id);
    },
    createService: async (service: any) => {
      db.services.push(service);
      await saveDb();
      return service;
    },
    updateService: async (id: number, updates: any) => {
      const index = db.services.findIndex((s: any) => s.id === id);
      if (index !== -1) {
        db.services[index] = { ...db.services[index], ...updates };
        await saveDb();
        return db.services[index];
      }
      return null;
    },
    // HR CRUD
    getAllLeaveRequests: async () => {
      return db.leaveRequests;
    },
    getLeaveRequestById: async (id: number) => {
      return db.leaveRequests.find((l: any) => l.id === id);
    },
    createLeaveRequest: async (leave: any) => {
      db.leaveRequests.push(leave);
      await saveDb();
      return leave;
    },
    updateLeaveRequest: async (id: number, updates: any) => {
      const index = db.leaveRequests.findIndex((l: any) => l.id === id);
      if (index !== -1) {
        db.leaveRequests[index] = { ...db.leaveRequests[index], ...updates };
        await saveDb();
        return db.leaveRequests[index];
      }
      return null;
    },
    getAllAbsenceAuthorizations: async () => {
      return db.absenceAuthorizations;
    },
    getAbsenceAuthorizationById: async (id: number) => {
      return db.absenceAuthorizations.find((a: any) => a.id === id);
    },
    createAbsenceAuthorization: async (auth: any) => {
      db.absenceAuthorizations.push(auth);
      await saveDb();
      return auth;
    },
    updateAbsenceAuthorization: async (id: number, updates: any) => {
      const index = db.absenceAuthorizations.findIndex((a: any) => a.id === id);
      if (index !== -1) {
        db.absenceAuthorizations[index] = { ...db.absenceAuthorizations[index], ...updates };
        await saveDb();
        return db.absenceAuthorizations[index];
      }
      return null;
    },
    getAllLeaveBalances: async () => { return db.leaveBalances || []; },
    getLeaveBalanceByUserId: async (userId: number) => {
      let balance = db.leaveBalances.find((b: any) => b.userId === userId);
      if (!balance) {
        balance = { userId, available: 20, used: 0 };
        db.leaveBalances.push(balance);
        await saveDb();
      }
      return balance;
    },
    updateLeaveBalance: async (userId: number, updates: any) => {
      let index = db.leaveBalances.findIndex((b: any) => b.userId === userId);
      if (index === -1) {
        db.leaveBalances.push({ userId, available: 20, used: 0, ...updates });
        index = db.leaveBalances.length - 1;
      } else {
        db.leaveBalances[index] = { ...db.leaveBalances[index], ...updates };
      }
      await saveDb();
      return db.leaveBalances[index];
    },

    // Time Tracking CRUD
    getAllTimeEntries: async () => {
      return db.timeEntries;
    },
    getTimeEntryById: async (id: string) => {
      return db.timeEntries.find((t: any) => t.id === id);
    },
    createTimeEntry: async (entry: any) => {
      db.timeEntries.unshift(entry); // add to top
      await saveDb();
      return entry;
    },
    updateTimeEntry: async (id: string, updates: any) => {
      const index = db.timeEntries.findIndex((t: any) => t.id === id);
      if (index !== -1) {
        db.timeEntries[index] = { ...db.timeEntries[index], ...updates };
        await saveDb();
        return db.timeEntries[index];
      }
      return null;
    },
    deleteTimeEntry: async (id: string) => {
      const index = db.timeEntries.findIndex((t: any) => t.id === id);
      if (index !== -1) {
        db.timeEntries.splice(index, 1);
        await saveDb();
        return true;
      }
      return false;
    },
    // Settings CRUD
    getSettings: async () => {
      return db.settings;
    },
    updateSettings: async (updates: any) => {
      db.settings = { ...db.settings, ...updates };
      await saveDb();
      return db.settings;
    }
  };
}

async function saveDb() {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

