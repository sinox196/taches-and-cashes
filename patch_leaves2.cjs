const fs = require('fs');
let content = fs.readFileSync('src/components/hr/LeavesTab.tsx', 'utf-8');

const durationInputTarget = `<input
                    type="number"
                    value={duration}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                    readOnly
                    required
                  />`;

const durationInputReplacement = `<input
                    type="text"
                    value={duration > 0 ? \`\${duration} \${duration > 1 ? 'jours' : 'jour'}\` : '0 jour'}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                    readOnly
                    required
                  />`;

content = content.replace(durationInputTarget, durationInputReplacement);
fs.writeFileSync('src/components/hr/LeavesTab.tsx', content, 'utf-8');
