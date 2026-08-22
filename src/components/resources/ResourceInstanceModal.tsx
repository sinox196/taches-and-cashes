import React, { useState } from 'react';
import { X, Check, Lock, Loader, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { friendlyError } from '../../utils/errors';

interface ItemStatus {
  id: string;
  label: string;
  sortOrder: number;
  done: boolean;
  completedAt: string | null;
}

interface Instance {
  id: string;
  name: string;
  type: 'document_checklist' | 'procedure';
  isSequential: boolean;
  createdAt: string;
  items: ItemStatus[];
}

interface ResourceInstanceModalProps {
  instance: Instance;
  onClose: () => void;
  onChanged: () => void;
}

/**
 * §4.2 — écran de suivi d'avancement. A plain "Document | Suivi" checkbox
 * list (or, when the template is séquentielle, a hard block on skipping
 * ahead), and a progress bar computed from items_terminés / total_items.
 */
export const ResourceInstanceModal: React.FC<ResourceInstanceModalProps> = ({ instance, onClose, onChanged }) => {
  const { token } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [items, setItems] = useState(instance.items);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const resolvedCount = sorted.filter(i => i.done).length;
  const progress = sorted.length ? Math.round((resolvedCount / sorted.length) * 100) : 0;

  const isBlocked = (item: ItemStatus) =>
    instance.isSequential && sorted.some(i => i.sortOrder < item.sortOrder && !i.done);

  const toggle = async (item: ItemStatus) => {
    setError('');
    setPendingId(item.id);
    try {
      const res = await fetch(`/api/client-resource-items/${item.id}`, {
        method: 'PUT', headers: authHeaders, body: JSON.stringify({ done: !item.done }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Mise à jour impossible.');
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, done: data.done, completedAt: data.completedAt } : i)));
      onChanged();
    } catch (e: any) {
      setError(friendlyError(e, 'Mise à jour impossible.'));
    } finally {
      setPendingId(null);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/client-resources/${instance.id}`, { method: 'DELETE', headers: authHeaders });
      if (!res.ok) throw new Error('Suppression impossible.');
      onChanged();
      onClose();
    } catch (e: any) {
      setError(friendlyError(e, 'Suppression impossible.'));
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-4 max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between shrink-0">
          <div>
            <h2 className="text-[14px] font-bold text-gray-900">{instance.name}</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {instance.type === 'procedure' ? 'Procédure' : 'Documents à fournir'} · affecté le {new Date(instance.createdAt).toLocaleDateString('fr-FR')}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pt-4 shrink-0">
          <div className="flex items-center justify-between text-[11px] font-medium text-gray-500 mb-1.5">
            <span>{resolvedCount} / {sorted.length} résolus</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-done-fg rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-3 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md shrink-0">{error}</div>
        )}

        <div className="p-5 overflow-y-auto flex-1 space-y-1.5">
          <div className="flex items-center justify-between px-1 pb-1 text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">
            <span>Document</span>
            <span>Suivi</span>
          </div>
          {sorted.map(item => {
            const blocked = isBlocked(item);
            const isPending = pendingId === item.id;
            return (
              <div
                key={item.id}
                className={`flex items-center gap-3 p-2.5 rounded-lg border ${
                  item.done ? 'border-emerald-100 bg-emerald-50/40' : 'border-gray-200 bg-white'
                }`}
              >
                <div className={`flex-1 min-w-0 text-[13px] font-medium ${item.done ? 'text-gray-500 line-through' : 'text-gray-800'}`}>
                  {item.label}
                </div>
                <button
                  type="button"
                  disabled={blocked || isPending}
                  onClick={() => toggle(item)}
                  title={blocked ? "Résolvez d'abord les documents précédents" : undefined}
                  className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                    item.done ? 'bg-done-fg border-done-fg text-white'
                      : blocked ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
                      : 'border-gray-300 hover:border-gray-400'
                  } disabled:cursor-not-allowed`}
                >
                  {isPending ? <Loader className="w-3 h-3 animate-spin" />
                    : item.done ? <Check className="w-3.5 h-3.5" />
                    : blocked ? <Lock className="w-2.5 h-2.5 text-gray-300" />
                    : null}
                </button>
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center shrink-0">
          {confirmingDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] text-red-700 font-medium">Retirer ce suivi ?</span>
              <button onClick={handleDelete} disabled={deleting} className="px-2.5 py-1 bg-red-600 text-white rounded-md text-[12px] font-semibold hover:bg-red-700 disabled:opacity-50">Oui</button>
              <button onClick={() => setConfirmingDelete(false)} className="px-2.5 py-1 border border-gray-300 rounded-md text-[12px] font-medium text-gray-600 hover:bg-gray-50">Non</button>
            </div>
          ) : (
            <button onClick={() => setConfirmingDelete(true)} className="text-[12px] font-medium text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg flex items-center gap-1.5">
              <Trash2 className="w-3.5 h-3.5" />
              Retirer
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover">Fermer</button>
        </div>
      </div>
    </div>
  );
};
