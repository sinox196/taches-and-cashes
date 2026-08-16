const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Replace imports if needed
content = content.replace(
  "INITIAL_TIME_ENTRIES,",
  ""
);

content = content.replace(
  "const [timeEntries, setTimeEntries] = useState<TimeEntry[]>(INITIAL_TIME_ENTRIES);",
  "const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);"
);

// We'll replace the entire TimeTracking state and effect logic using string replacement
