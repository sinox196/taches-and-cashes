const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// The best way to replace this logic is to inject our own version of App.tsx
