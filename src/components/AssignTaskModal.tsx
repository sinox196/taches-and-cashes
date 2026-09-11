import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { X, Search, Loader, Send, Check } from 'lucide-react';
import { SearchableSelect } from './SearchableSelect';
import { useAuth } from '../context/AuthContext';
import { friendlyError } from '../utils/errors';

/** Repliage des accents, comme le sélecteur de participants de GroupModal. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * An admin hands a mission + type de tâche to a staff member. It shows up
 * pending under Tâches → « Tâches déléguées » until they start it,
 * at which point it becomes an ordinary running time entry — same client
 * picker and mission/type cascade as "Démarrer nouvelle tâche" (NewTaskCard),
 * with a collaborator field added.
 */

interface AssignTaskModalProps {
  services: any[];
  taskTypes: any[];
  onClose: () => void;
  onAssigned: () => void;
}

export const AssignTaskModal: React.FC<AssignTaskModalProps> = ({ services, taskTypes, onClose, onAssigned }) => {
  useEscapeToClose(onClose);
  const { token } = useAuth();

  const [staff, setStaff] = useState<any[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [staffSearch, setStaffSearch] = useState('');
  // Plusieurs collaborateurs à la fois : chacun reçoit sa propre assignation,
  // une par personne, exactement comme si on avait rempli le formulaire N
  // fois — le suivi (démarrer, statut, progression) reste par assignataire.
  const [assignedToUserIds, setAssignedToUserIds] = useState<number[]>([]);

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

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch('/api/users/assignable', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : []))
      .then(setStaff)
      .catch(() => setStaff([]))
      .finally(() => setLoadingStaff(false));
  }, [token]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsClientDropdownOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Same debounced server-side lookup NewTaskCard uses — the client list is
  // never loaded in full.
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

  const matchingStaff = useMemo(() => {
    const q = fold(staffSearch.trim());
    return q ? staff.filter((s) => fold(s.name).includes(q)) : staff;
  }, [staff, staffSearch]);

  const toggleStaff = (id: number) =>
    setAssignedToUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const canSubmit = assignedToUserIds.length > 0 && !!selectedServiceId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setSaving(true);
    try {
      const service = services.find((s) => String(s.id) === selectedServiceId);
      const taskType = taskTypes.find((t) => String(t.id) === selectedTaskTypeId);
      const body = {
        client: selectedClient ? selectedClient.name : clientSearch.trim(),
        clientId: selectedClient ? Number(selectedClient.id) : undefined,
        pole: service?.name,
        serviceId: service ? Number(service.id) : undefined,
        taskType: taskType?.name,
        taskTypeId: taskType ? Number(taskType.id) : undefined,
        description: description.trim(),
      };
      // Une requête par collaborateur sélectionné — même geste que le
      // formulaire rempli plusieurs fois, en parallèle plutôt qu'un par un,
      // pour qu'une seule assignation refusée n'empêche pas les autres.
      const results = await Promise.allSettled(
        assignedToUserIds.map(async (id) => {
          const res = await fetch('/api/task-assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ...body, assignedToUserId: id }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Assignation impossible.');
          return data;
        }),
      );
      const failed = results
        .map((r, i) => (r.status === 'rejected' ? { id: assignedToUserIds[i], reason: r.reason } : null))
        .filter((x): x is { id: number; reason: any } => x !== null);
      const succeeded = results.length - failed.length;
      if (succeeded > 0) onAssigned();
      if (failed.length === 0) {
        setDone(true);
      } else if (succeeded > 0) {
        const names = failed.map((f) => staff.find((s) => s.id === f.id)?.name || f.id).join(', ');
        setError(`Assignée à ${succeeded} collaborateur${succeeded > 1 ? 's' : ''}, échec pour ${names}.`);
      } else {
        throw failed[0].reason;
      }
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
          <h2 className="text-[14px] font-bold text-gray-900">Déléguer une tâche</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {done ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
              <Send className="w-5 h-5" />
            </div>
            <p className="text-[13px] font-semibold text-gray-900">
              Tâche déléguée{assignedToUserIds.length > 1 ? ` à ${assignedToUserIds.length} collaborateurs` : ''}.
            </p>
            <p className="text-[12px] text-gray-500 mt-1">
              Elle apparaît maintenant dans Gestion des tâches → « Tâches déléguées »
              {assignedToUserIds.length > 1 ? ' de chacun' : ' du collaborateur'}.
            </p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover"
            >
              Fermer
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-3.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-gray-400">Collaborateur(s)</label>
                {assignedToUserIds.length > 0 && (
                  <span className="text-[11px] text-gray-400">{assignedToUserIds.length} sélectionné(s)</span>
                )}
              </div>
              {loadingStaff ? (
                <div className="flex items-center gap-2 text-[12px] text-gray-400 py-2">
                  <Loader className="w-3.5 h-3.5 animate-spin" /> Chargement…
                </div>
              ) : (
                <>
                  {staff.length > 6 && (
                    <div className="relative mb-1.5">
                      <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        value={staffSearch}
                        onChange={(e) => setStaffSearch(e.target.value)}
                        placeholder="Rechercher un collaborateur…"
                        className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-md text-[12.5px] focus:outline-none focus:border-gray-400"
                      />
                    </div>
                  )}
                  <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-44 overflow-y-auto">
                    {matchingStaff.length === 0 ? (
                      <p className="px-3 py-2.5 text-[12px] text-gray-400 italic">Aucun collaborateur ne correspond.</p>
                    ) : (
                      matchingStaff.map((s) => {
                        const on = assignedToUserIds.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleStaff(s.id)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50"
                          >
                            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              on ? 'bg-navy border-navy text-white' : 'border-gray-300'
                            }`}>
                              {on && <Check className="w-3 h-3" />}
                            </span>
                            <span className="text-[13px] text-gray-800 truncate flex-1">{s.name}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>

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

            <div>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">
                Instructions <span className="font-normal text-gray-300">(facultatif)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Précisions pour le collaborateur…"
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
                Déléguer
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
