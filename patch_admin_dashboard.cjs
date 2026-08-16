const fs = require('fs');
let content = fs.readFileSync('src/components/dashboard/AdminDashboard.tsx', 'utf-8');

// Add import
const importMulti = `import { MultiSelectAutocomplete } from './MultiSelectAutocomplete';\n`;
content = content.replace("import { EmployeeDetailsModal } from './EmployeeDetailsModal';", "import { EmployeeDetailsModal } from './EmployeeDetailsModal';\n" + importMulti);

// Update state
const stateTarget = `  // Filters
  const [period, setPeriod] = useState<string>('Ce mois');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<number | ''>('');
  const [selectedClient, setSelectedClient] = useState<number | ''>('');

  const [usersList, setUsersList] = useState<any[]>([]);
  const [clientsList, setClientsList] = useState<any[]>([]);`;

const stateReplacement = `  // Filters
  const toLocalDateString = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return \`\${year}-\${month}-\${day}\`;
  };

  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(1); // First day of current month
    return toLocalDateString(d);
  });
  const [endDate, setEndDate] = useState<string>(() => {
    return toLocalDateString(new Date()); // Today
  });
  const [selectedUsers, setSelectedUsers] = useState<{id: number, name: string}[]>([]);
  const [selectedClients, setSelectedClients] = useState<{id: number, name: string}[]>([]);`;

content = content.replace(stateTarget, stateReplacement);

// Remove usersList/clientsList fetch useEffect
const fetchFiltersTarget = `  useEffect(() => {
    // Fetch users and clients for filters
    const fetchFilters = async () => {
      try {
        const [uRes, cRes] = await Promise.all([
          fetch('/api/users', { headers: { Authorization: \`Bearer \${token}\` } }),
          fetch('/api/clients', { headers: { Authorization: \`Bearer \${token}\` } })
        ]);
        if (uRes.ok) {
          const uData = await uRes.json();
          setUsersList(uData.filter((u: any) => u.role !== 'ADMIN'));
        }
        if (cRes.ok) setClientsList(await cRes.json());
      } catch (error) {
        console.error('Failed to fetch filters data', error);
      }
    };
    fetchFilters();
  }, [token]);`;

content = content.replace(fetchFiltersTarget, "");

// Update fetchKPIs dependencies
content = content.replace(
  "  useEffect(() => {\n    fetchKPIs();\n  }, [period, startDate, endDate, selectedUser, selectedClient, token]);",
  "  useEffect(() => {\n    fetchKPIs();\n  }, [startDate, endDate, selectedUsers, selectedClients, token]);"
);

// Update fetchKPIs body
const fetchKpisTarget = `  const fetchKPIs = async () => {
    setLoading(true);
    let currentStartDate = startDate;
    let currentEndDate = endDate;

    const toLocalDateString = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return \`\${year}-\${month}-\${day}\`;
    };

    if (period !== 'Personnalisée') {
      const now = new Date();
      if (period === "Aujourd'hui") {
        currentStartDate = toLocalDateString(now);
        currentEndDate = currentStartDate;
      } else if (period === 'Cette semaine') {
        const firstDay = new Date(now.setDate(now.getDate() - now.getDay() + 1));
        const lastDay = new Date(now.setDate(now.getDate() - now.getDay() + 7));
        currentStartDate = toLocalDateString(firstDay);
        currentEndDate = toLocalDateString(lastDay);
      } else if (period === 'Ce mois') {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        currentStartDate = toLocalDateString(firstDay);
        currentEndDate = toLocalDateString(lastDay);
      } else if (period === 'Ce trimestre') {
        const q = Math.floor(now.getMonth() / 3);
        const firstDay = new Date(now.getFullYear(), q * 3, 1);
        const lastDay = new Date(now.getFullYear(), q * 3 + 3, 0);
        currentStartDate = toLocalDateString(firstDay);
        currentEndDate = toLocalDateString(lastDay);
      } else if (period === 'Cette année') {
        const firstDay = new Date(now.getFullYear(), 0, 1);
        const lastDay = new Date(now.getFullYear(), 11, 31);
        currentStartDate = toLocalDateString(firstDay);
        currentEndDate = toLocalDateString(lastDay);
      }
    }

    try {
      const res = await fetch('/api/kpi/dashboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: \`Bearer \${token}\`
        },
        body: JSON.stringify({
          startDate: currentStartDate,
          endDate: currentEndDate,
          filterUserId: selectedUser || undefined,
          filterClientId: selectedClient || undefined
        })
      });`;

const fetchKpisReplacement = `  const fetchKPIs = async () => {
    setLoading(true);

    try {
      const res = await fetch('/api/kpi/dashboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: \`Bearer \${token}\`
        },
        body: JSON.stringify({
          startDate,
          endDate,
          filterUserIds: selectedUsers.map(u => u.id),
          filterClientIds: selectedClients.map(c => c.id)
        })
      });`;

content = content.replace(fetchKpisTarget, fetchKpisReplacement);


// Replace the UI filters
const uiFiltersTarget = `          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200">
              <Calendar className="w-4 h-4 text-gray-500" />
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="bg-transparent text-[13px] font-medium text-gray-700 outline-none"
              >
                <option value="Aujourd'hui">Aujourd'hui</option>
                <option value="Cette semaine">Cette semaine</option>
                <option value="Ce mois">Ce mois</option>
                <option value="Ce trimestre">Ce trimestre</option>
                <option value="Cette année">Cette année</option>
                <option value="Personnalisée">Personnalisée</option>
              </select>
            </div>
            
            {period === 'Personnalisée' && (
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200">
                <input 
                  type="date" 
                  value={startDate} 
                  onChange={e => setStartDate(e.target.value)}
                  className="text-[13px] outline-none text-gray-700 bg-transparent"
                />
                <span className="text-gray-400">-</span>
                <input 
                  type="date" 
                  value={endDate} 
                  onChange={e => setEndDate(e.target.value)}
                  className="text-[13px] outline-none text-gray-700 bg-transparent"
                />
              </div>
            )}
            
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200">
              <Filter className="w-4 h-4 text-gray-500" />
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value ? Number(e.target.value) : '')}
                className="bg-transparent text-[13px] font-medium text-gray-700 outline-none w-32"
              >
                <option value="">Tous les collabs</option>
                {usersList.map(u => (
                  <option key={u.id} value={u.id}>{u.username}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200">
              <Filter className="w-4 h-4 text-gray-500" />
              <select
                value={selectedClient}
                onChange={(e) => setSelectedClient(e.target.value ? Number(e.target.value) : '')}
                className="bg-transparent text-[13px] font-medium text-gray-700 outline-none w-32 truncate"
              >
                <option value="">Tous les clients</option>
                {clientsList.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>`;

const uiFiltersReplacement = `          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span className="text-[13px] text-gray-500 font-medium">Du</span>
              <input 
                type="date" 
                value={startDate} 
                onChange={e => setStartDate(e.target.value)}
                className="text-[13px] outline-none text-gray-700 bg-transparent"
              />
              <span className="text-gray-300 mx-1">|</span>
              <span className="text-[13px] text-gray-500 font-medium">Au</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={e => setEndDate(e.target.value)}
                className="text-[13px] outline-none text-gray-700 bg-transparent"
              />
            </div>
            
            <MultiSelectAutocomplete 
              placeholder="Rechercher collaborateur..."
              endpoint="/api/kpi/users/search"
              selectedItems={selectedUsers}
              onChange={setSelectedUsers}
            />

            <MultiSelectAutocomplete 
              placeholder="Rechercher client..."
              endpoint="/api/kpi/clients/search"
              selectedItems={selectedClients}
              onChange={setSelectedClients}
            />
          </div>`;

content = content.replace(uiFiltersTarget, uiFiltersReplacement);

fs.writeFileSync('src/components/dashboard/AdminDashboard.tsx', content, 'utf-8');
