import { jsPDF } from 'jspdf';
import { amountToFrenchWords } from '../../utils/amountToWords';
import type { CompanyBlock } from '../cash/invoicePdf';

/**
 * Builds the bulletin de paie as a real PDF, following the same "vector text,
 * not rasterised HTML" rule as `invoicePdf.ts` — the output stays selectable,
 * searchable and sharp at any zoom, and download/print share this one
 * renderer so what is filed and what is printed can never differ.
 *
 * Layout follows the cabinet's own "Modèle de fiche de paie" template
 * (AMIRA DESIGN sample): company header, employee identity grid, a
 * TAUX/GAINS/RETENUES rubriques table, the net-à-payer banner with the
 * amount in words, and the Nb Heures/J.Congés/J.Fériés/J.Absences/Solde
 * Congé footer strip.
 */

const money = (v: number) =>
  (v || 0)
    .toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    .replace(/[  ]/g, ' ');

const INK: [number, number, number] = [13, 27, 42];
const MUTED: [number, number, number] = [102, 112, 133];
const LINE: [number, number, number] = [200, 205, 214];
const HEAD: [number, number, number] = INK;
const HEAD_TEXT: [number, number, number] = [255, 255, 255];

const M = 14;
const W = 210;
const RIGHT = W - M;

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
  let y = M;

  const text = (v: string, x: number, yy: number, opts?: any) => doc.text(String(v ?? ''), x, yy, opts);
  const setInk = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const rule = (yy: number, color: [number, number, number] = LINE) => {
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setLineWidth(0.2);
    doc.line(M, yy, RIGHT, yy);
  };

  // ---- header --------------------------------------------------------
  if (block?.logo) {
    try {
      const fmt = /^data:image\/png/.test(block.logo) ? 'PNG'
        : /^data:image\/webp/.test(block.logo) ? 'WEBP' : 'JPEG';
      doc.addImage(block.logo, fmt, M, y, 20, 14, undefined, 'FAST');
    } catch { /* a corrupt data URL must not take the whole document down */ }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); setInk(INK);
  text(block?.company?.name || '', M, y + 6);

  doc.setFontSize(18);
  text('BULLETIN DE PAIE', RIGHT, y + 7, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setInk(MUTED);
  text(`Période du ${p.periodeDu || '—'} au ${p.periodeAu || '—'}`, RIGHT, y + 13, { align: 'right' });

  y += 20;
  rule(y);
  y += 6;

  // ---- employee identity grid -----------------------------------------
  const LEFT_LABEL_W = 34;
  const midX = M + 96;
  const rowH = 5.4;
  const idRow = (label: string, value: string, x: number, labelW: number, valueW: number) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setInk(MUTED);
    text(label, x, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setInk(INK);
    const lines = doc.splitTextToSize(String(value ?? '—') || '—', valueW) as string[];
    text(lines[0] || '—', x + labelW, y);
  };

  idRow('NOM ET PRÉNOM', p.employeeName, M, LEFT_LABEL_W, midX - M - LEFT_LABEL_W - 2);
  idRow('SITUATION FAM.', `${p.situationFamiliale || '—'}${p.nombreEnfants != null ? `  ·  ${p.nombreEnfants} enfant(s)` : ''}`, midX, 30, RIGHT - midX - 30);
  y += rowH;
  idRow('MATRICULE', p.matricule, M, LEFT_LABEL_W, midX - M - LEFT_LABEL_W - 2);
  idRow('CATÉGORIE', p.categorie, midX, 30, RIGHT - midX - 30);
  y += rowH;
  idRow('N° CIN', p.numCin, M, LEFT_LABEL_W, midX - M - LEFT_LABEL_W - 2);
  idRow('ÉCHELON', p.echelon, midX, 30, RIGHT - midX - 30);
  y += rowH;
  idRow('N° CNSS', p.numCnss, M, LEFT_LABEL_W, midX - M - LEFT_LABEL_W - 2);
  idRow('SAL HEURE', typeof p.salHeure === 'number' ? money(p.salHeure) : '—', midX, 30, RIGHT - midX - 30);
  y += rowH;
  idRow('QUALIFICATION', p.qualification, M, LEFT_LABEL_W, midX - M - LEFT_LABEL_W - 2);
  idRow('BANQUE / POSTE', p.banque, midX, 30, RIGHT - midX - 30);
  y += rowH;
  idRow('DÉPARTEMENT', p.departement, M, LEFT_LABEL_W, midX - M - LEFT_LABEL_W - 2);
  idRow('COMPTE BANQ/POSTE', p.numeroCompte, midX, 34, RIGHT - midX - 34);
  y += rowH + 3;
  rule(y);
  y += 6;

  // ---- rubriques table --------------------------------------------------
  const cols = [
    { k: 'label', w: 94, a: 'left' },
    { k: 'taux', w: 24, a: 'right' },
    { k: 'gains', w: 36, a: 'right' },
    { k: 'retenues', w: 38, a: 'right' },
  ] as const;
  const colLabel: Record<string, string> = { label: 'Rubriques', taux: 'Taux', gains: 'Gains', retenues: 'Retenues' };

  const drawHead = () => {
    doc.setFillColor(HEAD[0], HEAD[1], HEAD[2]);
    doc.rect(M, y, RIGHT - M, 6.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setInk(HEAD_TEXT);
    let x = M + 2;
    for (const c of cols) {
      text(colLabel[c.k].toUpperCase(), c.a === 'right' ? x + c.w - 4 : x, y + 4.4, c.a === 'right' ? { align: 'right' } : undefined);
      x += c.w;
    }
    y += 6.5;
  };
  drawHead();

  type Row = { label: string; taux?: string; gains?: number; retenues?: number; bold?: boolean };
  const rows: Row[] = [
    { label: 'Salaire de base', gains: p.salaireBase },
    { label: 'Jours fériés', taux: p.joursFeries ? String(p.joursFeries) : '', gains: p.gainsJoursFeries },
    { label: 'Prime de présence', gains: p.primePresence },
    { label: 'Prime de transport', gains: p.primeTransport },
    { label: "Prime d'encouragement", gains: p.primeEncouragement },
    { label: 'Salaire brut', gains: p.salaireBrut, bold: true },
    { label: 'CNSS', taux: `${money(p.tauxCnss)} %`, retenues: p.retenueCnss },
    { label: 'Salaire brut imposable', gains: p.salaireBrutImposable, bold: true },
    { label: 'Impôt sur le revenu', retenues: p.impotSurLeRevenu },
    { label: 'Contribution sociale de solidarité', taux: '0,5 %', retenues: p.contributionSocialeSolidarite },
    { label: 'Salaire net', gains: p.salaireNet, bold: true },
  ];

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.8);
  for (const r of rows) {
    doc.setFillColor(r.bold ? 245 : 255, r.bold ? 247 : 255, r.bold ? 250 : 255);
    if (r.bold) doc.rect(M, y, RIGHT - M, 6, 'F');
    doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
    setInk(INK);
    let x = M + 2;
    for (const c of cols) {
      const raw = c.k === 'label' ? r.label
        : c.k === 'taux' ? (r.taux ?? '')
        : c.k === 'gains' ? (typeof r.gains === 'number' ? money(r.gains) : '')
        : (typeof r.retenues === 'number' ? money(r.retenues) : '');
      text(raw, c.a === 'right' ? x + c.w - 4 : x, y + 4.2, c.a === 'right' ? { align: 'right' } : undefined);
      x += c.w;
    }
    y += 6;
    rule(y);
  }

  // ---- net à payer banner -------------------------------------------
  y += 4;
  doc.setFillColor(INK[0], INK[1], INK[2]);
  doc.rect(M, y, RIGHT - M, 10, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); setInk(HEAD_TEXT);
  text('SALAIRE NET À PAYER', M + 4, y + 6.5);
  doc.setFontSize(12);
  text(`${money(p.salaireNetAPayer)} DT`, RIGHT - 4, y + 6.8, { align: 'right' });
  y += 15;

  doc.setFont('helvetica', 'italic'); doc.setFontSize(9); setInk(MUTED);
  const words = doc.splitTextToSize(amountToFrenchWords(p.salaireNetAPayer || 0), RIGHT - M) as string[];
  for (const line of words) { text(line, M, y); y += 4.6; }
  y += 4;

  // ---- footer stats strip --------------------------------------------
  const stats: [string, string][] = [
    ['Nb Heures', p.nbHeures ? String(p.nbHeures) : '—'],
    ['N Heures', p.nHeures ? String(p.nHeures) : '0'],
    ['J.Congés', p.joursConges ? String(p.joursConges) : '0'],
    ['J.Fériés', p.joursFeries ? String(p.joursFeries) : '0'],
    ['J.Absences', p.joursAbsences ? String(p.joursAbsences) : '0'],
    ['Solde Congé', typeof p.soldeConge === 'number' ? String(p.soldeConge) : '—'],
  ];
  const cellW = (RIGHT - M) / stats.length;
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
  doc.rect(M, y, RIGHT - M, 12);
  for (let i = 1; i < stats.length; i++) doc.line(M + cellW * i, y, M + cellW * i, y + 12);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setInk(MUTED);
  stats.forEach(([label], i) => text(label, M + cellW * i + cellW / 2, y + 4.5, { align: 'center' }));
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setInk(INK);
  stats.forEach(([, value], i) => text(value, M + cellW * i + cellW / 2, y + 9.5, { align: 'center' }));
  y += 18;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); setInk(MUTED);
  text("Dans votre intérêt et pour vous aider à faire valoir vos droits, conservez ce bulletin de paie sans limitation de durée.", M, 285);

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
