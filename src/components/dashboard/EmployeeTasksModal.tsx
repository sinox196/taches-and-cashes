import React, { useEffect, useMemo, useState } from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { X, Briefcase, Clock, CheckCircle2, Play, Pause, Search } from 'lucide-react';
import { formatCostTND } from '../../utils/formatters';
import { roleLabel } from '../../constants/roles';
import { useAuth } from '../../context/AuthContext';

interface EmployeeTasksModalProps {
  employee: any;
  /** Dashboard filters, replayed so the modal matches what's on screen. */
  filters: { startDate: string; endDate: string; filterUserIds: number[]; filterClientIds: number[] };
  onClose: () => void;
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

export const EmployeeTasksModal: React.FC<EmployeeTasksModalProps> = ({ employee, filters, onClose }) => {
  useEscapeToClose(onClose);
  const { user, token } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'RUNNING' | 'PAUSED'>('ALL');
  const [search, setSearch] = useState('');

  // Tasks are fetched on open rather than shipped with the dashboard summary,
  // so the summary stays small however many collaborators there are.
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(0);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    (async () => {
      try {
        const res = await fetch('/api/kpi/employee-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...filters, userId: employee.id }),
        });
        const body = await res.json();
        if (cancelled) return;
        setTasks(body.tasks ?? []);
        setTruncated(body.truncated ?? 0);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employee.id, token, JSON.stringify(filters)]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter(t => {
      const matchesStatus = statusFilter === 'ALL' || t.statut === statusFilter;
      const matchesSearch = !q
        || t.client.toLowerCase().includes(q)
        || t.description.toLowerCase().includes(q)
        || (t.pole || '').toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [tasks, statusFilter, search]);

  // Group by client so "Clients traités" reads as: this client → these tasks.
  const groups = useMemo(() => {
    const byClient = new Map<string, any[]>();
    visible.forEach(t => {
      const key = t.client || 'Sans client';
      if (!byClient.has(key)) byClient.set(key, []);
      byClient.get(key)!.push(t);
    });
    return [...byClient.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [visible]);

  const counts = useMemo(() => ({
    ALL: tasks.length,
    COMPLETED: tasks.filter(t => t.statut === 'COMPLETED').length,
    RUNNING: tasks.filter(t => t.statut === 'RUNNING').length,
    PAUSED: tasks.filter(t => t.statut === 'PAUSED').length,
  }), [tasks]);

  const FILTERS: { id: typeof statusFilter; label: string }[] = [
    { id: 'ALL', label: 'Toutes' },
    { id: 'COMPLETED', label: 'Terminées' },
    { id: 'RUNNING', label: 'En cours' },
    { id: 'PAUSED', label: 'En pause' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-3xl bg-white h-full shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-gray-900">Clients traités — {employee.name}</h2>
              <div className="text-[12px] text-gray-500">
                {roleLabel(employee.role)} · {employee.clients?.totalHandled ?? groups.length} client(s) · {tasks.length} tâche(s)
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 shrink-0">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                statusFilter === f.id
                  ? 'bg-navy text-white border-navy'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
            >
              {f.label} ({counts[f.id]})
            </button>
          ))}
          <div className="relative ml-auto">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filtrer par client, activité…"
              className="pl-8 pr-3 py-1.5 text-[12px] border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 w-56"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {truncated > 0 && (
            <div className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              Les {tasks.length} tâches les plus longues sont affichées · {truncated} autre(s) non listée(s).
            </div>
          )}
          {loading ? (
            <div className="text-center text-gray-400 text-[13px] italic py-12">Chargement des tâches…</div>
          ) : loadError ? (
            <div className="text-center text-red-600 text-[13px] py-12">
              Impossible de charger les tâches de ce collaborateur.
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center text-gray-400 text-[13px] italic py-12">
              Aucune tâche ne correspond à ce filtre.
            </div>
          ) : (
            groups.map(([clientName, clientTasks]) => {
              const secs = clientTasks.reduce((s, t) => s + (t.dureeSeconds || 0), 0);
              const priced = clientTasks.filter(t => t.cost != null);
              const cost = priced.reduce((s, t) => s + t.cost, 0);
              const h = Math.floor(secs / 3600);
              const m = Math.floor((secs % 3600) / 60);
              return (
                <div key={clientName} className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between">
                    <div className="font-semibold text-[13px] text-gray-900">{clientName}</div>
                    <div className="text-[11px] text-gray-500 flex items-center gap-3">
                      <span>{clientTasks.length} tâche(s)</span>
                      <span className="font-mono">{h}h{String(m).padStart(2, '0')}</span>
                      {isAdmin && (
                        <span className="font-semibold text-gray-700">
                          {priced.length === 0 ? '— coût non configuré' : formatCostTND(cost)}
                        </span>
                      )}
                    </div>
                  </div>
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                        <th className="px-4 py-2 font-semibold">Date</th>
                        <th className="px-4 py-2 font-semibold">Activité</th>
                        <th className="px-4 py-2 font-semibold">Pôle</th>
                        <th className="px-4 py-2 font-semibold whitespace-nowrap">Début → Fin</th>
                        <th className="px-4 py-2 font-semibold">Durée</th>
                        <th className="px-4 py-2 font-semibold">Statut</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {clientTasks.map(t => (
                        <tr key={t.id} className="hover:bg-gray-50/60">
                          <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{t.date}</td>
                          <td className="px-4 py-2 text-gray-900 font-medium max-w-xs truncate" title={t.description}>
                            {t.description || <span className="text-gray-400 italic">Sans description</span>}
                          </td>
                          <td className="px-4 py-2 text-gray-500">{t.pole || '—'}</td>
                          <td className="px-4 py-2 font-mono text-gray-500 whitespace-nowrap">
                            {t.heureDebut || '—'} → {t.heureFin || <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2 font-mono text-gray-800 whitespace-nowrap">{t.dureeFormatted}</td>
                          <td className="px-4 py-2"><StatusBadge statut={t.statut} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
