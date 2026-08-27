import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Trash2, Pencil, Check, X, BookOpen, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { friendlyError } from '../../utils/errors';
import { ClientSearchInput } from './ClientSearchInput';
import { CategoryPicker, CashCategory } from './CategoryPicker';
import { isCashMode } from '../../constants/paymentModes';

const money = (v: number) =>
  (v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const frDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
};

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const PAGE_SIZE = 20;

const monthOf = (iso: string) => Number(String(iso || '').slice(5, 7)) || 0;
const yearOf = (iso: string) => Number(String(iso || '').slice(0, 4)) || 0;

export interface JournalRow {
  id: string;
  date: string;
  /** Stored as `label`; shown as the Description column. */
  label: string;
  clientId: number | null;
  clientName: string;
  category: string;
  entree: number;
  sortie: number;
  /** Mode de règlement, set from the Règlements clients tab. Empty on the
   *  daybook's own movements, which reads as cash. */
  paymentMethod?: string;
}

const emptyDraft = (): Omit<JournalRow, 'id'> => ({
  date: new Date().toISOString().slice(0, 10),
  label: '',
  clientId: null,
  clientName: '',
  category: '',
  entree: 0,
  sortie: 0,
});

/**
 * The editable cells of one journal row.
 *
 * Declared at module scope, NOT inside CashJournal: a component defined
 * inside another is a brand-new component *type* on every render, so React
 * unmounts and remounts these inputs after each keystroke. That reads as a
 * field that closes the instant it is opened — a date picker or the client
 * dropdown snapping shut, and focus lost on every character typed.
 */
const Fields: React.FC<{
  value: Omit<JournalRow, 'id'>;
  onChange: (patch: Partial<Omit<JournalRow, 'id'>>) => void;
  categories: CashCategory[];
  onCreateCategory: (label: string) => Promise<CashCategory | null>;
  onDeleteCategory: (c: CashCategory) => void;
  canManage: boolean;
}> = ({ value, onChange, categories, onCreateCategory, onDeleteCategory, canManage }) => (
  <>
    <td className="px-2 py-1.5">
      <input type="date" value={value.date} onChange={e => onChange({ date: e.target.value })}
        className="w-full px-2 py-1 border border-gray-300 rounded text-[12px]" />
    </td>
    <td className="px-2 py-1.5">
      <CategoryPicker
        value={value.category}
        onChange={label => onChange({ category: label })}
        categories={categories}
        onCreate={onCreateCategory}
        onDelete={onDeleteCategory}
        canManage={canManage}
      />
    </td>
    <td className="px-2 py-1.5">
      <input value={value.label} onChange={e => onChange({ label: e.target.value })} placeholder="Description"
        className="w-full px-2 py-1 border border-gray-300 rounded text-[12px] min-w-[180px]" />
    </td>
    <td className="px-2 py-1.5 min-w-[180px]">
      <ClientSearchInput
        value={value.clientName}
        onChange={(name, id) => onChange({ clientName: name, clientId: id ?? null })}
      />
    </td>
    {/* w-full, not a fixed width: the column itself is stretched wide by
        the "MONTANT ENCAISSÉ"/"MONTANT DÉCAISSÉ" headers, and a narrower
        fixed-width input left-anchors inside that wider cell — visibly
        offset from the header above it and the right-aligned amounts every
        other row shows in the same column. Filling the cell and staying
        text-right keeps the input under the number it's meant to be under. */}
    <td className="px-2 py-1.5">
      <input type="number" step="0.001" min="0" value={value.entree || ''} placeholder="0,000"
        onChange={e => onChange({ entree: Number(e.target.value) || 0, sortie: 0 })}
        className="w-full px-2 py-1 border border-gray-300 rounded text-[12px] text-right font-mono" />
    </td>
    <td className="px-2 py-1.5">
      <input type="number" step="0.001" min="0" value={value.sortie || ''} placeholder="0,000"
        onChange={e => onChange({ sortie: Number(e.target.value) || 0, entree: 0 })}
        className="w-full px-2 py-1 border border-gray-300 rounded text-[12px] text-right font-mono" />
    </td>
  </>
);

/**
 * Brouillard de caisse — the cabinet's cash daybook, one row per movement.
 *
 * The column that matters beyond this screen is **Entrée**: a row with an
 * entrée tied to a client *is* that client's encaissement on the Clients
 * page. It is never copied there — the server merges the two on read — so
 * the movement is recorded once and editing it here updates the client.
 *
 * The running "Solde" is computed rather than stored, and deliberately over
 * the whole filtered set *before* paging: a balance that restarted at zero on
 * page 2 would be worse than no balance at all.
 */
export const CashJournal: React.FC = () => {
  const { token, hasPermission } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const canManage = hasPermission('MANAGE_CASH');

  const [rows, setRows] = useState<JournalRow[]>([]);
  const [categories, setCategories] = useState<CashCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState(0);
  const [year, setYear] = useState(0);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [draft, setDraft] = useState<Omit<JournalRow, 'id'> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Omit<JournalRow, 'id'> | null>(null);

  const load = async () => {
    try {
      const [jRes, cRes] = await Promise.all([
        fetch('/api/cash-journal', { headers: authHeaders }),
        fetch('/api/cash-categories', { headers: authHeaders }),
      ]);
      const data = await jRes.json();
      if (!jRes.ok) throw new Error(data.error || 'Chargement impossible.');
      setRows(Array.isArray(data) ? data : []);
      const cats = await cRes.json();
      if (cRes.ok && Array.isArray(cats)) setCategories(cats);
    } catch (e) {
      setError(friendlyError(e, 'Impossible de charger le brouillard de caisse.'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  // Any narrowing can leave the current page past the end of the results.
  useEffect(() => { setPage(1); }, [search, month, year]);

  const createCategory = async (label: string): Promise<CashCategory | null> => {
    try {
      const res = await fetch('/api/cash-categories', {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ label }),
      });
      const made = await res.json();
      if (!res.ok) throw new Error(made.error || "Ajout impossible.");
      setCategories(prev =>
        prev.some(c => c.id === made.id)
          ? prev
          : [...prev, made].sort((a, b) => a.label.localeCompare(b.label, 'fr')));
      return made;
    } catch (e) {
      setError(friendlyError(e, "Impossible d'ajouter cet objet."));
      return null;
    }
  };

  const deleteCategory = async (c: CashCategory) => {
    if (!confirm(`Retirer « ${c.label} » de la liste des objets ?\n\nLes lignes déjà enregistrées le conservent.`)) return;
    try {
      const res = await fetch(`/api/cash-categories/${c.id}`, { method: 'DELETE', headers: authHeaders });
      if (!res.ok) throw new Error('Suppression impossible.');
      setCategories(prev => prev.filter(x => x.id !== c.id));
    } catch (e) {
      setError(friendlyError(e, 'Suppression impossible.'));
    }
  };

  /** Years present in the journal, plus the current one so a new year is pickable. */
  const years = useMemo(() => {
    const set = new Set<number>(rows.map(r => yearOf(r.date)).filter(Boolean));
    set.add(new Date().getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      // The daybook is a *cash* book. A règlement client settled by virement,
      // chèque or lettre de change is recorded in Cash and counts towards the
      // client's encaissements, but it never passes through the till, so it
      // has no place here — and leaving it in would put money in the running
      // solde that the caisse never held. Rows with no mode at all (loyer,
      // STEG, alimentation de caisse, and everything entered before the field
      // existed) read as cash; see isCashMode().
      if (!isCashMode(r.paymentMethod)) return false;
      if (year && yearOf(r.date) !== year) return false;
      if (month && monthOf(r.date) !== month) return false;
      if (!q) return true;
      return [r.label, r.clientName, r.category]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, search, month, year]);

  // Balance over the whole filtered set, then paged — so page 2 continues
  // from page 1 instead of restarting.
  const withSolde = useMemo(() => {
    let solde = 0;
    return filtered.map(r => {
      solde = solde + (Number(r.entree) || 0) - (Number(r.sortie) || 0);
      return { row: r, solde };
    });
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(withSolde.length / PAGE_SIZE));
  const pageRows = withSolde.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totals = useMemo(() => ({
    entree: filtered.reduce((s, r) => s + (Number(r.entree) || 0), 0),
    sortie: filtered.reduce((s, r) => s + (Number(r.sortie) || 0), 0),
  }), [filtered]);

  const save = async (body: Omit<JournalRow, 'id'>, id?: string) => {
    setError('');
    setBusyId(id || 'new');
    try {
      const res = await fetch(id ? `/api/cash-journal/${id}` : '/api/cash-journal', {
        method: id ? 'PUT' : 'POST', headers: authHeaders, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible.');
      await load();
      return true;
    } catch (e) {
      setError(friendlyError(e, 'Enregistrement impossible.'));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (row: JournalRow) => {
    if (!confirm(`Supprimer la ligne du ${frDate(row.date)} ${row.label ? `« ${row.label} »` : ''} ?`)) return;
    setBusyId(row.id);
    setError('');
    try {
      const res = await fetch(`/api/cash-journal/${row.id}`, { method: 'DELETE', headers: authHeaders });
      if (!res.ok) throw new Error('Suppression impossible.');
      setRows(prev => prev.filter(r => r.id !== row.id));
    } catch (e) {
      setError(friendlyError(e, 'Suppression impossible.'));
    } finally {
      setBusyId(null);
    }
  };

  const fieldProps = {
    categories,
    onCreateCategory: createCategory,
    onDeleteCategory: deleteCategory,
    canManage,
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[11.5px] text-gray-500">
          Chaque <span className="font-semibold text-gray-700">entrée</span> rattachée à un client apparaît
          automatiquement dans ses encaissements sur la page Clients. Les règlements clients en{' '}
          <span className="font-semibold text-gray-700">espèce</span> y figurent d'office ; les autres modes
          restent hors caisse.
        </p>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="px-2.5 py-2 text-[12px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-gray-400">
            <option value={0}>Toutes les années</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="px-2.5 py-2 text-[12px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-gray-400">
            <option value={0}>Tous les mois</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Description, client, objet…"
              className="pl-8 pr-3 py-2 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 w-56" />
          </div>
          {canManage && !draft && (
            <button onClick={() => { setDraft(emptyDraft()); setPage(1); }}
              className="bg-navy hover:bg-navy-hover text-white px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2">
              <Plus className="w-4 h-4" /> Nouvelle ligne
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">{error}</div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex-1 flex flex-col min-h-0">
        {isLoading ? (
          <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-left whitespace-nowrap border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {['Date', 'Objet', 'Description', 'Client'].map(h => (
                      <th key={h} className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">{h}</th>
                    ))}
                    <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider text-right">Montant encaissé</th>
                    <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider text-right">Montant décaissé</th>
                    <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider text-right sticky right-0 bg-gray-50 border-l border-gray-200">Solde</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                  <tr className="bg-white border-b-2 border-gray-200 font-bold text-[12px]">
                    <td className="px-3 py-2 text-gray-700" colSpan={4}>Total général</td>
                    <td className="px-3 py-2 text-right font-mono text-done-fg">{money(totals.entree)}</td>
                    <td className="px-3 py-2 text-right font-mono text-late-fg">{money(totals.sortie)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-900 sticky right-0 bg-white border-l border-gray-200">{money(totals.entree - totals.sortie)}</td>
                    <td />
                  </tr>
                </thead>
                <tbody className="text-[12.5px]">
                  {canManage && draft && (
                    <tr className="bg-blue-50/40 border-b border-gray-100">
                      <Fields value={draft} onChange={patch => setDraft(d => ({ ...(d as any), ...patch }))} {...fieldProps} />
                      <td />
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button title="Enregistrer" disabled={busyId === 'new'}
                            onClick={async () => { if (await save(draft)) setDraft(null); }}
                            className="p-1.5 rounded-lg text-white bg-navy hover:bg-navy-hover disabled:opacity-50">
                            {busyId === 'new' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button title="Annuler" onClick={() => setDraft(null)}
                            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {pageRows.length === 0 && !draft ? (
                    <tr><td colSpan={8} className="p-10 text-center">
                      <BookOpen className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                      <p className="text-[13px] text-gray-500">
                        {search || month || year ? 'Aucune ligne ne correspond à ce filtre.' : 'Aucun mouvement de caisse enregistré.'}
                      </p>
                    </td></tr>
                  ) : pageRows.map(({ row, solde }) => (
                    editingId === row.id && editDraft ? (
                      <tr key={row.id} className="bg-blue-50/40 border-b border-gray-100">
                        <Fields value={editDraft} onChange={patch => setEditDraft(d => ({ ...(d as any), ...patch }))} {...fieldProps} />
                        <td />
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1 justify-end">
                            <button title="Enregistrer" disabled={busyId === row.id}
                              onClick={async () => { if (await save(editDraft, row.id)) { setEditingId(null); setEditDraft(null); } }}
                              className="p-1.5 rounded-lg text-white bg-navy hover:bg-navy-hover disabled:opacity-50">
                              {busyId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            </button>
                            <button title="Annuler" onClick={() => { setEditingId(null); setEditDraft(null); }}
                              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={row.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/60">
                        <td className="px-3 py-2 text-gray-600">{frDate(row.date)}</td>
                        <td className="px-3 py-2">
                          {row.category
                            ? <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px]">{row.category}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-800">{row.label || <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2 text-gray-700">{row.clientName || <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2 text-right font-mono text-done-fg">{row.entree ? money(row.entree) : ''}</td>
                        <td className="px-3 py-2 text-right font-mono text-late-fg">{row.sortie ? money(row.sortie) : ''}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-gray-900 sticky right-0 bg-white border-l border-gray-200">{money(solde)}</td>
                        <td className="px-3 py-2">
                          {canManage && (
                            <div className="flex items-center gap-1 justify-end">
                              <button title="Modifier"
                                onClick={() => { setEditingId(row.id); setEditDraft({ ...row }); setDraft(null); }}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-navy"><Pencil className="w-3.5 h-3.5" /></button>
                              <button title="Supprimer" disabled={busyId === row.id} onClick={() => remove(row)}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                                {busyId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
            </div>

            {/* Outside the scrolling area and `shrink-0`, so it stays on screen
                however long the journal gets — no scrolling to reach it. */}
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-[13px] shrink-0">
              <div className="text-gray-500">
                {withSolde.length === 0
                  ? 'Aucune ligne'
                  : `Affichage de ${((page - 1) * PAGE_SIZE) + 1} à ${Math.min(page * PAGE_SIZE, withSolde.length)} sur ${withSolde.length} lignes`}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 border border-gray-200 rounded text-gray-600 disabled:opacity-50 hover:bg-gray-100 bg-white"
                >
                  Précédent
                </button>
                <div className="flex items-center gap-1 px-2">
                  <span className="font-medium text-gray-900">{page}</span>
                  <span className="text-gray-500">/</span>
                  <span className="text-gray-500">{totalPages}</span>
                </div>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 border border-gray-200 rounded text-gray-600 disabled:opacity-50 hover:bg-gray-100 bg-white"
                >
                  Suivant
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
