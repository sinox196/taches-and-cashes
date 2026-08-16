const fs = require('fs');
let content = fs.readFileSync('src/server/database.ts', 'utf-8');
content = content.replace(
  "getLeaveBalanceByUserId: async (userId: number) => {",
  "getAllLeaveBalances: async () => { return db.leaveBalances || []; },\n    getLeaveBalanceByUserId: async (userId: number) => {"
);
fs.writeFileSync('src/server/database.ts', content, 'utf-8');
