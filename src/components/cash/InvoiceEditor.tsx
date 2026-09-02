import React, { useEffect, useMemo, useState } from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import {
  X, Plus, Trash2, Loader, Search, Upload, Calendar, AlertTriangle, FileClock,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { amountToFrenchWords } from '../../utils/amountToWords';
import { friendlyError } from '../../utils/errors';
import {
  normalizeDisbursementLines, DISBURSEMENT_LABEL_MAX, DISBURSEMENT_LINES_MAX,
} from '../../constants/disbursements';

/** Choices from the cahier des charges. */
const DOCUMENT_KINDS = [
  { id: 'FACTURE_LEGALE', label: 'Facture légale' },
  { id: 'AUTRE', label: 'Autre document' },
  { id: 'AUTRE_NON_FACTURABLE', label: 'Autre document (non facturable)' },
];
const BILLING_MODES = [
  { id: 'FORFAIT', label: 'Facturation au Forfait', hint: 'Masque Quantité et Prix Unitaire — la Désignation et le Montant HT sont saisis directement.' },
  { id: 'DETAILLEE', label: 'Facturation Détaillée (Temps / Quantité)', hint: 'Le Montant HT est calculé à partir de la Quantité et du Prix Unitaire.' },
];
const VAT_REGIMES = [
  { id: 'DROIT_COMMUN', label: 'Régime de Droit Commun (Facture avec TVA)' },
  { id: 'SUSPENSION', label: 'Vente en suspension de la TVA' },
  { id: 'EXPORT', label: 'Vente à l’export' },
];
const VAT_RATES = [0, 0.07, 0.13, 0.19];
const WITHHOLDING_RATES = [0, 0.005, 0.01, 0.015, 0.03, 0.05, 0.1];
/** Any other currency is free text, not a fixed list — typed by the user. */
const CURRENCY_SUFFIX: Record<string, string> = { TND: 'DT' };
/** Suggested titles; "Autre document" allows a free one. */
const TITLES = ['Facture', "Note d'honoraires"];

interface Line {
  designation: string;
  quantity: number | '';
  unitPrice: number | '';
  vatRate: number;
  /** "Non soumis" — out of VAT scope, distinct from a real 0% rate for reporting. */
  vatExempt?: boolean;
  montantHT: number | '';
}

const emptyLine = (): Line => ({ designation: '', quantity: 1, unitPrice: '', vatRate: 0.19, vatExempt: false, montantHT: '' });

const n = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const money = (v: number) =>
  v.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const SELECT_CLS =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] bg-white focus:ring-2 focus:ring-navy focus:border-transparent';

/**
 * Defined at module scope on purpose. Declaring a component inside the render
 * body gives it a new identity on every render, so React unmounts and remounts
 * its children — which slammed the native <select> dropdown shut the moment you
 * picked an option, and dropped focus after every keystroke.
 */
const Choice: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <div>
    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">{label}</label>
    {children}
    {hint && <p className="text-[11px] text-gray-500 mt-1">{hint}</p>}
  </div>
);

interface InvoiceEditorProps {
  /** Present = edit that document; absent = create a new one. */
  invoice?: any | null;
  onClose: () => void;
  onSaved: () => void;
}

export const InvoiceEditor: React.FC<InvoiceEditorProps> = ({ invoice = null, onClose, onSaved }) => {
  useEscapeToClose(onClose);
  const isEdit = !!invoice;
  const { token, hasPermission } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // --- selectors -----------------------------------------------------------
  const [documentKind, setDocumentKind] = useState(invoice?.documentKind ?? 'FACTURE_LEGALE');
  const [billingMode, setBillingMode] = useState(invoice?.billingMode ?? 'FORFAIT');
  const [vatRegime, setVatRegime] = useState(invoice?.vatRegime ?? 'DROIT_COMMUN');
  const [currency, setCurrency] = useState(invoice?.currency ?? 'TND');

  // --- header --------------------------------------------------------------
  const [title, setTitle] = useState(invoice?.title ?? 'Facture');
  const [number, setNumber] = useState(invoice?.number ?? '…');
  /** The next sequence value, kept so switching back from "Autre" restores it. */
  const [sequenceNumber, setSequenceNumber] = useState('…');
  const [lastIssueDate, setLastIssueDate] = useState<string | null>(null);
  /** Read-only here — the logo is configured once in Informations de facturation. */
  const [logo, setLogo] = useState<string | null>(null);
  /** The banks configured in Informations de facturation — this document picks one. */
  const [banks, setBanks] = useState<{ id: string; name: string }[]>([]);
  const [bankId, setBankId] = useState(invoice?.bankId ?? '');
  useEffect(() => {
    let cancelled = false;
    fetch('/api/cash/company', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (cancelled || !body) return;
        if (body.logo) setLogo(body.logo);
        setBanks(body.banks || []);
        // A new document defaults to the configured default bank; an
        // existing one keeps whichever bank it already carries.
        if (!isEdit && !bankId) setBankId(body.defaultBankId || '');
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  // --- client --------------------------------------------------------------
  /**
   * Y a-t-il un fichier clients où puiser ?
   *
   * Non pour une offre qui ne vend que la facturation : `hasPermission`
   * consulte déjà l'offre, donc il n'y a rien de plus à interroger ici. Sans
   * fichier clients, la raison sociale se tape à la main comme le matricule
   * fiscal et l'adresse — qui l'étaient déjà, ils étaient seulement
   * pré-remplis depuis la fiche.
   */
  const hasClientDirectory = hasPermission('VIEW_CLIENTS');
  const [clientSearch, setClientSearch] = useState(invoice?.clientName ?? '');
  const [clientResults, setClientResults] = useState<any[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [client, setClient] = useState<any | null>(
    invoice ? { id: invoice.clientId, name: invoice.clientName } : null);
  const [clientTaxId, setClientTaxId] = useState(invoice?.clientTaxId ?? '');
  const [clientAddress, setClientAddress] = useState(invoice?.clientAddress ?? '');
  const [customFields, setCustomFields] = useState<{ label: string; value: string }[]>(
    Object.entries(invoice?.customFields ?? {}).map(([label, value]) => ({ label, value: String(value) })));

  // --- document dates ------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const [issueDate, setIssueDate] = useState(invoice?.issueDate ?? today);
  const [showDueDate, setShowDueDate] = useState(invoice ? invoice.showDueDate !== false : true);
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? '');

  // --- lines & totals ------------------------------------------------------
  const [lines, setLines] = useState<Line[]>(
    invoice?.lines?.length
      ? invoice.lines.map((l: any) => ({
          designation: l.designation ?? '',
          quantity: l.quantity ?? 1,
          unitPrice: l.unitPrice ?? '',
          vatRate: l.vatRate ?? 0,
          vatExempt: !!l.vatExempt,
          montantHT: l.montantHT ?? '',
        }))
      : [emptyLine()]);
  const [withholdingRate, setWithholdingRate] = useState(invoice?.withholdingRate ?? 0.01);
  const [showWithholding, setShowWithholding] = useState(invoice ? invoice.showWithholding !== false : true);
  const [stampDuty, setStampDuty] = useState<number | ''>(invoice?.stampDuty ?? 1);
  const [showStampDuty, setShowStampDuty] = useState(invoice ? invoice.showStampDuty !== false : true);
  // Plusieurs débours possibles sur un même document. Un document d'avant
  // cette version arrive avec un montant et un libellé uniques : le
  // normalisateur partagé le relit comme une ligne, il n'y a rien à migrer.
  const initialDeb = normalizeDisbursementLines(invoice).map(l => ({
    label: l.label, amount: l.amount as number | '',
  }));
  const [showDisbursements, setShowDisbursements] = useState(initialDeb.length > 0);
  const [debLines, setDebLines] = useState<{ label: string; amount: number | '' }[]>(
    initialDeb.length > 0 ? initialDeb : [{ label: '', amount: '' }],
  );

  const setDebLine = (i: number, patch: Partial<{ label: string; amount: number | '' }>) =>
    setDebLines(prev => prev.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const addDebLine = () =>
    setDebLines(prev => (prev.length >= DISBURSEMENT_LINES_MAX ? prev : [...prev, { label: '', amount: '' }]));
  // La dernière ligne ne se supprime pas : décocher « Remboursement de
  // débours » est ce qui retire le bloc entier.
  const removeDebLine = (i: number) =>
    setDebLines(prev => (prev.length <= 1 ? prev : prev.filter((_, k) => k !== i)));
  const [showAdvances, setShowAdvances] = useState(!!invoice?.advances);
  const [advances, setAdvances] = useState<number | ''>(invoice?.advances || '');

  // Only meaningful under "Suspension de TVA" — printed under the invoice
  // number on the document. Kept in state regardless of régime so switching
  // back and forth doesn't lose what was typed.
  const [attestationNumber, setAttestationNumber] = useState(invoice?.attestationNumber ?? '');
  const [attestationDate, setAttestationDate] = useState(invoice?.attestationDate ?? '');
  const [bonCommandeNumber, setBonCommandeNumber] = useState(invoice?.bonCommandeNumber ?? '');

  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const suspended = vatRegime === 'SUSPENSION';
  const exported = vatRegime === 'EXPORT';
  /** Suspension and export both charge zero VAT; only suspension prints the attestation/indicative-VAT extras. */
  const zeroVat = suspended || exported;
  const detailed = billingMode === 'DETAILLEE';
  /** Only a legal invoice is bound to the sequence — both "Autre" kinds type their own number. */
  const freeNumber = documentKind !== 'FACTURE_LEGALE';
  /** The sequence restarts every year, so its number alone is ambiguous across years. */
  const numberDisplay = !freeNumber && issueDate ? `${number} - ${issueDate.slice(0, 4)}` : number;

  useEffect(() => {
    if (isEdit) return; // an issued document keeps its number
    (async () => {
      try {
        const res = await fetch('/api/invoices/meta/next-number', { headers: authHeaders });
        if (res.ok) {
          const body = await res.json();
          setSequenceNumber(body.nextNumber);
          setNumber(prev => (documentKind !== 'FACTURE_LEGALE' ? prev : body.nextNumber));
          setLastIssueDate(body.lastIssueDate ?? null);
        }
      } catch { /* the number is display-only until save */ }
    })();
  }, []);

  // Client lookup is server-side and debounced — the list is never fully loaded.
  useEffect(() => {
    const term = clientSearch.trim();
    if (!hasClientDirectory || term.length < 1 || client) { setClientResults([]); return; }
    let cancelled = false;
    const h = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(term)}&page=1&limit=8`, { headers: authHeaders });
        const body = await res.json();
        if (!cancelled) setClientResults(Array.isArray(body) ? body : (body.data ?? []));
      } catch { if (!cancelled) setClientResults([]); }
    }, 250);
    return () => { cancelled = true; clearTimeout(h); };
  }, [clientSearch, client, token, hasClientDirectory]);

  /** Matricule fiscal and adresse come from the client record automatically. */
  const selectClient = (c: any) => {
    setClient(c);
    setClientSearch(c.name);
    setDropdownOpen(false);
    setClientTaxId(c.taxId || '');
    setClientAddress([c.address, c.city, c.country].filter(Boolean).join(', '));
  };

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  /** In Détaillée mode the amount is derived; in Forfait it is typed. */
  const lineHT = (l: Line) => (detailed ? n(Number(l.quantity)) * n(Number(l.unitPrice)) : n(Number(l.montantHT)));

  // Mirrors computeInvoiceTotals() on the server; the server value is authoritative.
  const totals = useMemo(() => {
    const round3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000;
    const byRate = new Map<number, number>();
    const indicativeByRate = new Map<number, number>();
    let totalHT = 0;
    for (const l of lines) {
      const ht = lineHT(l);
      totalHT += ht;
      const realRate = l.vatExempt ? 0 : l.vatRate;
      const chargedRate = zeroVat ? 0 : realRate;
      byRate.set(chargedRate, (byRate.get(chargedRate) || 0) + ht);
      indicativeByRate.set(realRate, (indicativeByRate.get(realRate) || 0) + ht);
    }
    const breakdown = [...byRate.entries()]
      .filter(([r]) => !suspended && r > 0)
      .map(([rate, base]) => ({ rate, base: round3(base), amount: round3(base * rate) }))
      .sort((a, b) => a.rate - b.rate);
    // Purely informational under suspension — never added to tva/ttc below.
    const indicativeBreakdown = suspended
      ? [...indicativeByRate.entries()]
          .filter(([r]) => r > 0)
          .map(([rate, base]) => ({ rate, base: round3(base), amount: round3(base * rate) }))
          .sort((a, b) => a.rate - b.rate)
      : [];
    const indicativeTotal = round3(indicativeBreakdown.reduce((s, b) => s + b.amount, 0));

    const ht = round3(totalHT);
    const tva = round3(breakdown.reduce((s, b) => s + b.amount, 0));
    const ttc = round3(ht + tva);
    // Masking the retenue or the timbre fiscal drops each from the
    // net-to-pay math too — mirrors the server.
    const rsAmount = showWithholding ? round3(ttc * withholdingRate) : 0;
    const stamp = showStampDuty ? n(Number(stampDuty)) : 0;
    const net = round3(ttc - rsAmount + stamp);
    const deb = showDisbursements ? round3(debLines.reduce((t, l) => t + n(Number(l.amount)), 0)) : 0;
    const adv = showAdvances ? n(Number(advances)) : 0;
    const totalNet = round3(net + deb - adv);
    return { breakdown, indicativeBreakdown, indicativeTotal, ht, tva, ttc, rsAmount, stamp, net, deb, adv, totalNet };
  }, [lines, suspended, zeroVat, detailed, withholdingRate, showWithholding, stampDuty, showStampDuty, showDisbursements, debLines, showAdvances, advances]);

  const dateWarning = !isEdit && !freeNumber && lastIssueDate && issueDate < lastIssueDate
    ? `La date doit être postérieure ou égale à celle de la dernière facture légale (${lastIssueDate}).`
    : '';

  /**
   * `asDraft` n'est proposé qu'à la création : un document déjà émis ne
   * redevient pas un brouillon — il porte un numéro de la séquence légale, et
   * le rendre modifiable en silence ouvrirait un trou dans la numérotation.
   */
  const handleSave = async (asDraft = false) => {
    if (!clientSearch.trim()) { setError('La raison sociale du client est obligatoire.'); return; }
    if (!clientTaxId.trim()) { setError('Le matricule fiscal est obligatoire.'); return; }
    if (!clientAddress.trim()) { setError("L'adresse est obligatoire."); return; }
    if (!issueDate) { setError('La date de création est obligatoire.'); return; }
    // Un brouillon prend un numéro provisoire côté serveur : on ne le réclame
    // qu'à l'émission.
    if (freeNumber && !asDraft && !number.trim()) { setError('Le numéro du document est obligatoire.'); return; }
    if (!currency.trim()) { setError('La devise est obligatoire.'); return; }
    if (lines.some(l => !l.designation.trim())) { setError('Chaque ligne doit avoir une désignation.'); return; }
    if (dateWarning) { setError(dateWarning); return; }

    setError('');
    setIsSaving(true);
    try {
      const res = await fetch(isEdit ? `/api/invoices/${invoice.id}` : '/api/invoices', {
        method: isEdit ? 'PUT' : 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          documentKind, billingMode, vatRegime, currency: currency.trim(), title,
          ...(freeNumber ? { number: number.trim() } : {}),
          // Le document porte le nom qui est à l'écran ; l'id n'existe que
          // si une fiche a été choisie, et le serveur accepte l'un ou l'autre.
          clientId: client?.id ?? null, clientName: client?.name ?? clientSearch.trim(),
          clientTaxId, clientAddress,
          customFields: Object.fromEntries(customFields.filter(f => f.label.trim()).map(f => [f.label.trim(), f.value])),
          issueDate, dueDate: showDueDate ? dueDate : '', showDueDate,
          bankId: bankId || null,
          lines: lines.map(l => ({
            designation: l.designation.trim(),
            quantity: detailed ? n(Number(l.quantity)) : 1,
            unitPrice: detailed ? n(Number(l.unitPrice)) : 0,
            // The line's own rate is always sent, suspended or not — the
            // server is what decides whether it's actually charged; under
            // suspension it still needs the real rate to show the
            // "TVA à titre indicatif" breakdown.
            vatRate: l.vatRate,
            vatExempt: !!l.vatExempt,
            montantHT: lineHT(l),
          })),
          withholdingRate,
          showWithholding,
          stampDuty: n(Number(stampDuty)),
          showStampDuty,
          // Le serveur refait la somme depuis ces lignes : `disbursements`
          // n'est jamais envoyé, pour qu'un total ne puisse pas contredire
          // son propre détail.
          disbursementsLines: showDisbursements
            ? debLines
                .map(l => ({ label: l.label.trim().slice(0, DISBURSEMENT_LABEL_MAX), amount: n(Number(l.amount)) }))
                .filter(l => l.amount !== 0 || l.label !== '')
            : [],
          advances: totals.adv,
          attestationNumber: attestationNumber.trim(),
          attestationDate,
          bonCommandeNumber: bonCommandeNumber.trim(),
          ...(asDraft ? { status: 'DRAFT' } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Une erreur est survenue');
      }
      onSaved();
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl my-4 flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center shrink-0 sticky top-0 bg-white z-10 rounded-t-xl">
          <h2 className="text-[16px] font-bold text-gray-900">
            {isEdit ? `Modifier ${invoice.title} ${numberDisplay}` : 'Nouveau document'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* ---- 1. Choix ---- */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-5 border-b border-gray-200">
            <Choice
              label="Type de document"
              hint={documentKind === 'AUTRE_NON_FACTURABLE' ? 'Non pris en compte dans le solde du client (Clients et Tableau de bord).' : undefined}
            >
              <select
                value={documentKind}
                onChange={e => {
                  const kind = e.target.value;
                  setDocumentKind(kind);
                  if (!isEdit) {
                    // Don't carry the sequence number onto a free document, nor
                    // a typed reference back onto a legal one.
                    setNumber(kind !== 'FACTURE_LEGALE' ? '' : sequenceNumber);
                  }
                  // A legal invoice only offers the standard titles; a free one
                  // carried over from "Autre document" would display as blank
                  // while still being saved.
                  if (kind === 'FACTURE_LEGALE' && !TITLES.includes(title)) setTitle(TITLES[0]);
                }}
                className={SELECT_CLS}
              >
                {DOCUMENT_KINDS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </Choice>
            <Choice label="Mode de facturation" hint={BILLING_MODES.find(m => m.id === billingMode)?.hint}>
              <select value={billingMode} onChange={e => setBillingMode(e.target.value)} className={SELECT_CLS}>
                {BILLING_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Choice>
            <Choice
              label="Régime de TVA"
              hint={suspended ? 'Aucune TVA n’est appliquée sur ce document.' : exported ? 'Vente à l’export — Total TVA à 0,000.' : undefined}
            >
              <select value={vatRegime} onChange={e => setVatRegime(e.target.value)} className={SELECT_CLS}>
                {VAT_REGIMES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </Choice>
          </div>

          {suspended && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-5 border-b border-gray-200 -mt-2">
              <Choice label="N° Attestation">
                <input
                  type="text"
                  value={attestationNumber}
                  onChange={e => setAttestationNumber(e.target.value)}
                  className={SELECT_CLS}
                  placeholder="xxxxxxxxx"
                />
              </Choice>
              <Choice label="Date de l'attestation">
                <input
                  type="date"
                  value={attestationDate}
                  onChange={e => setAttestationDate(e.target.value)}
                  className={SELECT_CLS}
                />
              </Choice>
              <Choice label="N° Bon de commande">
                <input
                  type="text"
                  value={bonCommandeNumber}
                  onChange={e => setBonCommandeNumber(e.target.value)}
                  className={SELECT_CLS}
                  placeholder="xxxxxxxxx"
                />
              </Choice>
            </div>
          )}

          {/* ---- 2. En-tête ---- */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="w-24 h-16 border border-dashed border-gray-300 rounded-lg flex items-center justify-center overflow-hidden bg-gray-50">
                {logo
                  ? <img src={logo} alt="Logo" className="max-w-full max-h-full object-contain" />
                  : <Upload className="w-5 h-5 text-gray-300" />}
              </div>
              <p className="text-[10.5px] text-gray-400 mt-1 max-w-[240px]">
                Le logo est repris des Informations de facturation.
              </p>
            </div>

            <div className="text-right">
              {documentKind !== 'FACTURE_LEGALE' ? (
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Désignation du document"
                  className="text-[20px] font-bold text-gray-900 text-right border-b border-dashed border-gray-300 focus:outline-none focus:border-gray-600 bg-transparent"
                />
              ) : (
                <select
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="text-[20px] font-bold text-gray-900 text-right bg-transparent focus:outline-none cursor-pointer"
                >
                  {TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
              {freeNumber ? (
                <>
                  <div className="flex items-center justify-end gap-2 mt-1">
                    <label className="text-[13px] text-gray-500">Numéro</label>
                    <input
                      value={number}
                      onChange={e => setNumber(e.target.value)}
                      placeholder="Ex: BL-2026-014"
                      className="w-40 px-2 py-1 border border-gray-300 rounded-lg text-[13px] font-mono font-bold text-right text-gray-900 focus:ring-2 focus:ring-navy focus:border-transparent"
                    />
                  </div>
                  <p className="text-[10.5px] text-gray-400">Libre — hors séquence des factures</p>
                </>
              ) : (
                <>
                  <div className="text-[13px] text-gray-500 mt-1">
                    Numéro <span className="font-mono font-bold text-gray-900">{numberDisplay}</span>
                  </div>
                  <p className="text-[10.5px] text-gray-400">Généré automatiquement, séquentiel</p>
                </>
              )}
            </div>
          </div>

          {/* ---- 3. Client + document ---- */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="border border-gray-200 rounded-xl p-4">
              <h3 className="text-[12px] font-bold text-gray-700 uppercase tracking-wide mb-3">Détails du client</h3>

              <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                Raison sociale <span className="text-red-500">*</span>
              </label>
              {/* Sans fichier clients (offre Facturation), un champ simple :
                  une loupe qui ne cherche nulle part et une liste
                  systématiquement vide se liraient comme une panne. */}
              {hasClientDirectory ? (
                <div className="relative mb-3">
                  <div className="flex items-center border border-gray-300 rounded-lg bg-white focus-within:border-gray-500">
                    <Search className="w-3.5 h-3.5 text-gray-400 ml-2.5" />
                    <input
                      value={clientSearch}
                      onChange={e => {
                        setClientSearch(e.target.value);
                        setDropdownOpen(true);
                        if (client && e.target.value !== client.name) setClient(null);
                      }}
                      onFocus={() => setDropdownOpen(true)}
                      placeholder="Rechercher un client…"
                      className="w-full px-2 py-2 text-[13px] focus:outline-none bg-transparent rounded-lg"
                    />
                  </div>
                  {dropdownOpen && !client && clientSearch.trim().length >= 1 && (
                    <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {clientResults.length > 0 ? clientResults.map(c => (
                        <div
                          key={c.id}
                          onClick={() => selectClient(c)}
                          className="px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50 cursor-pointer"
                        >
                          {c.name}
                        </div>
                      )) : (
                        <div className="px-3 py-2 text-[12px] text-gray-500 italic">Aucun client trouvé.</div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <input
                  value={clientSearch}
                  onChange={e => setClientSearch(e.target.value)}
                  placeholder="Nom du client"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] mb-3"
                />
              )}

              <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                Matricule fiscal <span className="text-red-500">*</span>
              </label>
              <input
                value={clientTaxId}
                onChange={e => setClientTaxId(e.target.value)}
                placeholder={hasClientDirectory ? 'Repris de la fiche client' : 'Matricule fiscal du client'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] mb-3"
              />

              <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                Adresse <span className="text-red-500">*</span>
              </label>
              <textarea
                value={clientAddress}
                onChange={e => setClientAddress(e.target.value)}
                rows={2}
                placeholder={hasClientDirectory ? 'Reprise de la fiche client' : 'Adresse du client'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] resize-none"
              />
              <p className="text-[10.5px] text-gray-400 mt-1">
                {hasClientDirectory
                  ? 'Matricule fiscal et adresse sont renseignés automatiquement depuis la fiche client.'
                  : 'Raison sociale, matricule fiscal et adresse se saisissent ici, sur le document.'}
              </p>

              {customFields.map((f, i) => (
                <div key={i} className="flex gap-2 mt-2">
                  <input
                    value={f.label}
                    onChange={e => setCustomFields(prev => prev.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))}
                    placeholder="Libellé"
                    className="w-1/3 px-2 py-1.5 border border-gray-300 rounded-lg text-[12px]"
                  />
                  <input
                    value={f.value}
                    onChange={e => setCustomFields(prev => prev.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x))}
                    placeholder="Valeur"
                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-[12px]"
                  />
                  <button
                    onClick={() => setCustomFields(prev => prev.filter((_, idx) => idx !== i))}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setCustomFields(prev => [...prev, { label: '', value: '' }])}
                className="mt-2 text-[12px] font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Ajouter un champ
              </button>
            </div>

            <div className="border border-gray-200 rounded-xl p-4">
              <h3 className="text-[12px] font-bold text-gray-700 uppercase tracking-wide mb-3">Détails du document</h3>

              <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                Date de création <span className="text-red-500">*</span>
              </label>
              <div className="relative mb-1">
                <Calendar className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="date"
                  value={issueDate}
                  onChange={e => setIssueDate(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-[13px]"
                />
              </div>
              {dateWarning && (
                <p className="text-[11px] text-amber-700 flex items-start gap-1 mb-3">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  {dateWarning}
                </p>
              )}

              <div className="flex items-center justify-between mt-3 mb-1">
                <label className="text-[12px] font-semibold text-gray-700">Date d'échéance</label>
                <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                  <input type="checkbox" checked={showDueDate} onChange={e => setShowDueDate(e.target.checked)} className="rounded border-gray-300" />
                  Afficher
                </label>
              </div>
              {showDueDate && (
                <div className="relative">
                  <Calendar className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-[13px]"
                  />
                </div>
              )}
              <p className="text-[10.5px] text-gray-400 mt-1">Optionnel — peut être masqué sur le document.</p>

              {banks.length > 0 && (
                <div className="mt-3">
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Banque de règlement</label>
                  <select
                    value={bankId}
                    onChange={e => setBankId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] bg-white"
                  >
                    {banks.map(b => (
                      <option key={b.id} value={b.id}>{b.name || 'Banque sans nom'}</option>
                    ))}
                  </select>
                  <p className="text-[10.5px] text-gray-400 mt-1">RIB/IBAN affichés sur ce document.</p>
                </div>
              )}

              <div className="mt-3">
                <label className="block text-[12px] font-semibold text-gray-700 mb-1">Devise</label>
                <select
                  value={currency === 'TND' ? 'TND' : 'AUTRE'}
                  onChange={e => setCurrency(e.target.value === 'TND' ? 'TND' : '')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] bg-white"
                >
                  <option value="TND">Dinar tunisien (DT)</option>
                  <option value="AUTRE">Autre devise</option>
                </select>
                {currency !== 'TND' && (
                  <input
                    value={currency}
                    onChange={e => setCurrency(e.target.value.toUpperCase().slice(0, 12))}
                    placeholder="Ex: USD, EUR, GBP…"
                    className="w-full mt-1.5 px-3 py-2 border border-gray-300 rounded-lg text-[13px] font-mono"
                  />
                )}
              </div>
            </div>
          </div>

          {/* ---- 4. Lignes ---- */}
          <div>
            <h3 className="text-[12px] font-bold text-gray-700 uppercase tracking-wide mb-2">Lignes</h3>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                    <th className="px-3 py-2 font-semibold">Désignation</th>
                    {detailed && <th className="px-3 py-2 font-semibold w-24">Quantité</th>}
                    {detailed && <th className="px-3 py-2 font-semibold w-32">Prix unitaire</th>}
                    <th className="px-3 py-2 font-semibold w-28">TVA</th>
                    <th className="px-3 py-2 font-semibold w-36 text-right">Montant HT</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <textarea
                          value={l.designation}
                          onChange={e => setLine(i, { designation: e.target.value })}
                          placeholder="Ex: Mission de conseil"
                          rows={2}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-[13.5px] resize-y"
                        />
                      </td>
                      {detailed && (
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" step="0.01"
                            value={l.quantity}
                            onChange={e => setLine(i, { quantity: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded text-[12.5px]"
                          />
                        </td>
                      )}
                      {detailed && (
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" step="0.001"
                            value={l.unitPrice}
                            onChange={e => setLine(i, { unitPrice: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded text-[12.5px]"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <select
                          value={l.vatExempt ? 'NS' : String(l.vatRate)}
                          onChange={e => {
                            const v = e.target.value;
                            if (v === 'NS') setLine(i, { vatRate: 0, vatExempt: true });
                            else setLine(i, { vatRate: parseFloat(v), vatExempt: false });
                          }}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-[12.5px] bg-white"
                        >
                          {VAT_RATES.map(r => <option key={r} value={r}>{(r * 100).toFixed(0)} %</option>)}
                          <option value="NS">Non soumis</option>
                        </select>
                        {suspended && (
                          <p className="text-[10px] text-gray-400 mt-0.5">Indicatif — non facturé</p>
                        )}
                        {!suspended && l.vatExempt && (
                          <p className="text-[10px] text-gray-400 mt-0.5">Hors champ de la TVA</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {detailed ? (
                          <span className="font-mono text-gray-900">{money(lineHT(l))}</span>
                        ) : (
                          <input
                            type="number" min="0" step="0.001"
                            value={l.montantHT}
                            onChange={e => setLine(i, { montantHT: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded text-[12.5px] text-right"
                          />
                        )}
                      </td>
                      <td className="px-2">
                        {lines.length > 1 && (
                          <button
                            onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Supprimer la ligne"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2 bg-gray-50 border-t border-gray-100">
                <button
                  onClick={() => setLines(prev => [...prev, emptyLine()])}
                  className="text-[12px] font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Ajouter ligne
                </button>
              </div>
            </div>
          </div>

          {/* ---- 5. Récapitulatif TVA + totaux ---- */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              {!suspended && totals.breakdown.length > 0 && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                        <th className="px-3 py-2 font-semibold">TVA</th>
                        <th className="px-3 py-2 font-semibold text-right">Base</th>
                        <th className="px-3 py-2 font-semibold text-right">Montant</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {totals.breakdown.map(b => (
                        <tr key={b.rate}>
                          <td className="px-3 py-2">{(b.rate * 100).toFixed(0)} %</td>
                          <td className="px-3 py-2 text-right font-mono">{money(b.base)}</td>
                          <td className="px-3 py-2 text-right font-mono">{money(b.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {suspended && (
                <div className="border border-dashed border-gray-300 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 text-[11.5px] text-gray-500 bg-gray-50 border-b border-gray-200">
                    Suspension de TVA — aucune TVA n'est facturée. Détail ci-dessous à titre indicatif uniquement.
                  </div>
                  {totals.indicativeBreakdown.length > 0 && (
                    <table className="w-full text-left text-[12.5px]">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                          <th className="px-3 py-2 font-semibold">TVA</th>
                          <th className="px-3 py-2 font-semibold text-right">Base</th>
                          <th className="px-3 py-2 font-semibold text-right">Montant</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {totals.indicativeBreakdown.map(b => (
                          <tr key={b.rate}>
                            <td className="px-3 py-2">{(b.rate * 100).toFixed(0)} %</td>
                            <td className="px-3 py-2 text-right font-mono">{money(b.base)}</td>
                            <td className="px-3 py-2 text-right font-mono">{money(b.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="px-4 py-2 text-[12px] text-gray-600 border-t border-gray-200">
                    Total TVA à titre indicatif : <span className="font-mono font-semibold">{money(totals.indicativeTotal)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 text-[12.5px]">
              {[
                ['Total HT', money(totals.ht)],
                ['Total TVA', money(totals.tva)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between px-4 py-2">
                  <span className="text-gray-600">{label}</span>
                  <span className="font-mono text-gray-900">{value}</span>
                </div>
              ))}
              <div className="flex justify-between px-4 py-2 bg-gray-50">
                <span className="font-semibold text-gray-800">Total TTC</span>
                <span className="font-mono font-bold text-gray-900">{money(totals.ttc)}</span>
              </div>

              <div className="flex justify-between items-center px-4 py-2">
                <label className="flex items-center gap-1.5 text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showWithholding}
                    onChange={e => setShowWithholding(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Taux de la retenue à la source
                </label>
                <select
                  value={withholdingRate}
                  onChange={e => setWithholdingRate(parseFloat(e.target.value))}
                  className="px-2 py-1 border border-gray-300 rounded text-[12px] bg-white ml-auto"
                >
                  {WITHHOLDING_RATES.map(r => (
                    <option key={r} value={r}>{(r * 100).toLocaleString('fr-FR')} %</option>
                  ))}
                </select>
              </div>
              {!showWithholding && (
                <p className="px-4 pb-1 -mt-1 text-[10.5px] text-gray-400">
                  Masquée sur le document — le montant net n'est pas calculé avec cette retenue.
                </p>
              )}
              <div className="flex justify-between px-4 py-2">
                <span className="text-gray-600">Montant de la retenue à la source</span>
                <span className="font-mono text-gray-900">− {money(totals.rsAmount)}</span>
              </div>
              <div className="flex justify-between items-center px-4 py-2">
                <label className="flex items-center gap-1.5 text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showStampDuty}
                    onChange={e => setShowStampDuty(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Timbre fiscal
                </label>
                <input
                  type="number" min="0" step="0.001"
                  value={stampDuty}
                  onChange={e => setStampDuty(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  className="w-24 px-2 py-1 border border-gray-300 rounded text-[12px] text-right"
                />
              </div>
              {!showStampDuty && (
                <p className="px-4 pb-1 -mt-1 text-[10.5px] text-gray-400">
                  Masqué sur le document — le montant net n'est pas calculé avec ce timbre.
                </p>
              )}
              <div className="flex justify-between px-4 py-2 bg-gray-50">
                <span className="font-semibold text-gray-800">Net à payer</span>
                <span className="font-mono font-bold text-gray-900">{money(totals.net)}</span>
              </div>

              <div className="px-4 py-2 space-y-2">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                      <input type="checkbox" checked={showDisbursements} onChange={e => setShowDisbursements(e.target.checked)} className="rounded border-gray-300" />
                      Remboursement de débours
                    </label>
                    {showDisbursements && debLines.length > 1 && (
                      <span className="font-mono text-[12px] text-gray-700">{money(totals.deb)}</span>
                    )}
                  </div>
                  {showDisbursements && (
                    <div className="mt-1.5 space-y-1.5">
                      {debLines.map((l, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={l.label}
                            onChange={e => setDebLine(i, { label: e.target.value })}
                            maxLength={DISBURSEMENT_LABEL_MAX}
                            placeholder="Indication (facultatif) — ex : frais de greffe"
                            className="flex-1 min-w-0 px-2 py-1 border border-gray-200 rounded text-[11.5px]"
                          />
                          <input
                            type="number" min="0" step="0.001"
                            value={l.amount}
                            onChange={e => setDebLine(i, { amount: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                            className="w-24 shrink-0 px-2 py-1 border border-gray-300 rounded text-[12px] text-right"
                          />
                          <button
                            type="button"
                            onClick={() => removeDebLine(i)}
                            disabled={debLines.length <= 1}
                            title={debLines.length <= 1
                              ? 'Décochez « Remboursement de débours » pour retirer le bloc'
                              : 'Retirer cette ligne'}
                            className="shrink-0 p-1 text-gray-400 hover:text-late-fg disabled:opacity-30 disabled:hover:text-gray-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      {debLines.length < DISBURSEMENT_LINES_MAX && (
                        <button
                          type="button"
                          onClick={addDebLine}
                          className="flex items-center gap-1 text-[11px] text-navy hover:underline"
                        >
                          <Plus className="w-3 h-3" />
                          Ajouter une ligne de débours
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                    <input type="checkbox" checked={showAdvances} onChange={e => setShowAdvances(e.target.checked)} className="rounded border-gray-300" />
                    Moins avances perçues
                  </label>
                  {showAdvances && (
                    <input
                      type="number" min="0" step="0.001"
                      value={advances}
                      onChange={e => setAdvances(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      className="w-24 px-2 py-1 border border-gray-300 rounded text-[12px] text-right"
                    />
                  )}
                </div>
              </div>

              <div className="flex justify-between px-4 py-3 bg-navy text-white rounded-b-xl">
                <span className="font-bold">Montant de facture</span>
                <span className="font-mono font-bold">{money(totals.totalNet)} {CURRENCY_SUFFIX[currency] || currency}</span>
              </div>
            </div>
          </div>

          {/* ---- 6. Mention en toutes lettres ---- */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-[12.5px] text-gray-800 leading-relaxed">
              Arrêtée la présente <span className="font-semibold">{title.toLowerCase()}</span> à un montant total TTC
              net de{' '}
              <span className="font-semibold">
                {currency === 'TND'
                  ? amountToFrenchWords(totals.totalNet)
                  : `${money(totals.totalNet)} ${CURRENCY_SUFFIX[currency] || currency}`}
              </span>.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white rounded-b-xl">
          {error && (
            <div className="mb-3 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-100 bg-white"
          >
            Annuler
          </button>
          {/* Le brouillon n'existe qu'à la création : préparer un document
              sans consommer de numéro de la séquence légale. Une fois émis,
              on ne revient pas en arrière. */}
          {!isEdit && (
            <button
              onClick={() => handleSave(true)}
              disabled={isSaving}
              className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-100 bg-white flex items-center gap-2 disabled:opacity-50"
              title="Prépare le document sans lui attribuer de numéro. Il en prendra un à l'émission."
            >
              <FileClock className="w-4 h-4" />
              Enregistrer comme brouillon
            </button>
          )}
          <button
            onClick={() => handleSave(false)}
            disabled={isSaving}
            className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving && <Loader className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Enregistrer' : 'Créer le document'}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
};
