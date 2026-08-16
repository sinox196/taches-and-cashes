const fs = require('fs');
const content = fs.readFileSync('src/components/UsersManagement.tsx', 'utf8');
const lines = content.split('\n');

const stateIndex = lines.findIndex(l => l.includes('const [formAccidentTravail, setFormAccidentTravail] = useState<number | \'\'>(\'\');'));
lines.splice(stateIndex + 1, 0, `  const [formPrimesFraisNonCotisables, setFormPrimesFraisNonCotisables] = useState<number | ''>('');`);

const openCreateIdx = lines.findIndex(l => l.includes('setFormAccidentTravail(globalSettings?.accidentTravail ?? 0.5);'));
lines.splice(openCreateIdx + 1, 0, `    setFormPrimesFraisNonCotisables('');`);

const openEditIdx = lines.findIndex(l => l.includes('setFormAccidentTravail(typeof user.accidentTravail === \'number\' ? user.accidentTravail : (globalSettings?.accidentTravail ?? 0.5));'));
lines.splice(openEditIdx + 1, 0, `    setFormPrimesFraisNonCotisables(typeof user.primesFraisNonCotisables === 'number' ? user.primesFraisNonCotisables : '');`);

const payloadIdx = lines.findIndex(l => l.includes('accidentTravail: formAccidentTravail === \'\' ? null : Number(formAccidentTravail)'));
lines[payloadIdx] = lines[payloadIdx].replace('Number(formAccidentTravail)', 'Number(formAccidentTravail),');
lines.splice(payloadIdx + 1, 0, `        primesFraisNonCotisables: formPrimesFraisNonCotisables === '' ? null : Number(formPrimesFraisNonCotisables)`);

const calcIdx = lines.findIndex(l => l.includes('const coutTotalEmployeur = simSalaire + montantsCharges;'));
lines[calcIdx] = `  const simPrimes = typeof formPrimesFraisNonCotisables === 'number' ? formPrimesFraisNonCotisables : 0;
  const coutTotalEmployeur = simSalaire + montantsCharges + simPrimes;`;

// We also need to add Info icon to lucide-react imports
const importIdx = lines.findIndex(l => l.includes('import { Plus, Pencil, Trash2, Shield, X, Loader2, ChevronDown, ChevronRight } from \'lucide-react\';'));
lines[importIdx] = lines[importIdx].replace('X, Loader2', 'X, Loader2, Info');

fs.writeFileSync('src/components/UsersManagement.tsx', lines.join('\n'));
