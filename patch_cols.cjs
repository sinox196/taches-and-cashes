const fs = require('fs');
const content = fs.readFileSync('src/components/clients/ClientsManagement.tsx', 'utf8');
const lines = content.split('\n');

const stateIndex = lines.findIndex(l => l.includes('const [isFilterOpen, setIsFilterOpen] = useState(false);'));

const newCode1 = `  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  
  // Default visible columns
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem('clientsVisibleColumns');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return ['name', 'contact', 'taxId', 'status']; // Default columns
  });

  const toggleColumn = (key: string) => {
    setVisibleColumns(prev => {
      const newCols = prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key];
      localStorage.setItem('clientsVisibleColumns', JSON.stringify(newCols));
      return newCols;
    });
  };
`;

lines.splice(stateIndex, 1, newCode1);

const colsDefIndex = lines.findIndex(l => l.includes("const allFilterableFields = ["));
const newCodeCols = `
  const standardColumns = [
    { key: 'name', label: 'Client / Nom' },
    { key: 'contact', label: 'Contact (Email/Tél)' },
    { key: 'taxId', label: 'Matricule' },
    { key: 'address', label: 'Adresse' },
    { key: 'city', label: 'Ville' },
    { key: 'country', label: 'Pays' },
    { key: 'status', label: 'Statut' },
  ];

  const allFilterableFields = [
    { key: 'name', label: 'Client / Nom' },
    { key: 'type', label: 'Type de client' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Téléphone' },
    { key: 'taxId', label: 'Matricule' },
    { key: 'address', label: 'Adresse' },
    { key: 'city', label: 'Ville' },
    { key: 'country', label: 'Pays' },
    { key: 'status', label: 'Statut' },
    ...availableFields.map(f => ({ key: f, label: f }))
  ];

  const allTableColumns = [
    ...standardColumns,
    ...availableFields.map(f => ({ key: f, label: f, isCustom: true }))
  ];
`;

// Replace `allFilterableFields` up to `const customFieldKeys = availableFields;`
const endDefIndex = lines.findIndex(l => l.includes("const customFieldKeys = availableFields;"));
lines.splice(colsDefIndex - 11, endDefIndex - (colsDefIndex - 11) + 1, newCodeCols);

fs.writeFileSync('src/components/clients/ClientsManagement.tsx', lines.join('\n'));
