const fs = require('fs');
const content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf8');
const lines = content.split('\n');

const listEndIndex = lines.findIndex(l => l.includes('{/* Form Modal */}'));

// Just insert the pagination before {/* Form Modal */}
const newCode = `        )}

        {/* Pagination */}
        {!isLoading && totalPages > 0 && (
          <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-[13px]">
            <div className="text-gray-500">
              Affichage de {((page - 1) * limit) + 1} à {Math.min(page * limit, totalCount)} sur {totalCount} clients
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 border border-gray-200 rounded text-gray-600 disabled:opacity-50 hover:bg-gray-100 bg-white"
              >
                Précédent
              </button>
              
              <div className="flex items-center gap-1 px-2">
                <span className="font-medium text-gray-900">{page}</span>
                <span className="text-gray-500">/</span>
                <span className="text-gray-500">{totalPages}</span>
              </div>

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 border border-gray-200 rounded text-gray-600 disabled:opacity-50 hover:bg-gray-100 bg-white"
              >
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>

`;

lines.splice(listEndIndex - 2, 2, newCode);
fs.writeFileSync('src/components/clients/ClientsManagement.tsx', lines.join('\n'));
