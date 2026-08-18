import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  Loader2,
  Calendar,
  Clock,
  CheckCircle,
  Play,
  Pause,
  Briefcase,
  CalendarDays,
  Clock4,
} from 'lucide-react';

/**
 * Personal KPI dashboard for roles that don't get the team-wide AdminDashboard
 * (COLLABORATOR, STAGIAIRE — see DASHBOARD_ROLES in constants/roles.ts).
 *
 * Reuses POST /api/kpi/dashboard, same as AdminDashboard. The server pins a
 * non-team viewer to their own id regardless of what filters are sent, so
 * this only ever renders the caller's own numbers — there is no user/client
 * picker here on purpose.
 */
export const MyDashboard: React.FC = () => {
  const { token, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);

  const toLocalDateString = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return toLocalDateString(d);
  });
  const [endDate, setEndDate] = useState<string>(() => toLocalDateString(new Date()));

  useEffect(() => {
    let cancelled = false;
    const fetchKPIs = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/kpi/dashboard', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ startDate, endDate }),
        });
        if (res.ok && !cancelled) {
          setStats(await res.json());
        }
      } catch (error) {
        console.error('Failed to fetch personal KPIs', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchKPIs();
    return () => { cancelled = true; };
  }, [startDate, endDate, token]);

  if (!stats && loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
      </div>
    );
  }

  const me = stats?.employeeStats?.[0];
  const tasks = me?.tasks ?? { total: 0, completed: 0, inProgress: 0, paused: 0, completionRate: 0, totalDurationFormatted: '0h00' };
  const clients = me?.clients ?? { totalHandled: 0, list: [] };
  const leaves = me?.leaves ?? { totalRequests: 0, approved: 0, pending: 0, balance: { entitlement: 0, used: 0, available: 0 } };
  const auths = me?.authorizations ?? { total: 0, approved: 0, pending: 0, totalDuration: 0 };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-[#F2F4F7]">
      <main className="p-6 lg:p-8 flex-1 flex flex-col space-y-6 max-w-[1400px] w-full mx-auto">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-bold text-gray-900 tracking-tight">Mon tableau de bord</h1>
            <p className="text-[13px] text-gray-500 mt-1">
              Vos performances sur la période sélectionnée
            </p>
          </div>

          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span className="text-[13px] text-gray-500 font-medium">Du</span>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="text-[13px] outline-none text-gray-700 bg-transparent"
            />
            <span className="text-gray-300 mx-1">|</span>
            <span className="text-[13px] text-gray-500 font-medium">Au</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="text-[13px] outline-none text-gray-700 bg-transparent"
            />
          </div>
        </div>

        {loading && (
          <div className="text-[12px] text-gray-400">Actualisation…</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[12px] font-medium text-gray-500 mb-1 uppercase tracking-wider">Temps pointé</div>
              <div className="text-2xl font-bold text-gray-900">{tasks.totalDurationFormatted}</div>
              <div className="text-[11px] text-gray-400 mt-1">sur la période</div>
            </div>
            <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[12px] font-medium text-gray-500 mb-1 uppercase tracking-wider">Tâches</div>
              <div className="text-2xl font-bold text-gray-900">{tasks.total}</div>
              <div className="flex gap-2 mt-1">
                <span className="text-[11px] text-emerald-600 flex items-center"><CheckCircle className="w-3 h-3 mr-0.5" />{tasks.completed}</span>
                <span className="text-[11px] text-amber-600 flex items-center"><Play className="w-3 h-3 mr-0.5" />{tasks.inProgress}</span>
                <span className="text-[11px] text-gray-500 flex items-center"><Pause className="w-3 h-3 mr-0.5" />{tasks.paused}</span>
              </div>
            </div>
            <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-full flex items-center justify-center">
              <Clock className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[12px] font-medium text-gray-500 mb-1 uppercase tracking-wider">Clients traités</div>
              <div className="text-2xl font-bold text-gray-900">{clients.totalHandled}</div>
              <div className="text-[11px] text-gray-400 mt-1">Clients uniques sur la période</div>
            </div>
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center">
              <Briefcase className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[12px] font-medium text-gray-500 mb-1 uppercase tracking-wider">Solde congés</div>
              <div className="text-2xl font-bold text-gray-900">{leaves.balance?.available ?? 0}j</div>
              <div className="text-[11px] text-gray-400 mt-1">
                {leaves.balance?.used ?? 0}j utilisés / {leaves.balance?.entitlement ?? 0}j
              </div>
            </div>
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center">
              <CalendarDays className="w-6 h-6" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <div className="text-[13px] font-semibold text-gray-800 mb-3">Congés</div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-lg font-bold text-gray-900">{leaves.totalRequests}</div>
                <div className="text-[11px] text-gray-400">Demandes</div>
              </div>
              <div>
                <div className="text-lg font-bold text-emerald-600">{leaves.approved}</div>
                <div className="text-[11px] text-gray-400">Approuvées</div>
              </div>
              <div>
                <div className="text-lg font-bold text-amber-600">{leaves.pending}</div>
                <div className="text-[11px] text-gray-400">En attente</div>
              </div>
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <div className="text-[13px] font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
              <Clock4 className="w-4 h-4 text-gray-400" /> Autorisations d'absence
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-lg font-bold text-gray-900">{auths.total}</div>
                <div className="text-[11px] text-gray-400">Total</div>
              </div>
              <div>
                <div className="text-lg font-bold text-emerald-600">{auths.approved}</div>
                <div className="text-[11px] text-gray-400">Approuvées</div>
              </div>
              <div>
                <div className="text-lg font-bold text-amber-600">{auths.pending}</div>
                <div className="text-[11px] text-gray-400">En attente</div>
              </div>
            </div>
          </div>
        </div>

        {clients.list?.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="text-[13px] font-semibold text-gray-800 mb-3">Répartition par client</div>
            <div className="space-y-2">
              {clients.list
                .slice()
                .sort((a: any, b: any) => b.taskCount - a.taskCount)
                .map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between text-[13px] py-1.5 border-b border-gray-50 last:border-0">
                    <span className="text-gray-700">{c.name}</span>
                    <span className="text-gray-400">{c.taskCount} tâche{c.taskCount > 1 ? 's' : ''}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
