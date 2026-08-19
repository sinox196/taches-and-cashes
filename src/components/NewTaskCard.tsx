import React, { useState, useEffect, useRef } from 'react';
import { Play, Plus, X, Settings2, ChevronDown, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { MissionEditorModal } from './missions/MissionEditorModal';

interface NewTaskCardProps {
  services: any[];
  taskTypes: any[];
  onStartNewTask: (
    client: string,
    service: string,
    description: string,
    clientId?: number,
    serviceId?: number,
    taskType?: string,
    taskTypeId?: number
  ) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  refreshServices: () => void;
}

export const NewTaskCard: React.FC<NewTaskCardProps> = ({
  services,
  taskTypes,
  onStartNewTask,
  isOpen,
  onToggleOpen,
  refreshServices
}) => {
  const { hasPermission, token } = useAuth();
  
  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState<any[]>([]);
  const [selectedClient, setSelectedClient] = useState<any | null>(null);
  const [isSearchingClients, setIsSearchingClients] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [selectedTaskTypeId, setSelectedTaskTypeId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);

  // Full mission editor (name + client + types de tâches), shared with the
  // Missions admin screen. `false` = closed, null = creating, object = editing.
  const [missionEditor, setMissionEditor] = useState<false | { mission: any | null }>(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsClientDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const availableServices = selectedClientId
    ? services.filter(s => String(s.clientId) === String(selectedClientId) || s.clientId === null)
    : services;

  // Types de tâches belong to the chosen mission — e.g. picking "Comptabilité"
  // offers "Collecte des documents comptables", "Saisie des écritures", …
  const availableTaskTypes = selectedServiceId
    ? taskTypes.filter(t => String(t.serviceId) === String(selectedServiceId))
    : [];
  // Missions configured without any type stay usable; the field is only
  // required once the admin has defined types for that mission.
  const taskTypeRequired = availableTaskTypes.length > 0;

  // Client lookup is server-side and debounced: the full list is never loaded,
  // so this scales to hundreds of clients. Only 8 matches are ever rendered.
  useEffect(() => {
    const term = clientSearch.trim();
    if (term.length < 1 || selectedClientId) { setClientResults([]); return; }
    let cancelled = false;
    setIsSearchingClients(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(term)}&page=1&limit=8`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        const rows = Array.isArray(body) ? body : (body.data ?? []);
        if (!cancelled) setClientResults(rows);
      } catch {
        if (!cancelled) setClientResults([]);
      } finally {
        if (!cancelled) setIsSearchingClients(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [clientSearch, selectedClientId, token]);

  const handleClientSelect = (clientId: string, clientName: string, client?: any) => {
    setSelectedClientId(clientId);
    setSelectedClient(client ?? { id: clientId, name: clientName });
    setClientSearch(clientName);
    setIsClientDropdownOpen(false);
    setSelectedServiceId('');
    setSelectedTaskTypeId('');
  };

  // Changing the mission invalidates any type picked from the previous one.
  const handleServiceSelect = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setSelectedTaskTypeId('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const client = selectedClient;
    const service = services.find(s => String(s.id) === selectedServiceId);
    const taskType = taskTypes.find(t => String(t.id) === selectedTaskTypeId);

    const finalClientName = client ? client.name : clientSearch;
    const finalServiceName = service ? service.name : 'Unknown Service';
    const finalDescription = description.trim();

    onStartNewTask(
      finalClientName,
      finalServiceName,
      finalDescription,
      client ? Number(client.id) : undefined,
      service ? Number(service.id) : undefined,
      taskType ? taskType.name : undefined,
      taskType ? Number(taskType.id) : undefined
    );
  };

  const openMissionEditor = (mission: any | null) => setMissionEditor({ mission });

  const handleMissionSaved = (saved: any) => {
    setMissionEditor(false);
    refreshServices();
    setSelectedServiceId(String(saved.id));
    setSelectedTaskTypeId('');
  };

  const handleMissionDeleted = () => {
    setMissionEditor(false);
    refreshServices();
    // The selected mission is gone — clear it rather than leaving a dead id.
    setSelectedServiceId('');
    setSelectedTaskTypeId('');
  };

  const currentMission = services.find(s => String(s.id) === selectedServiceId) || null;

  return (
    <div className="relative">
      <div className="flex justify-end mb-2">
        <button
          onClick={onToggleOpen}
          className="w-10 h-10 md:w-12 md:h-12 bg-[#101828] text-white rounded-full flex items-center justify-center shadow-lg hover:scale-105 transition-all cursor-pointer"
          title={isOpen ? 'Fermer le panneau' : 'Démarrer nouvelle tâche'}
        >
          {isOpen ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5 stroke-[2.5]" />}
        </button>
      </div>

      {/* The panel is anchored to the right edge of its 320px column and opens
          leftwards: it is wider than the column, so laying it out in flow would
          push it off the right of the viewport. */}
      {isOpen && (
        <div className="absolute right-0 z-20 bg-white rounded-xl border border-gray-100 shadow-xl p-6 w-[min(460px,calc(100vw-2rem))] transition-all animate-fadeIn">
          <h3 className="text-[12px] font-bold text-gray-800 mb-5 tracking-wider uppercase">
            DÉMARRER NOUVELLE TÂCHE
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Field: Client */}
            <div ref={dropdownRef}>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">
                Client
              </label>
              <div className="relative">
                <div className="flex items-center border border-gray-200 rounded-md bg-white focus-within:border-gray-400 transition-colors">
                  <Search className="w-3.5 h-3.5 text-gray-400 ml-2" />
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={(e) => {
                      setClientSearch(e.target.value);
                      setIsClientDropdownOpen(true);
                      if (selectedClient && e.target.value !== selectedClient.name) {
                        setSelectedClientId('');
                        setSelectedClient(null);
                      }
                    }}
                    onFocus={() => setIsClientDropdownOpen(true)}
                    placeholder="Rechercher un client..."
                    className="w-full px-2 py-2 text-[13px] font-medium text-gray-800 focus:outline-none bg-transparent"
                  />
                </div>
                
                {isClientDropdownOpen && clientSearch.length >= 1 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-100 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {isSearchingClients ? (
                      <div className="px-3 py-2 text-[12px] text-gray-400 italic">Recherche…</div>
                    ) : clientResults.length > 0 ? (
                      clientResults.map(c => (
                        <div
                          key={c.id}
                          onClick={() => handleClientSelect(String(c.id), c.name, c)}
                          className="px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50 cursor-pointer"
                        >
                          {c.name}
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-[12px] text-gray-500 italic">
                        Aucun client trouvé.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Field: Mission */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-semibold text-gray-400 block">
                  Mission
                </label>
                {hasPermission('MANAGE_SERVICES') && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openMissionEditor(null)}
                      className="text-[9px] text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                      title="Créer une mission et ses types de tâches"
                    >
                      <Plus className="w-3 h-3" />
                      Ajouter
                    </button>
                    {currentMission && (
                      <button
                        type="button"
                        onClick={() => openMissionEditor(currentMission)}
                        className="text-[9px] text-gray-500 hover:text-gray-700 font-medium flex items-center gap-1"
                        title="Modifier cette mission et ses types de tâches"
                      >
                        <Settings2 className="w-3 h-3" />
                        Modifier
                      </button>
                    )}
                  </div>
                )}
              </div>
              
              <div className="relative">
                <select
                  value={selectedServiceId}
                  onChange={(e) => handleServiceSelect(e.target.value)}
                  className="w-full appearance-none bg-white border border-gray-200 rounded-md px-3 py-1.5 pr-8 text-[12px] font-medium text-gray-800 focus:outline-none focus:border-gray-400 transition-colors"
                >
                  <option value="" disabled hidden>Sélectionner une mission</option>
                  {availableServices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Field: Type de tâche — options come from the selected mission */}
            <div>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">
                Type de tâche {taskTypeRequired && <span className="text-red-500">*</span>}
              </label>
              {!selectedServiceId ? (
                <div className="w-full border border-dashed border-gray-200 rounded-md px-3 py-1.5 text-[11px] text-gray-400 italic">
                  Sélectionnez d'abord une mission
                </div>
              ) : availableTaskTypes.length === 0 ? (
                <div className="w-full border border-dashed border-gray-200 rounded-md px-3 py-1.5 text-[11px] text-gray-400 italic">
                  Aucun type défini pour cette mission
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={selectedTaskTypeId}
                    onChange={(e) => setSelectedTaskTypeId(e.target.value)}
                    className="w-full appearance-none bg-white border border-gray-200 rounded-md px-3 py-1.5 pr-8 text-[12px] font-medium text-gray-800 focus:outline-none focus:border-gray-400 transition-colors"
                  >
                    <option value="" disabled hidden>Sélectionner un type de tâche</option>
                    {availableTaskTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              )}
            </div>

            {/* Field: Description de l'activité */}
            <div>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">
                Description de l'activité <span className="font-normal text-gray-300">(facultatif)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Préparation Bilan"
                className="w-full border border-gray-200 rounded-md px-3 py-2 text-[13px] text-gray-800 focus:outline-none focus:border-gray-400 placeholder-gray-300 transition-colors"
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={
                !selectedClientId ||
                !selectedServiceId ||
                (taskTypeRequired && !selectedTaskTypeId)
              }
              className="w-full mt-3 bg-[#101828] hover:bg-[#1d2939] disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold text-[13px] py-2.5 px-3 rounded-md transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
              title={(!selectedClientId || !selectedServiceId || (taskTypeRequired && !selectedTaskTypeId)) ? "Sélectionnez au moins un client et une mission" : ""}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>DÉMARRER</span>
            </button>
          </form>
        </div>
      )}

      {missionEditor && (
        <MissionEditorModal
          mission={missionEditor.mission}
          taskTypes={taskTypes}
          onClose={() => setMissionEditor(false)}
          onSaved={handleMissionSaved}
          onDeleted={handleMissionDeleted}
        />
      )}
    </div>
  );
};
