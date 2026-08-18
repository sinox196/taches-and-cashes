import React, { useEffect, useState } from 'react';
import {
  Briefcase, ChevronDown, ChevronRight, Clock, Users, CheckCircle2, Play, Pause, AlertTriangle, Search,
} from 'lucide-react';
import { formatCostTND } from '../../utils/formatters';
import { useAuth } from '../../context/AuthContext';

interface ClientBreakdownProps {
  clients: any[];
  /** Dashboard filters, replayed when fetching a client's tasks. */
  filters: { startDate: string; endDate: string; filterUserIds: number[]; filterClientIds: number[] };
}

const STATUS_META: Record<string, { label: string; className: string; Icon: React.ElementType }> = {
  COMPLETED: { label: 'Terminée', className: 'bg-[#ECFDF3] text-[#12B76A]', Icon: CheckCircle2 },
  RUNNING: { label: 'En cours', className: 'bg-[#FFFAEB] text-[#B54708]', Icon: Play },
  PAUSED: { label: 'En pause', className: 'bg-gray-100 text-gray-600', Icon: Pause },
};

const StatusBadge: React.FC<{ statut: string }> = ({ statut }) => {
  const meta = STATUS_META[statut] ?? { label: statut, className: 'bg-gray-100 text-gray-600', Icon: Clock };
  const { Icon } = meta;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${meta.className}`}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
};

/**
 * Per-client view of the filtered period: what each client cost, who worked on
 * it, and which tasks were done. A table rather than a chart — several measures
 * per row plus a drill-down is tabular work, not a magnitude comparison.
 */
export const ClientBreakdown: React.FC<ClientBreakdownProps> = ({ clients, filters }) => {
  const { user, token } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /** Task lists fetched per client on expand: undefined = not loaded yet. */
  const [taskCache, setTaskCache] = useState<Record<string, any>>({});

  // Filters changed → the cached task lists no longer match what's on screen.
  // Keyed on the value, not the object: the parent rebuilds it every render.
  const filtersKey = JSON.stringify(filters);
  useEffect(() => { setTaskCache({}); setExpanded({}); }, [filtersKey]);

  const toggleRow = async (client: any) => {
    const key = String(client.key ?? client.id);
    const isOpen = !!expanded[key];
    setExpanded(prev => ({ ...prev, [key]: !isOpen }));
    if (isOpen || taskCache[key]) return;

    setTaskCache(prev => ({ ...prev, [key]: { loading: true, tasks: [] } }));
    try {
      const res = await fetch('/api/kpi/client-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...filters, key }),
      });
      const body = await res.json();
      setTaskCache(prev => ({
        ...prev,
        [key]: { loading: false, tasks: body.tasks ?? [], truncated: body.truncated ?? 0 },
      }));
    } catch {
      setTaskCache(prev => ({ ...prev, [key]: { loading: false, tasks: [], error: true } }));
    }
  };
  const [search, setSearch] = useState('');
  // Hundreds of clients would mean hundreds of DOM rows; show the costliest
  // first and reveal more on demand.
  const PAGE = 25;
  const [visible, setVisible] = useState(PAGE);

  if (!clients || clients.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 text-center">
        <Briefcase className="w-8 h-8 text-gray-300 mx-auto mb-3" />
        <p className="text-[13px] text-gray-500">Aucune activité client sur la période sélectionnée.</p>
      </div>
    );
  }

  // Share bar uses the busiest client as the reference, so each row's magnitude
  // is readable without a separate chart.
  const maxDuration = Math.max(...clients.map(c => c.durationSeconds || 0), 1);

  const term = search.trim().toLowerCase();
  const matching = term
    ? clients.filter(c => c.name.toLowerCase().includes(term))
    : clients;
  const shown = matching.slice(0, visible);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-bold text-gray-900 flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-gray-400" />
            Activité par client
            <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
              {clients.length}
            </span>
          </h2>
          <p className="text-[12px] text-gray-500 mt-0.5">
            Coût, intervenants et tâches réalisées — selon les filtres appliqués.
          </p>
        </div>
        <div className="relative shrink-0">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setVisible(PAGE); }}
            placeholder="Filtrer un client…"
            className="pl-8 pr-3 py-1.5 text-[12px] border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 w-56"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left whitespace-nowrap">
          <thead>
            <tr className="bg-[#F9FAFB] border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3">Client</th>
              <th className="px-3 py-3 text-center">Tâches</th>
              <th className="px-3 py-3 text-center">Intervenants</th>
              <th className="px-4 py-3">Durée</th>
              {isAdmin && <th className="px-4 py-3 text-right bg-emerald-50/40">Coût employeur</th>}
            </tr>
          </thead>
          <tbody className="text-[12.5px] divide-y divide-gray-100">
            {shown.map(client => {
              const key = String(client.key ?? client.id);
              const isOpen = !!expanded[key];
              const loaded = taskCache[key];
              return (
                <React.Fragment key={key}>
                  <tr
                    onClick={() => toggleRow(client)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {isOpen
                          ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                          : <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 shrink-0" />}
                        <div className="min-w-0">
                          <div className="font-semibold text-gray-900 truncate">{client.name}</div>
                          {/* magnitude cue: this client's share of the period's hours */}
                          <div className="mt-1 h-1 w-28 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(3, (client.durationSeconds / maxDuration) * 100)}%`,
                                backgroundColor: '#2a78d6',
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="font-semibold text-gray-800">{client.taskCount}</span>
                      <span className="text-gray-400"> · {client.completedTasks} term.</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="inline-flex items-center gap-1 text-gray-700">
                        <Users className="w-3.5 h-3.5 text-gray-400" />
                        {client.contributors.length}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-800">{client.durationFormatted}</td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right bg-emerald-50/20">
                        {/* Same formatter as the rows below, so the total and its
                            parts are read at the same precision. */}
                        <span className="font-semibold text-emerald-900">
                          {formatCostTND(client.totalCost)}
                        </span>
                        {client.unpricedTasks > 0 && (
                          <span
                            className="ml-1 text-amber-600 inline-flex items-center"
                            title={`${client.unpricedTasks} tâche(s) sans coût employeur configuré`}
                          >
                            <AlertTriangle className="w-3 h-3" />
                          </span>
                        )}
                      </td>
                    )}
                  </tr>

                  {isOpen && (
                    <tr>
                      <td colSpan={isAdmin ? 5 : 4} className="px-4 pb-4 pt-1 bg-gray-50/50">
                        {/* Who worked on this client */}
                        <div className="mb-3">
                          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                            Intervenants
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {client.contributors.map((c: any) => (
                              <span
                                key={c.userId}
                                className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2.5 py-1"
                              >
                                <span className="font-semibold text-gray-900 text-[12px]">{c.name}</span>
                                <span className="text-[11px] text-gray-500">
                                  {c.taskCount} tâche(s) · {c.durationFormatted}
                                  {isAdmin && c.cost != null && ` · ${formatCostTND(c.cost)}`}
                                </span>
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* What was done */}
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                          Tâches réalisées
                        </div>
                        {loaded?.loading ? (
                          <div className="bg-white border border-gray-200 rounded-lg px-3 py-4 text-[12px] text-gray-400 italic">
                            Chargement des tâches…
                          </div>
                        ) : loaded?.error ? (
                          <div className="bg-white border border-gray-200 rounded-lg px-3 py-4 text-[12px] text-red-600">
                            Impossible de charger les tâches de ce client.
                          </div>
                        ) : (
                        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                          <table className="w-full text-left text-[12px]">
                            <thead>
                              <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                                <th className="px-3 py-2 font-semibold">Date</th>
                                <th className="px-3 py-2 font-semibold">Collaborateur</th>
                                <th className="px-3 py-2 font-semibold">Activité</th>
                                <th className="px-3 py-2 font-semibold">Mission</th>
                                <th className="px-3 py-2 font-semibold">Type de tâche</th>
                                <th className="px-3 py-2 font-semibold">Durée</th>
                                {isAdmin && <th className="px-3 py-2 font-semibold text-right">Coût</th>}
                                <th className="px-3 py-2 font-semibold">Statut</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {(loaded?.tasks ?? []).map((t: any) => (
                                <tr key={t.id} className="hover:bg-gray-50/60">
                                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{t.date}</td>
                                  <td className="px-3 py-2 text-gray-800 font-medium whitespace-nowrap">{t.userName}</td>
                                  <td className="px-3 py-2 text-gray-900 max-w-[220px] truncate" title={t.description}>
                                    {t.description || <span className="text-gray-400 italic">Sans description</span>}
                                  </td>
                                  <td className="px-3 py-2 text-gray-500">{t.mission || '—'}</td>
                                  <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate" title={t.taskType}>
                                    {t.taskType || <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="px-3 py-2 font-mono text-gray-800 whitespace-nowrap">{t.dureeFormatted}</td>
                                  {isAdmin && (
                                    <td className="px-3 py-2 text-right font-medium text-gray-800 whitespace-nowrap">
                                      {t.cost == null ? <span className="text-gray-300">—</span> : formatCostTND(t.cost)}
                                    </td>
                                  )}
                                  <td className="px-3 py-2"><StatusBadge statut={t.statut} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {loaded?.truncated > 0 && (
                            <div className="px-3 py-2 text-[11px] text-gray-500 bg-gray-50 border-t border-gray-100">
                              Les {loaded.tasks.length} tâches les plus longues sont affichées ·{' '}
                              {loaded.truncated} autre(s) non listée(s).
                            </div>
                          )}
                        </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {matching.length > shown.length && (
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 text-center">
          <button
            onClick={() => setVisible(v => v + PAGE)}
            className="text-[12px] font-medium text-blue-600 hover:text-blue-800"
          >
            Afficher {Math.min(PAGE, matching.length - shown.length)} client(s) de plus
            <span className="text-gray-400"> · {shown.length}/{matching.length}</span>
          </button>
        </div>
      )}
      {term && matching.length === 0 && (
        <div className="px-6 py-8 text-center text-[13px] text-gray-400 italic">
          Aucun client ne correspond à « {search} ».
        </div>
      )}
    </div>
  );
};
