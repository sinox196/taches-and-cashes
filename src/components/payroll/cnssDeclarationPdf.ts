import { jsPDF } from 'jspdf';
import { amountToFrenchWords } from '../../utils/amountToWords';
import type { CompanyBlock } from '../cash/invoicePdf';

/**
 * Builds the quarterly CNSS declaration as a real PDF — same "vector text,
 * not rasterised HTML" rule as `invoicePdf.ts`/`payslipPdf.ts`.
 *
 * Reproduces the cabinet's own two-sheet Excel workbook literally: page 1 is
 * "DEC PAPIER" (la déclaration trimestrielle elle-même — un ordre, un
 * matricule CNSS, une identité, un numéro interne, un numéro CIN et les
 * trois montants mensuels par salarié), page 2 is "DEC RECAP" (l'état
 * récapitulatif — salaires déclarés, taux de cotisation, montant à payer).
 * Same bordered Excel-style grid as the bulletin de paie's own template —
 * every cell its own bordered rect via a shared `box()` helper.
 */

const money = (v: number) =>
  (v || 0)
    .toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    // fr-FR groups thousands with U+00A0/U+202F, absent from jsPDF's
    // standard fonts — see payslipPdf.ts's own money() for the same fix.
    .replace(/[  ]/g, ' ');

const pct = (v: number) => `${(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;

const INK: [number, number, number] = [0, 0, 0];
const NAVY: [number, number, number] = [13, 27, 42];
const BORDER: [number, number, number] = [70, 80, 95];

const M = 12;
const W = 210;
const RIGHT = W - M;
const CONTENT_W = RIGHT - M;
const PAGE_BOTTOM = 285;

/** Filesystem-safe document name, no extension. */
export const cnssDeclarationDocumentName = (d: any) =>
  ['Declaration-CNSS', `T${d.quarter}`, String(d.year)]
    .filter(Boolean)
    .join('-')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-_ ]+/g, '')
    .trim().replace(/\s+/g, '-') || 'declaration-cnss';

export function buildCnssDeclarationPdf(d: any, block?: CompanyBlock | null): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const text = (v: any, x: number, yy: number, opts?: any) => doc.text(String(v ?? ''), x, yy, opts);
  const setInk = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const box = (x: number, y: number, w: number, h: number) => {
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.2);
    doc.rect(x, y, w, h);
  };

  const lignes: any[] = Array.isArray(d.lignes) ? d.lignes : [];
  const companyName = d.companyName || block?.company?.name || '';
  const companyAddress = d.companyAddress || block?.company?.address || '';
  const numeroEmployeur = d.numeroEmployeur || block?.company?.numeroEmployeur || '';

  // ======================== PAGE 1 — DEC PAPIER ==========================
  let y = 16;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setInk(INK);
  text('DECLARATION TRIMESTRIELLE DES SALAIRES ET DES SALARIES', W / 2, y, { align: 'center' });
  y += 10;

  // Header grid: label/value on the left, employer name/address on the right.
  const HL = 30, HV = 46, HR = CONTENT_W - HL - HV;
  const hx1 = M, hx2 = hx1 + HL, hx3 = hx2 + HV;
  const headRowH = 6.5;
  const headerRow = (label: string, value: any, rightLabel?: string, rightValue?: string) => {
    box(hx1, y, HL, headRowH); box(hx2, y, HV, headRowH); box(hx3, y, HR, headRowH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); setInk(INK);
    text(label, hx1 + 2, y + 4.3);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    text(String(value ?? '—'), hx2 + 2, y + 4.3);
    doc.setFont('helvetica', rightLabel ? 'bold' : 'normal'); doc.setFontSize(8.5);
    if (rightLabel) text(rightLabel, hx3 + 2, y + 4.3);
    else { doc.setFontSize(9); text(String(rightValue ?? ''), hx3 + 2, y + 4.3); }
    y += headRowH;
  };
  headerRow('N° EMPLOYEUR :', numeroEmployeur, "Nom et adresse de l'employeur");
  headerRow('TRIMESTRE :', d.quarter, undefined, companyName);
  headerRow('ANNEE :', d.year, undefined, companyAddress);
  y += 5;

  // Table. Widths sum to exactly CONTENT_W (186) — checked explicitly below
  // rather than left as "whatever remains", which once left the TOTAL column
  // only ~2mm wide and its figures overlapped the header of the column next
  // to it.
  const C = { ordre: 12, matricule: 24, identite: 48, interne: 16, cin: 20, m1: 16, m2: 16, m3: 16, total: 18 };
  const colTotal = C.total;
  const cols: [string, number][] = [
    ['N° ordre', C.ordre], ['MATRICULE\nCNSS', C.matricule], ['IDENTITE DU SALARIE', C.identite],
    ['N°\ninterne', C.interne], ['N° CIN', C.cin], ['1ER MOIS', C.m1], ['2EME MOIS', C.m2],
    ['3EME MOIS', C.m3], ['TOTAL', colTotal],
  ];
  const headH = 9;
  const drawTableHeader = () => {
    let cx = M;
    for (const [label, w] of cols) {
      box(cx, y, w, headH);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); setInk(INK);
      const lines = label.split('\n');
      lines.forEach((line, i) => text(line, cx + w / 2, y + headH / 2 - (lines.length - 1) * 1.6 + i * 3.2, { align: 'center' }));
      cx += w;
    }
    y += headH;
  };
  drawTableHeader();

  const rowH = 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setInk(INK);
  for (const l of lignes) {
    if (y + rowH > PAGE_BOTTOM) {
      doc.addPage();
      y = 16;
      drawTableHeader();
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setInk(INK);
    }
    let cx = M;
    const cell = (v: any, w: number, align: 'left' | 'right' | 'center' = 'center') => {
      box(cx, y, w, rowH);
      const s = v === null || v === undefined || v === '' ? '' : String(v);
      const px = align === 'right' ? cx + w - 2 : align === 'left' ? cx + 2 : cx + w / 2;
      if (s) text(doc.splitTextToSize(s, w - 2)[0] || '', px, y + rowH / 2 + 1.3, { align });
      cx += w;
    };
    cell(l.ordre, C.ordre);
    cell(l.matriculeCnss, C.matricule);
    cell(l.identite, C.identite, 'left');
    cell(l.numInterne, C.interne);
    cell(l.numCin, C.cin);
    cell(l.mois1 ? money(l.mois1) : '', C.m1, 'right');
    cell(l.mois2 ? money(l.mois2) : '', C.m2, 'right');
    cell(l.mois3 ? money(l.mois3) : '', C.m3, 'right');
    cell(l.total ? money(l.total) : '', colTotal, 'right');
    y += rowH;
  }

  if (y + rowH + 1 > PAGE_BOTTOM) { doc.addPage(); y = 16; }
  // TOTAL row — label spans ordre+matricule+identite+interne+cin, like the model.
  const labelW = C.ordre + C.matricule + C.identite + C.interne + C.cin;
  box(M, y, labelW, rowH + 1);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setInk(INK);
  text('TOTAL', M + labelW / 2, y + (rowH + 1) / 2 + 1.5, { align: 'center' });
  let tx = M + labelW;
  for (const [val, w] of [[d.totalMois1, C.m1], [d.totalMois2, C.m2], [d.totalMois3, C.m3], [d.salairesDeclares, colTotal]] as [number, number][]) {
    box(tx, y, w, rowH + 1);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    text(money(val), tx + w - 2, y + (rowH + 1) / 2 + 1.3, { align: 'right' });
    tx += w;
  }
  y += rowH + 1 + 8;

  if (y + 30 > PAGE_BOTTOM) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setInk(INK);
  text('Certifié sincère et conforme à nos documents comptables et arrêté à la somme de', M, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  const wordsLines1 = doc.splitTextToSize(amountToFrenchWords(d.salairesDeclares || 0), CONTENT_W - 4) as string[];
  wordsLines1.forEach(line => { text(line, M, y); y += 4.6; });
  y += 8;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  text(`Fait à ${d.lieuSignature || '—'} le ${frDate(d.dateSignature)}`, RIGHT, y, { align: 'right' });
  y += 10;
  doc.setFont('helvetica', 'bold');
  text("Cachet et Signature de L'Entreprise", RIGHT, y, { align: 'right' });
  y += 4;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  text('(sur toutes les pages)', RIGHT, y, { align: 'right' });

  // ======================== PAGE 2 — DEC RECAP ============================
  doc.addPage();
  y = 16;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); setInk(NAVY);
  text('ETAT RECAPITULATIF DES SALAIRES DECLARES', W / 2, y, { align: 'center' });
  y += 10;

  // Trimestre/Année | Numéro employeur | Nom et adresse
  const RC = { periode: 32, employeur: 36, identite: CONTENT_W - 32 - 36 };
  const rx1 = M, rx2 = rx1 + RC.periode, rx3 = rx2 + RC.employeur;
  const recapHeadH = 6, recapBodyH = 12;
  box(rx1, y, RC.periode, recapHeadH); box(rx2, y, RC.employeur, recapHeadH); box(rx3, y, RC.identite, recapHeadH);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setInk(INK);
  text('Trimestre et année', rx1 + RC.periode / 2, y + 4.2, { align: 'center' });
  text('Numéro Employeur', rx2 + RC.employeur / 2, y + 4.2, { align: 'center' });
  text("Nom et adresse de l'employeur", rx3 + RC.identite / 2, y + 4.2, { align: 'center' });
  y += recapHeadH;
  box(rx1, y, RC.periode, recapBodyH); box(rx2, y, RC.employeur, recapBodyH); box(rx3, y, RC.identite, recapBodyH);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  text(`${d.quarter} / ${d.year}`, rx1 + RC.periode / 2, y + 5.5, { align: 'center' });
  text(String(numeroEmployeur || '—'), rx2 + RC.employeur / 2, y + 5.5, { align: 'center' });
  const idLines = doc.splitTextToSize(`${companyName}\n${companyAddress}`.trim(), RC.identite - 4) as string[];
  idLines.slice(0, 2).forEach((line, i) => text(line, rx3 + 2, y + 4.5 + i * 4));
  y += recapBodyH + 6;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setInk(INK);
  text('Nombre de salariés déclarés :', M, y);
  text(String(lignes.length), M + 56, y);
  y += 10;

  // Réservé aux services de la CNSS.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  text('Réservé aux services de la CNSS', M, y);
  y += 3;
  const RB = { label: 70, taux: 40, montant: CONTENT_W - 70 - 40 };
  const bx1 = M, bx2 = bx1 + RB.label, bx3 = bx2 + RB.taux;
  const bRowH = 7;
  box(bx1, y, RB.label, bRowH); box(bx2, y, RB.taux, bRowH); box(bx3, y, RB.montant, bRowH);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  text('Salaires déclarés', bx1 + 2, y + 4.6);
  text(money(d.salairesDeclares), bx3 + RB.montant - 2, y + 4.6, { align: 'right' });
  y += bRowH;

  const cnssRows: [string, string, number][] = [
    ['Sécurité sociale', pct(d.tauxSecuriteSociale), d.montantSecuriteSociale],
    ['Accident de travail', pct(d.tauxAccidentTravail), d.montantAccidentTravail],
  ];
  doc.setFont('helvetica', 'normal');
  for (const [label, taux, montant] of cnssRows) {
    box(bx1, y, RB.label, bRowH); box(bx2, y, RB.taux, bRowH); box(bx3, y, RB.montant, bRowH);
    text(label, bx1 + 2, y + 4.6);
    text(taux, bx2 + RB.taux - 2, y + 4.6, { align: 'right' });
    text(money(montant), bx3 + RB.montant - 2, y + 4.6, { align: 'right' });
    y += bRowH;
  }
  box(bx1, y, RB.label + RB.taux, bRowH);
  box(bx3, y, RB.montant, bRowH);
  doc.setFont('helvetica', 'bold');
  text('Cotisations', bx1 + 2, y + 4.6);
  text(money(d.cotisations), bx3 + RB.montant - 2, y + 4.6, { align: 'right' });
  y += bRowH;
  box(bx1, y, RB.label + RB.taux, bRowH); box(bx3, y, RB.montant, bRowH);
  doc.setFont('helvetica', 'normal');
  text('Pénalités', bx1 + 2, y + 4.6);
  text(money(d.penalites), bx3 + RB.montant - 2, y + 4.6, { align: 'right' });
  y += bRowH;
  box(bx1, y, RB.label + RB.taux, bRowH + 1); box(bx3, y, RB.montant, bRowH + 1);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  text('Total à payer', bx1 + 2, y + 5);
  text(money(d.totalAPayer), bx3 + RB.montant - 2, y + 5, { align: 'right' });
  y += bRowH + 1 + 5;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setInk(INK);
  text(`dont charge salariale ${pct(d.tauxChargeSalariale)} et charge patronale ${pct(d.tauxChargePatronale)}`, bx1, y);
  y += 8;

  // Montant payé.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  text(`Montant payé : ${d.modeReglement ? money(d.totalAPayer) : '—'}   le ${d.datePaiement ? frDate(d.datePaiement) : '—'}`, M, y);
  y += 6;
  const modes: [string, string][] = [
    ['ESPECES', 'Espèces'], ['CHEQUE', `Chèque${d.modeReglement === 'CHEQUE' && d.modeReglementRef ? ` n° ${d.modeReglementRef}` : ''}`],
    ['VIREMENT', `Virement${d.modeReglement === 'VIREMENT' && d.modeReglementRef ? ` sur ${d.modeReglementRef}` : ''}`],
    ['MANDAT', `Mandat${d.modeReglement === 'MANDAT' && d.modeReglementRef ? ` n° ${d.modeReglementRef}` : ''}`],
  ];
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  for (const [code, label] of modes) {
    // A real drawn box, not a Unicode ☐/☑ glyph — jsPDF's standard fonts
    // don't carry one, and it silently fell back to "&" (same class of
    // glyph-substitution bug as the fr-FR thousands separator above).
    box(M, y - 3, 3, 3);
    if (d.modeReglement === code) text('X', M + 0.6, y - 0.6);
    text(label, M + 5, y);
    y += 5;
  }
  y += 5;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  text('La présente déclaration de salaires certifiée sincère et conforme à nos documents comptables est arrêtée à la somme de :', M, y, { maxWidth: CONTENT_W });
  y += 7;
  doc.setFont('helvetica', 'bold');
  const wordsLines2 = doc.splitTextToSize(amountToFrenchWords(d.totalAPayer || 0), CONTENT_W - 4) as string[];
  wordsLines2.forEach(line => { text(line, M, y); y += 4.6; });
  y += 10;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  text(`Fait à ${d.lieuSignature || '—'} le ${frDate(d.dateSignature)}`, RIGHT, y, { align: 'right' });
  y += 10;
  doc.setFont('helvetica', 'bold');
  text("Signature et cachet de l'employeur", RIGHT, y, { align: 'right' });

  return doc;
}

/** `YYYY-MM-DD` -> `DD/MM/YYYY`, no `Date` round-trip (same reasoning as `civilDateKeyTN` elsewhere). */
function frDate(iso: string | undefined | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '—');
}

export function downloadCnssDeclarationPdf(d: any, block?: CompanyBlock | null): void {
  buildCnssDeclarationPdf(d, block).save(`${cnssDeclarationDocumentName(d)}.pdf`);
}

/** Same iframe-print pattern as `printInvoicePdf()`/`printPayslipPdf()`. */
export function printCnssDeclarationPdf(d: any, block?: CompanyBlock | null): void {
  const doc = buildCnssDeclarationPdf(d, block);
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
    setTimeout(() => {
      try { win.focus(); win.print(); } catch { /* some browsers refuse programmatic print */ }
    }, 200);
  };

  document.body.appendChild(frame);
  frame.src = url;
  setTimeout(cleanup, 120000);
}
