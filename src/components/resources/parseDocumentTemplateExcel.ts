/**
 * Reads a "Document à fournir" spreadsheet shaped like the cabinet's own
 * reference sheets: an optional header block (Secteur / Titre de la liste),
 * an optional "Document" column header, then one document per row. Every
 * part of that shape is optional except having at least one document row —
 * a sheet with no Secteur, no Titre de la liste, and no "Document" header
 * (just a bare list of labels) still imports; the admin fills in whatever
 * the sheet didn't carry, on the preview screen.
 *
 * Excel force-quotes a text cell as `="value"` in some CSV exports; that
 * quoting only means something to Excel itself, so a CSV reader (unlike
 * SheetJS reading a genuine .xlsx) hands the literal string back unparsed —
 * stripped defensively either way.
 */
export interface ParsedDocumentTemplate {
  sector: string;
  title: string;
  items: string[];
}

const stripFormulaQuote = (v: string) => {
  const m = /^="(.*)"$/.exec(v.trim());
  return (m ? m[1] : v).trim();
};

const normalizeKey = (v: string) =>
  v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[:\s]+$/, '').trim();

export async function parseDocumentTemplateWorkbook(file: File): Promise<ParsedDocumentTemplate> {
  // Dynamically imported so the parser only loads for someone who actually
  // opens this dialog, the same reasoning as the client bulk-importer.
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Le fichier ne contient aucune feuille.');
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '', raw: false });
  if (rows.length === 0) throw new Error('La feuille est vide.');

  const cell = (row: any[] | undefined, i: number) => stripFormulaQuote(String(row?.[i] ?? ''));

  let sector = '';
  let title = '';
  const items: string[] = [];
  for (const row of rows) {
    const first = cell(row, 0);
    if (!first) continue; // blank separator row
    const key = normalizeKey(first);
    if (key === 'secteur' && !sector) { sector = cell(row, 1); continue; }
    if (key === 'titre de la liste' && !title) { title = cell(row, 1); continue; }
    if (key === 'document') continue; // column header, not a document itself
    items.push(first);
  }
  if (items.length === 0) throw new Error('Aucun document trouvé dans ce fichier.');

  return { sector, title, items };
}
