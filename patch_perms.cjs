const fs = require('fs');
let content = fs.readFileSync('src/components/UsersManagement.tsx', 'utf-8');

content = content.replace(
  "{ id: 'DELETE_CLIENTS', label: 'Supprimer clients', desc: 'Peut archiver/supprimer des clients' },",
  "{ id: 'DELETE_CLIENTS', label: 'Supprimer clients', desc: 'Peut archiver/supprimer des clients' },\n      { id: 'MANAGE_CLIENT_FIELDS', label: 'Gérer champs', desc: 'Peut gérer les champs personnalisés' },"
);

fs.writeFileSync('src/components/UsersManagement.tsx', content, 'utf-8');

let dbContent = fs.readFileSync('src/server/database.ts', 'utf-8');
dbContent = dbContent.replace(
  "'DELETE_CLIENTS',",
  "'DELETE_CLIENTS', 'MANAGE_CLIENT_FIELDS',"
);
fs.writeFileSync('src/server/database.ts', dbContent, 'utf-8');

