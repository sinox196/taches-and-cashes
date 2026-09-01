import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Plus, X, Search, Loader2, Trash2, Pencil, Check, Table2, CalendarDays } from 'lucide-react';
import { friendlyError } from '../../utils/errors';
import { ExportButton } from '../ExportButton';

const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/**
 * A fixed set of color keys into the app's own reserved status-pill tokens
 * (never a raw hex — the whole point of those tokens is that no screen
 * invents its own color) that the admin picks per échéance status value.
 */
const COLOR_TOKENS: Record<string, { bg: string; fg: string; dot: string; label: string }> = {
  done: { bg: 'bg-done-bg', fg: 'text-done-fg', dot: 'bg-done-fg', label: 'Vert' },
  late: { bg: 'bg-late-bg', fg: 'text-late-fg', dot: 'bg-late-fg', label: 'Rouge' },
  run: { bg: 'bg-run-bg', fg: 'text-run-fg', dot: 'bg-run-fg', label: 'Ambre' },
  pause: { bg: 'bg-pause-bg', fg: 'text-pause-fg', dot: 'bg-pause-fg', label: 'Gris-bleu' },
  admin: { bg: 'bg-admin-bg', fg: 'text-admin-fg', dot: 'bg-admin-fg', label: 'Violet' },
  collab: { bg: 'bg-collab-bg', fg: 'text-collab-fg', dot: 'bg-collab-fg', label: 'Bleu' },
  gray: { bg: 'bg-gray-50', fg: 'text-gray-400', dot: 'bg-gray-400', label: 'Neutre' },
};
const COLOR_ORDER = ['done', 'late', 'run', 'pause', 'admin', 'collab', 'gray'];
const DEFAULT_COLOR = 'gray';
const EMPTY_STYLE = { bg: 'bg-white', fg: 'text-gray-300' };

interface Column {
  id: string;
  year: number;
  month: number;
  label: string;
  sortOrder: number;
}

interface StatusOption {
  id: string;
  label: string;
  sortOrder: number;
  color?: string;
}

/**
 * Suivi mensuel des échéances fiscales/sociales — a literal grid, not a
 * recurrence engine: one named column per échéance occurrence (month +
 * précis label, e.g. "DM 12/2025", "CNSS TR04"), one client per row, one
 * status cell per (client, column) set directly by the cabinet.
 *
 * Two views share the same data: "Vue tableau" (the wide grid, sticky
 * headers/first-two-columns, cells as buttons rather than native `<select>`s
 * — at cabinet scale that's thousands of cells, and one shared floating menu
 * stays responsive where that many live form controls would not) and "Vue
 * calendrier" (pick one client, see their year laid out as one card per
 * month instead of scrolling a single very wide row).
 */
interface EcheancesGridProps {
  /**
   * Peut modifier la grille. Sans lui, elle se consulte : aucun menu de
   * cellule, aucun éditeur de colonne, aucun bouton d'ajout. Le serveur
   * refuse de toute façon les écritures — ceci évite d'offrir un geste qui
   * finirait en 403.
   */
  canManage: boolean;
}

export const EcheancesGrid: React.FC<EcheancesGridProps> = ({ canManage }) => {
  const { token } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [columns, setColumns] = useState<Column[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'grid' | 'calendar'>('grid');

  const [addingColumn, setAddingColumn] = useState(false);
  const [newMonth, setNewMonth] = useState(1);
  const [newLabel, setNewLabel] = useState('');

  const [menu, setMenu] = useState<{ clientId: number; columnId: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [addingStatus, setAddingStatus] = useState(false);
  const [newStatusLabel, setNewStatusLabel] = useState('');
  const [newStatusColor, setNewStatusColor] = useState(COLOR_ORDER[0]);
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [editingStatusLabel, setEditingStatusLabel] = useState('');
  const [editingStatusColor, setEditingStatusColor] = useState(DEFAULT_COLOR);

  const openMenu = (clientId: number, columnId: string, rect: DOMRect) => {
    if (!canManage) return;
    setMenu({ clientId, columnId, x: rect.left, y: rect.bottom });
    setAddingStatus(false);
    setEditingStatusId(null);
  };

  const [editingColumn, setEditingColumn] = useState<Column | null>(null);
  const [editMonth, setEditMonth] = useState(1);
  const [editLabel, setEditLabel] = useState('');
  const [editPos, setEditPos] = useState<{ x: number; y: number } | null>(null);
  const editRef = useRef<HTMLDivElement>(null);

  const currentYear = new Date().getFullYear();
  const [customYears, setCustomYears] = useState<number[]>([]);
  const years = useMemo(
    () => [...new Set([...columns.map(c => c.year), currentYear, ...customYears])].sort((a: number, b: number) => b - a),
    [columns, currentYear, customYears],
  );
  const [year, setYear] = useState<number>(currentYear);
  const [monthFilter, setMonthFilter] = useState<number | null>(null);

  const [pickingYear, setPickingYear] = useState(false);
  const [yearInput, setYearInput] = useState('');
  const yearInputRef = useRef<HTMLInputElement>(null);

  const commitCustomYear = () => {
    const y = Number(yearInput);
    if (Number.isFinite(y) && y >= 1900 && y <= 3000) {
      setCustomYears(prev => (prev.includes(y) ? prev : [...prev, y]));
      setYear(y);
    }
    setPickingYear(false);
    setYearInput('');
  };

  const [calendarClientSearch, setCalendarClientSearch] = useState('');
  const [calendarClient, setCalendarClient] = useState<{ id: number; name: string } | null>(null);

  const load = async () => {
    try {
      const [c, s, cl, so] = await Promise.all([
        fetch('/api/echeance-columns', { headers: authHeaders }).then(r => r.json()),
        fetch('/api/echeance-statuses', { headers: authHeaders }).then(r => r.json()),
        fetch('/api/clients', { headers: authHeaders }).then(r => r.json()),
        fetch('/api/echeance-status-options', { headers: authHeaders }).then(r => r.json()),
      ]);
      if (Array.isArray(c)) setColumns(c);
      if (Array.isArray(s)) setStatuses(s);
      if (Array.isArray(cl)) setClients(cl);
      else if (cl?.data) setClients(cl.data);
      if (Array.isArray(so)) setStatusOptions(so);
    } catch (e) {
      setError(friendlyError(e, 'Impossible de charger les échéances.'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
        setAddingStatus(false);
        setEditingStatusId(null);
      }
      if (editRef.current && !editRef.current.contains(e.target as Node)) setEditingColumn(null);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const yearColumns = useMemo(
    () => columns.filter(c => c.year === year && (monthFilter == null || c.month === monthFilter)).sort((a, b) => a.sortOrder - b.sortOrder),
    [columns, year, monthFilter],
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

  const calendarTerm = normalize(calendarClientSearch.trim());
  const calendarResults = calendarTerm && !calendarClient
    ? sortedClients.filter(c => normalize(c.name || '').includes(calendarTerm)).slice(0, 8)
    : [];

  const [seedingYear, setSeedingYear] = useState(false);

  /** Pose la grille type de l'exercice affiché. Idempotent côté serveur. */
  const seedYear = async () => {
    if (!year || seedingYear) return;
    setSeedingYear(true);
    try {
      const res = await fetch('/api/echeance-columns/seed-year', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ year }),
      });
      if (res.ok) await load();
    } catch (e) {
      console.error('seed year failed', e);
    } finally {
      setSeedingYear(false);
    }
  };

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

  const openEditColumn = (column: Column, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!canManage) return;
    setEditingColumn(column);
    setEditMonth(column.month);
    setEditLabel(column.label);
    setEditPos({ x: rect.left, y: rect.bottom });
  };

  const saveEditColumn = async () => {
    if (!editingColumn || !editLabel.trim()) return;
    try {
      await fetch(`/api/echeance-columns/${editingColumn.id}`, {
        method: 'PUT', headers: authHeaders,
        body: JSON.stringify({ month: editMonth, label: editLabel.trim() }),
      });
      setEditingColumn(null);
      await load();
    } catch (e) {
      setError(friendlyError(e, 'Modification impossible.'));
    }
  };

  const removeEditColumn = async () => {
    if (!editingColumn) return;
    if (!confirm(`Supprimer la colonne "${editingColumn.label}" et toutes ses valeurs ?`)) return;
    try {
      await fetch(`/api/echeance-columns/${editingColumn.id}`, { method: 'DELETE', headers: authHeaders });
      setEditingColumn(null);
      await load();
    } catch (e) {
      setError(friendlyError(e, 'Suppression impossible.'));
    }
  };

  const sortedStatusOptions = useMemo(
    () => [...statusOptions].sort((a, b) => a.sortOrder - b.sortOrder),
    [statusOptions],
  );

  const styleForStatus = (status: string | null) => {
    if (!status) return EMPTY_STYLE;
    const opt = sortedStatusOptions.find(o => o.label === status);
    if (!opt) return EMPTY_STYLE;
    return COLOR_TOKENS[opt.color || DEFAULT_COLOR] ?? COLOR_TOKENS[DEFAULT_COLOR];
  };

  const openAddStatus = () => {
    setAddingStatus(true);
    setNewStatusColor(COLOR_ORDER[statusOptions.length % COLOR_ORDER.length]);
  };

  const addStatusOption = async () => {
    if (!newStatusLabel.trim()) return;
    try {
      await fetch('/api/echeance-status-options', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ label: newStatusLabel.trim(), color: newStatusColor }),
      });
      setNewStatusLabel('');
      setAddingStatus(false);
      await load();
    } catch (e) {
      setError(friendlyError(e, "Impossible d'ajouter cette valeur."));
    }
  };

  const startEditStatusOption = (opt: StatusOption) => {
    setEditingStatusId(opt.id);
    setEditingStatusLabel(opt.label);
    setEditingStatusColor(opt.color || DEFAULT_COLOR);
  };

  const saveStatusOption = async () => {
    if (!editingStatusId || !editingStatusLabel.trim()) return;
    try {
      await fetch(`/api/echeance-status-options/${editingStatusId}`, {
        method: 'PUT', headers: authHeaders,
        body: JSON.stringify({ label: editingStatusLabel.trim(), color: editingStatusColor }),
      });
      setEditingStatusId(null);
      await load();
    } catch (e) {
      setError(friendlyError(e, 'Modification impossible.'));
    }
  };

  const removeStatusOption = async (opt: StatusOption) => {
    if (!confirm(`Supprimer la valeur "${opt.label}" ? Les cellules déjà réglées sur cette valeur ne seront pas modifiées.`)) return;
    try {
      await fetch(`/api/echeance-status-options/${opt.id}`, { method: 'DELETE', headers: authHeaders });
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

  // Group year columns by month for the two-row header (colSpan per month) and for the calendar cards.
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
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
            <button
              onClick={() => { setView('grid'); setEditingColumn(null); setMenu(null); }}
              className={`px-3 py-2 text-[12.5px] font-medium flex items-center gap-1.5 ${view === 'grid' ? 'bg-navy text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <Table2 className="w-3.5 h-3.5" /> Tableau
            </button>
            <button
              onClick={() => { setView('calendar'); setEditingColumn(null); setMenu(null); }}
              className={`px-3 py-2 text-[12.5px] font-medium flex items-center gap-1.5 border-l border-gray-200 ${view === 'calendar' ? 'bg-navy text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <CalendarDays className="w-3.5 h-3.5" /> Calendrier par client
            </button>
          </div>

          {pickingYear ? (
            <div className="flex items-center gap-1">
              <input
                ref={yearInputRef}
                type="number"
                autoFocus
                value={yearInput}
                onChange={e => setYearInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitCustomYear(); }
                  if (e.key === 'Escape') { setPickingYear(false); setYearInput(''); }
                }}
                placeholder="Année"
                className="w-24 px-2.5 py-2 border border-gray-300 rounded-lg text-[13px] font-medium bg-white focus:outline-none focus:border-gray-400"
              />
              <button onClick={commitCustomYear} className="px-2.5 py-2 bg-navy text-white rounded-lg text-[12.5px] font-medium hover:bg-navy-hover">
                OK
              </button>
              <button onClick={() => { setPickingYear(false); setYearInput(''); }} className="px-2 py-2 border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <select
              value={year}
              onChange={e => {
                if (e.target.value === '__other__') { setPickingYear(true); return; }
                setYear(Number(e.target.value));
              }}
              className="px-2.5 py-2 border border-gray-300 rounded-lg text-[13px] font-medium bg-white focus:outline-none focus:border-gray-400"
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
              <option value="__other__">Autre année…</option>
            </select>
          )}

          <select
            value={monthFilter ?? ''}
            onChange={e => setMonthFilter(e.target.value === '' ? null : Number(e.target.value))}
            className="px-2.5 py-2 border border-gray-300 rounded-lg text-[13px] font-medium bg-white focus:outline-none focus:border-gray-400"
          >
            <option value="">Tous les mois</option>
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>

          {view === 'grid' && (
            <div className="flex items-center border border-gray-200 rounded-lg bg-white focus-within:border-gray-400">
              <Search className="w-3.5 h-3.5 text-gray-400 ml-2.5 shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher un client…"
                className="px-2 py-2 text-[13px] text-gray-800 focus:outline-none bg-transparent w-56"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {canManage ? (
            <button
              onClick={() => setAddingColumn(true)}
              className="bg-navy hover:bg-navy-hover text-white px-4 py-2 rounded-lg text-[13px] font-medium flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Ajouter une échéance
            </button>
          ) : (
            // Dire pourquoi rien ne réagit vaut mieux qu'une grille qui semble
            // cliquable et ne l'est pas.
            <span className="text-[11.5px] text-gray-400">Consultation — la grille se modifie par un administrateur.</span>
          )}
        </div>
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

      {/* Export de la grille telle qu'elle est filtrée : une colonne par
          échéance de l'année (ou du mois) affichée, une ligne par client
          visible. Le CSV reproduit le tableau, pas la base entière. */}
      {yearColumns.length > 0 && view === 'grid' && (
        <div className="flex justify-end">
          <ExportButton
            fileName={`echeances-${year}`}
            rows={visibleClients}
            columns={[
              { header: 'N°', value: (c: any) => c.customFields?.['Numéro'] ?? c.id },
              { header: 'Client', value: (c: any) => c.name || '' },
              ...yearColumns.map(col => ({
                header: `${MONTH_NAMES[Number(col.month) - 1] ?? col.month} — ${col.label}`,
                value: (c: any) => statusByCell.get(`${c.id}:${col.id}`) ?? '',
              })),
            ]}
          />
        </div>
      )}

      {yearColumns.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
          <p className="text-[13px] text-gray-500">Aucune échéance définie{year ? ` pour ${year}` : ''}{monthFilter ? ` en ${MONTH_NAMES[monthFilter - 1]}` : ''}.</p>
          {/* Un exercice vide se répare depuis l'écran plutôt qu'en attendant
              une mise en service : la grille type du cabinet est la même
              chaque année, et la poser est idempotente — les colonnes déjà là
              et les cellules remplies ne bougent pas. */}
          {canManage && year && !monthFilter && (
            <>
              <button
                onClick={seedYear}
                disabled={seedingYear}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover disabled:opacity-50"
              >
                {seedingYear ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Installer la grille type pour {year}
              </button>
              <p className="text-[11.5px] text-gray-400 mt-2">
                Les 28 échéances habituelles du cabinet, avec l'année à jour dans les libellés.
              </p>
            </>
          )}
        </div>
      ) : view === 'grid' ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-auto max-h-[75vh]">
          <table className="border-collapse text-[12px]">
            <thead>
              <tr>
                <th rowSpan={2} className="sticky left-0 top-0 z-30 bg-gray-50 border border-gray-200 px-3 py-2 text-left text-[10.5px] font-bold text-gray-400 uppercase tracking-wider min-w-[70px]">
                  N°
                </th>
                <th rowSpan={2} className="sticky left-[70px] top-0 z-30 bg-gray-50 border border-gray-200 px-3 py-2 text-left text-[10.5px] font-bold text-gray-400 uppercase tracking-wider min-w-[180px]">
                  Nom
                </th>
                {monthGroups.map(g => (
                  <th
                    key={g.month}
                    colSpan={g.cols.length}
                    className="sticky top-0 z-20 bg-gray-100 border border-gray-200 px-2 py-1.5 text-center text-[10.5px] font-bold text-gray-600 uppercase tracking-wider"
                  >
                    {MONTH_NAMES[g.month - 1]}
                  </th>
                ))}
              </tr>
              <tr>
                {yearColumns.map(c => (
                  <th
                    key={c.id}
                    onClick={e => openEditColumn(c, e)}
                    title="Cliquer pour modifier ou supprimer cette échéance"
                    className="sticky top-[33px] z-20 bg-gray-50 border border-gray-200 px-1.5 py-1.5 text-center font-semibold text-gray-600 min-w-[92px] max-w-[92px] cursor-pointer hover:bg-gray-100 transition-colors"
                  >
                    <span className="truncate block" title={c.label}>{c.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleClients.map(client => (
                <tr key={client.id} className="hover:bg-gray-50/60">
                  <td className="sticky left-0 z-10 bg-white border border-gray-200 px-3 py-1.5 text-gray-500 whitespace-nowrap">
                    {client.customFields?.['Numéro'] ?? client.id}
                  </td>
                  <td className="sticky left-[70px] z-10 bg-white border border-gray-200 px-3 py-1.5 font-medium text-gray-800 whitespace-nowrap max-w-[220px] truncate" title={client.name}>
                    {client.name}
                  </td>
                  {yearColumns.map(col => {
                    const status = statusByCell.get(`${client.id}:${col.id}`) ?? null;
                    const style = styleForStatus(status);
                    return (
                      <td key={col.id} className="border border-gray-200 p-0.5">
                        <button
                          onClick={e => openMenu(client.id, col.id, (e.target as HTMLElement).getBoundingClientRect())}
                          title={status || 'Vide'}
                          className={`w-full h-7 rounded text-[10.5px] font-semibold truncate px-1 ${style.bg} ${style.fg} hover:ring-1 hover:ring-gray-300 transition-shadow`}
                        >
                          {status || '—'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            {calendarClient ? (
              <div className="flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-lg bg-white shadow-sm">
                <span className="text-[14px] font-semibold text-gray-900">{calendarClient.name}</span>
                <button onClick={() => setCalendarClient(null)} className="text-gray-400 hover:text-red-500">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center border border-gray-200 rounded-lg bg-white focus-within:border-gray-400 shadow-sm">
                  <Search className="w-4 h-4 text-gray-400 ml-3" />
                  <input
                    value={calendarClientSearch}
                    onChange={e => setCalendarClientSearch(e.target.value)}
                    placeholder="Rechercher un client…"
                    autoFocus
                    className="w-full px-2.5 py-2.5 text-[14px] font-medium text-gray-800 focus:outline-none bg-transparent"
                  />
                </div>
                {calendarResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-100 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {calendarResults.map(c => (
                      <div
                        key={c.id}
                        onClick={() => { setCalendarClient({ id: c.id, name: c.name }); setCalendarClientSearch(''); }}
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

          {!calendarClient ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
              <CalendarDays className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <p className="text-[13px] text-gray-500">Cherchez un client pour voir son calendrier d'échéances {year}.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {monthGroups.map(g => (
                <div key={g.month} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-3.5 py-2 bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                    {MONTH_NAMES[g.month - 1]}
                  </div>
                  <div>
                    {g.cols.map(col => {
                      const status = statusByCell.get(`${calendarClient.id}:${col.id}`) ?? null;
                      const style = styleForStatus(status);
                      return (
                        <button
                          key={col.id}
                          onClick={e => openMenu(calendarClient.id, col.id, (e.target as HTMLElement).getBoundingClientRect())}
                          className="w-full flex items-stretch justify-between gap-0 border-t border-gray-200 hover:bg-gray-50 text-left"
                        >
                          <span className="flex-1 min-w-0 truncate text-[12.5px] text-gray-700 px-3.5 py-2 border-r border-gray-200">{col.label}</span>
                          <span className={`shrink-0 flex items-center px-2.5 text-[10.5px] font-semibold ${style.bg} ${style.fg}`}>
                            {status || 'Vide'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {menu && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 100 }}
          className="bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-[260px]"
        >
          <button
            onClick={() => setCellStatus(menu.clientId, menu.columnId, null)}
            className="w-full text-left px-3 py-1.5 text-[12px] text-gray-400 italic hover:bg-gray-50"
          >
            Vide
          </button>
          {sortedStatusOptions.map(opt => (
            <div key={opt.id} className="group flex items-center hover:bg-gray-50">
              {editingStatusId === opt.id ? (
                <div className="flex-1 px-3 py-1.5 space-y-1.5">
                  <div className="flex items-center gap-1">
                    <input
                      value={editingStatusLabel}
                      onChange={e => setEditingStatusLabel(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); saveStatusOption(); }
                        if (e.key === 'Escape') setEditingStatusId(null);
                      }}
                      autoFocus
                      className="flex-1 min-w-0 px-1.5 py-1 border border-gray-300 rounded text-[12px] focus:outline-none focus:border-gray-400"
                    />
                    <button onClick={saveStatusOption} disabled={!editingStatusLabel.trim()} className="p-1 text-navy hover:bg-navy/10 rounded disabled:opacity-40" title="Enregistrer">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setEditingStatusId(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded" title="Annuler">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {COLOR_ORDER.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setEditingStatusColor(c)}
                        title={COLOR_TOKENS[c].label}
                        className={`w-4 h-4 rounded-full ${COLOR_TOKENS[c].dot} ${editingStatusColor === c ? 'ring-2 ring-offset-1 ring-navy' : 'ring-1 ring-inset ring-black/10'}`}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setCellStatus(menu.clientId, menu.columnId, opt.label)}
                    className="flex-1 min-w-0 text-left px-3 py-1.5 text-[12px] text-gray-700 flex items-center gap-2"
                  >
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${COLOR_TOKENS[opt.color || DEFAULT_COLOR]?.dot ?? COLOR_TOKENS[DEFAULT_COLOR].dot}`} />
                    <span className="truncate">{opt.label}</span>
                  </button>
                  <button
                    onClick={() => startEditStatusOption(opt)}
                    className="p-1 mr-0.5 text-gray-300 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:text-gray-600 rounded shrink-0"
                    title="Modifier cette valeur"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => removeStatusOption(opt)}
                    className="p-1 mr-1.5 text-gray-300 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:text-red-600 rounded shrink-0"
                    title="Supprimer cette valeur"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          ))}
          <div className="border-t border-gray-100 mt-1 pt-1 px-2">
            {addingStatus ? (
              <div className="px-1 py-1 space-y-1.5">
                <div className="flex items-center gap-1">
                  <input
                    value={newStatusLabel}
                    onChange={e => setNewStatusLabel(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); addStatusOption(); }
                      if (e.key === 'Escape') { setAddingStatus(false); setNewStatusLabel(''); }
                    }}
                    placeholder="Nouvelle valeur"
                    autoFocus
                    className="flex-1 min-w-0 px-1.5 py-1 border border-gray-300 rounded text-[12px] focus:outline-none focus:border-gray-400"
                  />
                  <button onClick={addStatusOption} disabled={!newStatusLabel.trim()} className="p-1 text-navy hover:bg-navy/10 rounded disabled:opacity-40" title="Ajouter">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  {COLOR_ORDER.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewStatusColor(c)}
                      title={COLOR_TOKENS[c].label}
                      className={`w-4 h-4 rounded-full ${COLOR_TOKENS[c].dot} ${newStatusColor === c ? 'ring-2 ring-offset-1 ring-navy' : 'ring-1 ring-inset ring-black/10'}`}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <button
                onClick={openAddStatus}
                className="w-full text-left px-1.5 py-1 text-[11.5px] font-medium text-gray-400 hover:text-navy flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Ajouter une valeur
              </button>
            )}
          </div>
        </div>
      )}

      {editingColumn && editPos && (
        <div
          ref={editRef}
          style={{ position: 'fixed', left: editPos.x, top: editPos.y, zIndex: 100 }}
          className="bg-white border border-gray-200 rounded-lg shadow-xl p-3 w-64 space-y-2.5"
        >
          <div>
            <label className="block text-[10.5px] font-semibold text-gray-500 mb-1">Mois</label>
            <select
              value={editMonth}
              onChange={e => setEditMonth(Number(e.target.value))}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-[12.5px] bg-white focus:outline-none focus:border-gray-400"
            >
              {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10.5px] font-semibold text-gray-500 mb-1">Libellé précis</label>
            <input
              value={editLabel}
              onChange={e => setEditLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveEditColumn(); } }}
              autoFocus
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-[12.5px] focus:outline-none focus:border-gray-400"
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <button onClick={removeEditColumn} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Supprimer cette échéance">
              <Trash2 className="w-4 h-4" />
            </button>
            <div className="flex gap-2">
              <button onClick={() => setEditingColumn(null)} className="px-2.5 py-1 border border-gray-300 rounded-md text-[12px] font-medium text-gray-600 hover:bg-gray-50">
                Annuler
              </button>
              <button onClick={saveEditColumn} disabled={!editLabel.trim()} className="px-2.5 py-1 bg-navy text-white rounded-md text-[12px] font-medium disabled:opacity-50">
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
