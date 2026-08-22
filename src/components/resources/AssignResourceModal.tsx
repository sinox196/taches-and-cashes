import React, { useEffect, useRef, useState } from 'react';
import { X, Loader, Send, FileCheck2, ListChecks, CalendarClock, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { friendlyError } from '../../utils/errors';

/**
 * §4.1 of the cahier des charges — "Affecter une ressource à un client",
 * extended with a third choice for échéances: the source document only lists
 * Document/Procédure in that screen's own table, but its §2.4 flow describes
 * activating a deadline model per client, which needs the same client-picker
 * entry point. Reusing one modal for all three keeps that consistent rather
 * than growing a second, near-identical dialog.
 */

type Kind = 'document_checklist' | 'procedure' | 'deadline';

const KIND_META: Record<Kind, { label: string; icon: any }> = {
  document_checklist: { label: 'Document', icon: FileCheck2 },
  procedure: { label: 'Procédure', icon: ListChecks },
  deadline: { label: 'Échéance', icon: CalendarClock },
};

interface AssignResourceModalProps {
  /** Preselected and locked when the caller already has a client in context
   *  (the simple "Mon travail" flow). Omit to let the user search for one
   *  here instead (the admin's échéance-activation entry point, which has
   *  no client context of its own). */
  client?: { id: number; name: string };
  /** Restricts which kind of resource can be affected. Defaults to all three;
   *  a single-kind list skips the type selector entirely. */
  allowedKinds?: Kind[];
  onClose: () => void;
  onAssigned: () => void;
}

export const AssignResourceModal: React.FC<AssignResourceModalProps> = ({
  client, allowedKinds = ['document_checklist', 'procedure', 'deadline'], onClose, onAssigned,
}) => {
  const { token } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [selectedClient, setSelectedClient] = useState(client ?? null);
  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState<any[]>([]);
  const [isSearchingClients, setIsSearchingClients] = useState(false);

  const [kind, setKind] = useState<Kind>(allowedKinds[0]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [deadlineTemplates, setDeadlineTemplates] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [templateId, setTemplateId] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [isTemplateDropdownOpen, setIsTemplateDropdownOpen] = useState(false);
  const templateDropdownRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) setIsTemplateDropdownOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/resource-templates', { headers: authHeaders }).then(r => r.json()),
      fetch('/api/deadline-templates', { headers: authHeaders }).then(r => r.json()),
    ])
      .then(([t, d]) => { setTemplates(Array.isArray(t) ? t : []); setDeadlineTemplates(Array.isArray(d) ? d : []); })
      .catch(() => { setTemplates([]); setDeadlineTemplates([]); })
      .finally(() => setIsLoading(false));
  }, [token]);

  useEffect(() => {
    if (client) return; // locked — no search needed
    const term = clientSearch.trim();
    if (term.length < 1 || selectedClient) { setClientResults([]); return; }
    let cancelled = false;
    setIsSearchingClients(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(term)}&page=1&limit=8`, { headers: authHeaders });
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
  }, [clientSearch, selectedClient, token, client]);

  const allOptions = kind === 'deadline'
    ? deadlineTemplates.filter(t => t.isActive)
    : templates.filter(t => t.type === kind && t.isActive);

  const normalize = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const searchTerm = normalize(templateSearch.trim());
  const options = searchTerm ? allOptions.filter(t => normalize(t.name).includes(searchTerm)) : allOptions;
  const selectedTemplate = allOptions.find(t => t.id === templateId) ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId || !selectedClient) return;
    setError('');
    setSaving(true);
    try {
      const url = kind === 'deadline' ? '/api/client-deadlines/activate' : '/api/client-resources';
      const res = await fetch(url, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ clientId: selectedClient.id, templateId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Affectation impossible.');
      setDone(true);
      onAssigned();
    } catch (e: any) {
      setError(friendlyError(e, 'Affectation impossible.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-4">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-[14px] font-bold text-gray-900">Affecter une ressource</h2>
            {client && <p className="text-[11.5px] text-gray-500 mt-0.5">Pour {client.name}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {done ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
              <Send className="w-5 h-5" />
            </div>
            <p className="text-[13px] font-semibold text-gray-900">Ressource affectée.</p>
            <p className="text-[12px] text-gray-500 mt-1">Elle apparaît maintenant dans le suivi de ce client.</p>
            <button onClick={onClose} className="mt-4 px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover">
              Fermer
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-3.5">
            {!client && (
              <div className="relative">
                <label className="text-[11px] font-semibold text-gray-400 block mb-1">Client</label>
                {selectedClient ? (
                  <div className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-md bg-gray-50">
                    <span className="text-[13px] font-medium text-gray-800">{selectedClient.name}</span>
                    <button type="button" onClick={() => setSelectedClient(null)} className="text-gray-400 hover:text-red-500">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center border border-gray-200 rounded-md bg-white focus-within:border-gray-400">
                      <Search className="w-3.5 h-3.5 text-gray-400 ml-2" />
                      <input
                        value={clientSearch}
                        onChange={e => setClientSearch(e.target.value)}
                        placeholder="Rechercher un client…"
                        className="w-full px-2 py-2 text-[13px] font-medium text-gray-800 focus:outline-none bg-transparent"
                      />
                      {isSearchingClients && <Loader className="w-3.5 h-3.5 text-gray-400 animate-spin mr-2" />}
                    </div>
                    {clientSearch.length >= 1 && clientResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-100 rounded-md shadow-lg max-h-40 overflow-y-auto">
                        {clientResults.map(c => (
                          <div
                            key={c.id}
                            onClick={() => { setSelectedClient({ id: c.id, name: c.name }); setClientSearch(''); setClientResults([]); }}
                            className="px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50 cursor-pointer"
                          >
                            {c.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {allowedKinds.length > 1 && (
              <div>
                <label className="text-[11px] font-semibold text-gray-400 block mb-1.5">Type de ressource</label>
                <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${allowedKinds.length}, minmax(0,1fr))` }}>
                  {allowedKinds.map(k => {
                    const { label, icon: Icon } = KIND_META[k];
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => { setKind(k); setTemplateId(''); setTemplateSearch(''); }}
                        className={`px-2 py-2 rounded-lg text-[12px] font-medium border flex flex-col items-center gap-1 ${
                          kind === k ? 'bg-navy text-white border-navy' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="relative" ref={templateDropdownRef}>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">Modèle</label>
              {isLoading ? (
                <div className="flex items-center gap-2 text-[12px] text-gray-400 py-2">
                  <Loader className="w-3.5 h-3.5 animate-spin" /> Chargement…
                </div>
              ) : allOptions.length === 0 ? (
                <div className="w-full border border-dashed border-gray-200 rounded-md px-3 py-2 text-[11px] text-gray-400 italic">
                  Aucun modèle disponible pour ce type — créez-en un dans Ressources métier.
                </div>
              ) : (
                <>
                  <div className="flex items-center border border-gray-200 rounded-md bg-white focus-within:border-gray-400">
                    <Search className="w-3.5 h-3.5 text-gray-400 ml-2 shrink-0" />
                    <input
                      value={selectedTemplate ? selectedTemplate.name : templateSearch}
                      onChange={e => {
                        setTemplateSearch(e.target.value);
                        setIsTemplateDropdownOpen(true);
                        if (selectedTemplate) setTemplateId('');
                      }}
                      onFocus={() => setIsTemplateDropdownOpen(true)}
                      placeholder="Taper pour rechercher un modèle…"
                      className="w-full px-2 py-2 text-[13px] font-medium text-gray-800 focus:outline-none bg-transparent"
                    />
                  </div>
                  {isTemplateDropdownOpen && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-100 rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {options.length > 0 ? (
                        options.map(t => (
                          <div
                            key={t.id}
                            onClick={() => { setTemplateId(t.id); setTemplateSearch(''); setIsTemplateDropdownOpen(false); }}
                            className="px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50 cursor-pointer"
                          >
                            {t.name}{t.isSystem ? ' (système)' : ''}
                          </div>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-[12px] text-gray-500 italic">Aucun modèle trouvé.</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {error && (
              <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">{error}</div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-100 bg-white">
                Annuler
              </button>
              <button
                type="submit"
                disabled={!templateId || !selectedClient || saving}
                className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving && <Loader className="w-4 h-4 animate-spin" />}
                Affecter
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
