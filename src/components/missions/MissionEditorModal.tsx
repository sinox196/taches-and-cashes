import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Plus, Trash2, X, Loader, ListChecks } from 'lucide-react';

export interface Mission {
  id: number;
  name: string;
  clientId: number | null;
}

export interface TaskType {
  id: number;
  name: string;
  serviceId: number;
}

/** A row in the type list. `id` absent = not saved yet. */
interface DraftType {
  id?: number;
  name: string;
  /** Name as loaded, so only genuinely renamed types are PUT. */
  originalName?: string;
}

interface MissionEditorModalProps {
  /** null = create a new mission. */
  mission: Mission | null;
  /** All known task types; the ones for `mission` are pre-loaded into the form. */
  taskTypes: TaskType[];
  onClose: () => void;
  onSaved: (mission: Mission) => void;
  /** Called after the mission and its types have been deleted. */
  onDeleted?: (mission: Mission) => void;
}

/**
 * The single place a mission and its types de tâches are created or edited.
 *
 * Used by both the Missions admin screen and the Pointage card, so "ajouter"
 * and "modifier" mean the same thing — including adding types to a brand-new
 * mission and renaming/removing existing ones — wherever you start from.
 *
 * Type edits are staged locally and flushed on save in a fixed order:
 * mission first (a new one has no id yet), then deletions, then creates/renames.
 */
export const MissionEditorModal: React.FC<MissionEditorModalProps> = ({
  mission,
  taskTypes,
  onClose,
  onSaved,
  onDeleted,
}) => {
  const { token } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [name, setName] = useState(mission?.name ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [types, setTypes] = useState<DraftType[]>(
    mission
      ? taskTypes.filter(t => t.serviceId === mission.id).map(t => ({ id: t.id, name: t.name, originalName: t.name }))
      : []
  );
  const [removedIds, setRemovedIds] = useState<number[]>([]);
  const [newTypeName, setNewTypeName] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const addType = () => {
    const value = newTypeName.trim();
    if (!value) return;
    if (types.some(t => t.name.trim().toLowerCase() === value.toLowerCase())) {
      setError('Ce type de tâche existe déjà dans cette mission.');
      return;
    }
    setError('');
    setTypes(prev => [...prev, { name: value }]);
    setNewTypeName('');
  };

  const renameType = (index: number, value: string) =>
    setTypes(prev => prev.map((t, i) => (i === index ? { ...t, name: value } : t)));

  const removeType = (index: number) => {
    const target = types[index];
    if (target.id) setRemovedIds(prev => [...prev, target.id!]);
    setTypes(prev => prev.filter((_, i) => i !== index));
  };

  const request = async (url: string, method: string, body?: any) => {
    const res = await fetch(url, { method, headers: authHeaders, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Une erreur est survenue');
    }
    return res.json().catch(() => ({}));
  };

  const handleSave = async () => {
    const missionName = name.trim();
    if (!missionName) { setError('Le nom de la mission est requis.'); return; }
    if (types.some(t => !t.name.trim())) { setError('Un type de tâche ne peut pas être vide.'); return; }

    setError('');
    setIsSaving(true);
    try {
      // The client scope is no longer editable here; keep whatever an existing
      // mission already had, and leave new ones open to all clients.
      const payload = { name: missionName, clientId: mission ? mission.clientId ?? null : null };
      const saved: Mission = mission
        ? await request(`/api/services/${mission.id}`, 'PUT', payload)
        : await request('/api/services', 'POST', payload);

      for (const id of removedIds) {
        await request(`/api/task-types/${id}`, 'DELETE');
      }
      for (const draft of types) {
        const typeName = draft.name.trim();
        if (!draft.id) {
          await request('/api/task-types', 'POST', { name: typeName, serviceId: saved.id });
        } else if (typeName !== draft.originalName) {
          await request(`/api/task-types/${draft.id}`, 'PUT', { name: typeName });
        }
      }
      onSaved(saved);
    } catch (e: any) {
      setError(e.message || 'Une erreur est survenue');
    } finally {
      setIsSaving(false);
    }
  };

  /** Deletes the mission; the server cascades its types de tâches. */
  const handleDelete = async () => {
    if (!mission) return;
    setError('');
    setIsSaving(true);
    try {
      await request(`/api/services/${mission.id}`, 'DELETE');
      onDeleted?.(mission);
    } catch (e: any) {
      setError(e.message || 'Suppression impossible');
      setConfirmingDelete(false);
    } finally {
      setIsSaving(false);
    }
  };

  const existingTypeCount = mission ? taskTypes.filter(t => t.serviceId === mission.id).length : 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center shrink-0">
          <h2 className="text-[16px] font-bold text-gray-900">
            {mission ? 'Modifier la mission' : 'Nouvelle mission'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">Nom de la mission</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              placeholder="Ex: Comptabilité"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
            />
          </div>

          <div className="pt-4 border-t border-gray-200">
            <h3 className="text-[13px] font-bold text-gray-800 mb-1 flex items-center gap-1.5">
              <ListChecks className="w-4 h-4" />
              Types de tâches
            </h3>
            <p className="text-[11px] text-gray-500 mb-3">
              Proposés dans le pointage une fois cette mission sélectionnée.
            </p>

            {types.length === 0 ? (
              <p className="text-[12px] text-gray-400 italic mb-3">
                Aucun type pour l'instant — ajoutez-en ci-dessous.
              </p>
            ) : (
              <div className="space-y-2 mb-3">
                {types.map((t, i) => (
                  <div key={t.id ?? `new-${i}`} className="flex items-center gap-2">
                    <input
                      value={t.name}
                      onChange={e => renameType(i, e.target.value)}
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-[12.5px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    />
                    {!t.id && (
                      <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide shrink-0">
                        nouveau
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeType(i)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"
                      title="Retirer ce type de tâche"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={newTypeName}
                onChange={e => setNewTypeName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addType(); } }}
                placeholder="Ex: Collecte des documents comptables"
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-[12.5px] focus:ring-2 focus:ring-navy focus:border-transparent"
              />
              <button
                type="button"
                onClick={addType}
                disabled={!newTypeName.trim()}
                className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-[12px] font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Ajouter
              </button>
            </div>

            {removedIds.length > 0 && (
              <p className="text-[11px] text-amber-700 mt-2">
                {removedIds.length} type(s) seront supprimés à l'enregistrement.
              </p>
            )}
          </div>

          <div className="pt-4 border-t border-gray-200 flex items-center justify-between gap-3">
            {/* Delete lives here so a mission can be removed from wherever it
                was opened — Pointage or the Missions screen. */}
            {mission && onDeleted ? (
              confirmingDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] text-red-700 font-medium">
                    Supprimer{existingTypeCount > 0 ? ` avec ses ${existingTypeCount} type(s) ?` : ' ?'}
                  </span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isSaving}
                    className="px-2.5 py-1 bg-red-600 text-white rounded-md text-[12px] font-semibold hover:bg-red-700 disabled:opacity-50"
                  >
                    Oui, supprimer
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="px-2.5 py-1 border border-gray-300 rounded-md text-[12px] font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Non
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="px-3 py-2 text-[13px] font-medium text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1.5"
                  title="Supprimer cette mission et tous ses types de tâches"
                >
                  <Trash2 className="w-4 h-4" />
                  Supprimer la mission
                </button>
              )
            ) : (
              <span />
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-100 transition-colors bg-white"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || !name.trim()}
                className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving && <Loader className="w-4 h-4 animate-spin" />}
                {mission ? 'Enregistrer' : 'Créer la mission'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
