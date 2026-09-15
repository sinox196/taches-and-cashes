import { jsPDF } from 'jspdf';
import { roleLabel } from '../../constants/roles';

/**
 * Export PDF du tableau de bord Direction — mêmes primitives texte jsPDF que
 * `clientReportPdf.ts`/`invoicePdf.ts`/`payslipPdf.ts` : du vrai texte
 * vectoriel, pas une capture d'écran. C'est un instantané de ce que l'écran
 * montre pour la période actuellement sélectionnée dans le filtre (un jour
 * précis, « Aujourd'hui », un mois, une année ou une plage Du/Au libre) — le
 * serveur a déjà tranché qui voit quoi (ADMIN vs SUPERVISEUR, filtre
 * collaborateur actif ou non), donc ce rendu se contente d'afficher ce que
 * `exec`/`stats` contiennent réellement plutôt que de redécider un périmètre.
 */

export interface DashboardPdfInput {
  /** Ex. « Septembre 2026 », « 15/09/2026 », « Du 01/01/2026 au 15/09/2026 ». */
  periodLabel: string;
  generatedAt: Date;
  /** Réponse de `/api/dashboard/executive` (peut être `null` si l'appel a échoué). */
  exec: any;
  /** Réponse de `/api/kpi/dashboard` (peut être `null`). */
  stats: any;
  /** Filtres additionnels affichés en sous-titre, s'ils sont actifs. */
  filterLabel?: string;
}

const INK: [number, number, number] = [13, 27, 42]; // #0D1B2A
const MUTED: [number, number, number] = [102, 112, 133];
const LINE: [number, number, number] = [228, 231, 236];
const ACCENT: [number, number, number] = [0, 179, 166]; // #00B3A6 — turquoise de la charte
const LATE: [number, number, number] = [185, 28, 28];
const DONE: [number, number, number] = [4, 120, 87];

const M = 14;
const W = 210;
const RIGHT = W - M;
const PAGE_BOTTOM = 280;

const nf = (n: number, d = 0) => (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Même arrondi que `ExecutiveBar`/`ClientProfitability` à l'écran : entier, sauf s'il s'arrondirait à zéro sans l'être. */
const money = (n: number | null | undefined) => {
  if (n == null) return '—';
  return (n !== 0 && Math.abs(n) < 0.5 ? nf(n, 3) : nf(n)) + ' TND';
};

const hours = (h: number | null | undefined) => {
  if (h == null) return '—';
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return `${nf(whole)}h${String(mins).padStart(2, '0')}`;
};

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)} %`);

export function dashboardPdfName(periodLabel: string): string {
  return `Tableau-de-bord-${periodLabel}`
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-_ ]+/g, '')
    .trim().replace(/\s+/g, '-') || 'tableau-de-bord';
}

export function buildDashboardPdf(input: DashboardPdfInput): jsPDF {
  const { exec, stats, periodLabel, generatedAt, filterLabel } = input;
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
  const wrap = (v: string, width: number) => doc.splitTextToSize(String(v ?? ''), width) as string[];

  /** Une rangée de 2 à 4 mini-cartes chiffre + libellé, pour les métriques de synthèse. */
  const statRow = (items: [string, string][]) => {
    ensureSpace(18);
    const colW = (RIGHT - M) / items.length;
    for (let i = 0; i < items.length; i++) {
      const x = M + i * colW;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setInk(MUTED);
      text(items[i][0].toUpperCase(), x, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setInk(INK);
      text(items[i][1], x, y + 6.5);
    }
    y += 14;
  };

  const drawTableHeader = (cols: { label: string; w: number; a?: 'left' | 'right' }[]) => {
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

  const drawTable = (
    cols: { k: string; label: string; w: number; a?: 'left' | 'right' }[],
    rows: Record<string, string>[],
    emptyLabel: string,
  ) => {
    if (rows.length === 0) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setInk(MUTED);
      text(emptyLabel, M, y);
      y += 8;
      return;
    }
    drawTableHeader(cols);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    for (const row of rows) {
      if (y + 6 > PAGE_BOTTOM) {
        doc.addPage(); y = M; drawTableHeader(cols);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      }
      setInk(INK);
      let x = M + 2;
      for (const c of cols) {
        const lines = wrap(row[c.k] ?? '—', c.w - 3);
        text(lines[0] || '', c.a === 'right' ? x + c.w - 3 : x, y + 4, c.a === 'right' ? { align: 'right' } : undefined);
        x += c.w;
      }
      y += 5.5;
      rule(y);
    }
  };

  // ---- header ---------------------------------------------------------
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); setInk(INK);
  text('Tableau de bord Direction', M, y + 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setInk(MUTED);
  text(periodLabel, RIGHT, y + 6, { align: 'right' });
  y += 12;
  doc.setFontSize(9);
  text(
    `Généré le ${generatedAt.toLocaleDateString('fr-FR')} à ${generatedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
    M, y,
  );
  if (filterLabel) text(filterLabel, RIGHT, y, { align: 'right' });
  y += 6;
  rule(y);
  y += 10;

  const e = exec?.executive || {};
  const financialsFiltered = !!exec?.financialsFiltered;
  const showMoney = !financialsFiltered && e.honoraires !== undefined;

  if (financialsFiltered) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setInk(MUTED);
    text("Filtre collaborateur actif : les indicateurs financiers sont masqués (une facture n'a pas d'auteur).", M, y);
    y += 8;
  }

  // ---- Bandeau exécutif -------------------------------------------------
  if (exec) {
    sectionTitle('Vue d’ensemble');
    if (showMoney) {
      statRow([
        ['Honoraires', money(e.honoraires)],
        ['Marge sur temps', `${pct(e.tauxMarge)} (${money(e.marge)})`],
        ["Reste à encaisser", money(e.resteAEncaisser)],
      ]);
    }
    statRow([
      ['Heures produites', hours(e.heures)],
      ["Taux d'occupation", `${pct(e.occupation)} (capacité ${hours(e.capaciteNette)})`],
      ...(showMoney ? [['Honoraires / heure', e.honorairesParHeure == null ? '—' : `${nf(e.honorairesParHeure, 1)} TND`] as [string, string]] : []),
      ['Clients en alerte', String(e.clientsEnAlerte ?? 0)],
    ]);
    if (e.tachesSansTaux > 0) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setInk(LATE);
      text(`${e.tachesSansTaux} tâche(s) sans coût employeur — les marges affichées sont surévaluées.`, M, y);
      y += 7;
    }
    y += 3;
  }

  // ---- KPI globaux --------------------------------------------------------
  if (stats?.globalStats) {
    const g = stats.globalStats;
    sectionTitle('Indicateurs globaux');
    const items: [string, string][] = [];
    if (g.totalCostFormatted !== undefined) {
      items.push(['Coût employeur', g.pricedTasks === 0 && g.tasksWithoutRate > 0 ? 'Non configuré' : g.totalCostFormatted]);
    }
    items.push(['Effectif', String(g.totalHeadcount ?? '—')]);
    items.push(['Tâches (total)', `${g.totalTasks} (${g.completedTasks} terminées)`]);
    items.push(['Clients traités', String(g.clientsHandled)]);
    items.push(['RH en cours', String((g.activeLeaves ?? 0) + (g.activeAuthorizations ?? 0))]);
    // Deux lignes de trois, pas cinq colonnes serrées — plus lisible sur A4.
    while (items.length) statRow(items.splice(0, 3));
    y += 2;
  }

  // ---- Alertes ------------------------------------------------------------
  if (exec?.alerts) {
    sectionTitle(`Ce qui demande une décision${exec.alertsTotal ? ` (${exec.alertsTotal})` : ''}`);
    if (exec.alerts.length === 0) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setInk(MUTED);
      text('Aucune alerte sur cette période.', M, y);
      y += 8;
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      for (const a of exec.alerts as any[]) {
        ensureSpace(10);
        const levelColor = a.level === 'CRITIQUE' ? LATE : a.level === 'AVERTISSEMENT' ? [217, 119, 6] as [number, number, number] : MUTED;
        doc.setFillColor(levelColor[0], levelColor[1], levelColor[2]);
        doc.circle(M + 1, y - 1, 1, 'F');
        doc.setFont('helvetica', 'bold'); setInk(INK);
        text(a.title, M + 5, y);
        y += 4.5;
        doc.setFont('helvetica', 'normal'); setInk(MUTED);
        const lines = wrap(a.detail, RIGHT - M - 5);
        for (const l of lines.slice(0, 2)) { text(l, M + 5, y); y += 4; }
        y += 1.5;
      }
    }
    y += 2;
  }

  // ---- Rentabilité du portefeuille -----------------------------------------
  if (exec?.clients && exec.clients.length > 0) {
    sectionTitle('Rentabilité du portefeuille (top 15)');
    const rows = [...exec.clients]
      .sort((a: any, b: any) => (b.honoraires || 0) - (a.honoraires || 0))
      .slice(0, 15)
      .map((c: any) => ({
        name: c.name,
        heures: hours(c.heures),
        honoraires: money(c.honoraires),
        marge: money(c.marge),
        tauxMarge: pct(c.tauxMarge),
      }));
    drawTable(
      [
        { k: 'name', label: 'CLIENT', w: 62 },
        { k: 'heures', label: 'HEURES', w: 26, a: 'right' },
        { k: 'honoraires', label: 'HONORAIRES', w: 34, a: 'right' },
        { k: 'marge', label: 'MARGE', w: 34, a: 'right' },
        { k: 'tauxMarge', label: 'TAUX', w: 26, a: 'right' },
      ],
      rows,
      'Aucun client facturé sur cette période.',
    );
    y += 2;

    if (exec.concentration?.top1) {
      ensureSpace(10);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setInk(MUTED);
      text(
        `Concentration : ${exec.concentration.top1.name} pèse ${pct(exec.concentration.top1.part)} des honoraires ; le top 5 en pèse ${pct(exec.concentration.top5Part)}.`,
        M, y,
      );
      y += 8;
    }
  }

  // ---- Missions & types de tâche ------------------------------------------
  if (exec?.missions && exec.missions.length > 0) {
    sectionTitle('Missions & types de tâche (top 15)');
    const rows = [...exec.missions]
      .sort((a: any, b: any) => (b.heures || 0) - (a.heures || 0))
      .slice(0, 15)
      .map((m: any) => ({
        pole: m.pole,
        heures: hours(m.heures),
        taches: String(m.taches),
        collaborateurs: String(m.collaborateurs),
        clients: String(m.clients),
      }));
    drawTable(
      [
        { k: 'pole', label: 'MISSION', w: 62 },
        { k: 'heures', label: 'HEURES', w: 26, a: 'right' },
        { k: 'taches', label: 'TÂCHES', w: 24, a: 'right' },
        { k: 'collaborateurs', label: 'COLLAB.', w: 34, a: 'right' },
        { k: 'clients', label: 'CLIENTS', w: 26, a: 'right' },
      ],
      rows,
      'Aucune activité sur cette période.',
    );
    y += 2;
  }

  // ---- Performance des collaborateurs --------------------------------------
  const employees: any[] = stats?.employeeStats || [];
  if (employees.length > 0) {
    sectionTitle('Performance des collaborateurs');
    const rows = [...employees]
      .sort((a, b) => (b.totalDurationSeconds || 0) - (a.totalDurationSeconds || 0))
      .map((emp: any) => ({
        name: emp.name,
        role: roleLabel(emp.role),
        taches: `${emp.tasks?.total ?? 0} (${emp.tasks?.completed ?? 0} term.)`,
        duree: emp.totalDurationFormatted || '—',
        cout: emp.totalCostFormatted !== undefined ? (emp.totalCostFormatted || '—') : '',
        occupation: emp.occupation != null ? pct(emp.occupation) : '—',
      }));
    const cols = [
      { k: 'name', label: 'COLLABORATEUR', w: 36 },
      { k: 'role', label: 'RÔLE', w: 26 },
      { k: 'taches', label: 'TÂCHES', w: 30, a: 'right' as const },
      { k: 'duree', label: 'DURÉE', w: 24, a: 'right' as const },
      ...(rows.some(r => r.cout) ? [{ k: 'cout', label: 'COÛT', w: 26, a: 'right' as const }] : []),
      { k: 'occupation', label: 'OCCUPATION', w: 24, a: 'right' as const },
    ];
    drawTable(cols, rows, 'Aucun collaborateur sur cette période.');
  }

  // ---- Pied de page : pagination -------------------------------------------
  const pages = doc.getNumberOfPages();
  if (pages > 1) {
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setInk(MUTED);
      text(`${p} / ${pages}`, RIGHT, 292, { align: 'right' });
    }
  }

  return doc;
}

export function downloadDashboardPdf(input: DashboardPdfInput): void {
  buildDashboardPdf(input).save(`${dashboardPdfName(input.periodLabel)}.pdf`);
}
