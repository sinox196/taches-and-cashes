import React, { useEffect, useRef, useState } from 'react';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { X, ChevronDown, Search, Loader, CalendarClock } from 'lucide-react';
import { SearchableSelect } from './SearchableSelect';
import { useAuth } from '../context/AuthContext';
import { friendlyError } from '../utils/errors';

/**
 * Any user plans a task for themselves — a calendar date, a priority and an
 * optional reminder, on top of the same client/mission/type-de-tâche cascade
 * "Démarrer nouvelle tâche" and "Assigner une tâche" already use. It lands as
 * a PENDING task_assignments row targeting yourself, so it shows up on your
 * own dashboard (AssignedTasksCard) exactly like an admin's assignment does —
 * no separate storage or display path needed. Unlike AssignTaskModal, this is
 * never gated on ASSIGN_TASKS: planning your own work is not "assigning".
 */

const PRIORITIES = [
  { value: 'BASSE', label: 'Basse' },
  { value: 'NORMALE', label: 'Normale' },
  { value: 'HAUTE', label: 'Haute' },
  { value: 'URGENTE', label: 'Urgente' },
];

interface PlanTaskModalProps {
  services: any[];
  taskTypes: any[];
  onClose: () => void;
  onPlanned: () => void;
}

export const PlanTaskModal: React.FC<PlanTaskModalProps> = ({ services, taskTypes, onClose, onPlanned }) => {
  useEscapeToClose(onClose);
  const { token, user } = useAuth();

  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState<any[]>([]);
  const [selectedClient, setSelectedClient] = useState<any | null>(null);
  const [isSearchingClients, setIsSearchingClients] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedTaskTypeId, setSelectedTaskTypeId] = useState('');
  const [description, setDescription] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [priority, setPriority] = useState('NORMALE');
  const [reminderAt, setReminderAt] = useState('');

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsClientDropdownOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Same debounced server-side lookup NewTaskCard/AssignTaskModal use — the
  // client list is never loaded in full.
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

  const handleClientSelect = (client: any) => {
    setSelectedClientId(String(client.id));
    setSelectedClient(client);
    setClientSearch(client.name);
    setIsClientDropdownOpen(false);
  };

  const availableServices = selectedClientId
    ? services.filter((s) => String(s.clientId) === String(selectedClientId) || s.clientId === null)
    : services;
  const availableTaskTypes = selectedServiceId
    ? taskTypes.filter((t) => String(t.serviceId) === String(selectedServiceId))
    : [];

  const canSubmit = !!selectedServiceId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !user) return;
    setError('');
    setSaving(true);
    try {
      const service = services.find((s) => String(s.id) === selectedServiceId);
      const taskType = taskTypes.find((t) => String(t.id) === selectedTaskTypeId);
      const res = await fetch('/api/task-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          assignedToUserId: user.id,
          client: selectedClient ? selectedClient.name : clientSearch.trim(),
          clientId: selectedClient ? Number(selectedClient.id) : undefined,
          pole: service?.name,
          serviceId: service ? Number(service.id) : undefined,
          taskType: taskType?.name,
          taskTypeId: taskType ? Number(taskType.id) : undefined,
          description: description.trim(),
          scheduledDate: scheduledDate || undefined,
          priority,
          reminderAt: reminderAt ? new Date(reminderAt).toISOString() : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Planification impossible.');
      setDone(true);
      onPlanned();
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-4">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-[14px] font-bold text-gray-900">Planifier une tâche</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {done ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
              <CalendarClock className="w-5 h-5" />
            </div>
            <p className="text-[13px] font-semibold text-gray-900">Tâche planifiée.</p>
            <p className="text-[12px] text-gray-500 mt-1">Elle apparaît maintenant sur votre tableau de bord.</p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover"
            >
              Fermer
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-3.5">
            <div ref={dropdownRef}>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">
                Client <span className="font-normal text-gray-300">(facultatif)</span>
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
                      clientResults.map((c) => (
                        <div
                          key={c.id}
                          onClick={() => handleClientSelect(c)}
                          className="px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50 cursor-pointer"
                        >
                          {c.name}
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-[12px] text-gray-500 italic">Aucun client trouvé.</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">Mission</label>
              <SearchableSelect
                value={selectedServiceId}
                onChange={(id) => { setSelectedServiceId(id); setSelectedTaskTypeId(''); }}
                options={availableServices.map((s) => ({ id: s.id, label: s.name }))}
                placeholder="Sélectionner une mission"
                searchPlaceholder="Rechercher une mission…"
                emptyLabel="Aucune mission ne correspond."
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">
                Type de tâche <span className="font-normal text-gray-300">(facultatif)</span>
              </label>
              {!selectedServiceId ? (
                <div className="w-full border border-dashed border-gray-200 rounded-md px-3 py-2 text-[11px] text-gray-400 italic">
                  Sélectionnez d'abord une mission
                </div>
              ) : availableTaskTypes.length === 0 ? (
                <div className="w-full border border-dashed border-gray-200 rounded-md px-3 py-2 text-[11px] text-gray-400 italic">
                  Aucun type défini pour cette mission
                </div>
              ) : (
                <SearchableSelect
                  value={selectedTaskTypeId}
                  onChange={setSelectedTaskTypeId}
                  options={availableTaskTypes.map((t) => ({ id: t.id, label: t.name }))}
                  placeholder="Aucun"
                  searchPlaceholder="Rechercher un type…"
                  emptyLabel="Aucun type ne correspond."
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-gray-400 block mb-1">
                  Date prévue <span className="font-normal text-gray-300">(facultatif)</span>
                </label>
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-md px-3 py-2 text-[13px] font-medium text-gray-800 focus:outline-none focus:border-gray-400"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-400 block mb-1">Priorité</label>
                <div className="relative">
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full appearance-none bg-white border border-gray-200 rounded-md px-3 py-2 pr-8 text-[13px] font-medium text-gray-800 focus:outline-none focus:border-gray-400"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">
                Rappel <span className="font-normal text-gray-300">(facultatif — une notification vous sera envoyée)</span>
              </label>
              <input
                type="datetime-local"
                value={reminderAt}
                onChange={(e) => setReminderAt(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-md px-3 py-2 text-[13px] font-medium text-gray-800 focus:outline-none focus:border-gray-400"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">
                Instructions <span className="font-normal text-gray-300">(facultatif)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Précisions sur la tâche…"
                rows={2}
                className="w-full border border-gray-200 rounded-md px-3 py-2 text-[13px] text-gray-800 focus:outline-none focus:border-gray-400 placeholder-gray-300 resize-none"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-100 bg-white"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={!canSubmit || saving}
                className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving && <Loader className="w-4 h-4 animate-spin" />}
                Planifier
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
