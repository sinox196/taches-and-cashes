import React, { useEffect, useState } from 'react';
import { ClipboardCheck, Play, Loader } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

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
  const { token } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string | null>(null);
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
      setError(e.message);
    } finally {
      setStartingId(null);
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
              </div>
              {a.client && <div className="text-[11.5px] text-gray-500 mt-0.5">{a.client}</div>}
              {a.description && (
                <div className="text-[11.5px] text-gray-400 italic mt-0.5 truncate" title={a.description}>
                  {a.description}
                </div>
              )}
              <div className="text-[10.5px] text-gray-400 mt-1">Assignée par {a.assignedByName}</div>
            </div>
            <button
              onClick={() => start(a.id)}
              disabled={startingId === a.id}
              className="shrink-0 px-3 py-1.5 bg-navy text-white rounded-lg text-[11.5px] font-bold hover:bg-navy-hover disabled:opacity-50 flex items-center gap-1.5"
            >
              {startingId === a.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              Démarrer
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
