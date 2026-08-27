import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Trash2, Pencil, Check, X, BookOpen, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { friendlyError } from '../../utils/errors';
import { ClientSearchInput } from './ClientSearchInput';

const money = (v: number) =>
  (v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const frDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
};

const PAYMENT_METHODS = ['Espèces', 'Chèque', 'Virement', 'Carte', 'Traite'];

/**
 * The categories the cabinet's own journal already uses. Suggestions, not a
 * closed list — the field accepts anything typed, so a new one never needs a
 * code change. "Encaissement règlement de facture" is the one that normally
 * carries a client, and so becomes that client's encaissement.
 */
const CATEGORIES = [
  'Solde de départ',
  'Encaissement règlement de facture',
  'Alimentation de caisse',
  'Alimentation',
  'Transport',
  'Loyer',
  'Femme de ménage',
  'Fournitures de bureau',
  "Produits d'hygiène",
  'STEG',
  'SONEDE',
  'TELECOM',
  'OOREDOO',
  'Autre',
];

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/** The sheet's own "Mois" column — derived from the date, never stored. */
const monthOf = (iso: string) => Number(String(iso || '').slice(5, 7)) || 0;

export interface JournalRow {
  id: string;
  date: string;
  label: string;
  clientId: number | null;
  clientName: string;
  category: string;
  paymentMethod: string;
  reference: string;
  entree: number;
  sortie: number;
}

const emptyDraft = (): Omit<JournalRow, 'id'> => ({
  date: new Date().toISOString().slice(0, 10),
  label: '',
  clientId: null,
  clientName: '',
  category: '',
  paymentMethod: 'Espèces',
  reference: '',
  entree: 0,
  sortie: 0,
});

/**
 * Brouillard de caisse — the cabinet's cash daybook, one row per movement.
 *
 * The column that matters beyond this screen is **Entrée**: a row with an
 * entrée tied to a client *is* that client's encaissement on the Clients
 * page. It is never copied there — the server merges the two on read — so
 * the movement is recorded once and editing it here updates the client.
 *
 * The running "Solde" column is computed here rather than stored: it is
 * purely a function of the rows above it in date order, and storing it would
 * be a second copy to keep correct on every insert in the middle.
 */
export const CashJournal: React.FC = () => {
  const { token, hasPermission } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const canManage = hasPermission('MANAGE_CASH');

  const [rows, setRows] = useState<JournalRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  /** The sheet is read month by month; 0 = every month. */
  const [month, setMonth] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [draft, setDraft] = useState<Omit<JournalRow, 'id'> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Omit<JournalRow, 'id'> | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/cash-journal', { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Chargement impossible.');
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(friendlyError(e, 'Impossible de charger le brouillard de caisse.'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (month && monthOf(r.date) !== month) return false;
      if (!q) return true;
      return [r.label, r.clientName, r.category, r.reference, r.paymentMethod]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, search, month]);

  // Running balance follows the *displayed* order, so it always reads as the
  // column the cabinet's own sheet has: each line's solde is everything above
  // it plus itself.
  const withSolde = useMemo(() => {
    let solde = 0;
    return filtered.map(r => {
      solde = solde + (Number(r.entree) || 0) - (Number(r.sortie) || 0);
      return { row: r, solde };
    });
  }, [filtered]);

  const totals = useMemo(() => ({
    entree: filtered.reduce((s, r) => s + (Number(r.entree) || 0), 0),
    sortie: filtered.reduce((s, r) => s + (Number(r.sortie) || 0), 0),
  }), [filtered]);

  const save = async (body: Omit<JournalRow, 'id'>, id?: string) => {
    setError('');
    setBusyId(id || 'new');
    try {
      const res = await fetch(id ? `/api/cash-journal/${id}` : '/api/cash-journal', {
        method: id ? 'PUT' : 'POST',
        headers: authHeaders,
        body: JSON.stringify(body),
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

  const Fields: React.FC<{
    value: Omit<JournalRow, 'id'>;
    onChange: (patch: Partial<Omit<JournalRow, 'id'>>) => void;
  }> = ({ value, onChange }) => (
    <>
      <td className="px-2 py-1.5">
        <input type="date" value={value.date} onChange={e => onChange({ date: e.target.value })}
          className="w-full px-2 py-1 border border-gray-300 rounded text-[12px]" />
      </td>
      {/* Derived from the date, so it is shown rather than asked for. */}
      <td className="px-2 py-1.5 text-center text-[12px] text-gray-400">{monthOf(value.date) || '—'}</td>
      <td className="px-2 py-1.5">
        <input value={value.label} onChange={e => onChange({ label: e.target.value })} placeholder="Libellé"
          className="w-full px-2 py-1 border border-gray-300 rounded text-[12px]" />
      </td>
      <td className="px-2 py-1.5 min-w-[190px]">
        <ClientSearchInput
          value={value.clientName}
          onChange={(name, id) => onChange({ clientName: name, clientId: id ?? null })}
        />
      </td>
      <td className="px-2 py-1.5">
        <input list="caisse-categories" value={value.category} onChange={e => onChange({ category: e.target.value })}
          placeholder="Catégorie"
          className="w-full px-2 py-1 border border-gray-300 rounded text-[12px] min-w-[150px]" />
      </td>
      <td className="px-2 py-1.5">
        <select value={value.paymentMethod} onChange={e => onChange({ paymentMethod: e.target.value })}
          className="w-full px-2 py-1 border border-gray-300 rounded text-[12px] bg-white">
          {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <input value={value.reference} onChange={e => onChange({ reference: e.target.value })} placeholder="Pièce"
          className="w-full px-2 py-1 border border-gray-300 rounded text-[12px] w-24" />
      </td>
      <td className="px-2 py-1.5">
        <input type="number" step="0.001" min="0" value={value.entree || ''} placeholder="0,000"
          onChange={e => onChange({ entree: Number(e.target.value) || 0, sortie: 0 })}
          className="w-28 px-2 py-1 border border-gray-300 rounded text-[12px] text-right font-mono" />
      </td>
      <td className="px-2 py-1.5">
        <input type="number" step="0.001" min="0" value={value.sortie || ''} placeholder="0,000"
          onChange={e => onChange({ sortie: Number(e.target.value) || 0, entree: 0 })}
          className="w-28 px-2 py-1 border border-gray-300 rounded text-[12px] text-right font-mono" />
      </td>
    </>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-4">
      {/* Shared by every Catégorie input — suggestions only, free text wins. */}
      <datalist id="caisse-categories">
        {CATEGORIES.map(c => <option key={c} value={c} />)}
      </datalist>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[11.5px] text-gray-500">
          Chaque <span className="font-semibold text-gray-700">entrée</span> rattachée à un client apparaît
          automatiquement dans ses encaissements sur la page Clients.
        </p>
        <div className="flex items-center gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="px-2.5 py-2 text-[12px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-gray-400">
            <option value={0}>Tous les mois</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Libellé, client, catégorie…"
              className="pl-8 pr-3 py-2 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 w-56" />
          </div>
          {canManage && !draft && (
            <button onClick={() => setDraft(emptyDraft())}
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
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full text-left whitespace-nowrap border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Date', 'Mois', 'Libellé', 'Client', 'Catégorie', 'Règlement', 'Pièce'].map(h => (
                    <th key={h} className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">{h}</th>
                  ))}
                  <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider text-right">Entrée</th>
                  <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider text-right">Sortie</th>
                  <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider text-right sticky right-0 bg-gray-50 border-l border-gray-200">Solde</th>
                  <th className="px-3 py-2.5" />
                </tr>
                <tr className="bg-white border-b-2 border-gray-200 font-bold text-[12px]">
                  <td className="px-3 py-2 text-gray-700" colSpan={7}>Total général</td>
                  <td className="px-3 py-2 text-right font-mono text-done-fg">{money(totals.entree)}</td>
                  <td className="px-3 py-2 text-right font-mono text-late-fg">{money(totals.sortie)}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-900 sticky right-0 bg-white border-l border-gray-200">{money(totals.entree - totals.sortie)}</td>
                  <td />
                </tr>
              </thead>
              <tbody className="text-[12.5px]">
                {canManage && draft && (
                  <tr className="bg-blue-50/40 border-b border-gray-100">
                    <Fields value={draft} onChange={patch => setDraft(d => ({ ...(d as any), ...patch }))} />
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

                {withSolde.length === 0 && !draft ? (
                  <tr><td colSpan={11} className="p-10 text-center">
                    <BookOpen className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                    <p className="text-[13px] text-gray-500">
                      {search ? `Aucune ligne ne correspond à « ${search} ».` : 'Aucun mouvement de caisse enregistré.'}
                    </p>
                  </td></tr>
                ) : withSolde.map(({ row, solde }) => (
                  editingId === row.id && editDraft ? (
                    <tr key={row.id} className="bg-blue-50/40 border-b border-gray-100">
                      <Fields value={editDraft} onChange={patch => setEditDraft(d => ({ ...(d as any), ...patch }))} />
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
                      <td className="px-3 py-2 text-gray-400 text-center">{monthOf(row.date) || '—'}</td>
                      <td className="px-3 py-2 text-gray-800">{row.label || <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2 text-gray-700">{row.clientName || <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2">
                        {row.category
                          ? <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px]">{row.category}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{row.paymentMethod || '—'}</td>
                      <td className="px-3 py-2 text-gray-500">{row.reference || '—'}</td>
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
        )}
      </div>
    </div>
  );
};
