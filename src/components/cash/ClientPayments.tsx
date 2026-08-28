import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Trash2, Pencil, Check, X, Search, Wallet } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { friendlyError } from '../../utils/errors';
import { ClientSearchInput } from './ClientSearchInput';
import { PAYMENT_MODES, isCashMode, paymentModeLabel, type PaymentMode } from '../../constants/paymentModes';

const money = (v: number) =>
  (v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const frDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
};

const PAGE_SIZE = 20;
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const yearOf = (iso: string) => Number(String(iso || '').slice(0, 4)) || 0;
const monthOf = (iso: string) => Number(String(iso || '').slice(5, 7)) || 0;

/**
 * The objet carried into the brouillard by a règlement. The picklist there is
 * editable by the cabinet, and this is the seeded entry that means exactly
 * this — so a règlement lands under a sensible objet instead of a blank one.
 */
const REGLEMENT_CATEGORY = 'Encaissement client';

export interface PaymentRow {
  id: string;
  date: string;
  clientId: number | null;
  clientName: string;
  /** Stored as `label` on the journal row; "Facture N° …", "Avance", … */
  label: string;
  paymentMethod: PaymentMode | '';
  bankAccount: string;
  reference: string;
  /** Stored as `entree`: a règlement is money in, never money out. */
  entree: number;
  category: string;
}

const emptyDraft = (): Omit<PaymentRow, 'id'> => ({
  date: new Date().toISOString().slice(0, 10),
  clientId: null,
  clientName: '',
  label: '',
  paymentMethod: 'ESPECE',
  bankAccount: '',
  reference: '',
  entree: 0,
  category: REGLEMENT_CATEGORY,
});

/**
 * The editable cells of one règlement.
 *
 * Declared at module scope, NOT inside ClientPayments — a component defined
 * inside another is a new component *type* on every render, so React unmounts
 * and remounts these inputs after each keystroke, which reads as a field
 * closing the instant it is opened. Same rule as the journal's own Fields.
 */
const Fields: React.FC<{
  value: Omit<PaymentRow, 'id'>;
  onChange: (patch: Partial<Omit<PaymentRow, 'id'>>) => void;
}> = ({ value, onChange }) => {
  const cash = isCashMode(value.paymentMethod);
  return (
    <>
      <td className="px-2 py-1.5">
        <input type="date" value={value.date} onChange={e => onChange({ date: e.target.value })}
          className="w-full px-2 py-1 border border-gray-300 rounded text-[12px]" />
      </td>
      <td className="px-2 py-1.5 min-w-[180px]">
        <ClientSearchInput
          value={value.clientName}
          onChange={(name, id) => onChange({ clientName: name, clientId: id ?? null })}
        />
      </td>
      <td className="px-2 py-1.5">
        <input value={value.label} onChange={e => onChange({ label: e.target.value })}
          placeholder="Facture N°, Avance,…"
          className="w-full px-2 py-1 border border-gray-300 rounded text-[12px] min-w-[160px]" />
      </td>
      <td className="px-2 py-1.5">
        <select
          value={value.paymentMethod || 'ESPECE'}
          onChange={e => {
            const mode = e.target.value as PaymentMode;
            // Switching to Espèce clears the account: the money went to the
            // till, and leaving the previous IBAN behind would be a lie the
            // server would strip on save anyway.
            onChange(isCashMode(mode) ? { paymentMethod: mode, bankAccount: '' } : { paymentMethod: mode });
          }}
          className="w-full px-2 py-1 border border-gray-300 rounded text-[12px] min-w-[130px]"
        >
          {PAYMENT_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <input
          value={cash ? '' : value.bankAccount}
          onChange={e => onChange({ bankAccount: e.target.value })}
          disabled={cash}
          placeholder={cash ? 'Caisse' : 'Compte bancaire'}
          title={cash ? "Un règlement en espèce entre en caisse, pas sur un compte" : undefined}
          className="w-full px-2 py-1 border border-gray-300 rounded text-[12px] min-w-[130px] disabled:bg-gray-100 disabled:text-gray-400 disabled:placeholder-gray-400"
        />
      </td>
      <td className="px-2 py-1.5">
        <input value={value.reference} onChange={e => onChange({ reference: e.target.value })} placeholder="Référence"
          className="w-full px-2 py-1 border border-gray-300 rounded text-[12px] min-w-[110px]" />
      </td>
      <td className="px-2 py-1.5">
        <input type="number" step="0.001" min="0" value={value.entree || ''} placeholder="0,000"
          onChange={e => onChange({ entree: Number(e.target.value) || 0 })}
          className="w-full px-2 py-1 border border-gray-300 rounded text-[12px] text-right font-mono" />
      </td>
    </>
  );
};

/**
 * Règlements clients — what each client has actually paid, and how.
 *
 * A règlement is not a collection of its own: it *is* a brouillard row with
 * an `entree` tied to a client, seen through the fields that matter here
 * (mode de règlement, compte bancaire, référence). That is deliberate and is
 * what makes the two screens agree by construction — the movement is recorded
 * once, so a règlement corrected here is corrected in the daybook and in the
 * client's encaissements, with no second copy to keep in step.
 *
 * The mode decides where it shows up next: **Espèce** goes to the caisse and
 * therefore appears in the Brouillard de caisse; a virement or a chèque never
 * passes through the till and stays out of it. Either way it counts as the
 * client's encaissement on the Clients page.
 */
export const ClientPayments: React.FC = () => {
  const { token, hasPermission } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const canManage = hasPermission('MANAGE_CASH');

  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'' | PaymentMode>('');
  const [year, setYear] = useState(0);
  const [month, setMonth] = useState(0);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [draft, setDraft] = useState<Omit<PaymentRow, 'id'> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Omit<PaymentRow, 'id'> | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/cash-journal', { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Chargement impossible.');
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(friendlyError(e, 'Impossible de charger les règlements.'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [search, mode, year, month]);

  /**
   * A règlement client is a journal row that is money in from a named client.
   * The daybook's own movements — loyer, STEG, alimentation de caisse — are
   * sorties or carry no client, and are not règlements.
   */
  const payments = useMemo(
    () => rows.filter(r => (Number(r.entree) || 0) > 0 && (r.clientId || r.clientName)),
    [rows],
  );

  const years = useMemo(() => {
    const set = new Set<number>(payments.map(r => yearOf(r.date)).filter(Boolean));
    set.add(new Date().getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [payments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter(r => {
      if (year && yearOf(r.date) !== year) return false;
      if (month && monthOf(r.date) !== month) return false;
      // An older row carries no mode and reads as espèce, so the Espèce
      // filter has to match it too — the same rule isCashMode() applies.
      if (mode && (r.paymentMethod || (isCashMode(r.paymentMethod) ? 'ESPECE' : '')) !== mode) return false;
      if (!q) return true;
      return [r.clientName, r.label, r.reference, r.bankAccount]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [payments, search, mode, year, month]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totals = useMemo(() => ({
    all: filtered.reduce((s, r) => s + (Number(r.entree) || 0), 0),
    caisse: filtered.filter(r => isCashMode(r.paymentMethod)).reduce((s, r) => s + (Number(r.entree) || 0), 0),
  }), [filtered]);

  const save = async (body: Omit<PaymentRow, 'id'>, id?: string) => {
    if (!body.clientName?.trim()) {
      setError('Le client est obligatoire sur un règlement.');
      return false;
    }
    if (!(Number(body.entree) > 0)) {
      setError('Le montant doit être supérieur à 0.');
      return false;
    }
    setError('');
    setBusyId(id || 'new');
    try {
      const res = await fetch(id ? `/api/cash-journal/${id}` : '/api/cash-journal', {
        method: id ? 'PUT' : 'POST',
        headers: authHeaders,
        // sortie is pinned to 0: a règlement is money in by definition, and
        // the server refuses a row that is both.
        body: JSON.stringify({ ...body, sortie: 0, category: body.category || REGLEMENT_CATEGORY }),
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

  const remove = async (row: PaymentRow) => {
    if (!confirm(`Supprimer le règlement du ${frDate(row.date)}${row.clientName ? ` — ${row.clientName}` : ''} ?`)) return;
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

  const startEdit = (row: PaymentRow) => {
    setEditingId(row.id);
    setDraft(null);
    setEditDraft({
      date: row.date,
      clientId: row.clientId ?? null,
      clientName: row.clientName || '',
      label: row.label || '',
      paymentMethod: (row.paymentMethod || 'ESPECE') as PaymentMode,
      bankAccount: row.bankAccount || '',
      reference: row.reference || '',
      entree: Number(row.entree) || 0,
      category: row.category || REGLEMENT_CATEGORY,
    });
  };

  const COLSPAN = 8;

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[11.5px] text-gray-500">
          Un règlement en <span className="font-semibold text-gray-700">espèce</span> entre en caisse et apparaît
          dans le <span className="font-semibold text-gray-700">brouillard de caisse</span>. Les autres modes n'y
          figurent pas, mais comptent dans les encaissements du client.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Client, objet, référence…"
              className="pl-8 pr-3 py-2 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 w-full sm:w-56"
            />
          </div>
          <select value={mode} onChange={e => setMode(e.target.value as '' | PaymentMode)}
            className="px-2 py-2 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400">
            <option value="">Tous les modes</option>
            {PAYMENT_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="px-2 py-2 text-[12px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-gray-400">
            <option value={0}>Toutes les années</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="px-2 py-2 text-[12px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-gray-400">
            <option value={0}>Tous les mois</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          {canManage && (
            <button
              onClick={() => { setEditingId(null); setEditDraft(null); setDraft(emptyDraft()); }}
              className="bg-navy hover:bg-navy-hover text-white px-3.5 py-2 rounded-lg text-[12.5px] font-medium flex items-center gap-1.5 shrink-0"
            >
              <Plus className="w-4 h-4" /> Nouveau règlement
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F9FAFB] border-b border-gray-200">
                {['Date', 'Client', 'Objet du règlement', 'Mode de règlement', 'Compte bancaire', 'Référence'].map(h => (
                  <th key={h} className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">{h}</th>
                ))}
                <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider text-right">Montant</th>
                <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="text-[12px] divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={COLSPAN} className="px-3 py-10 text-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" /></td></tr>
              ) : (
                <>
                  {draft && (
                    <tr className="bg-turquoise/5">
                      <Fields value={draft} onChange={patch => setDraft(d => (d ? { ...d, ...patch } : d))} />
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={async () => { if (await save(draft)) setDraft(null); }}
                            disabled={busyId === 'new'}
                            title="Enregistrer"
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded disabled:opacity-50"
                          >
                            {busyId === 'new' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button onClick={() => { setDraft(null); setError(''); }} title="Annuler"
                            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {pageRows.map(row => (
                    editingId === row.id && editDraft ? (
                      <tr key={row.id} className="bg-turquoise/5">
                        <Fields value={editDraft} onChange={patch => setEditDraft(d => (d ? { ...d, ...patch } : d))} />
                        <td className="px-2 py-1.5">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={async () => { if (await save(editDraft, row.id)) { setEditingId(null); setEditDraft(null); } }}
                              disabled={busyId === row.id}
                              title="Enregistrer"
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded disabled:opacity-50"
                            >
                              {busyId === row.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                            <button onClick={() => { setEditingId(null); setEditDraft(null); setError(''); }} title="Annuler"
                              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={row.id} className="hover:bg-gray-50 group">
                        <td className="px-3 py-2.5 text-gray-600">{frDate(row.date)}</td>
                        <td className="px-3 py-2.5 font-semibold text-gray-900">{row.clientName || '—'}</td>
                        <td className="px-3 py-2.5 text-gray-600">{row.label || <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
                            isCashMode(row.paymentMethod)
                              ? 'bg-turquoise/10 text-turquoise'
                              : 'bg-gray-100 text-gray-600'
                          }`}>
                            {isCashMode(row.paymentMethod) && <Wallet className="w-3 h-3" />}
                            {paymentModeLabel(row.paymentMethod) || 'Espèce'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">
                          {isCashMode(row.paymentMethod)
                            ? <span className="text-gray-400 italic">Caisse</span>
                            : row.bankAccount || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">{row.reference || <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-semibold text-gray-900">{money(Number(row.entree) || 0)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            {canManage && (
                              <>
                                <button onClick={() => startEdit(row)} title="Modifier"
                                  className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded">
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button onClick={() => remove(row)} disabled={busyId === row.id} title="Supprimer"
                                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50">
                                  {busyId === row.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  ))}

                </>
              )}
            </tbody>
            {!isLoading && filtered.length > 0 && (
              <tfoot className="sticky bottom-0">
                <tr className="bg-[#F9FAFB] border-t border-gray-200 text-[12px] font-bold text-gray-900">
                  <td colSpan={6} className="px-3 py-2.5">
                    Total des règlements
                    <span className="ml-2 font-medium text-gray-500">
                      (dont {money(totals.caisse)} en caisse)
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">{money(totals.all)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>

          {/* Outside the table, not a colSpan row: the columns are nowrap and
              wider than the card on a phone, so a cell centred across all of
              them centred the message off the visible edge. */}
          {!isLoading && filtered.length === 0 && !draft && (
            <div className="px-3 py-10 text-center text-gray-500 text-[13px]">
              Aucun règlement enregistré.
            </div>
          )}
        </div>

        {/* Outside the scrolling area and `shrink-0`, so it stays on screen
            however long the list gets — no scrolling to reach it. Rendered
            unconditionally, not only past one page: it also carries the
            "showing X to Y of Z" count, which is worth seeing on a short
            list too, and a bar that appears and disappears makes the table
            jump. Same treatment as the journal. */}
        {!isLoading && (
          <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-[13px] shrink-0">
            <div className="text-gray-500">
              {filtered.length === 0
                ? 'Aucun règlement'
                : `Affichage de ${((page - 1) * PAGE_SIZE) + 1} à ${Math.min(page * PAGE_SIZE, filtered.length)} sur ${filtered.length} règlement${filtered.length > 1 ? 's' : ''}`}
            </div>
            <div className="flex gap-1 shrink-0">
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
        )}
      </div>
    </div>
  );
};
