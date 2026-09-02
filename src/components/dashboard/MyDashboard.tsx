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
  ChevronRight,
  ChevronDown,
  Loader,
  Search,
  X,
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

  // Per-client drill-down. The task list is deliberately not part of the
  // dashboard payload — it would grow without bound — so it is fetched when a
  // client is expanded, and cached by client key for as long as the dates hold.
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [clientTasks, setClientTasks] = useState<Record<string, any>>({});
  const [loadingTasks, setLoadingTasks] = useState<string | null>(null);
  // Filters the already-loaded list in place — no request, so it narrows from
  // the first character typed.
  const [clientQuery, setClientQuery] = useState('');

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

  // A new period invalidates the cached lists: they were fetched under the
  // previous dates and would otherwise be shown against the new ones.
  useEffect(() => {
    setExpandedClient(null);
    setClientTasks({});
  }, [startDate, endDate]);

  const toggleClient = async (clientKey: string) => {
    if (expandedClient === clientKey) { setExpandedClient(null); return; }
    setExpandedClient(clientKey);
    if (clientTasks[clientKey]) return;
    setLoadingTasks(clientKey);
    try {
      const res = await fetch('/api/kpi/client-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key: clientKey, startDate, endDate }),
      });
      if (res.ok) {
        const body = await res.json();
        setClientTasks(prev => ({ ...prev, [clientKey]: body }));
      }
    } catch (error) {
      console.error('Failed to load client tasks', error);
    } finally {
      setLoadingTasks(null);
    }
  };

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

  // Busiest client first, narrowed by the name filter. Accent-insensitive, so
  // typing "societe" still finds "Société".
  const normalise = (v: string) =>
    String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const clientNeedle = normalise(clientQuery.trim());
  const visibleClients = (clients.list ?? [])
    .slice()
    .sort((a: any, b: any) => b.taskCount - a.taskCount)
    .filter((c: any) => !clientNeedle || normalise(c.name).includes(clientNeedle));
  const leaves = me?.leaves ?? { totalRequests: 0, approved: 0, pending: 0, balance: { entitlement: 0, used: 0, available: 0 } };
  const auths = me?.authorizations ?? { total: 0, approved: 0, pending: 0, totalDuration: 0 };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-canvas">
      <main className="p-4 sm:p-6 lg:p-8 flex-1 flex flex-col space-y-4 sm:space-y-6 max-w-[1400px] w-full mx-auto">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-bold text-gray-900 tracking-tight">Mon tableau de bord</h1>
            <p className="text-[13px] text-gray-500 mt-1">
              Vos performances sur la période sélectionnée
            </p>
          </div>

          {/* Du and Au each wrap as a unit — side by side the pair is wider
              than a phone, and the second picker ran off the edge. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-white px-3 py-1.5 rounded-lg border border-gray-200 w-full sm:w-auto">
            <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13px] text-gray-500 font-medium">Du</span>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="text-[13px] outline-none text-gray-700 bg-transparent min-w-0"
              />
            </div>
            <span className="text-gray-300 mx-1 hidden sm:inline">|</span>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13px] text-gray-500 font-medium">Au</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="text-[13px] outline-none text-gray-700 bg-transparent min-w-0"
              />
            </div>
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
            <div className="text-[13px] font-semibold text-gray-800 mb-1">Répartition par client</div>
            <p className="text-[11px] text-gray-500 mb-3">Cliquez sur un client pour voir vos tâches.</p>

            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={clientQuery}
                onChange={e => setClientQuery(e.target.value)}
                placeholder="Filtrer un client..."
                className="w-full pl-8 pr-8 py-2 border border-gray-200 rounded-lg text-[12px] focus:outline-none focus:border-gray-400 placeholder-gray-300"
              />
              {clientQuery && (
                <button
                  onClick={() => setClientQuery('')}
                  title="Effacer"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="space-y-1">
              {visibleClients.length === 0 && (
                <p className="text-[12px] text-gray-400 italic py-2">
                  Aucun client ne correspond à « {clientQuery} ».
                </p>
              )}
              {visibleClients
                .map((c: any) => {
                  // The bucket key the server groups on; a client carrying an
                  // id is keyed on that id.
                  const clientKey = String(c.id);
                  const isOpen = expandedClient === clientKey;
                  const detail = clientTasks[clientKey];
                  return (
                    <div key={c.id} className="border-b border-gray-50 last:border-0">
                      <button
                        onClick={() => toggleClient(clientKey)}
                        aria-expanded={isOpen}
                        className="w-full flex items-center justify-between text-[13px] py-2 px-2 -mx-2 rounded-md hover:bg-gray-50 transition-colors text-left"
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          {isOpen
                            ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                          <span className="text-gray-700 truncate">{c.name}</span>
                        </span>
                        <span className="text-gray-400 shrink-0 ml-2">
                          {c.taskCount} tâche{c.taskCount > 1 ? 's' : ''}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="pb-3 pl-5">
                          {loadingTasks === clientKey ? (
                            <div className="flex items-center gap-2 text-[12px] text-gray-400 py-2">
                              <Loader className="w-3.5 h-3.5 animate-spin" /> Chargement…
                            </div>
                          ) : !detail || detail.tasks.length === 0 ? (
                            <p className="text-[12px] text-gray-400 italic py-2">
                              Aucune tâche sur cette période.
                            </p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="text-[10px] text-gray-500 uppercase tracking-[0.04em] border-b border-gray-100">
                                    <th className="py-1.5 pr-3 font-extrabold">Date</th>
                                    <th className="py-1.5 pr-3 font-extrabold">Mission</th>
                                    <th className="py-1.5 pr-3 font-extrabold">Type</th>
                                    <th className="py-1.5 pr-3 font-extrabold">Activité</th>
                                    <th className="py-1.5 pr-3 font-extrabold">Durée</th>
                                    <th className="py-1.5 font-extrabold">Statut</th>
                                  </tr>
                                </thead>
                                <tbody className="text-[11.5px] text-gray-700">
                                  {detail.tasks.map((t: any) => (
                                    <tr key={t.id} className="border-b border-gray-50 last:border-0">
                                      <td className="py-1.5 pr-3 whitespace-nowrap text-gray-500">{t.date}</td>
                                      <td className="py-1.5 pr-3 truncate" title={t.mission}>{t.mission || '—'}</td>
                                      <td className="py-1.5 pr-3 truncate" title={t.taskType}>{t.taskType || '—'}</td>
                                      <td className="py-1.5 pr-3 truncate" title={t.description}>
                                        {t.description || <span className="text-gray-300">—</span>}
                                      </td>
                                      <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{t.dureeFormatted}</td>
                                      <td className="py-1.5">
                                        <span className={`px-2 py-0.5 rounded-full text-[9.5px] font-extrabold whitespace-nowrap ${
                                          t.statut === 'COMPLETED' ? 'bg-done-bg text-done-fg'
                                            : t.statut === 'RUNNING' ? 'bg-run-bg text-run-fg'
                                            : 'bg-pause-bg text-pause-fg'
                                        }`}>
                                          {t.statut === 'COMPLETED' ? 'TERMINÉE'
                                            : t.statut === 'RUNNING' ? 'EN COURS' : 'EN PAUSE'}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {detail.truncated > 0 && (
                                <p className="text-[11px] text-gray-400 italic pt-2">
                                  {detail.truncated} tâche(s) supplémentaire(s) non affichée(s).
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
