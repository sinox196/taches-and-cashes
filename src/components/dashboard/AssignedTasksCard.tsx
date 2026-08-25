import React, { useEffect, useState } from 'react';
import { ClipboardCheck, Play, Loader, X, CalendarClock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { friendlyError } from '../../utils/errors';

const PRIORITY_STYLE: Record<string, string> = {
  BASSE: 'bg-gray-100 text-gray-500',
  NORMALE: 'bg-blue-50 text-blue-600',
  HAUTE: 'bg-orange-50 text-orange-600',
  URGENTE: 'bg-red-50 text-red-600',
};
const PRIORITY_LABEL: Record<string, string> = { BASSE: 'Basse', NORMALE: 'Normale', HAUTE: 'Haute', URGENTE: 'Urgente' };

/**
 * Pending "mission + type de tâche" assignments for the logged-in viewer.
 *
 * Mounted on both dashboards (MyDashboard for COLLABORATOR/STAGIAIRE,
 * AdminDashboard for ADMIN/SUPERVISEUR) so a SUPERVISEUR — who is staff and
 * so can be assigned work, but sees the team dashboard, not the personal one
 * — still has somewhere to find tasks assigned *to them*. Always shows the
 * viewer's own assignments regardless of which dashboard variant renders it.
 *
 * Renders nothing when there is nothing pending, so it costs no space on a
 * dashboard for someone who was never assigned anything.
 */
export const AssignedTasksCard: React.FC = () => {
  const { token, user } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    fetch('/api/task-assignments/mine', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : []))
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, [token]);

  const start = async (id: string) => {
    setError('');
    setStartingId(id);
    try {
      const res = await fetch(`/api/task-assignments/${id}/start`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Démarrage impossible.');
      // The task is now a real running time entry — Pointage will show it the
      // moment that page is opened (it always fetches fresh on mount).
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setStartingId(null);
    }
  };

  const cancel = async (id: string) => {
    if (!confirm('Annuler cette tâche planifiée ?')) return;
    setError('');
    setCancelingId(id);
    try {
      const res = await fetch(`/api/task-assignments/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Annulation impossible.');
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setCancelingId(null);
    }
  };

  if (loading || items.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardCheck className="w-4 h-4 text-blue-600" />
        <span className="text-[13px] font-semibold text-gray-800">Tâches assignées</span>
        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 rounded-full px-2 py-0.5">{items.length}</span>
      </div>
      <p className="text-[11px] text-gray-500 mb-3">
        En attente de démarrage — une fois lancée, la tâche apparaît dans Pointage.
      </p>

      {error && (
        <div className="mb-3 p-2.5 bg-red-50 border-l-4 border-red-500 text-red-700 text-[11.5px] font-medium rounded-r-md">
          {error}
        </div>
      )}

      <div className="divide-y divide-gray-50">
        {items.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold text-gray-900">{a.pole}</span>
                {a.taskType && (
                  <span className="text-[10.5px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{a.taskType}</span>
                )}
                {a.priority && a.priority !== 'NORMALE' && (
                  <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${PRIORITY_STYLE[a.priority] || PRIORITY_STYLE.NORMALE}`}>
                    {PRIORITY_LABEL[a.priority] || a.priority}
                  </span>
                )}
              </div>
              {a.client && <div className="text-[11.5px] text-gray-500 mt-0.5">{a.client}</div>}
              {a.description && (
                <div className="text-[11.5px] text-gray-400 italic mt-0.5 truncate" title={a.description}>
                  {a.description}
                </div>
              )}
              {a.scheduledDate && (
                <div className="flex items-center gap-1 text-[10.5px] text-gray-400 mt-1">
                  <CalendarClock className="w-3 h-3" />
                  {new Date(a.scheduledDate).toLocaleDateString('fr-FR')}
                </div>
              )}
              <div className="text-[10.5px] text-gray-400 mt-1">
                {a.assignedByUserId === user?.id ? 'Planifiée par vous' : `Assignée par ${a.assignedByName}`}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-1.5">
              <button
                onClick={() => start(a.id)}
                disabled={startingId === a.id}
                className="px-3 py-1.5 bg-navy text-white rounded-lg text-[11.5px] font-bold hover:bg-navy-hover disabled:opacity-50 flex items-center gap-1.5"
              >
                {startingId === a.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                Démarrer
              </button>
              <button
                onClick={() => cancel(a.id)}
                disabled={cancelingId === a.id}
                title="Annuler cette tâche"
                className="w-7 h-7 border border-gray-200 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:border-red-200 transition-colors disabled:opacity-50"
              >
                {cancelingId === a.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
