const fs = require('fs');
let content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf-8');

const insertAfter = `              {/* Notes */}
              {viewingClient.notes && (
                <section>
                  <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Notes</h3>
                  <div className="bg-yellow-50/50 border border-yellow-100 p-4 rounded-lg text-[13px] text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {viewingClient.notes}
                  </div>
                </section>
              )}`;

const customFieldsView = `

              {/* Custom Fields */}
              {viewingClient.customFields && Object.keys(viewingClient.customFields).length > 0 && (
                <section>
                  <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Champs personnalisés</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50/50 p-4 rounded-lg border border-gray-100">
                    {Object.entries(viewingClient.customFields).map(([key, value]) => (
                      <div key={key}>
                        <div className="text-[11px] text-gray-500 mb-0.5">{key}</div>
                        <div className="text-[13px] font-medium text-gray-900">{value as string || '-'}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}`;

content = content.replace(insertAfter, insertAfter + customFieldsView);

fs.writeFileSync('src/components/clients/ClientsManagement.tsx', content, 'utf-8');
