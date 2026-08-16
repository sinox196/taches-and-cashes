const fs = require('fs');
let content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf-8');

// Wrap the new field block
const addFieldBlock = `<div className="flex gap-2 mb-4">
                    <input`;

const replacementBlock = `{hasPermission('MANAGE_CLIENT_FIELDS') && (
                  <div className="flex gap-2 mb-4">
                    <input`;

content = content.replace(addFieldBlock, replacementBlock);

const endAddBlock = `Ajouter
                    </button>
                  </div>`;
const replacementEndBlock = `Ajouter
                    </button>
                  </div>
                  )}`;
content = content.replace(endAddBlock, replacementEndBlock);


const deleteButtonBlock = `<button
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
                            </button>`;

const replacementDeleteButtonBlock = `{hasPermission('MANAGE_CLIENT_FIELDS') && (
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
                            )}`;
content = content.replace(deleteButtonBlock, replacementDeleteButtonBlock);

fs.writeFileSync('src/components/clients/ClientsManagement.tsx', content, 'utf-8');

