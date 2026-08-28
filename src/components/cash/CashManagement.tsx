import React, { useEffect, useState } from 'react';
import { Plus, Loader2, Receipt, Search, Trash2, Pencil, FileText, Building2, BookOpen, Wallet } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { InvoiceEditor } from './InvoiceEditor';
import { InvoicePreview } from './InvoicePreview';
import { CompanySettings } from './CompanySettings';
import { CashJournal } from './CashJournal';
import { ClientPayments } from './ClientPayments';
import { friendlyError } from '../../utils/errors';

const money = (v: number) =>
  (v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** Payment dates are stored ISO; the Cash screen reads DD/MM/YYYY throughout. */
const frDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
};

/**
 * The legal sequence restarts every calendar year, so its own number alone
 * ("0006") is ambiguous across years — shown as "0006 - 2026". "Autre
 * document" carries a free reference outside that sequence and is left as-is.
 */
const displayNumber = (inv: any) =>
  inv.documentKind === 'FACTURE_LEGALE' && inv.issueDate
    ? `${inv.number} - ${String(inv.issueDate).slice(0, 4)}`
    : inv.number;

const KIND_LABEL: Record<string, string> = {
  FACTURE_LEGALE: 'Facture légale',
  AUTRE: 'Autre document',
  AUTRE_NON_FACTURABLE: 'Autre document (non facturable)',
};
const REGIME_LABEL: Record<string, string> = {
  DROIT_COMMUN: 'Droit commun',
  SUSPENSION: 'Vente en suspension de la TVA',
  EXPORT: 'Vente à l’export',
};
const CURRENCY_SUFFIX: Record<string, string> = { TND: 'DT', USD: 'USD', EUR: 'EUR' };
/** Matches the Clients table's own page size, so both lists page the same way. */
const PAGE_SIZE = 20;
const REGIME_BADGE: Record<string, string> = {
  SUSPENSION: 'bg-amber-50 text-amber-700',
  EXPORT: 'bg-purple-50 text-purple-700',
};

/**
 * Cash — the facturation view. Lists the documents issued and hosts the
 * creation workflow from the cahier des charges.
 */
export const CashManagement: React.FC = () => {
  const { token, hasPermission } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  /** Three screens under one nav item: the documents issued, the règlements
   *  clients that feed the clients' encaissements, and the cash daybook the
   *  espèce ones land in. */
  const [tab, setTab] = useState<'documents' | 'reglements' | 'journal'>('documents');
  const [invoices, setInvoices] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  /** Sums over the whole filtered set, per currency — see the note server-side. */
  const [totalsByCurrency, setTotalsByCurrency] = useState<Record<string, { totalHT: number; totalNetToPay: number; count: number }>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  /** false = closed, null = creating, object = editing that document. */
  const [editor, setEditor] = useState<false | { invoice: any | null }>(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);

  const canManage = hasPermission('MANAGE_CASH');

  // TND first (the default), then the rest alphabetically, so the row's
  // ordering doesn't shuffle as documents in other currencies come and go.
  const currencyTotals = Object.entries(totalsByCurrency).sort(([a], [b]) => {
    if (a === 'TND') return -1;
    if (b === 'TND') return 1;
    return a.localeCompare(b);
  }) as [string, { totalHT: number; totalNetToPay: number; count: number }][];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = async (q = '', p = page) => {
    try {
      const offset = (p - 1) * PAGE_SIZE;
      const res = await fetch(
        `/api/invoices?limit=${PAGE_SIZE}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        { headers: authHeaders },
      );
      if (!res.ok) throw new Error('Chargement impossible');
      const body = await res.json();
      setInvoices(body.data ?? []);
      setTotal(body.total ?? 0);
      setTotalsByCurrency(body.totalsByCurrency ?? {});
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setIsLoading(false);
    }
  };

  // Server-side search + pagination, debounced — the list is never fully
  // loaded client-side. Page resets to 1 in the search input's own handler,
  // so a new search can't land on a page that no longer exists.
  useEffect(() => {
    const h = setTimeout(() => load(search.trim(), page), 250);
    return () => clearTimeout(h);
  }, [search, page]);

  const remove = async (invoice: any) => {
    if (!confirm(`Supprimer le document ${invoice.number} — ${invoice.clientName} ?`)) return;
    const res = await fetch(`/api/invoices/${invoice.id}`, { method: 'DELETE', headers: authHeaders });
    if (res.ok) load(search.trim());
    else setError('Suppression impossible');
  };

  if (!hasPermission('VIEW_CASH')) {
    return (
      <div className="p-8 text-center text-gray-500">
        Vous n'avez pas l'autorisation d'accéder à cette page.
      </div>
    );
  }

  return (
    <div className={`flex-1 min-h-0 flex flex-col space-y-4 sm:space-y-6 w-full mx-auto p-4 sm:p-6 lg:p-8 ${
      // The daybook is a wide sheet by nature — eleven columns — so it gets
      // more room than the document list, which is comfortable at 1200.
      tab === 'documents' ? 'max-w-[1200px]' : 'max-w-[1500px]'
    }`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-bold text-gray-800 tracking-tight flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Cash
          </h1>
          <p className="text-[12px] text-gray-500 mt-1">
            {tab === 'documents'
              ? 'Factures légales et autres documents émis aux clients.'
              : tab === 'reglements'
                ? 'Ce que chaque client a réglé, et par quel moyen.'
                : 'Mouvements de caisse — entrées et sorties, jour par jour.'}
          </p>
        </div>
        <div className={`flex items-center gap-2 flex-wrap w-full sm:w-auto ${tab === 'documents' ? '' : 'hidden'}`}>
          <div className="relative flex-1 min-w-[160px] sm:flex-none">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="N°, client, titre…"
              className="pl-8 pr-3 py-2 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 w-full sm:w-56"
            />
          </div>
          {canManage && (
            <button
              onClick={() => setCompanyOpen(true)}
              title="Informations affichées au bas de chaque document"
              className="px-4 py-2.5 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2 shrink-0"
            >
              <Building2 className="w-4 h-4" />
              <span className="hidden sm:inline">Informations de facturation</span>
            </button>
          )}
          {canManage && (
            <button
              onClick={() => setEditor({ invoice: null })}
              className="bg-navy hover:bg-navy-hover text-white px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2 shrink-0"
            >
              <Plus className="w-4 h-4" />
              Nouveau document
            </button>
          )}
        </div>
      </div>

      {/* Scrolls sideways rather than wrapping: three two-word labels do not
          fit a phone, and letting them wrap turned the bar into three rows of
          broken text with no underline lining up under anything. */}
      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto shrink-0">
        {([
          { id: 'documents', label: 'Facturation', icon: FileText },
          { id: 'reglements', label: 'Règlements clients', icon: Wallet },
          { id: 'journal', label: 'Brouillard de caisse', icon: BookOpen },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium -mb-px border-b-2 transition-colors shrink-0 whitespace-nowrap ${
              tab === t.id
                ? 'border-navy text-navy'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'journal' ? <CashJournal /> : tab === 'reglements' ? <ClientPayments /> : <>

      {error && (
        <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
          {error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex-1 flex flex-col min-h-0">
        {isLoading ? (
          <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : invoices.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-[13px] text-gray-500">
              {search ? `Aucun document ne correspond à « ${search} ».` : 'Aucun document émis pour le moment.'}
            </p>
            {canManage && !search && (
              <button onClick={() => setEditor({ invoice: null })} className="mt-3 text-[13px] font-medium text-blue-600 hover:text-blue-800">
                Créer le premier document
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap">
              {/* Bloc en-tête figé, same treatment as the Clients table. */}
              <thead>
                <tr className="bg-[#F9FAFB] border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="sticky top-0 z-20 bg-[#F9FAFB] px-4 py-3">N°</th>
                  <th className="sticky top-0 z-20 bg-[#F9FAFB] px-4 py-3">Document</th>
                  <th className="sticky top-0 z-20 bg-[#F9FAFB] px-4 py-3">Client</th>
                  <th className="sticky top-0 z-20 bg-[#F9FAFB] px-4 py-3">Date</th>
                  <th className="sticky top-0 z-20 bg-[#F9FAFB] px-4 py-3">Régime</th>
                  <th className="sticky top-0 z-20 bg-[#F9FAFB] px-4 py-3 text-right">Total HT</th>
                  <th className="sticky top-0 z-20 bg-emerald-50 px-4 py-3 text-right">Montant de facture</th>
                  {/* Pinned right so the row's actions stay reachable while
                      the wide sheet scrolls sideways. */}
                  <th className="sticky top-0 right-0 z-30 bg-[#F9FAFB] px-4 py-3 text-center shadow-[-1px_0_0_0_theme(colors.gray.200)]">Actions</th>
                </tr>
                {/* Total Général — frozen directly under the column labels,
                    summing the whole filtered set rather than the page. One
                    line per currency: mixing dinars with USD/EUR in a single
                    figure would be meaningless. */}
                {currencyTotals.length > 0 && (
                  <tr className="bg-gray-100 border-b border-gray-200 text-[12px]">
                    <td className="sticky top-[42px] z-20 bg-gray-100 px-4 py-2.5 font-bold text-gray-800 whitespace-nowrap" colSpan={5}>
                      Total Général
                      {currencyTotals.length > 1 && (
                        <span className="ml-2 font-normal text-[11px] text-gray-500">(par devise)</span>
                      )}
                    </td>
                    <td className="sticky top-[42px] z-20 bg-gray-100 px-4 py-2.5 text-right">
                      {currencyTotals.map(([code, t]) => (
                        <div key={code} className="font-mono font-bold text-gray-900 whitespace-nowrap">
                          {money(t.totalHT)}
                          {currencyTotals.length > 1 && <span className="ml-1 font-sans font-normal text-[10px] text-gray-500">{CURRENCY_SUFFIX[code] || code}</span>}
                        </div>
                      ))}
                    </td>
                    <td className="sticky top-[42px] z-20 bg-emerald-50 px-4 py-2.5 text-right">
                      {currencyTotals.map(([code, t]) => (
                        <div key={code} className="font-mono font-bold text-emerald-900 whitespace-nowrap">
                          {money(t.totalNetToPay)} <span className="font-sans font-normal text-[10px] text-emerald-700">{CURRENCY_SUFFIX[code] || code}</span>
                        </div>
                      ))}
                    </td>
                    <td className="sticky top-[42px] right-0 z-30 bg-gray-100 px-4 py-2.5 shadow-[-1px_0_0_0_theme(colors.gray.200)]" />
                  </tr>
                )}
              </thead>
              <tbody className="text-[12.5px] divide-y divide-gray-100">
                {invoices.map(inv => (
                  <tr
                    key={inv.id}
                    onClick={() => setPreview(inv)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3 font-mono font-bold text-gray-900">{displayNumber(inv)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{inv.title}</div>
                      <div className="text-[11px] text-gray-400">{KIND_LABEL[inv.documentKind] ?? inv.documentKind}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-800">{inv.clientName}</td>
                    <td className="px-4 py-3 text-gray-500">{inv.issueDate}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                        REGIME_BADGE[inv.vatRegime] ?? 'bg-blue-50 text-blue-700'
                      }`}>
                        {REGIME_LABEL[inv.vatRegime] ?? inv.vatRegime}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">{money(inv.totalHT)}</td>
                    <td className="px-4 py-3 text-right bg-emerald-50/20">
                      <span className="font-mono font-semibold text-emerald-900">{money(inv.totalNetToPay)} {CURRENCY_SUFFIX[inv.currency] || inv.currency || 'DT'}</span>
                    </td>
                    <td className="px-4 py-3 text-center sticky right-0 z-10 bg-white group-hover:bg-gray-50 transition-colors shadow-[-1px_0_0_0_theme(colors.gray.200)]">
                      {canManage && (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={e => { e.stopPropagation(); setEditor({ invoice: inv }); }}
                            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
                            title="Modifier"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); remove(inv); }}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Supprimer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* Pagination — outside the scroll area, so it stays visible without
            scrolling to the bottom of the list (same as the Clients table). */}
        {!isLoading && invoices.length > 0 && (
          <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-[13px] shrink-0">
            <div className="text-gray-500">
              Affichage de {((page - 1) * PAGE_SIZE) + 1} à {Math.min(page * PAGE_SIZE, total)} sur {total} documents
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
        )}
      </div>

      {editor && (
        <InvoiceEditor
          invoice={editor.invoice}
          onClose={() => setEditor(false)}
          onSaved={() => { setEditor(false); setPreview(null); load(search.trim()); }}
        />
      )}

      {companyOpen && <CompanySettings onClose={() => setCompanyOpen(false)} />}

      {preview && (
        <InvoicePreview
          invoice={preview}
          onClose={() => setPreview(null)}
          onEdit={canManage ? (inv) => { setPreview(null); setEditor({ invoice: inv }); } : undefined}
          onDelete={canManage ? async (inv) => { await remove(inv); setPreview(null); } : undefined}
        />
      )}
      </>}
    </div>
  );
};
