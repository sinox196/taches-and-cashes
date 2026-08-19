import { amountToFrenchWords } from '../../utils/amountToWords';

const money = (v: number) =>
  (v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Filesystem-safe document name, no extension: "Facture-0001-Alpha-SA". */
const documentName = (invoice: any) =>
  [invoice.title, invoice.number, invoice.clientName]
    .filter(Boolean)
    .join('-')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9-_ ]+/g, '')
    .trim().replace(/\s+/g, '-');

/**
 * The document as a self-contained HTML page — the single source for both the
 * saved file and the printed/PDF output, so the two can never diverge. It
 * carries its own print stylesheet and page margins.
 */
function renderInvoiceHtml(invoice: any): string {
  const suspended = invoice.vatRegime === 'SUSPENSION';
  const detailed = invoice.billingMode === 'DETAILLEE';
  const custom = Object.entries(invoice.customFields || {});

  const lineRows = (invoice.lines || []).map((l: any) => `
      <tr>
        <td>${esc(l.designation)}</td>
        ${detailed ? `<td class="num">${esc(l.quantity)}</td>` : ''}
        ${detailed ? `<td class="num">${money(l.unitPrice)}</td>` : ''}
        ${!suspended ? `<td class="num">${(l.vatRate * 100).toFixed(0)} %</td>` : ''}
        <td class="num">${money(l.montantHT)}</td>
      </tr>`).join('');

  const vatRows = (invoice.vatBreakdown || []).map((b: any) => `
      <tr>
        <td>${(b.rate * 100).toFixed(0)} %</td>
        <td class="num">${money(b.base)}</td>
        <td class="num">${money(b.amount)}</td>
      </tr>`).join('');

  const totalRow = (label: string, value: string, strong = false) => `
      <tr class="${strong ? 'strong' : ''}"><td>${esc(label)}</td><td class="num">${value}</td></tr>`;

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${esc(documentName(invoice))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif; color: #101828;
         margin: 0; padding: 32px; font-size: 12.5px; line-height: 1.5; }
  .sheet { max-width: 780px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .logo { width: 96px; height: 64px; border: 1px dashed #e4e7ec; border-radius: 6px;
          display: flex; align-items: center; justify-content: center; color: #98a2b3; font-size: 11px; }
  h1 { font-size: 24px; margin: 0; letter-spacing: -0.01em; }
  .num-label { color: #667085; margin-top: 2px; }
  .cols { display: flex; justify-content: space-between; gap: 24px; margin: 28px 0; }
  .cap { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
         color: #98a2b3; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  .grid { border: 1px solid #e4e7ec; border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
  .grid th { background: #f9fafb; font-size: 10px; text-transform: uppercase; letter-spacing: .06em;
             color: #667085; text-align: left; padding: 8px 12px; border-bottom: 1px solid #e4e7ec; }
  .grid td { padding: 8px 12px; border-bottom: 1px solid #f2f4f7; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals td { padding: 7px 14px; border-bottom: 1px solid #f2f4f7; }
  .totals .strong td { background: #f9fafb; font-weight: 700; }
  .grand { display: flex; justify-content: space-between; background: #101828; color: #fff;
           padding: 12px 14px; font-weight: 700; }
  .mention { border-top: 1px solid #e4e7ec; padding-top: 16px; margin-top: 24px; }
  .two { display: flex; gap: 24px; align-items: flex-start; }
  .two > * { flex: 1; }
  @page { margin: 14mm; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<div class="sheet">
  <div class="head">
    <div class="logo">Logo</div>
    <div style="text-align:right">
      <h1>${esc(invoice.title)}</h1>
      <div class="num-label">N° <strong>${esc(invoice.number)}</strong></div>
    </div>
  </div>

  <div class="cols">
    <div>
      <div class="cap">Détails du client</div>
      <div><strong>${esc(invoice.clientName)}</strong></div>
      <div>Matricule fiscal : ${esc(invoice.clientTaxId) || '—'}</div>
      <div>Adresse : ${esc(invoice.clientAddress) || '—'}</div>
      ${custom.map(([k, v]) => `<div>${esc(k)} : ${esc(v)}</div>`).join('')}
    </div>
    <div style="text-align:right">
      <div class="cap">Détails du document</div>
      <div>Date de création : ${esc(invoice.issueDate)}</div>
      ${invoice.showDueDate && invoice.dueDate ? `<div>Date d'échéance : ${esc(invoice.dueDate)}</div>` : ''}
    </div>
  </div>

  <div class="grid">
    <table>
      <thead><tr>
        <th>Désignation</th>
        ${detailed ? '<th class="num">Qté</th><th class="num">P.U.</th>' : ''}
        ${!suspended ? '<th class="num">TVA</th>' : ''}
        <th class="num">Montant HT</th>
      </tr></thead>
      <tbody>${lineRows}</tbody>
    </table>
  </div>

  <div class="two">
    <div>
      ${!suspended && vatRows
        ? `<div class="grid"><table>
             <thead><tr><th>TVA</th><th class="num">Base</th><th class="num">Montant</th></tr></thead>
             <tbody>${vatRows}</tbody></table></div>`
        : `<div class="grid" style="padding:8px 12px;color:#667085">Suspension de TVA</div>`}
    </div>
    <div class="grid">
      <table class="totals">
        ${totalRow('Total HT (1)', money(invoice.totalHT))}
        ${totalRow('Total TVA (2)', money(invoice.totalVAT))}
        ${totalRow('Total TTC (3)', money(invoice.totalTTC), true)}
        ${totalRow(`Retenue à la source (5) — ${(invoice.withholdingRate * 100).toLocaleString('fr-FR')} %`, '− ' + money(invoice.withholdingAmount))}
        ${totalRow('Timbre fiscal (6)', money(invoice.stampDuty))}
        ${totalRow('Net à payer (7)', money(invoice.netToPay), true)}
        ${invoice.disbursements > 0 ? totalRow('Remboursement de débours (8)', '+ ' + money(invoice.disbursements)) : ''}
        ${invoice.advances > 0 ? totalRow('Moins avances perçues (9)', '− ' + money(invoice.advances)) : ''}
      </table>
      <div class="grand"><span>Total net à payer (10)</span><span>${money(invoice.totalNetToPay)} DT</span></div>
    </div>
  </div>

  <p class="mention">
    Arrêtée la présente <strong>${esc(String(invoice.title || '').toLowerCase())}</strong>
    à un montant total TTC net de <strong>${esc(amountToFrenchWords(invoice.totalNetToPay))}</strong>.
  </p>
</div>
</body>
</html>`;

  return html;
}

/** Saves the document as a standalone HTML file (an offline archive copy). */
export function downloadInvoice(invoice: any): void {
  const blob = new Blob([renderInvoiceHtml(invoice)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = documentName(invoice) + '.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Produces the PDF — for a facture légale and an autre document alike.
 *
 * The document is rendered into an offscreen iframe and *that* is printed,
 * rather than printing the page. The output then contains only the document, at
 * full width, with none of the app around it, and it does not depend on the
 * app's print stylesheet, which only knows how to isolate the preview modal.
 *
 * No PDF library, on purpose: the browser's print engine emits real vector text
 * that stays selectable and searchable, while html2canvas-style renderers
 * rasterise the page and produce a blurry picture of an invoice. The user picks
 * "Enregistrer au format PDF" in the dialog, and the file already carries the
 * document's name because that is the iframe's <title>.
 */
export function printInvoicePdf(invoice: any): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    setTimeout(() => frame.remove(), 500);
  };

  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) { cleanup(); return; }
    win.focus();
    win.onafterprint = cleanup;   // fires whether the user saved or cancelled
    win.print();
    setTimeout(cleanup, 120000);  // not every browser fires onafterprint
  };

  document.body.appendChild(frame);
  frame.srcdoc = renderInvoiceHtml(invoice);
}
