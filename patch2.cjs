const fs = require('fs');
const content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf8');
const lines = content.split('\n');

const searchStartIndex = lines.findIndex(l => l.includes('<!-- Filters & Search -->') || l.includes('{/* Filters & Search */}'));
const listStartIndex = lines.findIndex(l => l.includes('{/* List */}'));

const newCode = `      {/* Filters & Search */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Rechercher par nom, email, téléphone ou matricule..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-[#101828] focus:border-transparent transition-all outline-none"
            />
          </div>

          <div className="relative">
            <button
              onClick={() => setIsFilterOpen(!isFilterOpen)}
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
        </div>

        {/* Active Filters Display */}
        {(Object.keys(activeFilters).length > 0 || statusFilter !== 'ALL') && (
          <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <span className="text-[12px] font-medium text-gray-600">Filtres actifs:</span>
            
            {statusFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded-full text-[12px] font-medium text-gray-700">
                Statut: {statusFilter === 'Active' ? 'Actif' : 'Inactif'}
                <button onClick={() => setStatusFilter('ALL')} className="text-gray-400 hover:text-gray-600">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {Object.entries(activeFilters).map(([key, val]) => {
              const label = allFilterableFields.find(f => f.key === key)?.label || key;
              return (
                <span key={key} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded-full text-[12px] font-medium text-gray-700">
                  {label}: {val}
                  <button onClick={() => removeFilter(key)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}

            <button 
              onClick={clearAllFilters}
              className="text-[12px] text-red-600 hover:text-red-700 font-medium ml-2"
            >
              Réinitialiser les filtres
            </button>
          </div>
        )}
      </div>`;

lines.splice(searchStartIndex, listStartIndex - searchStartIndex, newCode);
fs.writeFileSync('src/components/clients/ClientsManagement.tsx', lines.join('\n'));
