/**
 * Export CSV des tableaux de l'application.
 *
 * Une seule implémentation, parce que chaque écran a le même besoin et que
 * trois variantes finiraient par produire trois fichiers qui ne s'ouvrent pas
 * de la même façon.
 *
 * Deux détails qui décident si le fichier s'ouvre correctement en Tunisie :
 *
 * - **Séparateur point-virgule.** Excel en locale française lit la virgule
 *   comme un séparateur décimal, pas comme un séparateur de colonnes : avec
 *   des virgules, « 1 234,500 » casse la ligne en deux cellules.
 * - **BOM UTF-8.** Sans lui, Excel ouvre le fichier en ANSI et « Échéance »
 *   devient « Ã‰chÃ©ance ».
 */

export interface CsvColumn<T> {
  /** En-tête de colonne, tel qu'il apparaîtra dans le fichier. */
  header: string;
  /** Valeur pour une ligne. Retourner une chaîne, un nombre, ou rien. */
  value: (row: T) => string | number | null | undefined;
}

const SEP = ';';

/**
 * Échappe une cellule. Le guillemet double est le caractère d'échappement du
 * format ; une cellule qui en contient doit les doubler, sinon le fichier
 * devient illisible à partir de cette ligne.
 */
const cell = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Un nombre décimal part avec la virgule française : Excel l'attend ainsi
  // dans cette locale, et le point serait lu comme du texte.
  const needsQuotes = /["\n\r;]/.test(s);
  return needsQuotes ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Nombre formaté pour Excel français : virgule décimale, pas de séparateur de milliers. */
export const csvNumber = (v: number | null | undefined, digits = 3): string =>
  v === null || v === undefined || Number.isNaN(v) ? '' : v.toFixed(digits).replace('.', ',');

/**
 * Construit le CSV et déclenche le téléchargement.
 *
 * Le nom du fichier reçoit la date du jour : un dossier de téléchargements
 * finit toujours par contenir plusieurs exports du même écran, et sans date
 * ils s'appellent tous « clients (3).csv ».
 */
export function exportToCsv<T>(baseName: string, columns: CsvColumn<T>[], rows: T[]): void {
  const head = columns.map(c => cell(c.header)).join(SEP);
  const body = rows.map(r => columns.map(c => cell(c.value(r))).join(SEP));
  const csv = '﻿' + [head, ...body].join('\r\n');

  const today = new Date().toISOString().slice(0, 10);
  const safe = baseName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase();

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safe}-${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Libéré au tour suivant : révoquer immédiatement annule le téléchargement
  // sur certains navigateurs, qui n'ont pas encore lu l'URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
