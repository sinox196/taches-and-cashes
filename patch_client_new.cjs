const fs = require('fs');
let content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf-8');

content = content.replace(
  "setFormData({ name: '', type: 'Company', email: '', phone: '', address: '', city: '', country: '', taxId: '', status: 'Active', notes: '' });",
  "setFormData({ name: '', type: 'Company', email: '', phone: '', address: '', city: '', country: '', taxId: '', status: 'Active', notes: '', customFields: {} });"
);

fs.writeFileSync('src/components/clients/ClientsManagement.tsx', content, 'utf-8');
