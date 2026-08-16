const fs = require('fs');
let content = fs.readFileSync('src/components/dashboard/AdminDashboard.tsx', 'utf-8');

const target = `    let currentStartDate = startDate;
    let currentEndDate = endDate;

    const toLocalDateString = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return \\\`\\\${year}-\\\${month}-\\\${day}\\\`;
    };
    
    if (period !== 'Personnalisée') {
      const now = new Date();
      if (period === "Aujourd'hui") {
        currentStartDate = toLocalDateString(now);
        currentEndDate = currentStartDate;
      } else if (period === 'Cette semaine') {
        const firstDay = new Date(now.setDate(now.getDate() - now.getDay() + 1));
        const lastDay = new Date(now.setDate(now.getDate() - now.getDay() + 7));
        currentStartDate = toLocalDateString(firstDay);
        currentEndDate = toLocalDateString(lastDay);
      } else if (period === 'Ce mois') {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        currentStartDate = toLocalDateString(firstDay);
        currentEndDate = toLocalDateString(lastDay);
      } else if (period === 'Ce trimestre') {
        const q = Math.floor(now.getMonth() / 3);
        const firstDay = new Date(now.getFullYear(), q * 3, 1);
        const lastDay = new Date(now.getFullYear(), q * 3 + 3, 0);
        currentStartDate = toLocalDateString(firstDay);
        currentEndDate = toLocalDateString(lastDay);
      } else if (period === 'Cette année') {
        const firstDay = new Date(now.getFullYear(), 0, 1);
        const lastDay = new Date(now.getFullYear(), 11, 31);
        currentStartDate = toLocalDateString(firstDay);
        currentEndDate = toLocalDateString(lastDay);
      }
    }`;

// Actually I can just replace from `const fetchKPIs = async () => {` until the `try {` block.

const replaceFrom = `  const fetchKPIs = async () => {`;
const replaceTo = `    try {
      const res = await fetch('/api/kpi/dashboard', {`;

const newCode = `  const fetchKPIs = async () => {
    setLoading(true);

    try {
      const res = await fetch('/api/kpi/dashboard', {`;

const fullTarget = content.substring(content.indexOf(replaceFrom), content.indexOf(replaceTo) + replaceTo.length);
content = content.replace(fullTarget, newCode);
fs.writeFileSync('src/components/dashboard/AdminDashboard.tsx', content, 'utf-8');
