import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, ComposedChart } from 'recharts';

interface DashboardChartsProps {
  employees: any[];
}

export const DashboardCharts: React.FC<DashboardChartsProps> = ({ employees }) => {
  // Sort employees for charts to show top ones first
  const sortedByTasks = [...employees].sort((a, b) => b.tasks.total - a.tasks.total).slice(0, 10);
  const sortedByRate = [...employees].sort((a, b) => b.tasks.completionRate - a.tasks.completionRate).slice(0, 10);
  const sortedByClients = [...employees].sort((a, b) => b.clients.totalHandled - a.clients.totalHandled).slice(0, 10);
  const sortedByLeaves = [...employees].sort((a, b) => b.leaves.daysTaken - a.leaves.daysTaken).slice(0, 10);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      
      {/* Tâches par collaborateur */}
      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <h3 className="text-[13px] font-bold text-gray-900 mb-4">Volume de Tâches par Collaborateur (Top 10)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sortedByTasks} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} angle={-45} textAnchor="end" />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                cursor={{ fill: '#f9fafb' }}
              />
              <Bar dataKey="tasks.total" name="Total Tâches" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="tasks.completed" name="Terminées" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Taux de réalisation */}
      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <h3 className="text-[13px] font-bold text-gray-900 mb-4">Taux de Réalisation (%)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sortedByRate} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} angle={-45} textAnchor="end" />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                cursor={{ fill: '#f9fafb' }}
                formatter={(value: number) => [`${Math.round(value)}%`, 'Taux']}
              />
              <Bar dataKey="tasks.completionRate" name="Taux" radius={[4, 4, 0, 0]}>
                {sortedByRate.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.tasks.completionRate > 80 ? '#10b981' : entry.tasks.completionRate > 50 ? '#f59e0b' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Clients traités */}
      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <h3 className="text-[13px] font-bold text-gray-900 mb-4">Clients Traités par Collaborateur</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sortedByClients} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} angle={-45} textAnchor="end" />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                cursor={{ fill: '#f9fafb' }}
              />
              <Bar dataKey="clients.totalHandled" name="Clients Uniques" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>


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

      {/* Congés pris vs restants */}
      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <h3 className="text-[13px] font-bold text-gray-900 mb-4">Congés Pris vs Droits (Jours)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={sortedByLeaves} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} angle={-45} textAnchor="end" />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Bar dataKey="leaves.daysTaken" name="Congés Pris" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="leaves.balance.available" name="Droit Annuel" stroke="#94a3b8" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  );
};
