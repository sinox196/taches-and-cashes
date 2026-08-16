const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf-8');

const kpiEndpoint = `
// --- KPI DASHBOARD ENDPOINT ---
app.post('/api/kpi/dashboard', authenticate, async (req: any, res: any) => {
  try {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPERVISEUR') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { startDate, endDate, filterUserId, filterClientId } = req.body;

    const parseFrenchDate = (dateStr: string) => {
      // Date in DD/MM/YYYY
      if (!dateStr) return 0;
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        return new Date(\`\${parts[2]}-\${parts[1]}-\${parts[0]}T00:00:00Z\`).getTime();
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

    // Filter time entries
    timeEntries = timeEntries.filter((t: any) => {
      const ts = parseFrenchDate(t.date);
      if (ts < startTs || ts > endTs) return false;
      if (filterUserId && t.userId !== filterUserId) return false;
      if (filterClientId && t.clientId !== filterClientId) return false;
      return true;
    });

    // Filter leave requests
    leaveRequests = leaveRequests.filter((l: any) => {
      const tsStart = parseIsoDate(l.startDate);
      const tsEnd = parseIsoDate(l.endDate);
      // Overlap logic
      if (tsEnd < startTs || tsStart > endTs) return false;
      if (filterUserId && l.userId !== filterUserId) return false;
      return true;
    });

    // Filter authorizations
    authorizations = authorizations.filter((a: any) => {
      const ts = parseIsoDate(a.date);
      if (ts < startTs || ts > endTs) return false;
      if (filterUserId && a.userId !== filterUserId) return false;
      return true;
    });

    const employees = allUsers.filter((u: any) => u.role === 'COLLABORATOR' || u.role === 'SUPERVISEUR');
    
    // Calculate global stats
    const globalStats = {
      totalCollaborators: employees.filter((u: any) => u.role === 'COLLABORATOR').length,
      totalSupervisors: employees.filter((u: any) => u.role === 'SUPERVISEUR').length,
      totalTasks: timeEntries.length,
      completedTasks: timeEntries.filter((t: any) => t.statut === 'COMPLETED').length,
      inProgressTasks: timeEntries.filter((t: any) => t.statut === 'RUNNING').length,
      pausedTasks: timeEntries.filter((t: any) => t.statut === 'PAUSED').length,
      clientsHandled: new Set(timeEntries.filter((t: any) => t.clientId).map((t: any) => t.clientId)).size,
      activeLeaves: leaveRequests.filter((l: any) => l.status === 'APPROVED').length,
      activeAuthorizations: authorizations.filter((a: any) => a.status === 'APPROVED').length,
    };

    // Calculate per employee stats
    const employeeStats = employees.map((emp: any) => {
      if (filterUserId && emp.id !== filterUserId) return null;

      const empTasks = timeEntries.filter((t: any) => t.userId === emp.id);
      const totalTasks = empTasks.length;
      const completedTasks = empTasks.filter((t: any) => t.statut === 'COMPLETED').length;
      
      const empClients = new Set();
      const clientTasksCount: any = {};
      empTasks.forEach((t: any) => {
        if (t.clientId) {
          empClients.add(t.clientId);
          clientTasksCount[t.clientId] = (clientTasksCount[t.clientId] || 0) + 1;
        }
      });
      
      const empLeaves = leaveRequests.filter((l: any) => l.userId === emp.id);
      const balance = leaveBalances.find((b: any) => b.userId === emp.id) || { available: 18, used: 0 };
      
      const empAuths = authorizations.filter((a: any) => a.userId === emp.id);
      const totalAuthDuration = empAuths
        .filter((a: any) => a.status === 'APPROVED')
        .reduce((sum: number, a: any) => sum + (a.duration || 0), 0);

      const clientListDetails = Array.from(empClients).map((cid: any) => {
        const c = clients.find((client: any) => client.id === cid);
        return {
          id: cid,
          name: c ? c.name : 'Unknown',
          taskCount: clientTasksCount[cid]
        };
      });

      return {
        id: emp.id,
        name: emp.username, // or full name if available
        role: emp.role,
        department: emp.department || 'N/A', // Assuming they might have it, or generic
        tasks: {
          total: totalTasks,
          completed: completedTasks,
          inProgress: empTasks.filter((t: any) => t.statut === 'RUNNING').length,
          paused: empTasks.filter((t: any) => t.statut === 'PAUSED').length,
          late: 0, // Not tracked in timeEntries currently
          completionRate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0
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

    res.json({ globalStats, employeeStats });
  } catch (error) {
    console.error('KPI error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
`;

content = content.replace(
  "app.post('/api/clients',",
  kpiEndpoint + "\n\n  app.post('/api/clients',"
);

fs.writeFileSync('server.ts', content, 'utf-8');
