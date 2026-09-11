import { jsPDF } from 'jspdf';
import { amountToFrenchWords } from '../../utils/amountToWords';
import type { CompanyBlock } from '../cash/invoicePdf';

/**
 * Builds the bulletin de paie as a real PDF, following the same "vector text,
 * not rasterised HTML" rule as `invoicePdf.ts` — the output stays selectable,
 * searchable and sharp at any zoom, and download/print share this one
 * renderer so what is filed and what is printed can never differ.
 *
 * **Reproduces the cabinet's own "Modèle de fiche de paie" template
 * literally**, not a restyled adaptation of it: a bordered Excel-style grid
 * throughout (the identity block, the rubriques table, the two boxes at the
 * bottom, the footer stats strip), plain black text and thin black borders
 * everywhere except the navy "BULLETIN DE PAIE" title — no filled dark
 * header bars, no colour-coded cards. The model was supplied twice by the
 * cabinet, byte-identical both times; the point of this file is to match it,
 * not to bring it into this app's own design language.
 */

const money = (v: number) =>
  (v || 0)
    .toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    .replace(/[  ]/g, ' ');

const INK: [number, number, number] = [0, 0, 0];
const NAVY: [number, number, number] = [13, 27, 42];
const BORDER: [number, number, number] = [70, 80, 95];

const M = 14;
const W = 210;
const RIGHT = W - M;
const CONTENT_W = RIGHT - M;

export const MOIS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

/** Filesystem-safe document name, no extension. */
export const payslipDocumentName = (p: any) =>
  ['Bulletin-de-paie', p.employeeName, String(p.year), String(p.month).padStart(2, '0')]
    .filter(Boolean)
    .join('-')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-_ ]+/g, '')
    .trim().replace(/\s+/g, '-') || 'bulletin-de-paie';

export function buildPayslipPdf(p: any, block?: CompanyBlock | null): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const text = (v: string, x: number, yy: number, opts?: any) => doc.text(String(v ?? ''), x, yy, opts);
  const setInk = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const box = (x: number, y: number, w: number, h: number, fill?: [number, number, number]) => {
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.2);
    if (fill) { doc.setFillColor(fill[0], fill[1], fill[2]); doc.rect(x, y, w, h, 'FD'); }
    else doc.rect(x, y, w, h);
  };
  // ---- header ----------------------------------------------------------
  let y = 16;
  if (block?.company?.name) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); setInk(INK);
    text(block.company.name, M, y);
  }
  if (block?.logo) {
    try {
      const fmt = /^data:image\/png/.test(block.logo) ? 'PNG'
        : /^data:image\/webp/.test(block.logo) ? 'WEBP' : 'JPEG';
      doc.addImage(block.logo, fmt, RIGHT - 22, y - 12, 22, 16, undefined, 'FAST');
    } catch { /* a corrupt data URL must not take the whole document down */ }
  }

  y += 10;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); setInk(NAVY);
  text('BULLETIN DE PAIE', W / 2, y, { align: 'center' });

  y += 9;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setInk(INK);
  text(`Période du   ${p.periodeDu || '—'}     Au   ${p.periodeAu || '—'}`, M, y);
  y += 5;

  // ---- employee identity grid -------------------------------------------
  // Four columns: label / value / label / value — the same grid the model
  // itself uses, right down to which rows carry a second label/value pair
  // and which don't (row 1 and the last row are full-width instead).
  const C1 = 36, C2 = 58, C3 = 44, C4 = 44; // sums to CONTENT_W (182)
  const x1 = M, x2 = x1 + C1, x3 = x2 + C2, x4 = x3 + C3;
  const idRowH = 6.2;
  const labelStyle = () => { doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setInk(INK); };
  const valueStyle = () => { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setInk(INK); };
  const cellText = (v: any, x: number, w: number, yy: number, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(9); setInk(INK);
    const s = v === null || v === undefined || v === '' ? '—' : String(v);
    const lines = doc.splitTextToSize(s, w - 4) as string[];
    text(lines[0] || '—', x + 2, yy);
  };

  // Row 1 — NOM ET PRENOM, value spans the rest of the row.
  box(x1, y, C1, idRowH); box(x2, y, C2 + C3 + C4, idRowH);
  labelStyle(); text('NOM ET PRENOM', x1 + 2, y + 4.2);
  cellText(p.employeeName, x2, C2 + C3 + C4, y + 4.2);
  y += idRowH;

  const pairRow = (label1: string, value1: any, label2: string, value2: any) => {
    box(x1, y, C1, idRowH); box(x2, y, C2, idRowH); box(x3, y, C3, idRowH); box(x4, y, C4, idRowH);
    labelStyle(); text(label1, x1 + 2, y + 4.2);
    cellText(value1, x2, C2, y + 4.2);
    labelStyle(); text(label2, x3 + 2, y + 4.2);
    cellText(value2, x4, C4, y + 4.2);
    y += idRowH;
  };

  pairRow('MATRICULE', p.matricule, 'SITUATION FAMILIALE',
    `${p.situationFamiliale || '—'}${p.nombreEnfants != null ? `   NB ENFANT : ${p.nombreEnfants}` : ''}`);
  pairRow('N° CIN', p.numCin, 'CATEGORIE', p.categorie);
  pairRow('N° CNSS', p.numCnss, 'ECHELON', p.echelon);
  pairRow('QUALIFICATION', p.qualification, 'SAL HEURE', typeof p.salHeure === 'number' ? money(p.salHeure) : '—');

  // DÉPARTEMENT — left pair only, like the model; the right half stays blank.
  box(x1, y, C1, idRowH); box(x2, y, C2, idRowH); box(x3, y, C3 + C4, idRowH);
  labelStyle(); text('DEPARTEMENT', x1 + 2, y + 4.2);
  cellText(p.departement, x2, C2, y + 4.2);
  y += idRowH;

  // BANQUE — the right half is a single merged cell headed "COMPTE BANQ / POSTE",
  // exactly as the model prints it, rather than a second label/value pair.
  box(x1, y, C1, idRowH); box(x2, y, C2, idRowH); box(x3, y, C3 + C4, idRowH);
  labelStyle(); text('BANQUE', x1 + 2, y + 4.2);
  cellText(p.banque, x2, C2, y + 4.2);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setInk(INK);
  text('COMPTE BANQ / POSTE', x3 + (C3 + C4) / 2, y + 4.2, { align: 'center' });
  y += idRowH;

  y += 5;

  // ---- rubriques table ---------------------------------------------------
  const RC1 = 100, RC2 = 27, RC3 = 27, RC4 = 28; // sums to CONTENT_W
  const rx1 = M, rx2 = rx1 + RC1, rx3 = rx2 + RC2, rx4 = rx3 + RC3;
  const headH = 7;

  box(rx1, y, RC1, headH); box(rx2, y, RC2, headH); box(rx3, y, RC3, headH); box(rx4, y, RC4, headH);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setInk(INK);
  text('RUBRIQUES', rx1 + RC1 / 2, y + 4.6, { align: 'center' });
  text('TAUX', rx2 + RC2 / 2, y + 4.6, { align: 'center' });
  text('GAINS', rx3 + RC3 / 2, y + 4.6, { align: 'center' });
  text('RETENUES', rx4 + RC4 / 2, y + 4.6, { align: 'center' });
  y += headH;

  type Row = { label: string; taux?: string; gains?: number; retenues?: number; bold?: boolean };
  const rows: Row[] = [
    // Le TAUX de cette ligne est Nb Heures, purement informatif comme sur le
    // modèle — le gains lui-même vient de salaireBase (voir computePayslip()
    // côté serveur), pas d'un calcul heures × taux horaire.
    { label: 'SALAIRE DE BASE', taux: p.nbHeures ? String(p.nbHeures) : '', gains: p.salaireBase },
    { label: 'JOURS FÉRIÉS', taux: p.joursFeries ? String(p.joursFeries) : '', gains: p.gainsJoursFeries },
    { label: 'PRIME DE PRESENCE', gains: p.primePresence },
    { label: 'PRIME DE TRANSPORT', gains: p.primeTransport },
    { label: "PRIME D'ENCOURAGEMENT", gains: p.primeEncouragement },
    { label: 'SALAIRE BRUTE', gains: p.salaireBrut },
    // Le TAUX de la colonne est un nombre tel quel (« 6.99 », « 0.5 »), pas
    // un montant en dinars — money() (virgule, 3 décimales) déformait ici un
    // simple pourcentage en « 6,990 ».
    { label: 'CNSS %', taux: String(p.tauxCnss ?? ''), retenues: p.retenueCnss },
    { label: 'SALAIRE BRUTE IMPOSABLE', gains: p.salaireBrutImposable },
    { label: 'IMPÔT SUR LE REVENU', retenues: p.impotSurLeRevenu },
    { label: 'CONTRIBUTION SOCIALE DE SOLIDARITÉ', taux: '0.5', retenues: p.contributionSocialeSolidarite },
    { label: 'SALAIRE NET', gains: p.salaireNet },
  ];

  const rowH = 6.3;
  for (const r of rows) {
    box(rx1, y, RC1, rowH); box(rx2, y, RC2, rowH); box(rx3, y, RC3, rowH); box(rx4, y, RC4, rowH);
    doc.setFont('helvetica', r.bold ? 'bold' : 'normal'); doc.setFontSize(8.5); setInk(INK);
    text(r.label, rx1 + 2, y + 4.2);
    if (r.taux) text(r.taux, rx2 + RC2 - 2, y + 4.2, { align: 'right' });
    if (typeof r.gains === 'number') text(money(r.gains), rx3 + RC3 - 2, y + 4.2, { align: 'right' });
    if (typeof r.retenues === 'number') text(money(r.retenues), rx4 + RC4 - 2, y + 4.2, { align: 'right' });
    y += rowH;
  }

  // SALAIRE NET A PAYER — merged final row (label spans RUBRIQUES+TAUX, amount spans GAINS+RETENUES), like the model.
  box(rx1, y, RC1 + RC2, rowH + 1); box(rx3, y, RC3 + RC4, rowH + 1);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); setInk(INK);
  text('SALAIRE NET A PAYER', rx1 + (RC1 + RC2) / 2, y + 4.6, { align: 'center' });
  text(money(p.salaireNetAPayer), rx3 + (RC3 + RC4) / 2, y + 4.6, { align: 'center' });
  y += rowH + 1 + 6;

  // ---- Net à payer / Signature & cachet ----------------------------------
  const NB1 = 120, NB2 = CONTENT_W - 120;
  const netHeadH = 7, netBodyH = 20;
  box(M, y, NB1, netHeadH); box(M + NB1, y, NB2, netHeadH + netBodyH);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setInk(INK);
  text(`Net à payer : ${money(p.salaireNetAPayer)}`, M + NB1 / 2, y + 4.6, { align: 'center' });
  text('Signature & cachet', M + NB1 + NB2 / 2, y + 4.6, { align: 'center' });
  box(M, y + netHeadH, NB1, netBodyH);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); setInk(INK);
  const words = doc.splitTextToSize(amountToFrenchWords(p.salaireNetAPayer || 0), NB1 - 6) as string[];
  let wy = y + netHeadH + 5;
  for (const line of words) { text(line, M + 3, wy); wy += 4.4; }
  y += netHeadH + netBodyH + 6;

  // ---- footer stats strip -------------------------------------------------
  const stats: [string, string][] = [
    ['Nb Heures', p.nbHeures ? String(p.nbHeures) : '0'],
    ['N Heures', p.nHeures ? String(p.nHeures) : '0'],
    ['J.Congés', p.joursConges ? String(p.joursConges) : '0'],
    ['J.Fériés', p.joursFeries ? String(p.joursFeries) : '0'],
    ['J.Absences', p.joursAbsences ? String(p.joursAbsences) : '0'],
    ['Solde Congé', typeof p.soldeConge === 'number' ? String(p.soldeConge) : '—'],
  ];
  const cellW = CONTENT_W / stats.length;
  const statsHeadH = 6, statsBodyH = 7;
  stats.forEach(([, ], i) => {
    box(M + cellW * i, y, cellW, statsHeadH);
    box(M + cellW * i, y + statsHeadH, cellW, statsBodyH);
  });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setInk(INK);
  stats.forEach(([label], i) => text(label, M + cellW * i + cellW / 2, y + 4, { align: 'center' }));
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setInk(INK);
  stats.forEach(([, value], i) => text(value, M + cellW * i + cellW / 2, y + statsHeadH + 4.8, { align: 'center' }));
  y += statsHeadH + statsBodyH + 12;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); setInk(INK);
  text(
    "DANS VOTRE INTERET ET POUR VOUS AIDEZ A FAIRE VALOIR VOS DROITS, CONSERVER CE BULLETIN DE PAIE SANS LIMITATION DE DUREE",
    W / 2, Math.max(y, 280), { align: 'center' },
  );

  return doc;
}

export function downloadPayslipPdf(p: any, block?: CompanyBlock | null): void {
  buildPayslipPdf(p, block).save(`${payslipDocumentName(p)}.pdf`);
}

/** Same iframe-print pattern as `printInvoicePdf()` — see its own comment for why. */
export function printPayslipPdf(p: any, block?: CompanyBlock | null): void {
  const doc = buildPayslipPdf(p, block);
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
