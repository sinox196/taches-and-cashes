const fs = require('fs');
const content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf8');
const lines = content.split('\n');

const startIndex = lines.findIndex(l => l.includes('{allTableColumns.map(col => ('));
const endIndex = lines.findIndex((l, idx) => idx > startIndex && l.includes('</label>'));

const newCode = `                    {allTableColumns.map(col => (
                      <label key={col.key} className="flex items-center gap-3 cursor-pointer group" onClick={(e) => { e.preventDefault(); toggleColumn(col.key); }}>
                        <div className={\`w-4 h-4 rounded border flex items-center justify-center transition-colors \${visibleColumns.includes(col.key) ? 'bg-[#101828] border-[#101828]' : 'border-gray-300 bg-white group-hover:border-gray-400'}\`}>
                          {visibleColumns.includes(col.key) && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className="text-[13px] text-gray-700 font-medium select-none">{col.label}</span>
                      </label>`;

lines.splice(startIndex, endIndex - startIndex + 1, newCode);
fs.writeFileSync('src/components/clients/ClientsManagement.tsx', lines.join('\n'));
