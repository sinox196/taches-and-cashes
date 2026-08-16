const fs = require('fs');
let content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf-8');

const tdStatut = `                      </span>
                    </td>`;
const newTd = `
                    {customFieldKeys.map(key => (
                      <td key={key} className="px-5 py-4 text-gray-600">
                        {client.customFields?.[key] || <span className="text-gray-400 italic text-[11px]">-</span>}
                      </td>
                    ))}
`;
content = content.replace(tdStatut, tdStatut + newTd);

fs.writeFileSync('src/components/clients/ClientsManagement.tsx', content, 'utf-8');
