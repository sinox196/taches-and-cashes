const fs = require('fs');
const content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf8');
const lines = content.split('\n');

const tableStartIndex = lines.findIndex(l => l.includes('<table className="w-full text-left border-collapse">'));
const tableEndIndex = lines.findIndex((l, idx) => idx > tableStartIndex && l.includes('</table>'));

const newCode = `            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse whitespace-nowrap min-w-max">
                <thead>
                  <tr className="bg-[#F9FAFB] border-b border-gray-200">
                    {allTableColumns.filter(c => visibleColumns.includes(c.key)).map(col => (
                      <th key={col.key} className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        {col.label}
                      </th>
                    ))}
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider text-right sticky right-0 bg-[#F9FAFB] z-10">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="text-[12px] divide-y divide-gray-50">
                  {filteredClients.map(client => (
                    <tr 
                      key={client.id} 
                      onClick={() => setViewingClient(client)}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors group cursor-pointer"
                    >
                      {allTableColumns.filter(c => visibleColumns.includes(c.key)).map(col => {
                        if (col.key === 'name') {
                          return (
                            <td key="name" className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                <div className={\`w-8 h-8 rounded flex items-center justify-center shrink-0 \${client.type === 'Company' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}\`}>
                                  {client.type === 'Company' ? <Building2 className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
                                </div>
                                <div>
                                  <div className="font-semibold text-gray-900">{client.name}</div>
                                  <div className="text-[11px] text-gray-500">{client.type === 'Company' ? 'Entreprise' : 'Particulier'}</div>
                                </div>
                              </div>
                            </td>
                          );
                        }
                        if (col.key === 'contact') {
                          return (
                            <td key="contact" className="px-5 py-4">
                              <div className="flex flex-col gap-1">
                                {client.email ? (
                                  <div className="flex items-center gap-1.5 text-gray-600">
                                    <Mail className="w-3 h-3 text-gray-400" />
                                    <span>{client.email}</span>
                                  </div>
                                ) : <span className="text-gray-400 italic text-[11px]">Pas d'email</span>}
                                {client.phone && (
                                  <div className="flex items-center gap-1.5 text-gray-600 text-[11px]">
                                    <Phone className="w-3 h-3 text-gray-400" />
                                    <span>{client.phone}</span>
                                  </div>
                                )}
                              </div>
                            </td>
                          );
                        }
                        if (col.key === 'status') {
                          return (
                            <td key="status" className="px-5 py-4">
                              <span className={\`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider \${
                                client.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                              }\`}>
                                {client.status === 'Active' ? 'Actif' : 'Inactif'}
                              </span>
                            </td>
                          );
                        }

                        let val = client[col.key as keyof Client];
                        if (col.isCustom) {
                          val = client.customFields?.[col.key];
                        }
                        
                        return (
                          <td key={col.key} className="px-5 py-4 text-gray-600">
                            {val ? val.toString() : <span className="text-gray-400 italic text-[11px]">-</span>}
                          </td>
                        );
                      })}
                      
                      <td className="px-5 py-4 text-right sticky right-0 bg-white group-hover:bg-gray-50 z-10 transition-colors">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {hasPermission('EDIT_CLIENTS') && (
                            <button
                              onClick={(e) => handleOpenEdit(client, e)}
                              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {hasPermission('DELETE_CLIENTS') && client.status !== 'Inactive' && (
                            <button
                              onClick={(e) => handleDelete(client.id, e)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredClients.length === 0 && (
                    <tr>
                      <td colSpan={allTableColumns.filter(c => visibleColumns.includes(c.key)).length + 1} className="px-5 py-8 text-center text-gray-500 text-[13px]">
                        Aucun client trouvé.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>`;

lines.splice(tableStartIndex, tableEndIndex - tableStartIndex + 1, newCode);
fs.writeFileSync('src/components/clients/ClientsManagement.tsx', lines.join('\n'));
