import React, { useEffect, useState } from 'react';
import { FileCheck2, ListChecks, Loader2, ChevronRight, Check } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface ResourcesProgressCardProps {
  /** The dashboard's own client filter — narrows this card to the same clients when set. */
  selectedClients?: { id: number; name: string }[];
}

/**
 * Admin-dashboard summary of documents/procédures affectés, grouped by
 * client — independent of Pointage: no date range, just "where do things
 * stand right now" (a checklist has no date to filter by). Clicking a client
 * row drills into its modèles and, inside each, the per-document detail —
 * the same summary/drill-down split the KPI dashboard already uses for
 * per-client tasks, so a client with many affected modèles doesn't ship its
 * whole item list to everyone up front.
 */
export const ResourcesProgressCard: React.FC<ResourcesProgressCardProps> = ({ selectedClients = [] }) => {
  const { token, hasPermission } = useAuth();
  const authHeaders = { Authorization: `Bearer ${token}` };
  const [rows, setRows] = useState<any[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [expandedClientId, setExpandedClientId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!hasPermission('VIEW_RESOURCES')) { setIsLoading(false); return; }
    fetch('/api/resources/portfolio', { headers: authHeaders })
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (Array.isArray(data)) setRows(data); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [token]);

  const toggleClient = async (clientId: number) => {
    if (expandedClientId === clientId) { setExpandedClientId(null); return; }
    setExpandedClientId(clientId);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/client-resources?clientId=${clientId}`, { headers: authHeaders });
      const body = await res.json();
      setDetail(Array.isArray(body) ? body : []);
    } catch {
      setDetail([]);
    } finally {
      setDetailLoading(false);
    }
  };

  if (!hasPermission('VIEW_RESOURCES')) return null;
  if (!isLoading && (!rows || rows.length === 0)) return null;

  const selectedIds = new Set(selectedClients.map(c => c.id));
  const visibleRows = selectedIds.size > 0 ? (rows ?? []).filter(r => selectedIds.has(r.clientId)) : (rows ?? []);

  const byClient = new Map<number, { clientId: number; clientName: string; modeles: number; resolved: number; total: number }>();
  for (const r of visibleRows) {
    const entry = byClient.get(r.clientId) ?? { clientId: r.clientId, clientName: r.clientName, modeles: 0, resolved: 0, total: 0 };
    entry.modeles += 1;
    entry.resolved += r.resolved;
    entry.total += r.total;
    byClient.set(r.clientId, entry);
  }
  const clientRows = [...byClient.values()].sort((a, b) => a.clientName.localeCompare(b.clientName));

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100">
        <h2 className="text-[14px] font-bold text-gray-900">Ressources métier — avancement par client</h2>
        <p className="text-[11.5px] text-gray-500 mt-0.5">
          Documents et procédures affectés{selectedIds.size > 0 ? ', clients filtrés' : ', tous clients confondus'}.
        </p>
      </div>
      {isLoading ? (
        <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : clientRows.length === 0 ? (
        <p className="text-[12px] text-gray-400 italic px-5 py-6">Aucun client concerné par ce filtre.</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {clientRows.map(c => {
            const progress = c.total ? Math.round((c.resolved / c.total) * 100) : 0;
            const expanded = expandedClientId === c.clientId;
            return (
              <div key={c.clientId}>
                <button
                  onClick={() => toggleClient(c.clientId)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <ChevronRight className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                  <span className="text-[13px] font-medium text-gray-800 min-w-[160px]">{c.clientName}</span>
                  <span className="text-[11px] text-gray-400 shrink-0">{c.modeles} modèle(s)</span>
                  <div className="flex items-center gap-2 flex-1 min-w-[140px] max-w-xs">
                    <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-done-fg rounded-full" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="text-[11px] text-gray-500 shrink-0">{c.resolved}/{c.total}</span>
                  </div>
                </button>

                {expanded && (
                  <div className="px-5 pb-4 pl-11 space-y-3 bg-gray-50/40">
                    {detailLoading ? (
                      <div className="py-3 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>
                    ) : (
                      (detail ?? []).map((inst: any) => {
                        const t = inst.items.length;
                        const r = inst.items.filter((i: any) => i.done).length;
                        const p = t ? Math.round((r / t) * 100) : 0;
                        return (
                          <div key={inst.id} className="bg-white border border-gray-200 rounded-lg p-3">
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className="text-[12.5px] font-semibold text-gray-800 flex items-center gap-1.5">
                                {inst.type === 'procedure' ? <ListChecks className="w-3.5 h-3.5 text-gray-400" /> : <FileCheck2 className="w-3.5 h-3.5 text-gray-400" />}
                                {inst.name}
                              </span>
                              <span className="text-[11px] text-gray-500">{r}/{t} · {p}%</span>
                            </div>
                            <div className="space-y-1">
                              {[...inst.items].sort((a: any, b: any) => a.sortOrder - b.sortOrder).map((item: any) => (
                                <div key={item.id} className="flex items-center gap-2 text-[12px]">
                                  <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                                    item.done ? 'bg-done-bg text-done-fg' : 'bg-gray-100 text-gray-300'
                                  }`}>
                                    {item.done && <Check className="w-3 h-3" />}
                                  </span>
                                  <span className={item.done ? 'text-gray-400 line-through' : 'text-gray-700'}>{item.label}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
