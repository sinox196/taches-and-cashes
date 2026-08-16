const fs = require('fs');
const content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf8');
const lines = content.split('\n');
const start = 44; // index 44 is line 45
const end = 74;   // index 73 is line 74

const newCode = `  // Pagination & Filters State
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterKey, setFilterKey] = useState<string>('name');
  const [filterValue, setFilterValue] = useState<string>('');

  const limit = 20;

  useEffect(() => {
    fetchAvailableFields();
  }, []);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      fetchClients();
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [page, searchTerm, activeFilters, statusFilter]);

  const fetchAvailableFields = async () => {
    try {
      const res = await fetch('/api/clients/fields', {
        headers: { 'Authorization': \`Bearer \${token}\` }
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableFields(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchClients = async () => {
    setIsLoading(true);
    try {
      const combinedFilters = { ...activeFilters };
      if (statusFilter !== 'ALL') {
        combinedFilters.status = statusFilter;
      }

      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        q: searchTerm,
        filters: JSON.stringify(combinedFilters)
      });

      const res = await fetch(\`/api/clients?\${params.toString()}\`, {
        headers: { 'Authorization': \`Bearer \${token}\` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.data) {
          setClients(data.data);
          setTotalCount(data.total);
        } else if (Array.isArray(data)) {
          setClients(data);
          setTotalCount(data.length);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddFilter = () => {
    if (!filterKey || (!filterValue.trim() && !['status', 'type'].includes(filterKey))) return;
    setActiveFilters(prev => ({ ...prev, [filterKey]: filterValue }));
    setFilterValue('');
    setPage(1);
    setIsFilterOpen(false);
  };

  const removeFilter = (key: string) => {
    setActiveFilters(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setPage(1);
  };

  const clearAllFilters = () => {
    setActiveFilters({});
    setStatusFilter('ALL');
    setSearchTerm('');
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  const standardFields = [
    { key: 'name', label: 'Client / Nom' },
    { key: 'type', label: 'Type de client' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Téléphone' },
    { key: 'taxId', label: 'Matricule' },
    { key: 'address', label: 'Adresse' },
    { key: 'city', label: 'Ville' },
    { key: 'country', label: 'Pays' },
    { key: 'status', label: 'Statut' }
  ];

  const allFilterableFields = [
    ...standardFields,
    ...availableFields.map(f => ({ key: f, label: f }))
  ];

  const customFieldKeys = availableFields;
  const filteredClients = clients;`;

lines.splice(start, end - start, newCode);
fs.writeFileSync('src/components/clients/ClientsManagement.tsx', lines.join('\n'));
