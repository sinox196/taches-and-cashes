const fs = require('fs');
let content = fs.readFileSync('src/components/Sidebar.tsx', 'utf-8');
content = content.replace(
  "{ id: 'Dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, hasChevron: false },",
  "...((user?.role === 'ADMIN' || user?.role === 'SUPERVISEUR') ? [{ id: 'Dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, hasChevron: false }] : []),"
);
fs.writeFileSync('src/components/Sidebar.tsx', content, 'utf-8');
