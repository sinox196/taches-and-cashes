import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, Loader2, Plus, FileCheck2, ListChecks, History, Briefcase } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AssignResourceModal } from './AssignResourceModal';
import { ResourceInstanceModal } from './ResourceInstanceModal';
import { usePeriodPage, PeriodFilter, PaginationBar } from '../PeriodPager';
import { ExportButton } from '../ExportButton';
import { friendlyError } from '../../utils/errors';

interface HistoryItem {
  id: string;
  label: string;
  sortOrder: number;
  done: boolean;
  completedAt: string | null;
}

interface HistoryRow {
  id: string;
  clientId: number;
  clientName: string;
  name: string;
  type: 'document_checklist' | 'procedure';
  status: string;
  isSequential: boolean;
  total: number;
  resolved: number;
  /** Le détail des documents — cliquer la ligne ouvre le même suivi que « Mon travail ». */
  items: HistoryItem[];
  createdAt: string;
  userId: number | null;
  userName: string;
}

/** Repliage des accents pour la recherche, comme le reste de l'app. */
const foldAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const HISTORY_PAGE_SIZE = 15;

/**
 * The simple, non-admin flow: choisir un client, choisir un modèle, cocher
 * les documents — nothing else on screen. Replaces the earlier "Suivi &
 * Ressources" section that lived inside the Clients page's detail panel:
 * one place to work a client's checklists instead of two.
 *
 * A côté, un second sous-onglet **Historique** : toutes les instances en
 * cours, tous clients confondus, avec filtres et pagination — ce que « Mon
 * travail » ne peut pas montrer puisqu'il ne charge qu'un client à la fois.
 */
export const MyResourcesWork: React.FC = () => {
  const { token } = useAuth();
  const authHeaders = { Authorization: `Bearer ${token}` };

  const [subView, setSubView] = useState<'work' | 'history'>('work');

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

  // --- Historique : toutes les instances, tous clients, filtrable et paginé ---
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [clientFilter, setClientFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [procedureFilter, setProcedureFilter] = useState('');
  const [historySearch, setHistorySearch] = useState('');

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    setHistoryError('');
    try {
      const res = await fetch('/api/client-resources/history', { headers: authHeaders });
      if (!res.ok) throw new Error();
      const body = await res.json();
      if (Array.isArray(body)) setHistoryRows(body);
    } catch (e) {
      setHistoryError(friendlyError(e, "Impossible de charger l'historique."));
    } finally {
      setIsLoadingHistory(false);
      setHistoryLoaded(true);
    }
  };

  // Chargé une seule fois, à la première visite de l'onglet — pas à chaque
  // bascule entre « Mon travail » et « Historique ».
  useEffect(() => { if (subView === 'history' && !historyLoaded) loadHistory(); }, [subView, historyLoaded]);

  // Options des trois filtres dérivées des lignes reçues — jamais un second
  // appel au fichier clients complet, qui à l'échelle du cabinet ne se
  // charge jamais en entier : ces listes ne portent que ce qui a
  // effectivement une instance en cours.
  const uniqueSorted = (values: string[]): string[] => Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  const clientOptions = useMemo(() => uniqueSorted(historyRows.map(r => r.clientName)), [historyRows]);
  const userOptions = useMemo(() => uniqueSorted(historyRows.map(r => r.userName)), [historyRows]);
  const procedureOptions = useMemo(() => uniqueSorted(historyRows.map(r => r.name)), [historyRows]);

  const historyTerm = foldAccents(historySearch.trim());
  const historyFilteredBase = useMemo(
    () => historyRows.filter(r =>
      (!clientFilter || r.clientName === clientFilter)
      && (!userFilter || r.userName === userFilter)
      && (!procedureFilter || r.name === procedureFilter)
      && (!historyTerm
        || foldAccents(r.clientName).includes(historyTerm)
        || foldAccents(r.name).includes(historyTerm)
        || foldAccents(r.userName).includes(historyTerm))),
    [historyRows, clientFilter, userFilter, procedureFilter, historyTerm],
  );

  const historyPage = usePeriodPage<HistoryRow>(historyFilteredBase, r => r.createdAt, HISTORY_PAGE_SIZE);

  return (
    <div className="space-y-5">
      <div className="flex rounded-lg border border-gray-200 overflow-hidden w-fit">
        <button
          onClick={() => setSubView('work')}
          className={`px-3 py-2 text-[12.5px] font-medium flex items-center gap-1.5 ${subView === 'work' ? 'bg-navy text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
        >
          <Briefcase className="w-3.5 h-3.5" /> Mon travail
        </button>
        <button
          onClick={() => setSubView('history')}
          className={`px-3 py-2 text-[12.5px] font-medium flex items-center gap-1.5 border-l border-gray-200 ${subView === 'history' ? 'bg-navy text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
        >
          <History className="w-3.5 h-3.5" /> Historique
        </button>
      </div>

      {subView === 'history' ? (
        <div className="space-y-3">
          {historyError && (
            <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">{historyError}</div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* La recherche est un filtre de plus, pas un bandeau à part : sur
                un écran étroit, un `flex-wrap` ordinaire renvoyait le champ de
                recherche (large, `w-64`) seul sur sa propre ligne au-dessus
                des `<select>`, qui eux se réarrangeaient en dessous — ça se
                lisait comme deux barres distinctes. `flex-nowrap
                overflow-x-auto` en fait une seule rangée qui défile
                latéralement, comme la barre d'onglets RH juste au-dessus. */}
            <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
              <div className="flex items-center border border-gray-300 rounded-lg bg-white focus-within:border-gray-400 shrink-0">
                <Search className="w-3.5 h-3.5 text-gray-400 ml-2.5 shrink-0" />
                <input
                  value={historySearch}
                  onChange={e => { setHistorySearch(e.target.value); historyPage.setPage(1); }}
                  placeholder="Rechercher client, procédure, collaborateur…"
                  className="px-2 py-2 text-[12.5px] text-gray-800 focus:outline-none bg-transparent w-64"
                />
              </div>
              <PeriodFilter page={historyPage} />
              <select
                value={clientFilter}
                onChange={e => { setClientFilter(e.target.value); historyPage.setPage(1); }}
                className="shrink-0 bg-white border border-gray-300 rounded-lg px-2.5 py-2 text-[12.5px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-navy/20 cursor-pointer"
              >
                <option value="">Tous les clients</option>
                {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                value={userFilter}
                onChange={e => { setUserFilter(e.target.value); historyPage.setPage(1); }}
                className="shrink-0 bg-white border border-gray-300 rounded-lg px-2.5 py-2 text-[12.5px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-navy/20 cursor-pointer"
              >
                <option value="">Tous les collaborateurs</option>
                {userOptions.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <select
                value={procedureFilter}
                onChange={e => { setProcedureFilter(e.target.value); historyPage.setPage(1); }}
                className="shrink-0 bg-white border border-gray-300 rounded-lg px-2.5 py-2 text-[12.5px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-navy/20 cursor-pointer"
              >
                <option value="">Toutes les procédures</option>
                {procedureOptions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <ExportButton
              fileName="historique-procedures"
              rows={historyPage.filtered}
              columns={[
                { header: 'Date', value: (r: HistoryRow) => r.createdAt.slice(0, 10).split('-').reverse().join('/') },
                { header: 'Client', value: (r: HistoryRow) => r.clientName },
                { header: 'Procédure', value: (r: HistoryRow) => r.name },
                { header: 'Utilisateur', value: (r: HistoryRow) => r.userName },
                { header: 'Progression', value: (r: HistoryRow) => `${r.resolved}/${r.total}` },
              ]}
            />
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col">
            {isLoadingHistory ? (
              <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : historyPage.filtered.length === 0 ? (
              <div className="p-10 text-center">
                <History className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                <p className="text-[13px] text-gray-500">Aucune procédure ne correspond à ces filtres.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-[13px]">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Client</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Procédure</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Utilisateur</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Progression</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {historyPage.pageRows.map(r => {
                      const pct = r.total ? Math.round((r.resolved / r.total) * 100) : 0;
                      return (
                        <tr
                          key={r.id}
                          onClick={() => setOpenInstance(r)}
                          title="Voir le détail des documents"
                          className="hover:bg-gray-50 cursor-pointer"
                        >
                          <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">{r.createdAt.slice(0, 10).split('-').reverse().join('/')}</td>
                          <td className="px-4 py-2.5 text-gray-900 font-medium">{r.clientName}</td>
                          <td className="px-4 py-2.5 text-gray-700 flex items-center gap-1.5">
                            {r.type === 'procedure' ? <ListChecks className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <FileCheck2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                            <span className="truncate">{r.name}</span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">{r.userName}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-gray-500 text-[12px] shrink-0">{r.resolved}/{r.total}</span>
                              <div className="w-20 h-1.5 rounded-full bg-gray-100 overflow-hidden shrink-0">
                                <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-turquoise'}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {/* Toujours visible, même sur une seule page — même règle que le
                Brouillard de caisse et les onglets RH. */}
            <PaginationBar page={historyPage} unit="procédures" />
          </div>
        </div>
      ) : (
      <>
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
          onClose={() => setAssigning(false)}
          onAssigned={() => { setAssigning(false); load(client.id); }}
        />
      )}
      </>
      )}

      {/* Partagé par les deux sous-vues : une ligne de l'historique ouvre le
          même suivi document-par-document qu'une carte de « Mon travail ». */}
      {openInstance && (
        <ResourceInstanceModal
          instance={openInstance}
          onClose={() => setOpenInstance(null)}
          onChanged={() => { if (subView === 'history') loadHistory(); else if (client) load(client.id); }}
        />
      )}
    </div>
  );
};
