/**
 * Reads the first sheet of an uploaded workbook into plain rows of strings.
 *
 * `raw: false` is what turns an Excel date serial (42116) into the text the
 * cell actually displays ("4/22/15") instead of a bare number nobody reading
 * a client record would recognise — sheet_to_json's default returns the raw
 * serial. Headers are trimmed of the embedded newlines Excel allows inside a
 * cell (a "Tej\nLogin" column header becomes "Tej Login"), since those would
 * otherwise leak into the custom-field labels shown on the Clients screen.
 */
export interface ParsedSheet {
  sheetName: string;
  headers: string[];
  rows: Record<string, string>[];
}

export async function parseClientsWorkbook(file: File): Promise<ParsedSheet> {
  // Dynamically imported so the parser (several hundred kB) only ever loads
  // for the person who actually opens the import dialog and picks a file —
  // not bundled into what every visitor downloads on first paint.
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Le fichier ne contient aucune feuille.');
  const sheet = workbook.Sheets[sheetName];

  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '', raw: false });
  if (raw.length === 0) throw new Error('La feuille est vide.');

  const cleanHeader = (h: string) => h.replace(/\s+/g, ' ').trim();
  const headers = Object.keys(raw[0]).map(cleanHeader);

  const rows = raw.map((r) => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(r)) {
      out[cleanHeader(key)] = typeof value === 'string' ? value.trim() : String(value ?? '');
    }
    return out;
  });

  return { sheetName, headers, rows };
}

/** The client fields an import can map an Excel column onto. */
export const NATIVE_FIELDS = [
  { key: 'name', label: 'Nom / Raison sociale', required: true },
  { key: 'taxId', label: 'Matricule fiscal', required: false },
  { key: 'email', label: 'E-mail', required: false },
  { key: 'phone', label: 'Téléphone', required: false },
  { key: 'address', label: 'Adresse', required: false },
  { key: 'city', label: 'Ville', required: false },
  { key: 'country', label: 'Pays', required: false },
] as const;

export type NativeFieldKey = (typeof NATIVE_FIELDS)[number]['key'];

/** Accent/case-insensitive header candidates used to pre-guess the mapping. */
const CANDIDATES: Record<NativeFieldKey, string[]> = {
  name: ['nom', 'raison sociale', 'client', 'société', 'entreprise', 'name'],
  taxId: ['matricule fiscal', 'matricule', 'mf', 'identifiant fiscal', 'tax id'],
  email: ['mail', 'email', 'e-mail', 'courriel'],
  phone: ['téléphone', 'telephone', 'tel', 'contact téléphonique', 'contacts téléphoniques', 'gsm', 'phone'],
  address: ['adresse', 'address'],
  city: ['ville', 'city', 'localité'],
  country: ['pays', 'country'],
};

const normalise = (v: string) =>
  v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Strips a trailing 's' so "Mails"/"Contacts"/"emails" line up with their
 * singular candidate ("mail", "contact", "email") under the exact-word match
 * below. Guarded by a length floor so a genuinely short word ("tel", "mf")
 * is not mangled into something else.
 */
const singular = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const normKey = (v: string) => normalise(v).split(' ').map(singular).join(' ');

/** Best-effort starting guess; the user confirms or overrides every field. */
export function guessMapping(headers: string[]): Partial<Record<NativeFieldKey, string>> {
  const normalisedHeaders = headers.map((h) => ({ header: h, key: normKey(h) }));
  const mapping: Partial<Record<NativeFieldKey, string>> = {};
  const taken = new Set<string>();

  for (const field of NATIVE_FIELDS) {
    const candidates = CANDIDATES[field.key];
    // Exact match on the whole (singularised) phrase first — this is what
    // lets a multi-word candidate like "contacts téléphoniques" bind to
    // exactly that header. Then a first-*word* match, so "Nom" still finds a
    // header titled just "Nom" without matching into "Nombre de salariés" —
    // comparing whole words, never a substring, is what keeps that safe.
    const exact = normalisedHeaders.find(
      (h) => !taken.has(h.header) && candidates.some((c) => h.key === normKey(c)),
    );
    const partial = exact || normalisedHeaders.find(
      (h) => !taken.has(h.header) && candidates.some((c) => h.key.split(' ')[0] === normKey(c).split(' ')[0]),
    );
    if (partial) {
      mapping[field.key] = partial.header;
      taken.add(partial.header);
    }
  }
  return mapping;
}
