const fs = require('fs');

let content = fs.readFileSync('src/components/UsersManagement.tsx', 'utf-8');

content = content.replace(
  "const [formRole, setFormRole] = useState<'ADMIN' | 'COLLABORATOR'>('COLLABORATOR');",
  "const [formRole, setFormRole] = useState<'ADMIN' | 'COLLABORATOR' | 'SUPERVISEUR'>('COLLABORATOR');"
);

content = content.replace(
  "onChange={e => setFormRole(e.target.value as 'ADMIN' | 'COLLABORATOR')}",
  "onChange={e => setFormRole(e.target.value as 'ADMIN' | 'COLLABORATOR' | 'SUPERVISEUR')}"
);

content = content.replace(
  /<option value="COLLABORATOR">Collaborateur<\/option>\s*<option value="ADMIN">Administrateur<\/option>/,
  '<option value="COLLABORATOR">Collaborateur</option>\n                    <option value="SUPERVISEUR">Superviseur</option>\n                    <option value="ADMIN">Administrateur</option>'
);

content = content.replace(
  "{formRole === 'COLLABORATOR' && (",
  "{formRole !== 'ADMIN' && ("
);

content = content.replace(
  "user.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'",
  "user.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : user.role === 'SUPERVISEUR' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'"
);

content = content.replace(
  "user.role === 'ADMIN' && <Shield className=\"w-3 h-3\" />",
  "(user.role === 'ADMIN' || user.role === 'SUPERVISEUR') && <Shield className=\"w-3 h-3\" />"
);

fs.writeFileSync('src/components/UsersManagement.tsx', content, 'utf-8');
