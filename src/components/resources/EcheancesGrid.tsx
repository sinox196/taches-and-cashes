import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Plus, X, Search, Loader2, Trash2 } from 'lucide-react';
import { friendlyError } from '../../utils/errors';

const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/** The fixed set of cell values — matches the cabinet's own paper sheet exactly. */
const STATUS_OPTIONS = [
  'Oui',
  "Client non concerné par l'échéance",
  'DEFAUT',
  'Préparée (en attente de confirmation client)',
  'CHEZ BC',
];

/** Reuses the app's existing status-pill tokens — never a new color for a new state. */
const STATUS_STYLE: Record<string, { bg: string; fg: string; short: string }> = {
  'Oui': { bg: 'bg-done-bg', fg: 'text-done-fg', short: 'Oui' },
  "Client non concerné par l'échéance": { bg: 'bg-gray-50', fg: 'text-gray-400', short: 'N/C' },
  'DEFAUT': { bg: 'bg-late-bg', fg: 'text-late-fg', short: 'DEFAUT' },
  'Préparée (en attente de confirmation client)': { bg: 'bg-run-bg', fg: 'text-run-fg', short: 'Préparée' },
  'CHEZ BC': { bg: 'bg-pause-bg', fg: 'text-pause-fg', short: 'CHEZ BC' },
};
const EMPTY_STYLE = { bg: 'bg-white', fg: 'text-gray-300', short: '—' };

interface Column {
  id: string;
  year: number;
  month: number;
  label: string;
  sortOrder: number;
}

/**
 * Suivi mensuel des échéances fiscales/sociales — a literal grid, not a
 * recurrence engine: one named column per échéance occurrence (month +
 * précis label, e.g. "DM 12/2025", "CNSS TR04"), one client per row, one
 * status cell per (client, column) set directly by the cabinet. Replaces the
 * earlier recurring-template/auto-generated-instance design entirely — this
 * is what the cabinet's own paper sheet already looks like.
 *
 * Cells are buttons, not native `<select>`s — at cabinet scale (hundreds of
 * clients × ~30 colonnes) that is thousands of cells, and a lightweight
 * clickable badge with one shared floating menu stays responsive where that
 * many live form controls would not. First two columns and both header rows
 * stay sticky so a wide, tall grid can be scrolled in both directions
 * without losing track of which client or which échéance a cell belongs to.
 */
export const EcheancesGrid: React.FC = () => {
  const { token } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [columns, setColumns] = useState<Column[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [addingColumn, setAddingColumn] = useState(false);
  const [newMonth, setNewMonth] = useState(1);
  const [newLabel, setNewLabel] = useState('');

  const [menu, setMenu] = useState<{ clientId: number; columnId: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const years = useMemo(() => [...new Set(columns.map(c => c.year))].sort((a: number, b: number) => b - a), [columns]);
  const [year, setYear] = useState<number | null>(null);

  const load = async () => {
    try {
      const [c, s, cl] = await Promise.all([
        fetch('/api/echeance-columns', { headers: authHeaders }).then(r => r.json()),
        fetch('/api/echeance-statuses', { headers: authHeaders }).then(r => r.json()),
        fetch('/api/clients', { headers: authHeaders }).then(r => r.json()),
      ]);
      if (Array.isArray(c)) {
        setColumns(c);
        setYear(prev => prev ?? (c.length ? Math.max(...c.map((x: any) => x.year)) : new Date().getFullYear()));
      }
      if (Array.isArray(s)) setStatuses(s);
      if (Array.isArray(cl)) setClients(cl);
      else if (cl?.data) setClients(cl.data);
    } catch (e) {
      setError(friendlyError(e, 'Impossible de charger les échéances.'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const yearColumns = useMemo(
    () => columns.filter(c => c.year === year).sort((a, b) => a.sortOrder - b.sortOrder),
    [columns, year],
  );

  const statusByCell = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const s of statuses) m.set(`${s.clientId}:${s.columnId}`, s.status);
    return m;
  }, [statuses]);

  const normalize = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const term = normalize(search.trim());
  const sortedClients = useMemo(() => [...clients].sort((a, b) => {
    const na = Number(a.customFields?.['Numéro']), nb = Number(b.customFields?.['Numéro']);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return (a.name || '').localeCompare(b.name || '');
  }), [clients]);
  const visibleClients = term
    ? sortedClients.filter(c => normalize(c.name || '').includes(term))
    : sortedClients;

  const addColumn = async () => {
    if (!newLabel.trim() || !year) return;
    try {
      await fetch('/api/echeance-columns', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ year, month: newMonth, label: newLabel.trim() }),
      });
      setNewLabel('');
      setAddingColumn(false);
      await load();
    } catch (e) {
      setError(friendlyError(e, "Impossible d'ajouter la colonne."));
    }
  };

  const removeColumn = async (column: Column) => {
    if (!confirm(`Supprimer la colonne "${column.label}" et toutes ses valeurs ?`)) return;
    try {
      await fetch(`/api/echeance-columns/${column.id}`, { method: 'DELETE', headers: authHeaders });
      await load();
    } catch (e) {
      setError(friendlyError(e, 'Suppression impossible.'));
    }
  };

  const setCellStatus = async (clientId: number, columnId: string, status: string | null) => {
    const key = `${clientId}:${columnId}`;
    setStatuses(prev => {
      const exists = prev.some(s => s.clientId === clientId && s.columnId === columnId);
      if (exists) return prev.map(s => (s.clientId === clientId && s.columnId === columnId ? { ...s, status } : s));
      return [...prev, { id: key, clientId, columnId, status }];
    });
    setMenu(null);
    try {
      await fetch('/api/echeance-statuses', {
        method: 'PUT', headers: authHeaders,
        body: JSON.stringify({ clientId, columnId, status }),
      });
    } catch (e) {
      setError(friendlyError(e, 'Mise à jour impossible.'));
      await load();
    }
  };

  // Group year columns by month for the two-row header (colSpan per month).
  const monthGroups: { month: number; cols: Column[] }[] = [];
  for (const c of yearColumns) {
    const g = monthGroups.find(g => g.month === c.month);
    if (g) g.cols.push(c); else monthGroups.push({ month: c.month, cols: [c] });
  }

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">{error}</div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {years.length > 1 && (
            <select
              value={year ?? ''}
              onChange={e => setYear(Number(e.target.value))}
              className="px-2.5 py-2 border border-gray-300 rounded-lg text-[13px] font-medium bg-white focus:outline-none focus:border-gray-400"
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          <div className="flex items-center border border-gray-200 rounded-lg bg-white focus-within:border-gray-400">
            <Search className="w-3.5 h-3.5 text-gray-400 ml-2.5 shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher un client…"
              className="px-2 py-2 text-[13px] text-gray-800 focus:outline-none bg-transparent w-56"
            />
          </div>
        </div>

        <button
          onClick={() => setAddingColumn(true)}
          className="bg-navy hover:bg-navy-hover text-white px-4 py-2 rounded-lg text-[13px] font-medium flex items-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Ajouter une échéance
        </button>
      </div>

      {addingColumn && (
        <div className="flex flex-wrap items-end gap-2 p-3 bg-white border border-gray-200 rounded-xl shadow-sm">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Mois</label>
            <select
              value={newMonth}
              onChange={e => setNewMonth(Number(e.target.value))}
              className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-[12.5px] bg-white focus:outline-none focus:border-gray-400"
            >
              {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Libellé précis</label>
            <input
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addColumn(); } }}
              placeholder="Ex: CNSS TR04"
              autoFocus
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-[12.5px] focus:outline-none focus:border-gray-400"
            />
          </div>
          <button onClick={addColumn} disabled={!newLabel.trim()} className="px-3 py-1.5 bg-navy text-white rounded-lg text-[12px] font-medium disabled:opacity-50">
            Ajouter
          </button>
          <button onClick={() => { setAddingColumn(false); setNewLabel(''); }} className="px-3 py-1.5 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600 hover:bg-gray-50">
            Annuler
          </button>
        </div>
      )}

      {yearColumns.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
          <p className="text-[13px] text-gray-500">Aucune échéance définie{year ? ` pour ${year}` : ''}.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-auto max-h-[75vh]">
          <table className="border-collapse text-[12px]">
            <thead>
              <tr>
                <th rowSpan={2} className="sticky left-0 top-0 z-30 bg-gray-50 border-b border-r border-gray-200 px-3 py-2 text-left text-[10.5px] font-bold text-gray-400 uppercase tracking-wider min-w-[70px]">
                  N°
                </th>
                <th rowSpan={2} className="sticky left-[70px] top-0 z-30 bg-gray-50 border-b border-r border-gray-200 px-3 py-2 text-left text-[10.5px] font-bold text-gray-400 uppercase tracking-wider min-w-[180px]">
                  Nom
                </th>
                {monthGroups.map(g => (
                  <th
                    key={g.month}
                    colSpan={g.cols.length}
                    className="sticky top-0 z-20 bg-gray-100 border-b border-r border-gray-200 px-2 py-1.5 text-center text-[10.5px] font-bold text-gray-600 uppercase tracking-wider"
                  >
                    {MONTH_NAMES[g.month - 1]}
                  </th>
                ))}
              </tr>
              <tr>
                {yearColumns.map(c => (
                  <th
                    key={c.id}
                    className="group sticky top-[33px] z-20 bg-gray-50 border-b border-r border-gray-200 px-1.5 py-1.5 text-center font-semibold text-gray-600 min-w-[92px] max-w-[92px]"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span className="truncate" title={c.label}>{c.label}</span>
                      <button
                        onClick={() => removeColumn(c)}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 shrink-0"
                        title="Supprimer cette colonne"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleClients.map(client => (
                <tr key={client.id} className="hover:bg-gray-50/60">
                  <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-100 px-3 py-1.5 text-gray-500 whitespace-nowrap">
                    {client.customFields?.['Numéro'] ?? client.id}
                  </td>
                  <td className="sticky left-[70px] z-10 bg-white border-b border-r border-gray-100 px-3 py-1.5 font-medium text-gray-800 whitespace-nowrap max-w-[220px] truncate" title={client.name}>
                    {client.name}
                  </td>
                  {yearColumns.map(col => {
                    const status = statusByCell.get(`${client.id}:${col.id}`) ?? null;
                    const style = status ? (STATUS_STYLE[status] ?? EMPTY_STYLE) : EMPTY_STYLE;
                    return (
                      <td key={col.id} className="border-b border-r border-gray-100 p-0.5">
                        <button
                          onClick={e => {
                            const rect = (e.target as HTMLElement).getBoundingClientRect();
                            setMenu({ clientId: client.id, columnId: col.id, x: rect.left, y: rect.bottom });
                          }}
                          title={status || 'Vide'}
                          className={`w-full h-7 rounded text-[10.5px] font-semibold truncate px-1 ${style.bg} ${style.fg} hover:ring-1 hover:ring-gray-300 transition-shadow`}
                        >
                          {style.short}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {menu && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 100 }}
          className="bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-[220px]"
        >
          <button
            onClick={() => setCellStatus(menu.clientId, menu.columnId, null)}
            className="w-full text-left px-3 py-1.5 text-[12px] text-gray-400 italic hover:bg-gray-50"
          >
            Vide
          </button>
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt}
              onClick={() => setCellStatus(menu.clientId, menu.columnId, opt)}
              className="w-full text-left px-3 py-1.5 text-[12px] text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_STYLE[opt].bg}`} />
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
