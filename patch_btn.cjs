const fs = require('fs');
const content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf8');
const lines = content.split('\n');

const importIndex = lines.findIndex(l => l.includes('import { Plus, Search, Filter'));
lines[importIndex] = lines[importIndex].replace('Filter,', 'Filter, Columns, Check,');

const filterBtnIndex = lines.findIndex(l => l.includes('<div className="relative">'));

const newCode = `          <div className="flex gap-2 relative">
            <div className="relative">
              <button
                onClick={() => { setIsFilterOpen(!isFilterOpen); setIsColumnsOpen(false); }}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Filter className="w-4 h-4" />
                Filtres
              </button>

              {isFilterOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-[13px] font-bold text-gray-900">Ajouter un filtre</h3>
                    <button onClick={() => setIsFilterOpen(false)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-[12px] font-medium text-gray-700 mb-1">Champ</label>
                      <select
                        value={filterKey}
                        onChange={(e) => setFilterKey(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-[#101828]"
                      >
                        {allFilterableFields.map(f => (
                          <option key={f.key} value={f.key}>{f.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[12px] font-medium text-gray-700 mb-1">Valeur</label>
                      {filterKey === 'status' ? (
                        <select
                          value={filterValue}
                          onChange={(e) => setFilterValue(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-[#101828]"
                        >
                          <option value="">Sélectionner...</option>
                          <option value="Active">Actif</option>
                          <option value="Inactive">Inactif</option>
                        </select>
                      ) : filterKey === 'type' ? (
                        <select
                          value={filterValue}
                          onChange={(e) => setFilterValue(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-[#101828]"
                        >
                          <option value="">Sélectionner...</option>
                          <option value="Individual">Particulier</option>
                          <option value="Company">Entreprise</option>
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={filterValue}
                          onChange={(e) => setFilterValue(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-[#101828]"
                          placeholder="Rechercher..."
                        />
                      )}
                    </div>

                    <button
                      onClick={handleAddFilter}
                      disabled={!filterValue.trim() && !['status', 'type'].includes(filterKey)}
                      className="w-full mt-2 py-2 bg-[#101828] text-white rounded-lg text-[13px] font-medium disabled:opacity-50 hover:bg-[#1a2b4b]"
                    >
                      Appliquer le filtre
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => { setIsColumnsOpen(!isColumnsOpen); setIsFilterOpen(false); }}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Columns className="w-4 h-4" />
                Colonnes
              </button>

              {isColumnsOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4 max-h-[300px] overflow-y-auto">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-[13px] font-bold text-gray-900">Affichage des colonnes</h3>
                    <button onClick={() => setIsColumnsOpen(false)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {allTableColumns.map(col => (
                      <label key={col.key} className="flex items-center gap-3 cursor-pointer group">
                        <div className={\`w-4 h-4 rounded border flex items-center justify-center transition-colors \${visibleColumns.includes(col.key) ? 'bg-[#101828] border-[#101828]' : 'border-gray-300 bg-white group-hover:border-gray-400'}\`}>
                          {visibleColumns.includes(col.key) && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className="text-[13px] text-gray-700 font-medium select-none">{col.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>`;

// Find where to slice it. It's from `<div className="relative">` to `</div>` before `{/* Active Filters Display */}`
let endIdx = -1;
for (let i = filterBtnIndex; i < lines.length; i++) {
  if (lines[i].includes('{/* Active Filters Display */}')) {
    endIdx = i - 1; // It's `</div>`
    break;
  }
}

lines.splice(filterBtnIndex, endIdx - filterBtnIndex, newCode);
fs.writeFileSync('src/components/clients/ClientsManagement.tsx', lines.join('\n'));
