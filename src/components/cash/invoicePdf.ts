import { jsPDF } from 'jspdf';
import { amountToFrenchWords } from '../../utils/amountToWords';
import { normalizeDisbursementLines } from '../../constants/disbursements';

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

export interface BankAccount {
  id: string;
  name: string;
  rib: string;
  iban: string;
  swift: string;
}

export interface CompanyBlock {
  company: { name: string; address: string; taxId: string; email: string; phone: string };
  banks: BankAccount[];
  defaultBankId: string;
  logo: string;
  signature: string;
  stamp: string;
  showSignature: boolean;
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

const CURRENCY_SUFFIX: Record<string, string> = { TND: 'DT', USD: 'USD', EUR: 'EUR' };

/** Payment dates are stored ISO; documents read DD/MM/YYYY throughout. */
const frDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
};

/**
 * The legal sequence restarts every calendar year, so its own number alone
 * ("0006") is ambiguous across years — printed as "0006 - 2026". "Autre
 * document" carries a free reference outside that sequence and is left as-is.
 */
const displayNumber = (inv: any) =>
  inv.documentKind === 'FACTURE_LEGALE' && inv.issueDate
    ? `${inv.number} - ${String(inv.issueDate).slice(0, 4)}`
    : inv.number;

/** Filesystem-safe document name, no extension: "Facture-0001-Alpha-SA". */
export const documentName = (invoice: any) =>
  [invoice.title, invoice.number, invoice.clientName]
    .filter(Boolean)
    .join('-')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-_ ]+/g, '')
    .trim().replace(/\s+/g, '-') || 'document';

const INK: [number, number, number] = [13, 27, 42]; // #0D1B2A — Bleu Profond
const MUTED: [number, number, number] = [102, 112, 133];
const LINE: [number, number, number] = [228, 231, 236];
const HEAD: [number, number, number] = [249, 250, 251];

const M = 14;           // page margin, mm
const W = 210;          // A4 width, mm
const RIGHT = W - M;

export function buildInvoicePdf(invoice: any, block?: CompanyBlock | null): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const suspended = invoice.vatRegime === 'SUSPENSION';
  const currency = invoice.currency || 'TND';
  const currencySuffix = CURRENCY_SUFFIX[currency] || currency;
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
  text(`N° ${displayNumber(invoice) || ''}`, RIGHT, y + 12, { align: 'right' });

  // Required wording for a suspended-VAT sale, printed right under the
  // document number so it can never be missed or separated from it.
  if (suspended) {
    doc.setFontSize(8); setInk(MUTED);
    doc.setFont('helvetica', 'bold');
    text('Vente en suspension de la TVA', RIGHT, y + 17, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    text(`Selon Attestation N° ${invoice.attestationNumber || 'xxxxxxxxx'} du ${invoice.attestationDate ? frDate(invoice.attestationDate) : 'jj/mm/aa'}`, RIGHT, y + 21, { align: 'right' });
    text(`Et bon de commande N°${invoice.bonCommandeNumber || 'xxxxxxxxx'}`, RIGHT, y + 25, { align: 'right' });
  }

  // Logo, top-left, with the company name stacked underneath it.
  const LOGO_H = 16;
  let logoDrawn = false;
  if (block?.logo) {
    try {
      const fmt = /^data:image\/png/.test(block.logo) ? 'PNG'
        : /^data:image\/webp/.test(block.logo) ? 'WEBP' : 'JPEG';
      doc.addImage(block.logo, fmt, M, y, 24, LOGO_H, undefined, 'FAST');
      logoDrawn = true;
    } catch {
      /* a corrupt data URL must not take the whole document down */
    }
  }

  // Issuer: the company name alone, in bold, directly below the logo. Address,
  // MF and contact details are printed once in the footer instead — repeating
  // them here made the header heavy for no gain.
  if (block?.company?.name) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setInk(INK);
    text(block.company.name, M, y + (logoDrawn ? LOGO_H + 5 : 6));
  }

  // Stacking the name under the logo makes the left column taller than the
  // right one, so the rule below has to clear both.
  const headerBlockH = logoDrawn && block?.company?.name ? LOGO_H + 9 : 24;
  y += Math.max(suspended ? 34 : 24, headerBlockH);
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
  // The rate column stays even under suspension — it's what the "TVA à
  // titre indicatif" breakdown below is computed from, so it must stay
  // visible for the reader to see which rate each line nominally carries.
  const cols = detailed
    ? [{ k: 'designation', w: 78, a: 'left' }, { k: 'quantity', w: 18, a: 'right' },
       { k: 'unitPrice', w: 26, a: 'right' }, { k: 'vat', w: 18, a: 'right' },
       { k: 'montantHT', w: 42, a: 'right' }]
    : [{ k: 'designation', w: 104, a: 'left' },
       { k: 'vat', w: 18, a: 'right' },
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

  // Désignation is the line's primary content, sized a notch above the other
  // cells (10pt vs 9pt) for readability — wrapped at that same larger size so
  // the measured line breaks match what's actually drawn.
  const DESIGNATION_SIZE = 10;
  const BODY_SIZE = 9;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(BODY_SIZE); setInk(INK);
  for (const l of invoice.lines || []) {
    doc.setFontSize(DESIGNATION_SIZE);
    const nameLines = wrap(l.designation || '', cols[0].w - 5);
    doc.setFontSize(BODY_SIZE);
    const rowH = Math.max(7, nameLines.length * 4.6 + 2.5);
    // New page before a row would run off the sheet, header repeated.
    if (y + rowH > 250) { doc.addPage(); y = M; drawHeader(); doc.setFont('helvetica', 'normal'); doc.setFontSize(BODY_SIZE); setInk(INK); }
    let x = M + 2;
    for (const c of cols) {
      const raw = c.k === 'designation' ? null
        : c.k === 'quantity' ? String(l.quantity ?? '')
        : c.k === 'unitPrice' ? money(l.unitPrice)
        : c.k === 'vat' ? (l.vatExempt ? 'Non soumis' : `${Math.round((l.vatRate || 0) * 100)} %`)
        : money(l.montantHT);
      if (raw === null) {
        doc.setFontSize(DESIGNATION_SIZE);
        let ny = y + 4.8;
        for (const line of nameLines) { text(line, x, ny); ny += 4.6; }
        doc.setFontSize(BODY_SIZE);
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
  const totalsTop = y;

  // Détail des taux de TVA — the same breakdown already shown in the invoice
  // template, printed here too so the screen and the file can't disagree.
  let breakdownBottom = totalsTop;
  if (!suspended && (invoice.vatBreakdown || []).length > 0) {
    const bx = M, bw = tx - 8 - M;
    const c1 = bx + bw * 0.42, c2 = bx + bw;
    let by = totalsTop;
    doc.setFillColor(HEAD[0], HEAD[1], HEAD[2]);
    doc.rect(bx, by, bw, 6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); setInk(MUTED);
    text('TVA', bx + 2, by + 4.2);
    text('BASE', c1, by + 4.2, { align: 'right' });
    text('MONTANT', c2 - 2, by + 4.2, { align: 'right' });
    by += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setInk(INK);
    for (const b of invoice.vatBreakdown) {
      by += 5;
      text(`${Math.round((b.rate || 0) * 100)} %`, bx + 2, by);
      text(money(b.base), c1, by, { align: 'right' });
      text(money(b.amount), c2 - 2, by, { align: 'right' });
    }
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.2);
    doc.rect(bx, totalsTop, bw, by - totalsTop + 2);
    breakdownBottom = by + 2;
  } else if (suspended) {
    // No VAT is charged, but the document still has to show what it would
    // have been ("à titre indicatif") — same box style as the charged
    // breakdown above, just sourced from indicativeVatBreakdown instead.
    const bx = M, bw = tx - 8 - M;
    const c1 = bx + bw * 0.42, c2 = bx + bw;
    let by = totalsTop;
    const indicative = invoice.indicativeVatBreakdown || [];
    if (indicative.length > 0) {
      doc.setFillColor(HEAD[0], HEAD[1], HEAD[2]);
      doc.rect(bx, by, bw, 6, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); setInk(MUTED);
      text('TVA', bx + 2, by + 4.2);
      text('BASE', c1, by + 4.2, { align: 'right' });
      text('MONTANT', c2 - 2, by + 4.2, { align: 'right' });
      by += 6;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setInk(INK);
      for (const b of indicative) {
        by += 5;
        text(`${Math.round((b.rate || 0) * 100)} %`, bx + 2, by);
        text(money(b.base), c1, by, { align: 'right' });
        text(money(b.amount), c2 - 2, by, { align: 'right' });
      }
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.2);
      doc.rect(bx, totalsTop, bw, by - totalsTop + 2);
      by += 2;
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setInk(MUTED);
    text(`Total TVA à titre indicatif : ${money(invoice.indicativeVatTotal || 0)}`, bx, by + 4);
    breakdownBottom = by + 8;
  }

  const row = (lbl: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(9);
    setInk(bold ? INK : MUTED); text(lbl, tx, y);
    setInk(INK); text(value, RIGHT, y, { align: 'right' });
    y += 5;
  };
  row('Total HT', money(invoice.totalHT));
  row('Total TVA', money(invoice.totalVAT));
  row('Total TTC', money(invoice.totalTTC), true);
  if (invoice.withholdingAmount && invoice.showWithholding !== false) {
    row(`Retenue à la source — ${((invoice.withholdingRate || 0) * 100).toLocaleString('fr-FR')} %`,
      `- ${money(invoice.withholdingAmount)}`);
  }
  if (invoice.showStampDuty !== false) {
    row('Timbre fiscal', money(invoice.stampDuty));
  }
  row('Net à payer', money(invoice.netToPay), true);
  // Une ligne par débours : le client doit pouvoir lire ce qui a été avancé
  // pour son compte, poste par poste. Le normalisateur relit un document
  // d'avant les lignes multiples comme une ligne unique, donc ce même code
  // dessine les anciens documents à l'identique.
  const debLines = normalizeDisbursementLines(invoice);
  if (debLines.length === 1) {
    const only = debLines[0].label;
    row(only ? `Remboursement de débours — ${only}` : 'Remboursement de débours',
      `+ ${money(debLines[0].amount)}`);
  } else if (debLines.length > 1) {
    row('Remboursement de débours', `+ ${money(invoice.disbursements)}`);
    for (const l of debLines) {
      row(l.label ? `    ${l.label}` : '    Débours', money(l.amount));
    }
  }
  if (invoice.advances > 0) row('Moins avances perçues', `- ${money(invoice.advances)}`);

  y = Math.max(y, breakdownBottom);
  y += 1;
  doc.setFillColor(INK[0], INK[1], INK[2]);
  doc.rect(tx - 4, y, RIGHT - tx + 4, 9, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255);
  text('Montant de facture', tx, y + 6);
  text(`${money(invoice.totalNetToPay)} ${currencySuffix}`, RIGHT - 2, y + 6, { align: 'right' });
  y += 15;

  // ---- amount in words ---------------------------------------------------
  if (y > 240) { doc.addPage(); y = M; }
  rule(y); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setInk(INK);
  const netWords = currency === 'TND'
    ? amountToFrenchWords(invoice.totalNetToPay)
    : `${money(invoice.totalNetToPay)} ${currencySuffix}`;
  for (const line of wrap(
    `Arrêtée la présente ${String(invoice.title || '').toLowerCase()} à un montant total TTC net de `
    + `${netWords}.`, RIGHT - M)) {
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
    // The full issuer identity lives here, not in the header (which carries
    // the company name alone). Each piece on its own line, not joined into a
    // paragraph and re-wrapped — a MF or phone number wrapping mid-line reads
    // as broken data entry.
    const companyLines = [
      block?.company?.name,
      block?.company?.address,
      block?.company?.taxId ? `MF: ${block.company.taxId}` : '',
      block?.company?.email,
      block?.company?.phone,
    ].filter(Boolean);
    let cy = fy;
    for (const line of (companyLines.length ? companyLines : ['—'])) {
      for (const wrapped of wrap(line, 70)) { text(wrapped, M, cy); cy += 3.4; }
    }

    // The document's own chosen bank, falling back to the configured default
    // (or the first one) for a document created before this selector existed.
    const selectedBank = block?.banks?.find(b => b.id === invoice?.bankId);
    const defaultBank = selectedBank || block?.banks?.find(b => b.id === block.defaultBankId) || block?.banks?.[0];
    let by = fy;
    text(`Banque : ${defaultBank?.name || '—'}`, 90, by); by += 3.4;
    if (defaultBank?.rib) { text(`RIB : ${defaultBank.rib}`, 90, by); by += 3.4; }
    for (const line of wrap(`IBAN : ${defaultBank?.iban || '—'}`, 60)) { text(line, 90, by); by += 3.4; }
    if (defaultBank?.swift) { text(`SWIFT : ${defaultBank.swift}`, 90, by); by += 3.4; }

    // Signature and stamp are drawn side by side, gated together on the one
    // "show" toggle — the admin controls the whole block, not each half.
    if (block?.showSignature !== false) {
      const addFooterImage = (dataUrl: string, x: number) => {
        try {
          const fmt = /^data:image\/png/.test(dataUrl) ? 'PNG'
            : /^data:image\/webp/.test(dataUrl) ? 'WEBP' : 'JPEG';
          doc.addImage(dataUrl, fmt, x, fy - 2, 36, 18, undefined, 'FAST');
        } catch {
          /* a corrupt data URL must not take the whole document down */
        }
      };
      if (block?.stamp) addFooterImage(block.stamp, RIGHT - 78);
      if (block?.signature) addFooterImage(block.signature, RIGHT - 38);
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
 * The blob is handed to a hidden iframe and printed by calling `.print()` on
 * *that frame's own window* once it has loaded — not by embedding a
 * "this.print()" action inside the PDF itself (jsPDF's `autoPrint()`).
 * Chromium's built-in PDF viewer disables JavaScript actions embedded in a
 * PDF for security, so `autoPrint()` silently did nothing in Chrome and Edge:
 * the iframe loaded the document but nothing ever asked to print it. Calling
 * `print()` on the hosting window instead is a normal DOM API call, unrelated
 * to the PDF's own scripting, and is what every "print this PDF blob" pattern
 * actually relies on.
 *
 * The dialog previews exactly this document — never the surrounding app page
 * — which is what removes the step of cancelling a first, wrong preview.
 */
export function printInvoicePdf(invoice: any, block?: CompanyBlock | null): void {
  const doc = buildInvoicePdf(invoice, block);
  const url = URL.createObjectURL(doc.output('blob'));

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    setTimeout(() => { URL.revokeObjectURL(url); frame.remove(); }, 500);
  };

  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) { cleanup(); return; }
    // The PDF viewer needs a moment after 'load' to finish laying out the
    // document; printing immediately can open a blank dialog.
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {
        /* some browsers refuse programmatic print in ways that throw */
      }
    }, 200);
  };

  document.body.appendChild(frame);
  frame.src = url;

  // Not every browser closes the loop cleanly; don't leak the iframe forever.
  setTimeout(cleanup, 120000);
}
