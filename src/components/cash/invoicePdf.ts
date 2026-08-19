import { jsPDF } from 'jspdf';
import { amountToFrenchWords } from '../../utils/amountToWords';

/**
 * Builds the document as a real PDF.
 *
 * Drawn with jsPDF's text primitives rather than rasterising HTML: the output
 * carries genuine vector text that stays selectable, searchable and sharp at
 * any zoom. An html2canvas-style renderer would have produced a picture of an
 * invoice — heavier, blurry when printed, and useless to any accounting tool
 * that expects to read the figures back out.
 *
 * This is the *only* renderer. Download saves this document and print sends
 * this same document to the printer, so what is filed and what is printed can
 * never differ, and printing no longer involves the app's own page at all.
 */

export interface CompanyBlock {
  company: { name: string; address: string; taxId: string; email: string; phone: string };
  bank: { name: string; iban: string };
  signature: string;
}

/**
 * fr-FR groups thousands with a narrow no-break space (U+202F, or U+00A0 on
 * some engines). Neither exists in the PDF standard fonts, so the glyph came
 * out as a slash and the digits spaced apart — "1 500,000" printed as
 * "1 / 5 0 0 , 0 0 0". Normalised to a plain space, which those fonts have.
 */
const money = (v: number) =>
  (v || 0)
    .toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    .replace(/[\u00a0\u202f]/g, ' ');

/** Payment dates are stored ISO; documents read DD/MM/YYYY throughout. */
const frDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
};

/** Filesystem-safe document name, no extension: "Facture-0001-Alpha-SA". */
export const documentName = (invoice: any) =>
  [invoice.title, invoice.number, invoice.clientName]
    .filter(Boolean)
    .join('-')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-_ ]+/g, '')
    .trim().replace(/\s+/g, '-') || 'document';

const INK: [number, number, number] = [16, 24, 40];
const MUTED: [number, number, number] = [102, 112, 133];
const LINE: [number, number, number] = [228, 231, 236];
const HEAD: [number, number, number] = [249, 250, 251];

const M = 14;           // page margin, mm
const W = 210;          // A4 width, mm
const RIGHT = W - M;

export function buildInvoicePdf(invoice: any, block?: CompanyBlock | null): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const suspended = invoice.vatRegime === 'SUSPENSION';
  const detailed = invoice.billingMode === 'DETAILLEE';
  let y = M;

  const text = (v: string, x: number, yy: number, opts?: any) => doc.text(String(v ?? ''), x, yy, opts);
  const setInk = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const rule = (yy: number) => {
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
    doc.line(M, yy, RIGHT, yy);
  };
  /** Guards against a long value colliding with the next block. */
  const wrap = (v: string, width: number) => doc.splitTextToSize(String(v ?? ''), width) as string[];

  // ---- header ------------------------------------------------------------
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); setInk(INK);
  text(invoice.title || 'Facture', RIGHT, y + 6, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setInk(MUTED);
  text(`N° ${invoice.number || ''}`, RIGHT, y + 12, { align: 'right' });

  // Issuer, top-left, from the settings block.
  if (block?.company?.name) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); setInk(INK);
    text(block.company.name, M, y + 5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setInk(MUTED);
    let cy = y + 10;
    for (const line of wrap(block.company.address, 80)) { text(line, M, cy); cy += 4; }
    if (block.company.taxId) { text(`MF : ${block.company.taxId}`, M, cy); cy += 4; }
    const contact = [block.company.email, block.company.phone].filter(Boolean).join('  ·  ');
    if (contact) text(contact, M, cy);
  }

  y += 24;
  rule(y);
  y += 8;

  // ---- client / document details ----------------------------------------
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setInk(MUTED);
  text('DÉTAILS DU CLIENT', M, y);
  text('DÉTAILS DU DOCUMENT', RIGHT, y, { align: 'right' });
  y += 5;

  doc.setFontSize(9.5); setInk(INK);
  text(invoice.clientName || '', M, y);
  doc.setFont('helvetica', 'normal'); setInk(MUTED);
  text(`Date de création : ${invoice.issueDate || ''}`, RIGHT, y, { align: 'right' });
  y += 4.5;

  let ly = y;
  for (const line of wrap(`Matricule fiscal : ${invoice.clientTaxId || '—'}`, 90)) { text(line, M, ly); ly += 4.5; }
  for (const line of wrap(`Adresse : ${invoice.clientAddress || '—'}`, 90)) { text(line, M, ly); ly += 4.5; }
  for (const [k, v] of Object.entries(invoice.customFields || {})) {
    for (const line of wrap(`${k} : ${v}`, 90)) { text(line, M, ly); ly += 4.5; }
  }
  if (invoice.showDueDate && invoice.dueDate) {
    text(`Date d'échéance : ${invoice.dueDate}`, RIGHT, y, { align: 'right' });
  }
  y = Math.max(ly, y + 6) + 4;

  // ---- lines -------------------------------------------------------------
  const cols = detailed
    ? [{ k: 'designation', w: 78, a: 'left' }, { k: 'quantity', w: 18, a: 'right' },
       { k: 'unitPrice', w: 26, a: 'right' }, ...(suspended ? [] : [{ k: 'vat', w: 18, a: 'right' }]),
       { k: 'montantHT', w: suspended ? 60 : 42, a: 'right' }]
    : [{ k: 'designation', w: suspended ? 122 : 104, a: 'left' },
       ...(suspended ? [] : [{ k: 'vat', w: 18, a: 'right' }]),
       { k: 'montantHT', w: 60, a: 'right' }];
  const label: Record<string, string> = {
    designation: 'Désignation', quantity: 'Qté', unitPrice: 'P.U.', vat: 'TVA', montantHT: 'Montant HT',
  };

  const drawHeader = () => {
    doc.setFillColor(HEAD[0], HEAD[1], HEAD[2]);
    doc.rect(M, y, RIGHT - M, 7, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setInk(MUTED);
    let x = M + 2;
    for (const c of cols) {
      text(label[c.k].toUpperCase(), c.a === 'right' ? x + c.w - 4 : x, y + 4.7,
        c.a === 'right' ? { align: 'right' } : undefined);
      x += c.w;
    }
    y += 7;
  };
  drawHeader();

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setInk(INK);
  for (const l of invoice.lines || []) {
    const nameLines = wrap(l.designation || '', cols[0].w - 5);
    const rowH = Math.max(6.5, nameLines.length * 4.2 + 2.5);
    // New page before a row would run off the sheet, header repeated.
    if (y + rowH > 250) { doc.addPage(); y = M; drawHeader(); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setInk(INK); }
    let x = M + 2;
    for (const c of cols) {
      const raw = c.k === 'designation' ? null
        : c.k === 'quantity' ? String(l.quantity ?? '')
        : c.k === 'unitPrice' ? money(l.unitPrice)
        : c.k === 'vat' ? `${Math.round((l.vatRate || 0) * 100)} %`
        : money(l.montantHT);
      if (raw === null) {
        let ny = y + 4.5;
        for (const line of nameLines) { text(line, x, ny); ny += 4.2; }
      } else {
        text(raw, x + c.w - 4, y + 4.5, { align: 'right' });
      }
      x += c.w;
    }
    y += rowH;
    rule(y);
  }

  y += 8;
  if (y > 215) { doc.addPage(); y = M; }

  // ---- totals ------------------------------------------------------------
  const tx = 120;
  const row = (lbl: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(9);
    setInk(bold ? INK : MUTED); text(lbl, tx, y);
    setInk(INK); text(value, RIGHT, y, { align: 'right' });
    y += 5;
  };
  row('Total HT (1)', money(invoice.totalHT));
  row('Total TVA (2)', money(invoice.totalVAT));
  row('Total TTC (3)', money(invoice.totalTTC), true);
  if (invoice.withholdingAmount) {
    row(`Retenue à la source (5) — ${((invoice.withholdingRate || 0) * 100).toLocaleString('fr-FR')} %`,
      `- ${money(invoice.withholdingAmount)}`);
  }
  row('Timbre fiscal (6)', money(invoice.stampDuty));
  row('Net à payer (7)', money(invoice.netToPay), true);
  if (invoice.disbursements > 0) row('Remboursement de débours (8)', `+ ${money(invoice.disbursements)}`);
  if (invoice.advances > 0) row('Moins avances perçues (9)', `- ${money(invoice.advances)}`);

  y += 1;
  doc.setFillColor(INK[0], INK[1], INK[2]);
  doc.rect(tx - 4, y, RIGHT - tx + 4, 9, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255);
  text('Total net à payer (10)', tx, y + 6);
  text(`${money(invoice.totalNetToPay)} DT`, RIGHT - 2, y + 6, { align: 'right' });
  y += 15;

  // ---- encaissements -----------------------------------------------------
  if ((invoice.payments || []).length > 0) {
    if (y > 235) { doc.addPage(); y = M; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setInk(MUTED);
    text('ENCAISSEMENTS', M, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setInk(INK);
    for (const pay of invoice.payments) {
      text(`${frDate(pay.date)}${pay.note ? `  ·  ${pay.note}` : ''}`, M, y);
      text(money(pay.amount), M + 90, y, { align: 'right' });
      y += 4.5;
    }
    doc.setFont('helvetica', 'bold');
    text('Reste à payer', M, y + 1);
    text(`${money(invoice.remainingToPay ?? 0)} DT`, M + 90, y + 1, { align: 'right' });
    y += 9;
  }

  // ---- amount in words ---------------------------------------------------
  if (y > 240) { doc.addPage(); y = M; }
  rule(y); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setInk(INK);
  for (const line of wrap(
    `Arrêtée la présente ${String(invoice.title || '').toLowerCase()} à un montant total TTC net de `
    + `${amountToFrenchWords(invoice.totalNetToPay)}.`, RIGHT - M)) {
    text(line, M, y); y += 4.5;
  }

  // ---- issuer footer, on every page --------------------------------------
  // Drawn last and on all pages, so the bank details and signature are on the
  // sheet whichever one the reader is holding.
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    let fy = 262;
    rule(fy); fy += 5;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); setInk(MUTED);
    text("INFORMATIONS DE L'ENTREPRISE", M, fy);
    text('INFORMATIONS BANCAIRES', 90, fy);
    fy += 4;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setInk(INK);
    const left = [
      block?.company?.name,
      block?.company?.address,
      block?.company?.taxId ? `MF: ${block.company.taxId}` : '',
      [block?.company?.email, block?.company?.phone].filter(Boolean).join('  '),
    ].filter(Boolean).join('  ');
    let cy = fy;
    for (const line of wrap(left || '—', 70)) { text(line, M, cy); cy += 3.4; }

    let by = fy;
    text(`Banque : ${block?.bank?.name || '—'}`, 90, by); by += 3.4;
    for (const line of wrap(`IBAN : ${block?.bank?.iban || '—'}`, 60)) { text(line, 90, by); by += 3.4; }

    if (block?.signature) {
      try {
        const fmt = /^data:image\/png/.test(block.signature) ? 'PNG'
          : /^data:image\/webp/.test(block.signature) ? 'WEBP' : 'JPEG';
        doc.addImage(block.signature, fmt, RIGHT - 38, fy - 2, 36, 18, undefined, 'FAST');
        doc.setFontSize(6.5); setInk(MUTED);
        text('Signature', RIGHT - 20, fy + 19, { align: 'center' });
      } catch {
        /* a corrupt data URL must not take the whole document down */
      }
    }

    if (pages > 1) {
      doc.setFontSize(6.5); setInk(MUTED);
      text(`${page} / ${pages}`, W / 2, 289, { align: 'center' });
    }
  }

  return doc;
}

/** Saves the document as a real PDF file. */
export function downloadInvoicePdf(invoice: any, block?: CompanyBlock | null): void {
  buildInvoicePdf(invoice, block).save(`${documentName(invoice)}.pdf`);
}

/**
 * Prints the very same PDF.
 *
 * The blob is handed to a hidden iframe and printed from there, so the print
 * dialog is the PDF viewer's own and previews exactly the document — never the
 * surrounding page. That is what removes the step of cancelling a first,
 * wrong preview.
 */
export function printInvoicePdf(invoice: any, block?: CompanyBlock | null): void {
  const doc = buildInvoicePdf(invoice, block);
  doc.autoPrint();
  const url = URL.createObjectURL(doc.output('blob'));

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  frame.src = url;
  document.body.appendChild(frame);

  // The viewer needs the object URL until the dialog is done with it.
  setTimeout(() => { URL.revokeObjectURL(url); frame.remove(); }, 120000);
}
