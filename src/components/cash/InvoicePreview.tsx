import React, { useEffect, useState } from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { X, Printer, Download, Pencil, Trash2 } from 'lucide-react';
import { amountToFrenchWords } from '../../utils/amountToWords';
import { useAuth } from '../../context/AuthContext';
import { downloadInvoicePdf, printInvoicePdf, CompanyBlock } from './invoicePdf';

const money = (v: number) =>
  (v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const CURRENCY_SUFFIX: Record<string, string> = { TND: 'DT', USD: 'USD', EUR: 'EUR' };

/** Payment/attestation dates are stored ISO; documents read DD/MM/YYYY throughout. */
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

/** Module scope: see the note in InvoiceEditor about remounting. */
const Row: React.FC<{ label: string; value: string; strong?: boolean; muted?: boolean }> = ({ label, value, strong, muted }) => (
  <div className={`flex justify-between px-4 py-2 ${strong ? 'bg-gray-50' : ''}`}>
    <span className={strong ? 'font-semibold text-gray-800' : 'text-gray-600'}>{label}</span>
    <span className={`font-mono ${strong ? 'font-bold text-gray-900' : muted ? 'text-gray-500' : 'text-gray-900'}`}>{value}</span>
  </div>
);

interface InvoicePreviewProps {
  invoice: any;
  onClose: () => void;
  /** Present only when the viewer may modify documents. */
  onEdit?: (invoice: any) => void;
  onDelete?: (invoice: any) => void;
}

/** The issued document, laid out as described in the cahier des charges. */
export const InvoicePreview: React.FC<InvoicePreviewProps> = ({ invoice, onClose, onEdit, onDelete }) => {
  useEscapeToClose(onClose);
  const { token } = useAuth();
  const suspended = invoice.vatRegime === 'SUSPENSION';
  const detailed = invoice.billingMode === 'DETAILLEE';
  const custom = Object.entries(invoice.customFields || {});
  const currency = invoice.currency || 'TND';
  const currencySuffix = CURRENCY_SUFFIX[currency] || currency;

  // The issuer block belongs on every document, so it is loaded once here and
  // handed to the PDF as well as rendered below.
  const [block, setBlock] = useState<CompanyBlock | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/cash/company', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(body => { if (!cancelled && body) setBlock(body); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm overflow-y-auto print:static print:bg-white print:p-0">
      <div id="invoice-print" className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-4">
        <div className="no-print px-5 py-3 border-b border-gray-100 flex flex-wrap gap-2 justify-between items-center">
          <h2 className="text-[14px] font-bold text-gray-900">
            {invoice.title} {displayNumber(invoice)}
          </h2>
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                onClick={() => onEdit(invoice)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
              >
                <Pencil className="w-3.5 h-3.5" /> Modifier
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(invoice)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-[12px] font-medium text-red-600 hover:bg-red-50 flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" /> Supprimer
              </button>
            )}
            <button
              onClick={() => downloadInvoicePdf(invoice, block)}
              title="Enregistrer le document sur votre poste"
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Télécharger PDF
            </button>
            <button
              onClick={() => printInvoicePdf(invoice, block)}
              title="Imprimer — choisissez « Enregistrer au format PDF » pour obtenir un PDF"
              className="px-3 py-1.5 bg-navy text-white rounded-lg text-[12px] font-medium hover:bg-navy-hover flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" /> Imprimer / PDF
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-8 space-y-6">
          <div className="flex items-start justify-between gap-6">
            {/* Header carries the company name alone, in bold, stacked under
                the logo — address, MF and contact details are printed once in
                the footer below. */}
            <div className="text-[11px] text-gray-400 flex flex-col items-start gap-2">
              {block?.logo ? (
                <img src={block.logo} alt="Logo" className="max-h-16 max-w-40 object-contain" />
              ) : (
                <div className="w-24 h-16 border border-dashed border-gray-200 rounded flex items-center justify-center shrink-0">Logo</div>
              )}
              {block?.company?.name && (
                <div className="text-[15px] font-bold text-gray-900">{block.company.name}</div>
              )}
            </div>
            <div className="text-right">
              <div className="text-[24px] font-bold text-gray-900 tracking-tight">{invoice.title}</div>
              <div className="text-[13px] text-gray-500 mt-0.5">
                N° <span className="font-mono font-bold text-gray-900">{displayNumber(invoice)}</span>
              </div>
              {suspended && (
                <div className="text-[11px] text-gray-500 mt-2 leading-snug">
                  <div className="font-semibold text-gray-700">Vente en suspension de la TVA</div>
                  <div>Selon Attestation N° {invoice.attestationNumber || 'xxxxxxxxx'} du {invoice.attestationDate ? frDate(invoice.attestationDate) : 'jj/mm/aa'}</div>
                  <div>Et bon de commande N°{invoice.bonCommandeNumber || 'xxxxxxxxx'}</div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 text-[12.5px]">
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Détails du client</div>
              <div className="font-semibold text-gray-900">{invoice.clientName}</div>
              <div className="text-gray-600 mt-1">Matricule fiscal : {invoice.clientTaxId || '—'}</div>
              <div className="text-gray-600 whitespace-pre-line">Adresse : {invoice.clientAddress || '—'}</div>
              {custom.map(([label, value]) => (
                <div key={label} className="text-gray-600">{label} : {String(value)}</div>
              ))}
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Détails du document</div>
              <div className="text-gray-600">Date de création : <span className="text-gray-900">{invoice.issueDate}</span></div>
              {invoice.showDueDate && invoice.dueDate && (
                <div className="text-gray-600">Date d'échéance : <span className="text-gray-900">{invoice.dueDate}</span></div>
              )}
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="px-3 py-2 font-semibold">Désignation</th>
                  {detailed && <th className="px-3 py-2 font-semibold text-right">Qté</th>}
                  {detailed && <th className="px-3 py-2 font-semibold text-right">P.U.</th>}
                  <th className="px-3 py-2 font-semibold text-right">TVA</th>
                  <th className="px-3 py-2 font-semibold text-right">Montant HT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(invoice.lines || []).map((l: any, i: number) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-[13.5px] text-gray-900 whitespace-pre-wrap break-words">{l.designation}</td>
                    {detailed && <td className="px-3 py-2 text-right font-mono text-gray-600">{l.quantity}</td>}
                    {detailed && <td className="px-3 py-2 text-right font-mono text-gray-600">{money(l.unitPrice)}</td>}
                    <td className="px-3 py-2 text-right text-gray-600">{l.vatExempt ? 'Non soumis' : `${(l.vatRate * 100).toFixed(0)} %`}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-900">{money(l.montantHT)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              {!suspended && (invoice.vatBreakdown || []).length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                        <th className="px-3 py-2 font-semibold">TVA</th>
                        <th className="px-3 py-2 font-semibold text-right">Base</th>
                        <th className="px-3 py-2 font-semibold text-right">Montant</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {invoice.vatBreakdown.map((b: any) => (
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
                <div className="border border-dashed border-gray-300 rounded-lg overflow-hidden">
                  {(invoice.indicativeVatBreakdown || []).length > 0 && (
                    <table className="w-full text-left text-[12px]">
                      <thead>
                        <tr className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                          <th className="px-3 py-2 font-semibold">TVA</th>
                          <th className="px-3 py-2 font-semibold text-right">Base</th>
                          <th className="px-3 py-2 font-semibold text-right">Montant</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {invoice.indicativeVatBreakdown.map((b: any) => (
                          <tr key={b.rate}>
                            <td className="px-3 py-2">{(b.rate * 100).toFixed(0)} %</td>
                            <td className="px-3 py-2 text-right font-mono">{money(b.base)}</td>
                            <td className="px-3 py-2 text-right font-mono">{money(b.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="px-3 py-2 text-[12px] text-gray-500 border-t border-gray-200">
                    Total TVA à titre indicatif : <span className="font-mono">{money(invoice.indicativeVatTotal || 0)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 text-[12.5px]">
              <Row label="Total HT" value={money(invoice.totalHT)} />
              <Row label="Total TVA" value={money(invoice.totalVAT)} />
              <Row label="Total TTC" value={money(invoice.totalTTC)} strong />
              {invoice.showWithholding !== false && (
                <Row label={`Retenue à la source — ${(invoice.withholdingRate * 100).toLocaleString('fr-FR')} %`} value={`− ${money(invoice.withholdingAmount)}`} />
              )}
              {invoice.showStampDuty !== false && (
                <Row label="Timbre fiscal" value={money(invoice.stampDuty)} />
              )}
              <Row label="Net à payer" value={money(invoice.netToPay)} strong />
              {invoice.disbursements > 0 && <Row label="Remboursement de débours" value={`+ ${money(invoice.disbursements)}`} />}
              {invoice.advances > 0 && <Row label="Moins avances perçues" value={`− ${money(invoice.advances)}`} />}
              <div className="flex justify-between px-4 py-3 bg-navy text-white">
                <span className="font-bold">Montant de facture</span>
                <span className="font-mono font-bold">{money(invoice.totalNetToPay)} {currencySuffix}</span>
              </div>
            </div>
          </div>

          <p className="text-[12.5px] text-gray-800 leading-relaxed border-t border-gray-200 pt-4">
            Arrêtée la présente <span className="font-semibold">{(invoice.title || '').toLowerCase()}</span> à un
            montant total TTC net de{' '}
            <span className="font-semibold">
              {currency === 'TND' ? amountToFrenchWords(invoice.totalNetToPay) : `${money(invoice.totalNetToPay)} ${currencySuffix}`}
            </span>.
          </p>

          {/* Issuer footer — the same block the PDF prints, so the screen and
              the file agree. */}
          <div className="border-t border-gray-200 pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-[11px]">
            <div>
              <div className="font-bold text-gray-400 uppercase tracking-[0.05em] text-[9.5px] mb-1">
                Informations de l'entreprise
              </div>
              {block?.company?.name ? (
                <div className="text-gray-700 leading-relaxed">
                  <div className="font-semibold text-gray-900">{block.company.name}</div>
                  {block.company.address && <div>{block.company.address}</div>}
                  {block.company.taxId && <div>MF: {block.company.taxId}</div>}
                  {block.company.email && <div>{block.company.email}</div>}
                  {block.company.phone && <div>{block.company.phone}</div>}
                </div>
              ) : (
                <div className="text-gray-300 italic">Non renseignées</div>
              )}
            </div>

            <div>
              <div className="font-bold text-gray-400 uppercase tracking-[0.05em] text-[9.5px] mb-1">
                Informations bancaires
              </div>
              {(() => {
                const selectedBank = block?.banks?.find(b => b.id === invoice?.bankId);
                const defaultBank = selectedBank || block?.banks?.find(b => b.id === block.defaultBankId) || block?.banks?.[0];
                return (
                  <div className="text-gray-700 leading-relaxed">
                    <div>Banque : {defaultBank?.name || <span className="text-gray-300">—</span>}</div>
                    {defaultBank?.rib && <div className="font-mono break-all">RIB : {defaultBank.rib}</div>}
                    <div className="font-mono break-all">
                      IBAN : {defaultBank?.iban || <span className="text-gray-300 font-sans">—</span>}
                    </div>
                    {defaultBank?.swift && <div className="font-mono break-all">SWIFT : {defaultBank.swift}</div>}
                  </div>
                );
              })()}
            </div>

            <div className="sm:text-right">
              {block?.showSignature !== false && (block?.signature || block?.stamp) ? (
                <div className="flex sm:justify-end gap-2">
                  {block.stamp && <img src={block.stamp} alt="Cachet" className="h-14 inline-block object-contain" />}
                  {block.signature && <img src={block.signature} alt="Signature" className="h-14 inline-block object-contain" />}
                </div>
              ) : (
                <div className="text-gray-300 italic">Aucune signature</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
