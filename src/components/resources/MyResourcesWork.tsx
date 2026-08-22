import React, { useEffect, useState } from 'react';
import { Search, X, Loader2, Plus, FileCheck2, ListChecks } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AssignResourceModal } from './AssignResourceModal';
import { ResourceInstanceModal } from './ResourceInstanceModal';

/**
 * The simple, non-admin flow: choisir un client, choisir un modèle, cocher
 * les documents — nothing else on screen. Replaces the earlier "Suivi &
 * Ressources" section that lived inside the Clients page's detail panel:
 * one place to work a client's checklists instead of two.
 */
export const MyResourcesWork: React.FC = () => {
  const { token } = useAuth();
  const authHeaders = { Authorization: `Bearer ${token}` };

  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState<any[]>([]);
  const [isSearchingClients, setIsSearchingClients] = useState(false);
  const [client, setClient] = useState<{ id: number; name: string } | null>(null);

  const [instances, setInstances] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [openInstance, setOpenInstance] = useState<any | null>(null);

  useEffect(() => {
    const term = clientSearch.trim();
    if (term.length < 1 || client) { setClientResults([]); return; }
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
  }, [clientSearch, client, token]);

  const load = async (clientId: number) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/client-resources?clientId=${clientId}`, { headers: authHeaders });
      const body = await res.json();
      if (Array.isArray(body)) setInstances(body);
    } catch {
      setInstances([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { if (client) load(client.id); }, [client]);

  return (
    <div className="space-y-5">
      <div className="relative max-w-sm">
        <label className="text-[11px] font-semibold text-gray-400 block mb-1.5">Client</label>
        {client ? (
          <div className="flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-lg bg-white shadow-sm">
            <span className="text-[14px] font-semibold text-gray-900">{client.name}</span>
            <button onClick={() => { setClient(null); setInstances([]); }} className="text-gray-400 hover:text-red-500">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center border border-gray-200 rounded-lg bg-white focus-within:border-gray-400 shadow-sm">
              <Search className="w-4 h-4 text-gray-400 ml-3" />
              <input
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                placeholder="Rechercher un client…"
                autoFocus
                className="w-full px-2.5 py-2.5 text-[14px] font-medium text-gray-800 focus:outline-none bg-transparent"
              />
              {isSearchingClients && <Loader2 className="w-4 h-4 text-gray-400 animate-spin mr-3" />}
            </div>
            {clientSearch.length >= 1 && clientResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-100 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {clientResults.map(c => (
                  <div
                    key={c.id}
                    onClick={() => { setClient({ id: c.id, name: c.name }); setClientSearch(''); }}
                    className="px-3.5 py-2.5 text-[13.5px] text-gray-700 hover:bg-gray-50 cursor-pointer"
                  >
                    {c.name}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {!client ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
          <Search className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-[13px] text-gray-500">Cherchez un client pour voir ou cocher ses documents.</p>
        </div>
      ) : isLoading ? (
        <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="space-y-3 max-w-lg">
          <button
            onClick={() => setAssigning(true)}
            className="bg-navy hover:bg-navy-hover text-white px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Affecter un modèle à {client.name}
          </button>

          {instances.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
              <FileCheck2 className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <p className="text-[13px] text-gray-500">Aucun modèle affecté à ce client pour l'instant.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {instances.map(inst => {
                const total = inst.items.length;
                const resolved = inst.items.filter((i: any) => i.done).length;
                const progress = total ? Math.round((resolved / total) * 100) : 0;
                return (
                  <button
                    key={inst.id}
                    onClick={() => setOpenInstance(inst)}
                    className="w-full text-left p-4 bg-white rounded-xl border border-gray-200 shadow-sm hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {inst.type === 'procedure' ? <ListChecks className="w-4 h-4 text-gray-400 shrink-0" /> : <FileCheck2 className="w-4 h-4 text-gray-400 shrink-0" />}
                        <span className="text-[13.5px] font-semibold text-gray-800 truncate">{inst.name}</span>
                      </div>
                      <span className="text-[12px] text-gray-500 shrink-0">{resolved}/{total}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mt-2.5">
                      <div className="h-full bg-done-fg rounded-full" style={{ width: `${progress}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {assigning && client && (
        <AssignResourceModal
          client={client}
          allowedKinds={['document_checklist']}
          onClose={() => setAssigning(false)}
          onAssigned={() => { setAssigning(false); load(client.id); }}
        />
      )}

      {openInstance && (
        <ResourceInstanceModal
          instance={openInstance}
          onClose={() => setOpenInstance(null)}
          onChanged={() => client && load(client.id)}
        />
      )}
    </div>
  );
};
