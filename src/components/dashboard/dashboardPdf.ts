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
 *
 * Chaque tableau reprend **toutes** les colonnes de son équivalent à l'écran
 * (Rentabilité du portefeuille, Missions & types de tâche, Performance des
 * collaborateurs), pas un sous-ensemble : un PDF qui en tait la moitié se
 * lit comme incomplet plutôt que comme un résumé délibéré. La table
 * Performance des collaborateurs, la plus large (jusqu'à 14 colonnes), passe
 * donc en paysage plutôt que de tasser ses colonnes en portrait au point de
 * les rendre illisibles.
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
  /**
   * Le détail « Tâches réalisées » de chaque client, par `key` (le même que
   * `stats.clientStats[].key`) — `exec`/`stats` ne le portent pas, c'est un
   * tiroir qu'`ClientBreakdown.tsx` n'ouvre normalement qu'au clic
   * (`GET /api/kpi/client-tasks`). L'appelant le récupère pour chaque client
   * avant d'appeler ce renderer, plutôt que ce fichier ne fasse ses propres
   * appels réseau.
   */
  clientTasksByKey?: Record<string, { tasks: any[]; truncated: number }>;
}

const INK: [number, number, number] = [13, 27, 42]; // #0D1B2A
const MUTED: [number, number, number] = [102, 112, 133];
const LINE: [number, number, number] = [228, 231, 236];
const ACCENT: [number, number, number] = [0, 179, 166]; // #00B3A6 — turquoise de la charte
const LATE: [number, number, number] = [185, 28, 28];

const M = 14;
const PORTRAIT_W = 210;
const PORTRAIT_BOTTOM = 280;
const LANDSCAPE_W = 297;
const LANDSCAPE_H = 210;
const LANDSCAPE_BOTTOM = 195;

/**
 * fr-FR groupe les milliers avec une espace fine insécable (U+202F) que les
 * polices standard de jsPDF n'ont pas — non normalisée, un nombre comme
 * « 975 000 » s'imprimait « 9 7 5 / 0 0 0 », chaque caractère écarté par un
 * glyphe de remplacement, ce qui se lisait comme des valeurs qui se
 * chevauchent. Même correctif que `money()` dans `clientReportPdf.ts`/
 * `invoicePdf.ts`, appliqué ici une fois pour toutes dans le formateur de
 * base plutôt que dans chaque appelant.
 */
const nf = (n: number, d = 0) =>
  (n ?? 0)
    .toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })
    .replace(/[  ]/g, ' ');

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
  const { exec, stats, periodLabel, generatedAt, filterLabel, clientTasksByKey } = input;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = M;
  // Géométrie de la page courante — mutable, parce que la table Performance
  // des collaborateurs bascule en paysage pour tenir toutes ses colonnes.
  let orientation: 'portrait' | 'landscape' = 'portrait';
  let right = PORTRAIT_W - M;
  let bottom = PORTRAIT_BOTTOM;

  const text = (v: string, x: number, yy: number, opts?: any) => doc.text(String(v ?? ''), x, yy, opts);
  const setInk = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const rule = (yy: number) => {
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
    doc.line(M, yy, right, yy);
  };
  const newPage = () => {
    doc.addPage('a4', orientation);
    y = M;
  };
  const ensureSpace = (need: number) => {
    if (y + need > bottom) newPage();
  };
  const goLandscape = () => {
    orientation = 'landscape';
    right = LANDSCAPE_W - M;
    bottom = LANDSCAPE_BOTTOM;
    newPage();
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

  /**
   * Largeurs de colonnes **mesurées**, jamais devinées à l'œil : un libellé
   * d'en-tête ou une valeur plus longue que prévu (« COÛT EMPLOYEUR », un
   * nom de collaborateur à rallonge…) débordait sur la colonne voisine avec
   * des largeurs fixes — deux en-têtes se recouvraient au lieu de se lire.
   * `doc.getTextWidth()` mesure dans la police/taille réellement utilisée à
   * l'affichage, en-tête et corps, donc la largeur retenue est toujours
   * celle du texte le plus large de la colonne. Un `minW` garde un plancher
   * pour une colonne à valeurs très courtes (« 0 », « — ») ; si la somme
   * dépasse la largeur disponible, tout le tableau est mis à l'échelle
   * plutôt que de laisser une colonne déborder de la page.
   */
  const fitColumns = (
    cols: { k: string; label: string; a?: 'left' | 'right'; minW?: number }[],
    rows: Record<string, string>[],
    headerSize: number,
    bodySize: number,
  ) => {
    const measured = cols.map(c => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(headerSize);
      let w = doc.getTextWidth(c.label);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(bodySize);
      for (const r of rows) {
        const rw = doc.getTextWidth(r[c.k] ?? '');
        if (rw > w) w = rw;
      }
      w += 6; // marge de part et d'autre du texte
      if (c.minW != null) w = Math.max(w, c.minW);
      return { k: c.k, label: c.label, a: c.a, w };
    });
    const available = right - M;
    const total = measured.reduce((s, c) => s + c.w, 0);
    if (total > available) {
      const scale = available / total;
      for (const c of measured) c.w *= scale;
    }
    return measured;
  };

  /**
   * Une rangée de 2 à 4 mini-cartes chiffre + libellé, pour les métriques de
   * synthèse — value en gras, foot optionnel en dessous en plus petit
   * (même charpente que la `Card` d'`ExecutiveBar.tsx` à l'écran : libellé,
   * puis la valeur, puis un pied plus discret). **Jamais une seule chaîne
   * value+détail concaténée** : « 92 % (capacité 176h00) » sur une seule
   * ligne déborde d'une colonne à quatre cartes bien avant qu'un chiffre
   * réel (pas les zéros d'un compte tout juste seedé) ne la remplisse — le
   * chevauchement remonté n'apparaissait qu'avec de vraies données. `foot`
   * porte le détail, sur sa propre ligne. Une garde de largeur mesurée
   * (`doc.getTextWidth`, comme `fitColumns`) reste en place sur les deux
   * lignes : un nombre malgré tout trop large pour tenir est tronqué à la
   * première ligne de `wrap()` plutôt que de déborder sur la carte voisine.
   */
  const statRow = (items: { label: string; value: string; foot?: string }[]) => {
    const hasFoot = items.some(it => it.foot);
    ensureSpace(hasFoot ? 21 : 16);
    const colW = (right - M) / items.length;
    const textW = colW - 4;
    for (let i = 0; i < items.length; i++) {
      const x = M + i * colW;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setInk(MUTED);
      text(wrap(items[i].label.toUpperCase(), textW)[0] || '', x, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setInk(INK);
      text(wrap(items[i].value, textW)[0] || '', x, y + 6.5);
      if (items[i].foot) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); setInk(MUTED);
        text(wrap(items[i].foot as string, textW)[0] || '', x, y + 11.5);
      }
    }
    y += hasFoot ? 17 : 12;
  };

  const drawTableHeader = (cols: { label: string; w: number; a?: 'left' | 'right' }[], fontSize = 7) => {
    doc.setFillColor(INK[0], INK[1], INK[2]);
    doc.rect(M, y, right - M, 6.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fontSize); doc.setTextColor(255, 255, 255);
    let x = M + 2;
    for (const c of cols) {
      text(c.label, c.a === 'right' ? x + c.w - 3 : x, y + 4.5, c.a === 'right' ? { align: 'right' } : undefined);
      x += c.w;
    }
    y += 6.5;
  };

  /**
   * Dessine une seule ligne sur les colonnes données, avec un décalage
   * optionnel — c'est ce qui indente une sous-ligne (un type de tâche sous
   * sa mission, une tâche sous son client) sans lui donner un jeu de
   * colonnes séparé : elle occupe les mêmes positions x que la ligne mère,
   * simplement décalées de `indent` mm et vides sur les colonnes qu'elle ne
   * renseigne pas.
   */
  const drawRow = (
    cols: { k: string; w: number; a?: 'left' | 'right' }[],
    row: Record<string, string>,
    opts: { bold?: boolean; ink?: [number, number, number]; indent?: number; fontSize: number } = { fontSize: 7.5 },
  ) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal'); doc.setFontSize(opts.fontSize);
    setInk(opts.ink ?? INK);
    let x = M + 2 + (opts.indent ?? 0);
    for (const c of cols) {
      const w = c.w - (cols[0] === c ? (opts.indent ?? 0) : 0);
      const lines = wrap(row[c.k] ?? '', Math.max(w - 3, 4));
      text(lines[0] || '', c.a === 'right' ? x + w - 3 : x, y + 4, c.a === 'right' ? { align: 'right' } : undefined);
      x += w;
    }
    y += 5.5;
    rule(y);
  };

  const drawTable = (
    cols: { k: string; label: string; w: number; a?: 'left' | 'right' }[],
    rows: Record<string, string>[],
    emptyLabel: string,
    fontSize = 7.5,
  ) => {
    if (rows.length === 0) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setInk(MUTED);
      text(emptyLabel, M, y);
      y += 8;
      return;
    }
    drawTableHeader(cols, fontSize - 0.5);
    for (const row of rows) {
      if (y + 6 > bottom) {
        newPage(); drawTableHeader(cols, fontSize - 0.5);
      }
      drawRow(cols, row, { fontSize });
    }
  };

  // ---- header ---------------------------------------------------------
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); setInk(INK);
  text('Tableau de bord Direction', M, y + 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setInk(MUTED);
  text(periodLabel, right, y + 6, { align: 'right' });
  y += 12;
  doc.setFontSize(9);
  text(
    `Généré le ${generatedAt.toLocaleDateString('fr-FR')} à ${generatedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
    M, y,
  );
  if (filterLabel) text(filterLabel, right, y, { align: 'right' });
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
        { label: 'Honoraires', value: money(e.honoraires) },
        { label: 'Marge sur temps', value: pct(e.tauxMarge), foot: money(e.marge) },
        { label: "Reste à encaisser", value: money(e.resteAEncaisser) },
      ]);
    }
    statRow([
      { label: 'Heures produites', value: hours(e.heures) },
      { label: "Taux d'occupation", value: pct(e.occupation), foot: `capacité ${hours(e.capaciteNette)}` },
      ...(showMoney ? [{ label: 'Honoraires / heure', value: e.honorairesParHeure == null ? '—' : `${nf(e.honorairesParHeure, 1)} TND` }] : []),
      { label: 'Clients en alerte', value: String(e.clientsEnAlerte ?? 0) },
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
    const items: { label: string; value: string; foot?: string }[] = [];
    if (g.totalCostFormatted !== undefined) {
      items.push({
        label: 'Coût employeur',
        value: g.pricedTasks === 0 && g.tasksWithoutRate > 0 ? 'Non configuré' : g.totalCostFormatted,
      });
    }
    items.push({ label: 'Effectif', value: String(g.totalHeadcount ?? '—') });
    items.push({ label: 'Tâches (total)', value: String(g.totalTasks), foot: `${g.completedTasks} terminées` });
    items.push({ label: 'Clients traités', value: String(g.clientsHandled) });
    items.push({ label: 'RH en cours', value: String((g.activeLeaves ?? 0) + (g.activeAuthorizations ?? 0)) });
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
        const lines = wrap(a.detail, right - M - 5);
        for (const l of lines.slice(0, 2)) { text(l, M + 5, y); y += 4; }
        y += 1.5;
      }
    }
    y += 2;
  }

  // ---- Rentabilité du portefeuille -----------------------------------------
  // Mêmes 8 colonnes que ClientProfitability.tsx à l'écran, dans le même
  // ordre : Client, Heures, Coût du temps, Honoraires, Marge, Taux, Hon./h,
  // Reste dû. `exec.clients` n'existe que pour un ADMIN (voir server.ts), donc
  // aucune garde de plus n'est nécessaire ici.
  if (exec?.clients && exec.clients.length > 0) {
    sectionTitle('Rentabilité du portefeuille (top 15)');
    const rows = [...exec.clients]
      .sort((a: any, b: any) => (b.honoraires || 0) - (a.honoraires || 0))
      .slice(0, 15)
      .map((c: any) => ({
        name: c.name,
        heures: hours(c.heures),
        cout: money(c.cout),
        honoraires: money(c.honoraires),
        marge: money(c.marge),
        tauxMarge: pct(c.tauxMarge),
        honorairesParHeure: c.honorairesParHeure == null ? '—' : `${nf(c.honorairesParHeure, 1)} TND`,
        resteAPayer: money(c.resteAPayer),
      }));
    const clientCols = fitColumns(
      [
        { k: 'name', label: 'CLIENT', minW: 30 },
        { k: 'heures', label: 'HEURES', a: 'right' },
        { k: 'cout', label: 'COÛT DU TEMPS', a: 'right' },
        { k: 'honoraires', label: 'HONORAIRES', a: 'right' },
        { k: 'marge', label: 'MARGE', a: 'right' },
        { k: 'tauxMarge', label: 'TAUX', a: 'right' },
        { k: 'honorairesParHeure', label: 'HON./H', a: 'right' },
        { k: 'resteAPayer', label: 'RESTE DÛ', a: 'right' },
      ],
      rows, 6.5, 7,
    );
    drawTable(clientCols, rows, 'Aucun client facturé sur cette période.', 7);
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
  // Mêmes colonnes que TaskIntelligence.tsx : Mission, Heures, Coût (si
  // showMoney — reproduit exactement la garde `missions.some(m => m.cout
  // !== undefined)` que ce composant applique déjà), Tâches, Durée moy.,
  // Collab., Clients. Chaque mission déplie aussi ses types de tâche — le
  // détail que la carte à l'écran révèle au clic (`taskTypes`) — en
  // sous-lignes indentées sur les mêmes colonnes MISSION/HEURES/TÂCHES/COÛT ;
  // DURÉE MOY./COLLAB./CLIENTS n'existent qu'au niveau mission et restent
  // vides sur ces lignes-là.
  if (exec?.missions && exec.missions.length > 0) {
    sectionTitle('Missions & types de tâche (top 15)');
    const showMissionMoney = exec.missions.some((m: any) => m.cout !== undefined);
    const missions = [...exec.missions].sort((a: any, b: any) => (b.heures || 0) - (a.heures || 0)).slice(0, 15);
    const rows = missions.map((m: any) => ({
      pole: m.pole,
      heures: hours(m.heures),
      cout: money(m.cout),
      taches: String(m.taches),
      dureeMoyenneH: hours(m.dureeMoyenneH),
      collaborateurs: String(m.collaborateurs),
      clients: String(m.clients),
    }));
    const missionCols = fitColumns(
      [
        { k: 'pole', label: 'MISSION', minW: 30 },
        { k: 'heures', label: 'HEURES', a: 'right' },
        ...(showMissionMoney ? [{ k: 'cout', label: 'COÛT', a: 'right' as const }] : []),
        { k: 'taches', label: 'TÂCHES', a: 'right' },
        { k: 'dureeMoyenneH', label: 'DURÉE MOY.', a: 'right' },
        { k: 'collaborateurs', label: 'COLLAB.', a: 'right' },
        { k: 'clients', label: 'CLIENTS', a: 'right' },
      ],
      rows, 6.5, 7,
    );
    if (rows.length === 0) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setInk(MUTED);
      text('Aucune activité sur cette période.', M, y);
      y += 8;
    } else {
      drawTableHeader(missionCols, 6.5);
      for (let i = 0; i < missions.length; i++) {
        if (y + 6 > bottom) { newPage(); drawTableHeader(missionCols, 6.5); }
        drawRow(missionCols, rows[i], { bold: true, fontSize: 7 });
        const types: any[] = missions[i].taskTypes || [];
        for (const t of types) {
          if (y + 5.5 > bottom) { newPage(); drawTableHeader(missionCols, 6.5); }
          drawRow(missionCols, {
            pole: t.name,
            heures: hours(t.heures),
            cout: money(t.cout),
            taches: String(t.taches),
          }, { indent: 5, ink: MUTED, fontSize: 6.5 });
        }
      }
    }
    y += 2;
  }

  // ---- Activité par client --------------------------------------------------
  // Mêmes colonnes qu'ClientBreakdown.tsx à l'écran (Client, Tâches,
  // Intervenants, Durée, Coût employeur ADMIN, puis le grand-livre —
  // Solde antérieur/Montant de facture/Encaissements/Reste à payer — quand
  // ces champs existent, c-à-d. quand l'appelant tient `VIEW_CLIENT_FINANCIALS`),
  // et sous chaque client son propre tiroir « Tâches réalisées »
  // (`clientTasksByKey`, fourni par l'appelant — voir `DashboardPdfInput`)
  // exactement comme le clic sur une ligne l'ouvre à l'écran.
  const clientStats: any[] = stats?.clientStats || [];
  if (clientStats.length > 0) {
    // Jusqu'à 9 colonnes une fois le grand-livre ajouté (Solde antérieur,
    // Montant de facture, Encaissements, Reste à payer, en plus des cinq de
    // base) — la même raison que la table Performance des collaborateurs
    // bascule déjà en paysage : mesuré serré, `fitColumns()` réduisait
    // TÂCHES/INTERVENANTS jusqu'à tronquer leur propre valeur (« 3 (3 » au
    // lieu de « 3 (3 term.) »).
    goLandscape();
    sectionTitle('Activité par client');
    const showClientCost = clientStats.some((c: any) => c.totalCostFormatted !== undefined);
    const showLedger = clientStats.some((c: any) => c.soldeAnterieur !== undefined);
    const clients = [...clientStats].sort((a, b) => (b.durationSeconds || 0) - (a.durationSeconds || 0));
    const rows = clients.map((c: any) => ({
      name: c.name,
      taches: `${c.taskCount} (${c.completedTasks} term.)`,
      intervenants: String(c.contributors?.length ?? 0),
      duree: c.durationFormatted || '—',
      cout: c.totalCostFormatted !== undefined ? (c.totalCostFormatted || '—') : '',
      soldeAnterieur: money(c.soldeAnterieur),
      montantFacture: money(c.montantFacture),
      encaissements: money(c.encaissements),
      resteAPayer: money(c.resteAPayer),
    }));
    const clientCols = fitColumns(
      [
        { k: 'name', label: 'CLIENT', minW: 30 },
        { k: 'taches', label: 'TÂCHES', a: 'right' },
        { k: 'intervenants', label: 'INTERVENANTS', a: 'right' },
        { k: 'duree', label: 'DURÉE', a: 'right' },
        ...(showClientCost ? [{ k: 'cout', label: 'COÛT EMPLOYEUR', a: 'right' as const }] : []),
        ...(showLedger ? [
          { k: 'soldeAnterieur', label: 'SOLDE ANTÉRIEUR', a: 'right' as const },
          { k: 'montantFacture', label: 'MONTANT FACTURE', a: 'right' as const },
          { k: 'encaissements', label: 'ENCAISSEMENTS', a: 'right' as const },
          { k: 'resteAPayer', label: 'RESTE À PAYER', a: 'right' as const },
        ] : []),
      ],
      rows, 6.5, 7,
    );

    // Colonnes fixes pour le détail « Tâches réalisées », indenté sous
    // chaque client — un jeu de colonnes différent de la table client
    // (Date/Collaborateur/Mission/Type de tâche/Durée/Coût/Statut), donc
    // pas question de le faire tenir dans les colonnes ci-dessus.
    const statusLabel = (s: string) => (s === 'COMPLETED' ? 'Terminée' : s === 'RUNNING' ? 'En cours' : s === 'PAUSED' ? 'En pause' : s);
    const showTaskCost = Object.values(clientTasksByKey || {}).some(v => v.tasks.some((t: any) => t.cost !== undefined));
    const taskCols: { k: string; label: string; w: number; a?: 'left' | 'right' }[] = [
      { k: 'date', label: 'DATE', w: 18 },
      { k: 'userName', label: 'COLLABORATEUR', w: 28 },
      { k: 'mission', label: 'MISSION', w: 30 },
      { k: 'taskType', label: 'TYPE DE TÂCHE', w: 30 },
      { k: 'dureeFormatted', label: 'DURÉE', w: 16, a: 'right' },
      ...(showTaskCost ? [{ k: 'cost', label: 'COÛT', w: 18, a: 'right' as const }] : []),
      { k: 'statut', label: 'STATUT', w: 14, a: 'right' as const },
    ];

    if (rows.length === 0) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setInk(MUTED);
      text('Aucune activité client sur cette période.', M, y);
      y += 8;
    } else {
      drawTableHeader(clientCols, 6.5);
      for (let i = 0; i < clients.length; i++) {
        if (y + 6 > bottom) { newPage(); drawTableHeader(clientCols, 6.5); }
        drawRow(clientCols, rows[i], { bold: true, fontSize: 7 });

        const key = String(clients[i].key ?? clients[i].id);
        const detail = clientTasksByKey?.[key];
        if (detail && detail.tasks.length > 0) {
          ensureSpace(9);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); setInk(MUTED);
          text('TÂCHES RÉALISÉES', M + 2 + 5, y + 3.5);
          y += 6;
          for (const t of detail.tasks) {
            if (y + 5 > bottom) { newPage(); drawTableHeader(clientCols, 6.5); }
            drawRow(taskCols, {
              date: t.date,
              userName: t.userName || '—',
              mission: t.mission || '—',
              taskType: t.taskType || '—',
              dureeFormatted: t.dureeFormatted,
              cost: money(t.cost),
              statut: statusLabel(t.statut),
            }, { indent: 5, ink: MUTED, fontSize: 6.5 });
          }
          if (detail.truncated > 0) {
            ensureSpace(5);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); setInk(MUTED);
            text(`… et ${detail.truncated} tâche(s) supplémentaire(s) non affichée(s).`, M + 7, y + 3);
            y += 5;
          }
          y += 1;
        }
      }
    }
    y += 2;
  }

  // ---- Performance des collaborateurs --------------------------------------
  // Mêmes colonnes qu'EmployeeTable.tsx à l'écran, dans le même ordre :
  // Collaborateur, Rôle, Total Tâches, Terminées, En cours, En pause, Nbr
  // Clients, Temps passé, Occupation, Coût employeur (ADMIN), Congés pris,
  // Solde congés, Autorisations, Ponctualité — jusqu'à 14 colonnes, donc
  // cette table bascule en paysage plutôt que de les tasser en portrait.
  const employees: any[] = stats?.employeeStats || [];
  if (employees.length > 0) {
    goLandscape();
    sectionTitle('Performance des collaborateurs');
    const rows = [...employees]
      .sort((a, b) => (b.totalDurationSeconds || 0) - (a.totalDurationSeconds || 0))
      .map((emp: any) => {
        const daysTaken = emp.leaves?.daysTaken || 0;
        const remainingDays = emp.leaves?.balance?.available ?? 0;
        const attendance = emp.attendance?.checkins
          ? `${emp.attendance.onTimeCheckins}/${emp.attendance.checkins}`
          : '—';
        return {
          name: emp.name,
          role: roleLabel(emp.role),
          total: String(emp.tasks?.total ?? 0),
          completed: String(emp.tasks?.completed ?? 0),
          inProgress: String(emp.tasks?.inProgress ?? 0),
          paused: String(emp.tasks?.paused ?? 0),
          clients: String(emp.clients?.totalHandled ?? 0),
          duree: emp.totalDurationFormatted || '—',
          occupation: emp.occupation != null ? pct(emp.occupation) : '—',
          cout: emp.totalCostFormatted !== undefined ? (emp.totalCostFormatted || '—') : '',
          leavesTaken: `${daysTaken} j`,
          leavesRemaining: `${remainingDays} j`,
          authorizations: String(emp.authorizations?.total ?? 0),
          punctuality: attendance,
        };
      });
    const employeeCols = fitColumns(
      [
        { k: 'name', label: 'COLLABORATEUR', minW: 28 },
        { k: 'role', label: 'RÔLE' },
        { k: 'total', label: 'TOTAL TÂCHES', a: 'right' },
        { k: 'completed', label: 'TERMINÉES', a: 'right' },
        { k: 'inProgress', label: 'EN COURS', a: 'right' },
        { k: 'paused', label: 'EN PAUSE', a: 'right' },
        { k: 'clients', label: 'NBR CLIENTS', a: 'right' },
        { k: 'duree', label: 'TEMPS PASSÉ', a: 'right' },
        { k: 'occupation', label: 'OCCUPATION', a: 'right' },
        ...(rows.some(r => r.cout) ? [{ k: 'cout', label: 'COÛT EMPLOYEUR', a: 'right' as const }] : []),
        { k: 'leavesTaken', label: 'CONGÉS PRIS', a: 'right' },
        { k: 'leavesRemaining', label: 'SOLDE CONGÉS', a: 'right' },
        { k: 'authorizations', label: 'AUTOS.', a: 'right' },
        { k: 'punctuality', label: 'PONCTUALITÉ', a: 'right' },
      ],
      rows, 6.5, 7,
    );
    drawTable(employeeCols, rows, 'Aucun collaborateur sur cette période.', 7);
  }

  // ---- Pied de page : pagination -------------------------------------------
  const pages = doc.getNumberOfPages();
  if (pages > 1) {
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setInk(MUTED);
      doc.text(`${p} / ${pages}`, pw - M, ph - 8, { align: 'right' });
    }
  }

  return doc;
}

export function downloadDashboardPdf(input: DashboardPdfInput): void {
  buildDashboardPdf(input).save(`${dashboardPdfName(input.periodLabel)}.pdf`);
}
