const fs = require('fs');
const content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf8');
const lines = content.split('\n');

const stateIndex = lines.findIndex(l => l.includes('const [isColumnsOpen, setIsColumnsOpen] = useState(false);'));
lines.splice(stateIndex, 0, `  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = (key: string) => {
    if (sortField === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(key);
      setSortDir('asc');
    }
  };
`);

const fetchIndex = lines.findIndex(l => l.includes('filters: JSON.stringify(combinedFilters)'));
lines.splice(fetchIndex, 0, `        sortField,
        sortDir,`);

const effectIndex = lines.findIndex(l => l.includes('}, [page, searchTerm, activeFilters, statusFilter]);'));
lines[effectIndex] = `  }, [page, searchTerm, activeFilters, statusFilter, sortField, sortDir]);`;

const headIndex = lines.findIndex(l => l.includes('                  <tr className="bg-[#F9FAFB] border-b border-gray-200">'));
const headEndIndex = lines.findIndex((l, idx) => idx > headIndex && l.includes('                  </tr>'));

const headCode = `                  <tr className="bg-[#F9FAFB] border-b border-gray-200">
                    {allTableColumns.filter(c => visibleColumns.includes(c.key)).map(col => (
                      <th 
                        key={col.key} 
                        onClick={() => handleSort(col.key)}
                        className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors group select-none"
                      >
                        <div className="flex items-center gap-1">
                          {col.label}
                          <div className={\`flex flex-col opacity-0 group-hover:opacity-100 transition-opacity \${sortField === col.key ? '!opacity-100' : ''}\`}>
                            <ChevronRight className={\`w-3 h-3 -rotate-90 -mb-1.5 \${sortField === col.key && sortDir === 'asc' ? 'text-gray-900' : 'text-gray-400'}\`} />
                            <ChevronRight className={\`w-3 h-3 rotate-90 \${sortField === col.key && sortDir === 'desc' ? 'text-gray-900' : 'text-gray-400'}\`} />
                          </div>
                        </div>
                      </th>
                    ))}
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider text-right sticky right-0 bg-[#F9FAFB] z-10">
                      Actions
                    </th>`;

lines.splice(headIndex, headEndIndex - headIndex, headCode);

fs.writeFileSync('src/components/clients/ClientsManagement.tsx', lines.join('\n'));
