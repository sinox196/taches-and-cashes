const fs = require('fs');
let content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf-8');

if (!content.includes('const [newFieldName, setNewFieldName] = useState')) {
  content = content.replace(
    "const [formError, setFormError] = useState('');",
    "const [formError, setFormError] = useState('');\n  const [newFieldName, setNewFieldName] = useState('');"
  );
}

const targetBlock = `<div className="flex items-center justify-between mb-3">
                    <label className="block text-[13px] font-bold text-gray-900">Champs personnalisés</label>
                    <button
                      type="button"
                      onClick={() => {
                        const newKey = prompt('Nom du nouveau champ :');
                        if (newKey && newKey.trim() !== '') {
                          setFormData({
                            ...formData,
                            customFields: {
                              ...(formData.customFields || {}),
                              [newKey.trim()]: ''
                            }
                          });
                        }
                      }}
                      className="text-[12px] font-medium text-[#101828] bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded-md flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Ajouter un champ
                    </button>
                  </div>`;

const replacementBlock = `<div className="flex items-center justify-between mb-3">
                    <label className="block text-[13px] font-bold text-gray-900">Champs personnalisés</label>
                  </div>
                  
                  <div className="flex gap-2 mb-4">
                    <input
                      type="text"
                      value={newFieldName}
                      onChange={e => setNewFieldName(e.target.value)}
                      placeholder="Nom du nouveau champ..."
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-[12px] focus:ring-1 focus:ring-[#101828]"
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (newFieldName.trim()) {
                            setFormData({
                              ...formData,
                              customFields: {
                                ...(formData.customFields || {}),
                                [newFieldName.trim()]: ''
                              }
                            });
                            setNewFieldName('');
                          }
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (newFieldName.trim() !== '') {
                          setFormData({
                            ...formData,
                            customFields: {
                              ...(formData.customFields || {}),
                              [newFieldName.trim()]: ''
                            }
                          });
                          setNewFieldName('');
                        }
                      }}
                      disabled={!newFieldName.trim()}
                      className="text-[12px] font-medium text-[#101828] bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-md flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Ajouter
                    </button>
                  </div>`;

content = content.replace(targetBlock, replacementBlock);

fs.writeFileSync('src/components/clients/ClientsManagement.tsx', content, 'utf-8');
