const fs = require('fs');
let content = fs.readFileSync('src/components/hr/AbsencesTab.tsx', 'utf-8');

// 1. Add timeError state and useEffect
const hooksTarget = "const [approverId, setApproverId] = useState('');";
const hooksReplacement = `const [approverId, setApproverId] = useState('');
  const [timeError, setTimeError] = useState('');

  React.useEffect(() => {
    if (startTime && endTime) {
      const startParts = startTime.split(':');
      const endParts = endTime.split(':');
      const startMins = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
      const endMins = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
      const diffMins = endMins - startMins;

      if (diffMins < 0) {
        setTimeError("L'heure de fin ne peut pas être antérieure à l'heure de début.");
        setDuration(0);
      } else if (diffMins === 0) {
        setTimeError("La durée doit être supérieure à 0.");
        setDuration(0);
      } else {
        setTimeError('');
        setDuration(diffMins / 60);
      }
    } else {
      setTimeError('');
      setDuration(0);
    }
  }, [startTime, endTime]);`;

content = content.replace(hooksTarget, hooksReplacement);

// 2. Prevent submit if error or duration <= 0
const submitTarget = `const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approverId) {`;
const submitReplacement = `const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (timeError) {
      alert(timeError);
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Durée (en heures)</label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Durée (en heures)</label>
                  <input
                    type="text"
                    value={duration > 0 ? \`\${Math.floor(duration)}h\${(duration % 1) * 60 === 0 ? '00' : Math.round((duration % 1) * 60)}\` : '0h00'}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                    readOnly
                    required
                  />
                  {timeError && (
                    <p className="mt-1 text-[12px] text-red-600 font-medium">{timeError}</p>
                  )}
                </div>`;

content = content.replace(durationInputTarget, durationInputReplacement);

fs.writeFileSync('src/components/hr/AbsencesTab.tsx', content, 'utf-8');
