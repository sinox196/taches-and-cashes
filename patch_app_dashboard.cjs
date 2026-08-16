const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Add import
const importDashboard = `import { AdminDashboard } from './components/dashboard/AdminDashboard';\n`;
content = content.replace("import { UsersManagement } from './components/UsersManagement';", importDashboard + "import { UsersManagement } from './components/UsersManagement';");

// Update routing
const routeDashboard = `
        {activeSidebarItem === 'Dashboard' && (hasPermission('ADMIN') || user?.role === 'ADMIN' || user?.role === 'SUPERVISEUR') ? (
          <AdminDashboard />
        ) : activeSidebarItem === 'Users' && hasPermission('MANAGE_USERS') ? (
`;

content = content.replace(
  "{activeSidebarItem === 'Users' && hasPermission('MANAGE_USERS') ? (",
  routeDashboard
);

// We should also make sure default activeSidebarItem is 'Dashboard' if they have permission, but Time Tracking is fine as default.

fs.writeFileSync('src/App.tsx', content, 'utf-8');
