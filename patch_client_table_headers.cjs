const fs = require('fs');
let content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf-8');

const thStatut = '<th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Statut</th>';
const newTh = `
                  {customFieldKeys.map(key => (
                    <th key={key} className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{key}</th>
                  ))}
`;
content = content.replace(thStatut, thStatut + newTh);

fs.writeFileSync('src/components/clients/ClientsManagement.tsx', content, 'utf-8');
