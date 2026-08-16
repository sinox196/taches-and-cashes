const fs = require('fs');
let content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf-8');

const targetStr = "const filteredClients = clients.filter(c => {";
const insertStr = `
  const customFieldKeys = Array.from(new Set(clients.flatMap(c => Object.keys(c.customFields || {}))));
`;
content = content.replace(targetStr, insertStr + targetStr);

fs.writeFileSync('src/components/clients/ClientsManagement.tsx', content, 'utf-8');
