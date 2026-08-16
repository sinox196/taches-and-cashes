const fs = require('fs');
let content = fs.readFileSync('src/components/dashboard/DashboardCharts.tsx', 'utf-8');

const targetStr = `      {/* Congés pris vs restants */}`;

const authChart = `
      {/* Autorisations */}
      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <h3 className="text-[13px] font-bold text-gray-900 mb-4">Autorisations (Volume & Durée)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={sortedByTasks} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} angle={-45} textAnchor="end" />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Bar dataKey="authorizations.total" name="Nb Demandes" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="authorizations.totalDuration" name="Durée (h)" stroke="#14b8a6" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
`;

content = content.replace(targetStr, authChart + "\n" + targetStr);
fs.writeFileSync('src/components/dashboard/DashboardCharts.tsx', content, 'utf-8');
