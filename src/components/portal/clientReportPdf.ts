import { jsPDF } from 'jspdf';

/**
 * Rapport mensuel du portail client — dessiné avec les primitives texte de
 * jsPDF, comme `invoicePdf.ts`/`payslipPdf.ts` : du vrai texte vectoriel,
 * sélectionnable et net à l'impression, là où un rendu html2canvas aurait
 * produit une image. C'est le seul rendu de ce rapport ; le téléchargement
 * en est le seul point d'entrée — pas d'e-mail, pas de bouton admin, le
 * rapport du mois civil précédent est simplement toujours calculable à la
 * demande côté serveur (`GET /api/portal/report`).
 *
 * Volontairement dépouillé de tout ce que le portail ne montre jamais à un
 * client : aucun coût employeur, aucune performance de collaborateur —
 * seulement ce que `/api/portal/report` a déjà filtré.
 */

export interface ClientReport {
  client: { name: string; taxId: string };
  period: { year: number; month: number; label: string };
  finance: { honoraires: number; encaisse: number; soldeNet: number };
  missions: { pole: string; heures: number; taches: number; types: { name: string; heures: number; taches: number }[] }[];
  activites: { date: string; mission: string; typeTache: string; responsable: string; dureeFormatted: string; statut: string }[];
}

/** Même normalisation que les autres PDF de l'app : l'espace fine insécable fr-FR n'existe pas dans les polices standard de jsPDF. */
const money = (v: number) =>
  (v || 0)
    .toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    .replace(/[\u00a0\u202f]/g, ' ') + ' TND';

const hours = (h: number) => `${h.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`;

const INK: [number, number, number] = [13, 27, 42]; // #0D1B2A
const MUTED: [number, number, number] = [102, 112, 133];
const LINE: [number, number, number] = [228, 231, 236];
const ACCENT: [number, number, number] = [0, 179, 166]; // #00B3A6 — turquoise de la charte

const M = 14;
const W = 210;
const RIGHT = W - M;
const PAGE_BOTTOM = 280;

export function documentName(report: ClientReport): string {
  return [`Rapport-${String(report.period.month).padStart(2, '0')}-${report.period.year}`, report.client.name]
    .filter(Boolean)
    .join('-')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-_ ]+/g, '')
    .trim().replace(/\s+/g, '-') || 'rapport';
}

export function buildClientReportPdf(report: ClientReport): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = M;

  const text = (v: string, x: number, yy: number, opts?: any) => doc.text(String(v ?? ''), x, yy, opts);
  const setInk = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const rule = (yy: number) => {
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
    doc.line(M, yy, RIGHT, yy);
  };
  const ensureSpace = (need: number) => {
    if (y + need > PAGE_BOTTOM) { doc.addPage(); y = M; }
  };
  const sectionTitle = (label: string) => {
    ensureSpace(16);
    doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
    doc.rect(M, y, 2.2, 6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setInk(INK);
    text(label, M + 5, y + 4.8);
    y += 11;
  };

  // ---- header -------------------------------------------------------------
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); setInk(INK);
  text('Rapport mensuel', M, y + 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setInk(MUTED);
  text(report.period.label, RIGHT, y + 6, { align: 'right' });
  y += 12;
  doc.setFontSize(11); setInk(INK);
  text(report.client.name || '', M, y);
  if (report.client.taxId) {
    doc.setFontSize(9); setInk(MUTED);
    text(`Matricule fiscal : ${report.client.taxId}`, RIGHT, y, { align: 'right' });
  }
  y += 6;
  rule(y);
  y += 10;

  const stats: [string, string][] = [
    ['Honoraires facturés', money(report.finance.honoraires)],
    ['Encaissements', money(report.finance.encaisse)],
    ['Solde net du mois', money(report.finance.soldeNet)],
  ];
  const statW = (RIGHT - M) / 3;
  for (let i = 0; i < stats.length; i++) {
    const x = M + i * statW;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setInk(MUTED);
    text(stats[i][0].toUpperCase(), x, y);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); setInk(INK);
    text(stats[i][1], x, y + 7);
  }
  y += 16;
  rule(y);
  y += 10;

  // ---- Missions affectés ---------------------------------------------------
  sectionTitle('Missions affectés');
  if (report.missions.length === 0) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setInk(MUTED);
    text('Aucune activité enregistrée sur ce mois.', M, y);
    y += 8;
  } else {
    const drawMissionHeader = () => {
      doc.setFillColor(INK[0], INK[1], INK[2]);
      doc.rect(M, y, RIGHT - M, 6.5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255);
      text('MISSION / TYPE DE TÂCHE', M + 2, y + 4.5);
      text('TÂCHES', RIGHT - 42, y + 4.5, { align: 'right' });
      text('HEURES', RIGHT - 2, y + 4.5, { align: 'right' });
      y += 6.5;
    };
    drawMissionHeader();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const newPageForMission = () => {
      doc.addPage(); y = M; drawMissionHeader();
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    };
    for (const mission of report.missions) {
      if (y + 7 > PAGE_BOTTOM) newPageForMission();
      setInk(INK);
      doc.setFont('helvetica', 'bold');
      text(mission.pole, M + 2, y + 4.5);
      text(String(mission.taches), RIGHT - 42, y + 4.5, { align: 'right' });
      text(hours(mission.heures), RIGHT - 2, y + 4.5, { align: 'right' });
      y += 6;
      rule(y);
      doc.setFont('helvetica', 'normal');
      for (const t of mission.types) {
        if (y + 6 > PAGE_BOTTOM) newPageForMission();
        setInk(MUTED);
        text(t.name, M + 7, y + 4);
        text(String(t.taches), RIGHT - 42, y + 4, { align: 'right' });
        text(hours(t.heures), RIGHT - 2, y + 4, { align: 'right' });
        y += 5.5;
      }
      y += 1.5;
    }
  }
  y += 4;

  // ---- Activité du dossier ---------------------------------------------------
  ensureSpace(20);
  sectionTitle('Activité du dossier');
  if (report.activites.length === 0) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setInk(MUTED);
    text('Aucune tâche terminée sur ce mois.', M, y);
  } else {
    const cols = [
      { k: 'date', label: 'DATE', w: 22, a: 'left' as const },
      { k: 'mission', label: 'MISSION', w: 42, a: 'left' as const },
      { k: 'typeTache', label: 'TYPE DE TÂCHE', w: 48, a: 'left' as const },
      { k: 'responsable', label: 'COLLABORATEUR', w: 32, a: 'left' as const },
      { k: 'dureeFormatted', label: 'DURÉE', w: 20, a: 'right' as const },
      { k: 'statut', label: 'STATUT', w: 18, a: 'right' as const },
    ];
    const drawTaskHeader = () => {
      doc.setFillColor(INK[0], INK[1], INK[2]);
      doc.rect(M, y, RIGHT - M, 6.5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
      let x = M + 2;
      for (const c of cols) {
        text(c.label, c.a === 'right' ? x + c.w - 3 : x, y + 4.5, c.a === 'right' ? { align: 'right' } : undefined);
        x += c.w;
      }
      y += 6.5;
    };
    drawTaskHeader();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    for (const t of report.activites) {
      if (y + 6 > PAGE_BOTTOM) {
        doc.addPage(); y = M; drawTaskHeader();
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      }
      setInk(INK);
      let x = M + 2;
      const wrap = (v: string, width: number) => doc.splitTextToSize(String(v ?? ''), width) as string[];
      const values: Record<string, string> = {
        date: t.date, mission: t.mission || '—', typeTache: t.typeTache || '—',
        responsable: t.responsable || '—', dureeFormatted: t.dureeFormatted,
        statut: t.statut === 'COMPLETED' ? 'Terminée' : t.statut,
      };
      for (const c of cols) {
        const lines = wrap(values[c.k], c.w - 3);
        text(lines[0] || '', c.a === 'right' ? x + c.w - 3 : x, y + 4, c.a === 'right' ? { align: 'right' } : undefined);
        x += c.w;
      }
      y += 5.5;
      rule(y);
    }
  }

  return doc;
}

export function downloadClientReportPdf(report: ClientReport): void {
  buildClientReportPdf(report).save(`${documentName(report)}.pdf`);
}
