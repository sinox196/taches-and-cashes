import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Plus, Pencil, Trash2, Loader2, Layers, ListChecks } from 'lucide-react';
import { MissionEditorModal, type Mission, type TaskType } from './MissionEditorModal';

/**
 * Admin screen for the mission → types de tâches catalogue that drives the
 * Pointage form. Gated on MANAGE_SERVICES, so the admin can hand this to any
 * other role by granting that permission in the user form.
 *
 * Creating and editing both open MissionEditorModal — the same component the
 * Pointage card uses, so the two entry points can't drift apart.
 */
export const MissionsManagement: React.FC = () => {
  const { token, hasPermission } = useAuth();

  const [missions, setMissions] = useState<Mission[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<false | { mission: Mission | null }>(false);

  const canManage = hasPermission('MANAGE_SERVICES');
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  /**
   * Une réponse qui n'est pas une liste est une **erreur**, pas une liste
   * vide. L'ancienne version testait `Array.isArray` et, sur un 401/403/500,
   * laissait simplement l'état à `[]` : l'écran affichait « Aucune mission
   * pour le moment » alors que la requête avait échoué, ce qui envoie
   * chercher un catalogue manquant quand le vrai problème est ailleurs. On
   * remonte donc le message du serveur.
   */
  const fetchList = async (url: string): Promise<any[]> => {
    const res = await fetch(url, { headers: authHeaders });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `${url} — erreur ${res.status}`);
    if (!Array.isArray(body)) throw new Error(`${url} — réponse inattendue du serveur`);
    return body;
  };

  const load = async () => {
    try {
      const [m, t, c] = await Promise.all([
        fetchList('/api/services'),
        fetchList('/api/task-types'),
        // Les clients ne servent qu'à nommer la portée d'une mission : leur
        // absence ne doit pas masquer le catalogue.
        fetchList('/api/clients').catch(() => []),
      ]);
      setMissions(m);
      setTaskTypes(t);
      setClients(c);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Impossible de charger les missions.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const removeMission = async (mission: Mission) => {
    const count = taskTypes.filter(t => t.serviceId === mission.id).length;
    const warning = count
      ? `Supprimer la mission "${mission.name}" et ses ${count} type(s) de tâche ?`
      : `Supprimer la mission "${mission.name}" ?`;
    if (!confirm(warning)) return;
    const res = await fetch(`/api/services/${mission.id}`, { method: 'DELETE', headers: authHeaders });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Suppression impossible');
      return;
    }
    await load();
  };

  if (!canManage) {
    return (
      <div className="p-8 text-center text-gray-500">
        Vous n'avez pas l'autorisation d'accéder à cette page.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col space-y-4 sm:space-y-6 max-w-[900px] w-full mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-bold text-gray-800 tracking-tight flex items-center gap-2">
            <Layers className="w-5 h-5" />
            Missions &amp; types de tâches
          </h1>
          <p className="text-[12px] text-gray-500 mt-1">
            Ces missions et leurs types de tâches alimentent le formulaire de pointage.
          </p>
        </div>
        <button
          onClick={() => setEditor({ mission: null })}
          className="bg-navy hover:bg-navy-hover text-white px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          Nouvelle mission
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : missions.length === 0 && !error ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
          <Layers className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-[13px] text-gray-500">Aucune mission pour le moment.</p>
          <button
            onClick={() => setEditor({ mission: null })}
            className="mt-3 text-[13px] font-medium text-blue-600 hover:text-blue-800"
          >
            Créer la première mission
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {missions.map(mission => {
            const types = taskTypes.filter(t => t.serviceId === mission.id);
            const client = clients.find(c => String(c.id) === String(mission.clientId));
            return (
              <div key={mission.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-100">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 text-[14px] truncate">{mission.name}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {types.length} type(s) de tâche · {client ? client.name : 'tous les clients'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setEditor({ mission })}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
                      title="Modifier la mission et ses types de tâches"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Modifier
                    </button>
                    <button
                      onClick={() => removeMission(mission)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      title="Supprimer la mission"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="px-4 py-3 bg-gray-50/40">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                    <ListChecks className="w-3.5 h-3.5" />
                    Types de tâches
                  </div>
                  {types.length === 0 ? (
                    <p className="text-[12px] text-gray-400 italic">
                      Aucun type — la mission reste sélectionnable sans type de tâche.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {types.map(t => (
                        <span key={t.id} className="bg-white border border-gray-200 text-gray-700 text-[11.5px] px-2.5 py-1 rounded-md">
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editor && (
        <MissionEditorModal
          mission={editor.mission}
          taskTypes={taskTypes}
          onClose={() => setEditor(false)}
          onSaved={async () => { setEditor(false); await load(); }}
          onDeleted={async () => { setEditor(false); await load(); }}
        />
      )}
    </div>
  );
};
