const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf-8');

// In POST /api/clients
content = content.replace(
  "const { name, type, email, phone, address, city, country, taxId, status, notes } = req.body;",
  "const { name, type, email, phone, address, city, country, taxId, status, notes, customFields } = req.body;"
);

content = content.replace(
  "notes: notes || '',",
  "notes: notes || '',\n        customFields: customFields || {},"
);

// In PUT /api/clients/:id
content = content.replace(
  "const { name, type, email, phone, address, city, country, taxId, status, notes } = req.body;",
  "const { name, type, email, phone, address, city, country, taxId, status, notes, customFields } = req.body;"
);

content = content.replace(
  "notes: notes || '',\n        updatedAt",
  "notes: notes || '',\n        customFields: customFields || {},\n        updatedAt"
);

fs.writeFileSync('server.ts', content, 'utf-8');
