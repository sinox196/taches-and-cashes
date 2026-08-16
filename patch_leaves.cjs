const fs = require('fs');
let content = fs.readFileSync('src/components/hr/LeavesTab.tsx', 'utf-8');

// 1. Add dateError state and useEffect
const hooksTarget = "const [approverId, setApproverId] = useState('');";
const hooksReplacement = `const [approverId, setApproverId] = useState('');
  const [dateError, setDateError] = useState('');

  React.useEffect(() => {
    if (startDate && endDate) {
      const start = new Date(startDate).getTime();
      const end = new Date(endDate).getTime();
      if (end < start) {
        setDateError('La date de fin ne peut pas être antérieure à la date de début.');
        setDuration(0);
      } else {
        setDateError('');
        const diffDays = (end - start) / (1000 * 3600 * 24);
        setDuration(diffDays);
      }
    } else {
      setDateError('');
      setDuration(0);
    }
  }, [startDate, endDate]);`;

content = content.replace(hooksTarget, hooksReplacement);

// 2. Prevent submit if error or duration <= 0
const submitTarget = `const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approverId) {`;
const submitReplacement = `const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dateError) {
      alert(dateError);
      return;
    }
    if (duration <= 0) {
      alert('La durée doit être supérieure à 0.');
      return;
    }
    if (!approverId) {`;

content = content.replace(submitTarget, submitReplacement);

// 3. Update the input to be read-only and add validation message
const durationInputTarget = `<div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Durée (en jours)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
                    required
                  />
                </div>`;

const durationInputReplacement = `<div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Durée (en jours)</label>
                  <input
                    type="number"
                    value={duration}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                    readOnly
                    required
                  />
                  {dateError && (
                    <p className="mt-1 text-[12px] text-red-600 font-medium">{dateError}</p>
                  )}
                  {!dateError && duration === 0 && startDate && endDate && (
                    <p className="mt-1 text-[12px] text-amber-600 font-medium">La durée doit être supérieure à 0 (les dates ne peuvent pas être identiques si la formule est Date Fin - Date Début).</p>
                  )}
                </div>`;

content = content.replace(durationInputTarget, durationInputReplacement);

fs.writeFileSync('src/components/hr/LeavesTab.tsx', content, 'utf-8');
