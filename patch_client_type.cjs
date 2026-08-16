const fs = require('fs');
let content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf-8');

content = content.replace(
  "missionCount?: number;",
  "missionCount?: number;\n  customFields?: Record<string, string>;"
);

content = content.replace(
  "const [formData, setFormData] = useState<Partial<Client>>({",
  "const [formData, setFormData] = useState<Partial<Client>>({\n    customFields: {},"
);

fs.writeFileSync('src/components/clients/ClientsManagement.tsx', content, 'utf-8');
