const fs = require('fs');
let content = fs.readFileSync('src/components/dashboard/AdminDashboard.tsx', 'utf-8');

const targetLogic = `        currentStartDate = firstDay.toISOString().split('T')[0];
        currentEndDate = lastDay.toISOString().split('T')[0];`;

const replacementLogic = `
    const toLocalDateString = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return \`\${year}-\${month}-\${day}\`;
    };
`;

content = content.replace(
  "let currentStartDate = startDate;",
  "let currentStartDate = startDate;\n    let currentEndDate = endDate;\n" + replacementLogic
);

// Replace all .toISOString().split('T')[0] with toLocalDateString
content = content.replace(/now\.toISOString\(\)\.split\('T'\)\[0\]/g, "toLocalDateString(now)");
content = content.replace(/firstDay\.toISOString\(\)\.split\('T'\)\[0\]/g, "toLocalDateString(firstDay)");
content = content.replace(/lastDay\.toISOString\(\)\.split\('T'\)\[0\]/g, "toLocalDateString(lastDay)");

fs.writeFileSync('src/components/dashboard/AdminDashboard.tsx', content, 'utf-8');
