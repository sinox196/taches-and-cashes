/**
 * Lit un tableur « missions et types de tâches ».
 *
 * Volontairement permissif, comme le parseur des modèles de documents : le
 * cabinet a déjà ses feuilles, elles ne suivent pas un format qu'on aurait
 * choisi. Les deux formes qu'on rencontre réellement sont acceptées, et se
 * mélangent dans un même fichier :
 *
 *   Mission        | Type de tâche          (une ligne par type)
 *   Comptabilité   | Saisie comptable
 *                  | Lettrage               (1re cellule vide = mission du dessus)
 *   Fiscalité      | Déclaration TVA | Acompte | Liasse   (types en colonnes)
 *
 * Une ligne d'en-tête (« Mission », « Type de tâche »…) est reconnue et
 * sautée si elle est là, mais rien ne l'exige : une feuille qui commence
 * directement par les données s'importe telle quelle. Une mission sans aucun
 * type est valide — le type de tâche est facultatif dans le formulaire de
 * pointage.
 *
 * La seule exigence dure : au moins une mission.
 *
 * Les doublons ne sont **pas** traités ici. Deux lignes portant la même
 * mission sont fusionnées côté serveur (`normalizeMissionCatalogue`), qui est
 * aussi ce qui compare à ce que l'entreprise a déjà — une seule définition de
 * « doublon » pour les deux, plutôt qu'une ici et une là-bas.
 */
export interface ParsedMission {
  name: string;
  taskTypes: string[];
}

/** Excel force-quote parfois une cellule texte en `="valeur"` dans ses exports CSV. */
const stripFormulaQuote = (v: string) => {
  const m = /^="(.*)"$/.exec(v.trim());
  return (m ? m[1] : v).trim();
};

const fold = (v: string) =>
  v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[:\s]+$/, '').trim();

/** Les intitulés sous lesquels une feuille annonce ses deux colonnes. */
const MISSION_HEADERS = ['mission', 'missions', 'service', 'services', 'prestation', 'prestations'];
const TYPE_HEADERS = ['type de tache', 'types de taches', 'type de taches', 'types de tache', 'type', 'types', 'tache', 'taches'];

/**
 * Une ligne d'en-tête, et seulement en première position : « Mission » au
 * milieu d'une feuille est une mission qui s'appelle Mission. La deuxième
 * cellule doit annoncer une colonne de types, ou être vide — une ligne
 * « Mission | Comptabilité » n'est pas un en-tête.
 */
const isHeaderRow = (cells: string[]) => {
  if (!MISSION_HEADERS.includes(fold(cells[0] || ''))) return false;
  const second = fold(cells[1] || '');
  return second === '' || TYPE_HEADERS.includes(second);
};

export async function parseMissionsWorkbook(file: File): Promise<ParsedMission[]> {
  // Importé dynamiquement : quelques centaines de ko qui ne doivent charger
  // que pour qui ouvre réellement cette boîte de dialogue — même raison que
  // l'import des clients et celui des modèles de documents.
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  // `codepage` force l'UTF-8 pour un CSV sans BOM. Sans ça SheetJS retombe sur
  // un jeu de caractères hérité et « Comptabilité » arrive « ComptabilitÃ© » —
  // le pendant à la lecture du BOM que l'export CSV écrit à l'autre bout. Un
  // .xlsx est déjà de l'XML UTF-8 et n'est pas concerné.
  const workbook = XLSX.read(buffer, { type: 'array', codepage: 65001 });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Le fichier ne contient aucune feuille.');

  const rows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
  if (rows.length === 0) throw new Error('La feuille est vide.');

  const missions: ParsedMission[] = [];
  let current: ParsedMission | null = null;
  let headerSkipped = false;

  for (const row of rows) {
    const cells = (Array.isArray(row) ? row : []).map(c => stripFormulaQuote(String(c ?? '')));
    if (cells.every(c => !c)) continue; // ligne de séparation

    if (!headerSkipped && missions.length === 0 && isHeaderRow(cells)) {
      headerSkipped = true;
      continue;
    }

    const [first, ...rest] = cells;
    const types = rest.filter(Boolean);

    if (first) {
      current = { name: first, taskTypes: [] };
      missions.push(current);
    } else if (!current) {
      // Des types avant toute mission : rien à quoi les rattacher.
      continue;
    }
    current!.taskTypes.push(...types);
  }

  if (missions.length === 0) throw new Error('Aucune mission trouvée dans ce fichier.');
  return missions;
}
