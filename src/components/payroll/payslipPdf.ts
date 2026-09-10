import { jsPDF } from 'jspdf';
import { amountToFrenchWords } from '../../utils/amountToWords';
import type { CompanyBlock } from '../cash/invoicePdf';

/**
 * Builds the bulletin de paie as a real PDF, following the same "vector text,
 * not rasterised HTML" rule as `invoicePdf.ts` — the output stays selectable,
 * searchable and sharp at any zoom, and download/print share this one
 * renderer so what is filed and what is printed can never differ.
 *
 * **Follows the cabinet's own markdown template
 * ("Fiche_de_Paie_Zainab_Ben_Attiya.md") section by section**, not the
 * earlier PDF sample's exact box layout — the two disagree on where things
 * sit (a single top title vs. "AMIRA DESIGN" + "Période du" as the masthead
 * and "BULLETIN DE PAIE" as a mid-document section heading, one Net à
 * payer/Signature box vs. three separate lines) and the markdown is the more
 * recent, more explicit spec of the two. Same "Excel-style bordered grid,
 * plain black text" treatment as before for the two tables — the model still
 * reads like a spreadsheet printout there — but the document otherwise
 * follows the markdown's own flow: masthead, "Informations Salarié", a
 * horizontal rule, "BULLETIN DE PAIE", the rubriques table (now five columns
 * — the model adds "BASE / NOMBRE" beside TAUX), "SALAIRE NET A PAYER" as
 * its own heading with "Net à payer"/"Montant en lettres" underneath,
 * "Compteurs et Temps de Travail", the disclaimer, and "Signature & cachet"
 * as a closing line — not a boxed area, since the template no longer draws
 * one.
 */

const money = (v: number) =>
  (v || 0)
    .toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    .replace(/[  ]/g, ' ');

const INK: [number, number, number] = [0, 0, 0];
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
  const box = (x: number, y: number, w: number, h: number) => {
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.2);
    doc.rect(x, y, w, h);
  };
  const rule = (yy: number) => {
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.3);
    doc.line(M, yy, RIGHT, yy);
  };
  const sectionHeading = (label: string, yy: number) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); setInk(INK);
    text(label, M, yy);
  };

  // ---- masthead ----------------------------------------------------------
  let y = 18;
  if (block?.logo) {
    try {
      const fmt = /^data:image\/png/.test(block.logo) ? 'PNG'
        : /^data:image\/webp/.test(block.logo) ? 'WEBP' : 'JPEG';
      doc.addImage(block.logo, fmt, RIGHT - 22, y - 12, 22, 16, undefined, 'FAST');
    } catch { /* a corrupt data URL must not take the whole document down */ }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); setInk(INK);
  text(block?.company?.name || '—', M, y);

  y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setInk(INK);
  doc.setFont('helvetica', 'bold'); text('Période du : ', M, y);
  const periodeDuW = doc.getTextWidth('Période du : ');
  doc.setFont('helvetica', 'normal'); text(`${p.periodeDu || '—'} Au ${p.periodeAu || '—'}`, M + periodeDuW, y);
  y += 4;
  rule(y);
  y += 7;

  // ---- Informations Salarié ------------------------------------------------
  sectionHeading('Informations Salarié', y);
  y += 5;

  // Deux colonnes label/valeur, symétriques, six lignes — la même paire que
  // le tableau markdown du modèle, ligne pour ligne, sans fusion nulle part
  // (contrairement à l'ancien modèle PDF, qui fusionnait NOM ET PRENOM et la
  // ligne BANQUE).
  const C1 = 42, C2 = 49, C3 = 42, C4 = CONTENT_W - 42 - 49 - 42;
  const x1 = M, x2 = x1 + C1, x3 = x2 + C2, x4 = x3 + C3;
  const idRowH = 6.4;
  const labelStyle = () => { doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setInk(INK); };
  const cellText = (v: any, x: number, w: number, yy: number) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setInk(INK);
    const s = v === null || v === undefined || v === '' ? '-' : String(v);
    const lines = doc.splitTextToSize(s, w - 4) as string[];
    text(lines[0] || '-', x + 2, yy);
  };

  const idRow = (label1: string, value1: any, label2: string, value2: any) => {
    box(x1, y, C1, idRowH); box(x2, y, C2, idRowH); box(x3, y, C3, idRowH); box(x4, y, C4, idRowH);
    labelStyle(); text(label1, x1 + 2, y + 4.3);
    cellText(value1, x2, C2, y + 4.3);
    labelStyle(); text(label2, x3 + 2, y + 4.3);
    cellText(value2, x4, C4, y + 4.3);
    y += idRowH;
  };

  idRow('NOM ET PRENOM', p.employeeName, 'MATRICULE', p.matricule);
  idRow('SITUATION FAMILIALE',
    `${p.situationFamiliale || '-'}${p.nombreEnfants != null ? ` (NB ENFANT: ${p.nombreEnfants})` : ''}`,
    'N° CIN', p.numCin);
  idRow('CATEGORIE', p.categorie, 'N° CNSS', p.numCnss);
  idRow('ECHELON', p.echelon, 'QUALIFICATION', p.qualification);
  idRow('SAL HEURE', typeof p.salHeure === 'number' ? money(p.salHeure) : '-', 'DEPARTEMENT', p.departement);
  idRow('BANQUE', p.banque, 'COMPTE BANQ / POSTE', p.numeroCompte);

  y += 6;
  rule(y);
  y += 7;

  // ---- BULLETIN DE PAIE (rubriques) ---------------------------------------
  sectionHeading('BULLETIN DE PAIE', y);
  y += 5;

  // Cinq colonnes — le modèle ajoute BASE / NOMBRE à côté de TAUX : une
  // quantité (heures, jours) pour les lignes qui en portent une, distincte
  // du taux/pourcentage des lignes qui en portent un. Les deux ne se
  // recouvrent jamais sur une même ligne dans le modèle.
  const RC1 = 66, RC2 = 27, RC3 = 27, RC4 = 30, RC5 = CONTENT_W - 66 - 27 - 27 - 30;
  const rx1 = M, rx2 = rx1 + RC1, rx3 = rx2 + RC2, rx4 = rx3 + RC3, rx5 = rx4 + RC4;
  const headH = 7;

  const rowBoxes = (h: number) => { box(rx1, y, RC1, h); box(rx2, y, RC2, h); box(rx3, y, RC3, h); box(rx4, y, RC4, h); box(rx5, y, RC5, h); };
  rowBoxes(headH);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); setInk(INK);
  text('RUBRIQUES', rx1 + RC1 / 2, y + 4.6, { align: 'center' });
  text('BASE / NOMBRE', rx2 + RC2 / 2, y + 4.6, { align: 'center' });
  text('TAUX', rx3 + RC3 / 2, y + 4.6, { align: 'center' });
  text('GAINS', rx4 + RC4 / 2, y + 4.6, { align: 'center' });
  text('RETENUES', rx5 + RC5 / 2, y + 4.6, { align: 'center' });
  y += headH;

  type Row = { label: string; base?: string; taux?: string; gains?: number; retenues?: number; bold?: boolean };
  const rows: Row[] = [
    { label: 'SALAIRE DE BASE', base: p.nbHeures ? String(p.nbHeures) : '', gains: p.salaireBase },
    { label: 'JOURS FÉRIÉS', base: p.joursFeries ? String(p.joursFeries) : '', gains: p.gainsJoursFeries },
    { label: 'PRIME DE PRESENCE', gains: p.primePresence },
    { label: 'PRIME DE TRANSPORT', gains: p.primeTransport },
    { label: "PRIME D'ENCOURAGEMENT", gains: p.primeEncouragement },
    { label: 'SALAIRE BRUT', gains: p.salaireBrut, bold: true },
    // Le TAUX est un nombre tel quel (« 6.99 », « 0.5 »), pas un montant en
    // dinars — money() (virgule, 3 décimales) déformait un simple
    // pourcentage en « 6,990 ».
    { label: 'CNSS %', taux: String(p.tauxCnss ?? ''), retenues: p.retenueCnss },
    { label: 'SALAIRE BRUT IMPOSABLE', gains: p.salaireBrutImposable, bold: true },
    { label: 'IMPÔT SUR LE REVENU', retenues: p.impotSurLeRevenu },
    { label: 'CONTRIBUTION SOCIALE DE SOLIDARITÉ', taux: '0.5', retenues: p.contributionSocialeSolidarite },
    { label: 'SALAIRE NET', gains: p.salaireNet, bold: true },
  ];

  const rowH = 6.3;
  for (const r of rows) {
    rowBoxes(rowH);
    doc.setFont('helvetica', r.bold ? 'bold' : 'normal'); doc.setFontSize(8.5); setInk(INK);
    text(r.label, rx1 + 2, y + 4.2);
    if (r.base) text(r.base, rx2 + RC2 - 2, y + 4.2, { align: 'right' });
    if (r.taux) text(r.taux, rx3 + RC3 - 2, y + 4.2, { align: 'right' });
    if (typeof r.gains === 'number') text(money(r.gains), rx4 + RC4 - 2, y + 4.2, { align: 'right' });
    if (typeof r.retenues === 'number') text(money(r.retenues), rx5 + RC5 - 2, y + 4.2, { align: 'right' });
    y += rowH;
  }
  y += 6;
  rule(y);
  y += 8;

  // ---- SALAIRE NET A PAYER -------------------------------------------------
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setInk(INK);
  text(`SALAIRE NET A PAYER : ${money(p.salaireNetAPayer)} TND`, M, y);
  y += 7;
  doc.setFontSize(9.5);
  text(`Net à payer : ${money(p.salaireNetAPayer)}`, M, y);
  y += 5.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const wordsLabel = 'Montant en lettres : ';
  doc.setFont('helvetica', 'bold'); text(wordsLabel, M, y);
  const wordsLabelW = doc.getTextWidth(wordsLabel);
  doc.setFont('helvetica', 'normal');
  const words = doc.splitTextToSize(amountToFrenchWords(p.salaireNetAPayer || 0), CONTENT_W - wordsLabelW) as string[];
  text(words[0] || '', M + wordsLabelW, y);
  let wy = y;
  for (const line of words.slice(1)) { wy += 4.6; text(line, M, wy); }
  y = wy + 8;
  rule(y);
  y += 7;

  // ---- Compteurs et Temps de Travail ---------------------------------------
  sectionHeading('Compteurs et Temps de Travail', y);
  y += 5;

  const stats: [string, string][] = [
    ['Nb Heures', p.nbHeures ? String(p.nbHeures) : '0'],
    ['N° Heures', p.nHeures ? String(p.nHeures) : '0'],
    ['J.Congés', p.joursConges ? String(p.joursConges) : '0'],
    ['J.Fériés', p.joursFeries ? String(p.joursFeries) : '0'],
    ['J.Absences', p.joursAbsences ? String(p.joursAbsences) : '0'],
    ['Solde Congé', typeof p.soldeConge === 'number' ? String(p.soldeConge) : '-'],
  ];
  const cellW = CONTENT_W / stats.length;
  const statsHeadH = 6, statsBodyH = 7;
  stats.forEach((_, i) => {
    box(M + cellW * i, y, cellW, statsHeadH);
    box(M + cellW * i, y + statsHeadH, cellW, statsBodyH);
  });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setInk(INK);
  stats.forEach(([label], i) => text(label, M + cellW * i + cellW / 2, y + 4, { align: 'center' }));
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setInk(INK);
  stats.forEach(([, value], i) => text(value, M + cellW * i + cellW / 2, y + statsHeadH + 4.8, { align: 'center' }));
  y += statsHeadH + statsBodyH + 8;
  rule(y);
  y += 8;

  doc.setFont('helvetica', 'italic'); doc.setFontSize(7); setInk(INK);
  text(
    "DANS VOTRE INTERET ET POUR VOUS AIDER A FAIRE VALOIR VOS DROITS, CONSERVER CE BULLETIN DE PAIE SANS LIMITATION DE DUREE",
    W / 2, y, { align: 'center' },
  );
  y += 10;

  doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5); setInk(INK);
  text('Signature & cachet', RIGHT, y, { align: 'right' });

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
