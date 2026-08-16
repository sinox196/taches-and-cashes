const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');
const lines = content.split('\n');

const listStartIndex = lines.findIndex(l => l.includes('// 3. Pagination'));

const newCode = `      // 3. Sorting
      const sortField = req.query.sortField || 'createdAt';
      const sortDir = req.query.sortDir || 'desc';

      clients.sort((a, b) => {
        let valA = a[sortField];
        if (valA === undefined && a.customFields) valA = a.customFields[sortField];
        
        let valB = b[sortField];
        if (valB === undefined && b.customFields) valB = b.customFields[sortField];

        if (valA === valB) return 0;
        if (valA === undefined || valA === null) return sortDir === 'asc' ? -1 : 1;
        if (valB === undefined || valB === null) return sortDir === 'asc' ? 1 : -1;

        if (typeof valA === 'string' && typeof valB === 'string') {
          return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        
        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });

      // 4. Pagination`;

lines.splice(listStartIndex, 1, newCode);
fs.writeFileSync('server.ts', lines.join('\n'));
