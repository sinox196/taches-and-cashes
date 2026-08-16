const fs = require('fs');
let content = fs.readFileSync('src/components/dashboard/AdminDashboard.tsx', 'utf-8');

const target = `        body: JSON.stringify({
          startDate: currentStartDate,
          endDate: currentEndDate,
          filterUserId: selectedUser || undefined,
          filterClientId: selectedClient || undefined
        })`;

const replacement = `        body: JSON.stringify({
          startDate,
          endDate,
          filterUserIds: selectedUsers.map(u => u.id),
          filterClientIds: selectedClients.map(c => c.id)
        })`;

content = content.replace(target, replacement);
fs.writeFileSync('src/components/dashboard/AdminDashboard.tsx', content, 'utf-8');
