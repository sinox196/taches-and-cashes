import React, { useEffect, useState } from 'react';
import { Plus, Loader2, Receipt, Search, Trash2, Pencil, FileText, Building2, BookOpen, Wallet, FileClock, Send, ArrowRightLeft, ChevronRight, ChevronDown, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { InvoiceEditor } from './InvoiceEditor';
import { InvoicePreview } from './InvoicePreview';
import { CompanySettings } from './CompanySettings';
import { CashJournal } from './CashJournal';
import { ClientPayments } from './ClientPayments';
import { friendlyError } from '../../utils/errors';
import { ExportButton } from '../ExportButton';
import { csvNumber } from '../../utils/exportCsv';

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
/** One colour per subview, matched on each screen's own total (Facturation's
 *  blue Total Général card, Règlements clients' green total, Brouillard de
 *  caisse's violet total) — same idiom as Tâches'/RH's per-subview tabs,
 *  so switching subviews here reads the same way it does there. */
const CASH_TAB_COLOR: Record<'documents' | 'reglements' | 'journal', string> = {
  documents: 'border-blue-600 text-blue-600',
  reglements: 'border-emerald-600 text-emerald-700',
  journal: 'border-violet-600 text-violet-700',
};
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
  const [kindFilter, setKindFilter] = useState('');
  /** false = closed, null = creating, object = editing that document. */
  const [editor, setEditor] = useState<false | { invoice: any | null }>(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);
  /**
   * Le plafond mensuel — `limit: null` pour une offre sans plafond (Complet).
   * `permanent: true` distingue le quota Freelance (jamais un essai qui
   * expire, ne bloque jamais la création — seule la consultation d'un
   * document au-delà se verrouille) de l'ancien plafond d'essai (`permanent:
   * false`, bloquant, hérité d'une offre retirée du catalogue). Compté par le
   * serveur, avec le même helper que les refus : un compteur qui annoncerait
   * une place restante devant un refus serait pire que pas de compteur.
   */
  const [quota, setQuota] = useState<{ limit: number | null; used: number; remaining: number | null; permanent?: boolean } | null>(null);
  /** "Voir le détail" on the Total Général card — collapsed by default, since
   *  the two summed amounts already answer the usual question. */
  const [showTotalDetail, setShowTotalDetail] = useState(false);

  const canManage = hasPermission('MANAGE_CASH');

  // TND first (the default), then the rest alphabetically, so the row's
  // ordering doesn't shuffle as documents in other currencies come and go.
  const currencyTotals = Object.entries(totalsByCurrency).sort(([a], [b]) => {
    if (a === 'TND') return -1;
    if (b === 'TND') return 1;
    return a.localeCompare(b);
  }) as [string, { totalHT: number; totalNetToPay: number; count: number }][];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = async (q = '', p = page, kind = kindFilter) => {
    try {
      const offset = (p - 1) * PAGE_SIZE;
      const res = await fetch(
        `/api/invoices?limit=${PAGE_SIZE}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}`,
        { headers: authHeaders },
      );
      if (!res.ok) throw new Error('Chargement impossible');
      const body = await res.json();
      setInvoices(body.data ?? []);
      setTotal(body.total ?? 0);
      setTotalsByCurrency(body.totalsByCurrency ?? {});
      // Relu à chaque chargement : émettre un document consomme une place, et
      // le compteur doit le refléter sans qu'on recharge la page.
      fetch('/api/cash/document-quota', { headers: authHeaders })
        .then(r => (r.ok ? r.json() : null))
        .then(q => { if (q) setQuota(q); })
        .catch(() => {});
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
    const h = setTimeout(() => load(search.trim(), page, kindFilter), 250);
    return () => clearTimeout(h);
  }, [search, page, kindFilter]);

  /**
   * Pour « Exporter » — `invoices` ne porte que la page affichée (pagination
   * serveur, comme Clients). La route plafonne `limit` à 500 par appel
   * (server.ts), donc on boucle par tranches de 500 jusqu'à avoir tout ce que
   * `total` annonce, plutôt que de supposer qu'un seul appel suffit — même
   * raisonnement que « Charger plus » sur le Suivi des tâches de l'équipe.
   */
  const fetchAllFilteredInvoices = async (): Promise<any[]> => {
    const q = search.trim();
    const kind = kindFilter;
    const CHUNK = 500;
    let offset = 0;
    let all: any[] = [];
    // Bornée par le total annoncé par le premier appel, pour ne jamais
    // boucler indéfiniment si la réponse venait à changer entre deux appels.
    let total = Infinity;
    while (offset < total) {
      const res = await fetch(
        `/api/invoices?limit=${CHUNK}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}`,
        { headers: authHeaders },
      );
      if (!res.ok) break;
      const body = await res.json();
      const chunk = body.data ?? [];
      if (chunk.length === 0) break;
      all = all.concat(chunk);
      total = typeof body.total === 'number' ? body.total : all.length;
      offset += CHUNK;
    }
    return all;
  };

  /**
   * Émettre un brouillon : c'est le serveur qui lui attribue son numéro, à ce
   * moment-là et pas avant. Un autre document doit fournir sa référence libre.
   */
  const issue = async (invoice: any) => {
    let number: string | null = null;
    if (invoice.documentKind !== 'FACTURE_LEGALE') {
      number = window.prompt(`Numéro à donner à ce document en l'émettant :`, '');
      if (number === null) return;
    } else if (!confirm(
      `Émettre ce brouillon en facture légale ?\n\nIl prendra le prochain numéro de la séquence et ne pourra plus revenir à l'état de brouillon.`
    )) return;

    const res = await fetch(`/api/invoices/${invoice.id}/issue`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify(number === null ? {} : { number }),
    });
    if (res.ok) { setError(''); load(search.trim()); }
    else setError((await res.json().catch(() => ({}))).error || "Émission impossible");
  };

  /** Transformer un autre document en facture légale : il prend le prochain
   *  numéro de la séquence et se place donc en dernier. */
  const convertToLegal = async (invoice: any) => {
    if (!confirm(
      `Transformer « ${invoice.number} » en facture légale ?\n\nIl prendra le prochain numéro de la séquence légale et devra en respecter l'ordre chronologique. Sa référence actuelle sera conservée pour mémoire.`
    )) return;
    const res = await fetch(`/api/invoices/${invoice.id}/convert-to-legal`, { method: 'POST', headers: authHeaders });
    if (res.ok) { setError(''); load(search.trim()); }
    else setError((await res.json().catch(() => ({}))).error || 'Conversion impossible');
  };

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
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
            <Receipt className="w-5 h-5 text-gray-800" />
          </div>
          <div>
          <h1 className="text-[20px] font-bold text-gray-800 tracking-tight">
            Facturation &amp; Trésorerie
          </h1>
          <p className="text-[12px] text-gray-500 mt-1">
            {tab === 'documents'
              ? 'Factures légales et autres documents émis aux clients.'
              : tab === 'reglements'
                ? 'Ce que chaque client a réglé, et par quel moyen.'
                : 'Mouvements de caisse — entrées et sorties, jour par jour.'}
          </p>
          {/* N'apparaît que là où il y a quelque chose à dire : une offre
              sans plafond n'affiche rien, comme le badge d'essai du bandeau. */}
          {quota?.limit ? (
            <p
              title={quota.permanent
                ? "Les documents au-delà du quota se créent normalement — seule leur consultation se verrouille jusqu'à l'upgrade."
                : 'Les brouillons ne comptent pas — préparez-en autant que nécessaire.'}
              className={`inline-flex items-center gap-1.5 mt-2 px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${
                quota.remaining === 0 ? 'bg-late-bg text-late-fg' : 'bg-[#FFFAEB] text-[#B54708]'
              }`}
            >
              <FileClock className="w-3.5 h-3.5 shrink-0" />
              {quota.permanent
                ? (quota.remaining === 0
                    ? `Quota atteint — ${quota.limit} documents ce mois-ci, passez à l'offre illimitée`
                    : `Offre Freelance : ${quota.used} / ${quota.limit} documents ce mois-ci`)
                : (quota.remaining === 0
                    ? `Plafond atteint — ${quota.limit} documents ce mois-ci`
                    : `Essai gratuit : ${quota.used} / ${quota.limit} documents ce mois-ci`)}
            </p>
          ) : null}
          </div>
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
          <select
            value={kindFilter}
            onChange={e => { setKindFilter(e.target.value); setPage(1); }}
            className="px-2.5 py-2 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 shrink-0"
          >
            <option value="">Tous les types</option>
            {Object.entries(KIND_LABEL).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
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
          <ExportButton
            fileName="factures"
            rows={invoices}
            fetchAllRows={fetchAllFilteredInvoices}
            columns={[
              { header: 'Numéro', value: (i: any) => displayNumber(i) },
              { header: 'Statut', value: (i: any) => (i.status === 'DRAFT' ? 'Brouillon' : 'Émis') },
              { header: 'Type', value: (i: any) => KIND_LABEL[i.documentKind] ?? i.documentKind },
              { header: 'Objet', value: (i: any) => i.title },
              { header: 'Client', value: (i: any) => i.clientName },
              { header: 'Matricule', value: (i: any) => i.clientTaxId || '' },
              { header: 'Date', value: (i: any) => frDate(i.issueDate) },
              { header: 'Échéance', value: (i: any) => frDate(i.dueDate) },
              { header: 'Régime TVA', value: (i: any) => REGIME_LABEL[i.vatRegime] ?? i.vatRegime },
              { header: 'Devise', value: (i: any) => i.currency || 'TND' },
              { header: 'Total HT', value: (i: any) => csvNumber(i.totalHT) },
              { header: 'Total TVA', value: (i: any) => csvNumber(i.totalVAT) },
              { header: 'Montant de facture', value: (i: any) => csvNumber(i.totalNetToPay) },
            ]}
          />
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
                ? CASH_TAB_COLOR[t.id]
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

      {/* Total Général — a standalone accent card above the table rather than
          a sticky row inside it, so the headline figure reads before any
          scrolling. Sums the whole filtered set, one line per currency —
          mixing dinars with USD/EUR in a single figure would be meaningless.
          Collapsed by default; "Voir le détail" adds the document count per
          currency, the one field the two totals alone don't answer. */}
      {currencyTotals.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 border-t-[3px] border-t-blue-600 overflow-hidden shrink-0">
          <button
            type="button"
            onClick={() => setShowTotalDetail(v => !v)}
            className="w-full flex items-center justify-between gap-3 px-5 py-3 bg-blue-50/60 border-b border-blue-100 text-left"
          >
            <span className="text-[13.5px] font-bold text-gray-900">
              Total Général
              {currencyTotals.length > 1 && <span className="ml-1.5 font-normal text-gray-500">(par devise)</span>}
            </span>
            <span className="flex items-center gap-1 text-[12.5px] text-gray-500 shrink-0">
              Voir le détail
              {showTotalDetail ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </span>
          </button>
          <div className="px-5 py-3 flex flex-wrap gap-x-8 gap-y-3">
            {currencyTotals.map(([code, t]) => (
              <div key={code} className="flex items-center gap-6">
                <div>
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                    Total HT{currencyTotals.length > 1 ? ` (${CURRENCY_SUFFIX[code] || code})` : ''}
                  </div>
                  <div className="font-mono font-bold text-gray-900 text-[13.5px]">{money(t.totalHT)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">Montant de facture</div>
                  <div className="font-mono font-bold text-emerald-900 text-[13.5px]">
                    {money(t.totalNetToPay)} <span className="font-sans font-normal text-[10px] text-emerald-700">{CURRENCY_SUFFIX[code] || code}</span>
                  </div>
                </div>
                {showTotalDetail && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Documents</div>
                    <div className="font-mono font-bold text-gray-700 text-[13.5px]">{t.count}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
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
              </thead>
              <tbody className="text-[12.5px] divide-y divide-gray-100">
                {invoices.map(inv => (
                  <tr
                    key={inv.id}
                    onClick={() => setPreview(inv)}
                    /* Un brouillon se distingue par un fond ambré et un bord
                       gauche : il est dans la liste sans être un document émis,
                       et ne compte dans aucun total. */
                    className={`cursor-pointer transition-colors group ${
                      inv.status === 'DRAFT'
                        ? 'bg-run-bg/40 hover:bg-run-bg/70 border-l-2 border-l-run-fg'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-4 py-3 font-mono font-bold text-gray-900">
                      {inv.status === 'DRAFT' ? (
                        <span className="inline-flex items-center gap-1.5 text-run-fg">
                          <FileClock className="w-3.5 h-3.5" />
                          <span className="font-sans text-[10px] font-bold uppercase tracking-wide">Brouillon</span>
                        </span>
                      ) : (
                        <>
                          {displayNumber(inv)}
                          {inv.convertedFromNumber && (
                            <span
                              title={`Anciennement « ${inv.convertedFromNumber} », converti en facture légale.`}
                              className="ml-1.5 font-sans text-[9px] font-bold uppercase tracking-wide text-gray-400"
                            >
                              converti
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 flex items-center gap-1.5">
                        {inv.title}
                        {inv.quotaLocked && (
                          <span
                            title="Quota Freelance dépassé — passez à l'offre illimitée pour le consulter"
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[9px] font-bold uppercase tracking-wide shrink-0"
                          >
                            <Lock className="w-2.5 h-2.5" /> Verrouillé
                          </span>
                        )}
                      </div>
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
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {inv.quotaLocked ? <span className="text-gray-300 select-none">•••••</span> : money(inv.totalHT)}
                    </td>
                    <td className="px-4 py-3 text-right bg-emerald-50/20">
                      {inv.quotaLocked ? (
                        <span className="text-gray-300 select-none">•••••</span>
                      ) : (
                        <span className="font-mono font-semibold text-emerald-900">{money(inv.totalNetToPay)} {CURRENCY_SUFFIX[inv.currency] || inv.currency || 'DT'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center sticky right-0 z-10 bg-white group-hover:bg-gray-50 transition-colors shadow-[-1px_0_0_0_theme(colors.gray.200)]">
                      {canManage && (
                        <div className="flex items-center justify-center gap-1">
                          {/* Un document verrouillé ne s'émet, ne se convertit
                              ni ne se modifie plus — seule sa suppression
                              reste possible, elle n'exige pas d'en consulter
                              les montants. */}
                          {inv.quotaLocked ? (
                            <span
                              title="Verrouillé — quota Freelance dépassé, passez à l'offre illimitée"
                              className="p-1.5 text-amber-500"
                            >
                              <Lock className="w-4 h-4" />
                            </span>
                          ) : (
                            <>
                              {inv.status === 'DRAFT' && (
                                <button
                                  onClick={e => { e.stopPropagation(); issue(inv); }}
                                  className="p-1.5 text-run-fg hover:bg-run-bg rounded"
                                  title="Émettre — lui attribue son numéro définitif"
                                >
                                  <Send className="w-4 h-4" />
                                </button>
                              )}
                              {inv.status !== 'DRAFT' && inv.documentKind !== 'FACTURE_LEGALE' && (
                                <button
                                  onClick={e => { e.stopPropagation(); convertToLegal(inv); }}
                                  className="p-1.5 text-gray-400 hover:text-navy hover:bg-gray-100 rounded"
                                  title="Transformer en facture légale"
                                >
                                  <ArrowRightLeft className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={e => { e.stopPropagation(); setEditor({ invoice: inv }); }}
                                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
                                title="Modifier"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            </>
                          )}
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
