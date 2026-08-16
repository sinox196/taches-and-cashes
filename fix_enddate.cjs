const fs = require('fs');
let content = fs.readFileSync('src/components/dashboard/AdminDashboard.tsx', 'utf-8');
content = content.replace("let currentEndDate = endDate;\n    let currentEndDate = endDate;", "let currentEndDate = endDate;");
fs.writeFileSync('src/components/dashboard/AdminDashboard.tsx', content, 'utf-8');
