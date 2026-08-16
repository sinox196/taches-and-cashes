const fs = require('fs');
let content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf-8');

const insertAfter = `                <div className="md:col-span-2">
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Notes internes</label>
                  <textarea
                    rows={3}
                    value={formData.notes}
                    onChange={e => handleFormChange('notes', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-[#101828] focus:border-transparent resize-none"
                    placeholder="Informations supplémentaires..."
                  />
                </div>`;

const customFieldsUI = `
                {/* Custom Fields */}
                <div className="md:col-span-2 pt-4 border-t border-gray-100 mt-2">
                  <div className="flex items-center justify-between mb-3">
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
                  </div>
                  
                  {Object.keys(formData.customFields || {}).length === 0 ? (
                    <div className="text-[12px] text-gray-500 italic py-2">
                      Aucun champ personnalisé défini pour ce client.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {Object.entries(formData.customFields || {}).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-3">
                          <div className="w-1/3">
                            <input
                              type="text"
                              value={key}
                              disabled
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-[13px] bg-gray-50 text-gray-700 font-medium"
                            />
                          </div>
                          <div className="w-2/3 flex items-center gap-2">
                            <input
                              type="text"
                              value={value as string}
                              onChange={e => {
                                setFormData({
                                  ...formData,
                                  customFields: {
                                    ...(formData.customFields || {}),
                                    [key]: e.target.value
                                  }
                                });
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-[#101828] focus:border-transparent"
                              placeholder={"Valeur pour " + key}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const newCustomFields = { ...formData.customFields };
                                delete newCustomFields[key];
                                setFormData({
                                  ...formData,
                                  customFields: newCustomFields
                                });
                              }}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Supprimer ce champ"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
`;

content = content.replace(insertAfter, insertAfter + customFieldsUI);

fs.writeFileSync('src/components/clients/ClientsManagement.tsx', content, 'utf-8');
