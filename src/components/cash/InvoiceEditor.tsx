import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Plus, Trash2, Loader, Search, Upload, Calendar, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { amountToFrenchWords } from '../../utils/amountToWords';

/** Choices from the cahier des charges. */
const DOCUMENT_KINDS = [
  { id: 'FACTURE_LEGALE', label: 'Facture légale' },
  { id: 'AUTRE', label: 'Autre document' },
];
const BILLING_MODES = [
  { id: 'FORFAIT', label: 'Facturation au Forfait', hint: 'Masque Quantité et Prix Unitaire — la Désignation et le Montant HT sont saisis directement.' },
  { id: 'DETAILLEE', label: 'Facturation Détaillée (Temps / Quantité)', hint: 'Le Montant HT est calculé à partir de la Quantité et du Prix Unitaire.' },
];
const VAT_REGIMES = [
  { id: 'DROIT_COMMUN', label: 'Régime de Droit Commun (Facture avec TVA)' },
  { id: 'SUSPENSION', label: 'Suspension de TVA' },
];
const VAT_RATES = [0, 0.07, 0.13, 0.19];
const WITHHOLDING_RATES = [0, 0.01, 0.015, 0.03];
/** Suggested titles; "Autre document" allows a free one. */
const TITLES = ['Facture', "Note d'honoraires"];

interface Line {
  designation: string;
  quantity: number | '';
  unitPrice: number | '';
  vatRate: number;
  montantHT: number | '';
}

const emptyLine = (): Line => ({ designation: '', quantity: 1, unitPrice: '', vatRate: 0.19, montantHT: '' });

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
  const isEdit = !!invoice;
  const { token } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // --- selectors -----------------------------------------------------------
  const [documentKind, setDocumentKind] = useState(invoice?.documentKind ?? 'FACTURE_LEGALE');
  const [billingMode, setBillingMode] = useState(invoice?.billingMode ?? 'FORFAIT');
  const [vatRegime, setVatRegime] = useState(invoice?.vatRegime ?? 'DROIT_COMMUN');

  // --- header --------------------------------------------------------------
  const [title, setTitle] = useState(invoice?.title ?? 'Facture');
  const [number, setNumber] = useState(invoice?.number ?? '…');
  /** The next sequence value, kept so switching back from "Autre" restores it. */
  const [sequenceNumber, setSequenceNumber] = useState('…');
  const [lastIssueDate, setLastIssueDate] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);

  // --- client --------------------------------------------------------------
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
          montantHT: l.montantHT ?? '',
        }))
      : [emptyLine()]);
  const [withholdingRate, setWithholdingRate] = useState(invoice?.withholdingRate ?? 0.01);
  const [stampDuty, setStampDuty] = useState<number | ''>(invoice?.stampDuty ?? 1);
  const [showDisbursements, setShowDisbursements] = useState(!!invoice?.disbursements);
  const [disbursements, setDisbursements] = useState<number | ''>(invoice?.disbursements || '');
  const [showAdvances, setShowAdvances] = useState(!!invoice?.advances);
  const [advances, setAdvances] = useState<number | ''>(invoice?.advances || '');

  // Encaissements: what the client has actually paid, possibly in several
  // instalments on different dates. The server owns the derived totals; these
  // rows are only the input.
  const [payments, setPayments] = useState<{ id: string; amount: number | ''; date: string; note: string }[]>(
    (invoice?.payments ?? []).map((pay: any) => ({
      id: String(pay.id), amount: pay.amount ?? '', date: pay.date ?? '', note: pay.note ?? '',
    })),
  );
  const addPayment = () => setPayments(prev => [
    ...prev,
    { id: `pay-${Date.now()}-${prev.length}`, amount: '', date: new Date().toISOString().slice(0, 10), note: '' },
  ]);
  const updatePayment = (id: string, patch: Partial<{ amount: number | ''; date: string; note: string }>) =>
    setPayments(prev => prev.map(pay => (pay.id === id ? { ...pay, ...patch } : pay)));
  const removePayment = (id: string) => setPayments(prev => prev.filter(pay => pay.id !== id));

  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const suspended = vatRegime === 'SUSPENSION';
  const detailed = billingMode === 'DETAILLEE';
  /** "Autre document" is outside the legal sequence, so its number is typed. */
  const freeNumber = documentKind === 'AUTRE';

  useEffect(() => {
    if (isEdit) return; // an issued document keeps its number
    (async () => {
      try {
        const res = await fetch('/api/invoices/meta/next-number', { headers: authHeaders });
        if (res.ok) {
          const body = await res.json();
          setSequenceNumber(body.nextNumber);
          setNumber(prev => (documentKind === 'AUTRE' ? prev : body.nextNumber));
          setLastIssueDate(body.lastIssueDate ?? null);
        }
      } catch { /* the number is display-only until save */ }
    })();
  }, []);

  // Client lookup is server-side and debounced — the list is never fully loaded.
  useEffect(() => {
    const term = clientSearch.trim();
    if (term.length < 1 || client) { setClientResults([]); return; }
    let cancelled = false;
    const h = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(term)}&page=1&limit=8`, { headers: authHeaders });
        const body = await res.json();
        if (!cancelled) setClientResults(Array.isArray(body) ? body : (body.data ?? []));
      } catch { if (!cancelled) setClientResults([]); }
    }, 250);
    return () => { cancelled = true; clearTimeout(h); };
  }, [clientSearch, client, token]);

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
    let totalHT = 0;
    for (const l of lines) {
      const ht = lineHT(l);
      totalHT += ht;
      const rate = suspended ? 0 : l.vatRate;
      byRate.set(rate, (byRate.get(rate) || 0) + ht);
    }
    const breakdown = [...byRate.entries()]
      .filter(([r]) => !suspended && r > 0)
      .map(([rate, base]) => ({ rate, base: round3(base), amount: round3(base * rate) }))
      .sort((a, b) => a.rate - b.rate);

    const ht = round3(totalHT);
    const tva = round3(breakdown.reduce((s, b) => s + b.amount, 0));
    const ttc = round3(ht + tva);
    const rsAmount = round3(ttc * withholdingRate);
    const stamp = n(Number(stampDuty));
    const net = round3(ttc - rsAmount + stamp);
    const deb = showDisbursements ? n(Number(disbursements)) : 0;
    const adv = showAdvances ? n(Number(advances)) : 0;
    const totalNet = round3(net + deb - adv);
    const paid = round3(payments.reduce((sum, pay) => sum + n(Number(pay.amount)), 0));
    return { breakdown, ht, tva, ttc, rsAmount, stamp, net, deb, adv, totalNet,
             paid, remaining: round3(totalNet - paid) };
  }, [lines, suspended, detailed, withholdingRate, stampDuty, showDisbursements, disbursements, showAdvances, advances, payments]);

  const dateWarning = !isEdit && lastIssueDate && issueDate < lastIssueDate
    ? `La date doit être postérieure ou égale à celle du dernier document (${lastIssueDate}).`
    : '';

  const handleSave = async () => {
    if (!client) { setError('La raison sociale du client est obligatoire.'); return; }
    if (!clientTaxId.trim()) { setError('Le matricule fiscal est obligatoire.'); return; }
    if (!clientAddress.trim()) { setError("L'adresse est obligatoire."); return; }
    if (!issueDate) { setError('La date de création est obligatoire.'); return; }
    if (freeNumber && !number.trim()) { setError('Le numéro du document est obligatoire.'); return; }
    if (lines.some(l => !l.designation.trim())) { setError('Chaque ligne doit avoir une désignation.'); return; }
    if (dateWarning) { setError(dateWarning); return; }

    setError('');
    setIsSaving(true);
    try {
      const res = await fetch(isEdit ? `/api/invoices/${invoice.id}` : '/api/invoices', {
        method: isEdit ? 'PUT' : 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          documentKind, billingMode, vatRegime, title,
          ...(freeNumber ? { number: number.trim() } : {}),
          clientId: client.id, clientName: client.name,
          clientTaxId, clientAddress,
          customFields: Object.fromEntries(customFields.filter(f => f.label.trim()).map(f => [f.label.trim(), f.value])),
          issueDate, dueDate: showDueDate ? dueDate : '', showDueDate,
          lines: lines.map(l => ({
            designation: l.designation.trim(),
            quantity: detailed ? n(Number(l.quantity)) : 1,
            unitPrice: detailed ? n(Number(l.unitPrice)) : 0,
            vatRate: suspended ? 0 : l.vatRate,
            montantHT: lineHT(l),
          })),
          withholdingRate,
          stampDuty: n(Number(stampDuty)),
          disbursements: totals.deb,
          advances: totals.adv,
          // Rows without a date are drafts the user never finished; the server
          // drops them too, but filtering here keeps the payload honest.
          payments: payments
            .filter(pay => pay.date)
            .map(pay => ({ id: pay.id, amount: n(Number(pay.amount)), date: pay.date, note: pay.note })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Une erreur est survenue');
      }
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl my-4 flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center shrink-0 sticky top-0 bg-white z-10 rounded-t-xl">
          <h2 className="text-[16px] font-bold text-gray-900">
            {isEdit ? `Modifier ${invoice.title} ${invoice.number}` : 'Nouveau document'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* ---- 1. Choix ---- */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-5 border-b border-gray-200">
            <Choice label="Type de document">
              <select
                value={documentKind}
                onChange={e => {
                  const kind = e.target.value;
                  setDocumentKind(kind);
                  if (!isEdit) {
                    // Don't carry the sequence number onto a free document, nor
                    // a typed reference back onto a legal one.
                    setNumber(kind === 'AUTRE' ? '' : sequenceNumber);
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
            <Choice label="Régime de TVA" hint={suspended ? 'Aucune TVA n’est appliquée sur ce document.' : undefined}>
              <select value={vatRegime} onChange={e => setVatRegime(e.target.value)} className={SELECT_CLS}>
                {VAT_REGIMES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </Choice>
          </div>

          {/* ---- 2. En-tête ---- */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <div className="w-24 h-16 border border-dashed border-gray-300 rounded-lg flex items-center justify-center overflow-hidden bg-gray-50">
                  {logo
                    ? <img src={logo} alt="Logo" className="max-w-full max-h-full object-contain" />
                    : <Upload className="w-5 h-5 text-gray-400" />}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => setLogo(String(reader.result));
                    reader.readAsDataURL(file);
                  }}
                />
                <span className="text-[12px] text-blue-600 hover:text-blue-800 font-medium">Télécharger le logo</span>
              </label>
              <p className="text-[10.5px] text-gray-400 mt-1 max-w-[240px]">
                Le logo est normalement repris du compte de la société.
              </p>
            </div>

            <div className="text-right">
              {documentKind === 'AUTRE' ? (
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
                    Numéro <span className="font-mono font-bold text-gray-900">{number}</span>
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

              <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                Matricule fiscal <span className="text-red-500">*</span>
              </label>
              <input
                value={clientTaxId}
                onChange={e => setClientTaxId(e.target.value)}
                placeholder="Repris de la fiche client"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] mb-3"
              />

              <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                Adresse <span className="text-red-500">*</span>
              </label>
              <textarea
                value={clientAddress}
                onChange={e => setClientAddress(e.target.value)}
                rows={2}
                placeholder="Reprise de la fiche client"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] resize-none"
              />
              <p className="text-[10.5px] text-gray-400 mt-1">
                Matricule fiscal et adresse sont renseignés automatiquement depuis la fiche client.
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
                    {!suspended && <th className="px-3 py-2 font-semibold w-28">TVA</th>}
                    <th className="px-3 py-2 font-semibold w-36 text-right">Montant HT</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <input
                          value={l.designation}
                          onChange={e => setLine(i, { designation: e.target.value })}
                          placeholder="Ex: Mission de conseil"
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-[12.5px]"
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
                      {!suspended && (
                        <td className="px-3 py-2">
                          <select
                            value={l.vatRate}
                            onChange={e => setLine(i, { vatRate: parseFloat(e.target.value) })}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded text-[12.5px] bg-white"
                          >
                            {VAT_RATES.map(r => <option key={r} value={r}>{(r * 100).toFixed(0)} %</option>)}
                          </select>
                        </td>
                      )}
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
                <div className="border border-dashed border-gray-300 rounded-xl px-4 py-3 text-[12px] text-gray-500">
                  Suspension de TVA — aucune TVA n'est facturée.
                </div>
              )}
            </div>

            <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 text-[12.5px]">
              {[
                ['Total HT (1)', money(totals.ht)],
                ['Total TVA (2)', money(totals.tva)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between px-4 py-2">
                  <span className="text-gray-600">{label}</span>
                  <span className="font-mono text-gray-900">{value}</span>
                </div>
              ))}
              <div className="flex justify-between px-4 py-2 bg-gray-50">
                <span className="font-semibold text-gray-800">Total TTC (3)</span>
                <span className="font-mono font-bold text-gray-900">{money(totals.ttc)}</span>
              </div>

              <div className="flex justify-between items-center px-4 py-2">
                <span className="text-gray-600">Taux de la retenue à la source (4)</span>
                <select
                  value={withholdingRate}
                  onChange={e => setWithholdingRate(parseFloat(e.target.value))}
                  className="px-2 py-1 border border-gray-300 rounded text-[12px] bg-white"
                >
                  {WITHHOLDING_RATES.map(r => (
                    <option key={r} value={r}>{(r * 100).toLocaleString('fr-FR')} %</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-between px-4 py-2">
                <span className="text-gray-600">Montant de la retenue à la source (5)</span>
                <span className="font-mono text-gray-900">− {money(totals.rsAmount)}</span>
              </div>
              <div className="flex justify-between items-center px-4 py-2">
                <span className="text-gray-600">Timbre fiscal (6)</span>
                <input
                  type="number" min="0" step="0.001"
                  value={stampDuty}
                  onChange={e => setStampDuty(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  className="w-24 px-2 py-1 border border-gray-300 rounded text-[12px] text-right"
                />
              </div>
              <div className="flex justify-between px-4 py-2 bg-gray-50">
                <span className="font-semibold text-gray-800">Net à payer (7)</span>
                <span className="font-mono font-bold text-gray-900">{money(totals.net)}</span>
              </div>

              <div className="px-4 py-2 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                    <input type="checkbox" checked={showDisbursements} onChange={e => setShowDisbursements(e.target.checked)} className="rounded border-gray-300" />
                    Remboursement de débours (8)
                  </label>
                  {showDisbursements && (
                    <input
                      type="number" min="0" step="0.001"
                      value={disbursements}
                      onChange={e => setDisbursements(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      className="w-24 px-2 py-1 border border-gray-300 rounded text-[12px] text-right"
                    />
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                    <input type="checkbox" checked={showAdvances} onChange={e => setShowAdvances(e.target.checked)} className="rounded border-gray-300" />
                    Moins avances perçues (9)
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
                <span className="font-bold">Total net à payer (10)</span>
                <span className="font-mono font-bold">{money(totals.totalNet)} DT</span>
              </div>
            </div>
          </div>

          {/* ---- Encaissements ----
               Sits after (10) on purpose: payments settle the document, they
               are not part of the numbered cascade and must not shift it. */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
              <div>
                <h4 className="text-[12.5px] font-bold text-gray-800">Encaissements</h4>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Un document peut être réglé en plusieurs fois — ajoutez une ligne par versement.
                </p>
              </div>
              <button
                type="button"
                onClick={addPayment}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-white flex items-center gap-1.5 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" /> Ajouter
              </button>
            </div>

            {payments.length === 0 ? (
              <p className="px-4 py-4 text-[12px] text-gray-400 italic">
                Aucun encaissement — le document reste dû en totalité.
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {payments.map(pay => (
                  <div key={pay.id} className="flex flex-wrap items-end gap-3 px-4 py-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-400 mb-1">Montant</label>
                      <input
                        type="number" min="0" step="0.001"
                        value={pay.amount}
                        onChange={e => updatePayment(pay.id, { amount: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                        className="w-32 px-2 py-1.5 border border-gray-300 rounded text-[12px] text-right"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-400 mb-1">Date</label>
                      <input
                        type="date"
                        value={pay.date}
                        onChange={e => updatePayment(pay.id, { date: e.target.value })}
                        className="px-2 py-1.5 border border-gray-300 rounded text-[12px]"
                      />
                    </div>
                    <div className="flex-1 min-w-[140px]">
                      <label className="block text-[10px] font-semibold text-gray-400 mb-1">
                        Référence <span className="font-normal text-gray-300">(facultatif)</span>
                      </label>
                      <input
                        type="text"
                        value={pay.note}
                        onChange={e => updatePayment(pay.id, { note: e.target.value })}
                        placeholder="Ex: virement, chèque n°…"
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-[12px]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removePayment(pay.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                      title="Supprimer cet encaissement"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-6 px-4 py-3 bg-gray-50 border-t border-gray-200 text-[12.5px]">
              <span className="text-gray-600">
                Montant encaissé <span className="font-mono font-bold text-gray-900 ml-1.5">{money(totals.paid)} DT</span>
              </span>
              <span className="text-gray-600">
                Reste à payer
                {/* Negative means the client overpaid — surfaced, not clamped. */}
                <span className={`font-mono font-bold ml-1.5 ${
                  Math.abs(totals.remaining) < 0.001 ? 'text-emerald-700'
                    : totals.remaining < 0 ? 'text-amber-700' : 'text-gray-900'
                }`}>
                  {Math.abs(totals.remaining) < 0.001 ? 'Soldé' : `${money(totals.remaining)} DT`}
                </span>
              </span>
            </div>
          </div>

          {/* ---- 6. Mention en toutes lettres ---- */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-[12.5px] text-gray-800 leading-relaxed">
              Arrêtée la présente <span className="font-semibold">{title.toLowerCase()}</span> à un montant total TTC
              net de <span className="font-semibold">{amountToFrenchWords(totals.totalNet)}</span>.
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
          <button
            onClick={handleSave}
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
