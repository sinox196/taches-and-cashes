const fs = require('fs');

function fixFile(file) {
  let content = fs.readFileSync(file, 'utf-8');
  content = content.replace(/\\`/g, '`');
  content = content.replace(/\\\$/g, '$'); // Just in case I escaped $
  fs.writeFileSync(file, content, 'utf-8');
}

fixFile('src/components/dashboard/EmployeeDetailsModal.tsx');
fixFile('src/components/dashboard/EmployeeTable.tsx');
fixFile('src/components/dashboard/DashboardCharts.tsx');

