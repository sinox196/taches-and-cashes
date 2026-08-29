import React, { useMemo, useState, useEffect } from 'react';

/**
 * Filtrage par période et pagination des tableaux RH.
 *
 * Les quatre onglets (congés, autorisations, prêts, avances) ont exactement le
 * même besoin. Une implémentation partagée, comme pour l'export CSV : quatre
 * copies finiraient par se répondre différemment sur la même question — « quel
 * mois est-ce que je regarde ».
 *
 * Le filtre est **année puis mois**, l'ordre déjà retenu par le Brouillard de
 * caisse et les Échéances, pour qu'un même geste marche partout.
 */

export const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export const HR_PAGE_SIZE = 10;

/** Année d'une date ISO (YYYY-MM-DD), sans passer par `new Date` — pas de décalage de fuseau. */
const yearOf = (iso: string | undefined | null): string => String(iso || '').slice(0, 4);
/** Mois 1-12, en deux chiffres. */
const monthOf = (iso: string | undefined | null): string => String(iso || '').slice(5, 7);

export interface PeriodPage<T> {
  year: string;
  setYear: (v: string) => void;
  month: string;
  setMonth: (v: string) => void;
  /** Années présentes dans les données, plus l'année en cours, décroissantes. */
  yearOptions: string[];
  /** Toutes les lignes retenues par le filtre, avant découpage en pages. */
  filtered: T[];
  page: number;
  setPage: (v: number) => void;
  totalPages: number;
  /** La page affichée. */
  pageRows: T[];
}

/**
 * Appelez-le avec son paramètre de type explicite —
 * `usePeriodPage<LeaveRow>(rows, dateOf)`. Laissé à l'inférence, le couple
 * `rows` / `dateOf` (ce dernier venant en général d'un `useCallback`) retombe
 * sur `unknown`, et les lignes rendues perdent leur type sans que rien ne le
 * signale au bon endroit : l'erreur sort dans le JSX, loin de sa cause.
 *
 * @param dateOf où lire la date de la ligne — elle ne porte pas le même nom
 *   d'un onglet à l'autre (`startDate`, `date`, `dateGranted`).
 */
export function usePeriodPage<T>(
  rows: T[],
  dateOf: (row: T) => string | undefined | null,
  pageSize = HR_PAGE_SIZE,
): PeriodPage<T> {
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [page, setPage] = useState(1);

  const yearOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const y = yearOf(dateOf(r));
      if (y) set.add(y);
    }
    // L'année en cours est toujours proposée, même sans aucune ligne : c'est
    // celle qu'on cherche en janvier, avant la première demande de l'année.
    set.add(String(new Date().getFullYear()));
    return [...set].sort().reverse();
  }, [rows, dateOf]);

  const filtered = useMemo(() => rows.filter(r => {
    const d = dateOf(r);
    if (year && yearOf(d) !== year) return false;
    if (month && monthOf(d) !== month) return false;
    return true;
  }), [rows, year, month, dateOf]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  // Filtrer réduit le nombre de pages : rester sur la page 5 afficherait un
  // tableau vide qui se lit comme « aucun résultat » alors qu'il y en a.
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  return { year, setYear, month, setMonth, yearOptions, filtered, page, setPage, totalPages, pageRows };
}

const SELECT =
  'bg-white border border-gray-300 rounded-lg px-2.5 py-2 text-[12.5px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-navy/20 cursor-pointer';

/** Les deux listes déroulantes : année, puis mois. */
export function PeriodFilter<T>({ page }: { page: PeriodPage<T> }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <select
        value={page.year}
        onChange={e => { page.setYear(e.target.value); page.setPage(1); }}
        title="Filtrer par année"
        className={SELECT}
      >
        <option value="">Toutes les années</option>
        {page.yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <select
        value={page.month}
        onChange={e => { page.setMonth(e.target.value); page.setPage(1); }}
        title="Filtrer par mois"
        className={SELECT}
      >
        <option value="">Tous les mois</option>
        {MONTHS_FR.map((m, i) => (
          <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * La barre de pagination.
 *
 * **En dehors de la zone qui défile et `shrink-0`**, comme celle du Brouillard
 * de caisse : elle reste à l'écran quelle que soit la longueur de la liste.
 * Un `sticky bottom-0` posé dans le conteneur qui défilait ne suffisait pas —
 * la hauteur de son bloc conteneur valait celle du viewport, il ne restait
 * aucune marge pour coller et la barre repartait en bas du tableau, hors
 * écran. C'est le tableau qui doit défiler, pas la page.
 *
 * Elle s'affiche même sur une seule page, également comme le Brouillard : elle
 * porte le décompte « X à Y sur Z », utile aussi sur une liste courte, et une
 * barre qui apparaît et disparaît fait sauter le tableau.
 */
export function PaginationBar<T>({ page, unit = 'lignes' }: { page: PeriodPage<T>; unit?: string }) {
  const { filtered, page: current, setPage, totalPages } = page;
  const from = filtered.length === 0 ? 0 : (current - 1) * HR_PAGE_SIZE + 1;
  const to = Math.min(current * HR_PAGE_SIZE, filtered.length);
  return (
    // `flex-wrap` + `gap-2` : à 375 px le décompte et les boutons se
    // chevauchaient — le texte passait à la ligne sous « Précédent »/« Suivant »
    // au lieu de les pousser. Il occupe désormais toute la largeur et les
    // boutons passent dessous.
    <div className="shrink-0 mt-3 -mx-4 -mb-4 px-4 py-2.5 border-t border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
      <div className="text-gray-500">
        {filtered.length === 0
          ? `Aucune ${unit.replace(/s$/, '')}`
          : `Affichage de ${from} à ${to} sur ${filtered.length} ${unit}`}
      </div>
      <div className="flex gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setPage(Math.max(1, current - 1))}
          disabled={current === 1}
          className="px-3 py-1.5 border border-gray-200 rounded text-gray-600 disabled:opacity-50 hover:bg-gray-100 bg-white"
        >
          Précédent
        </button>
        <div className="flex items-center gap-1 px-2">
          <span className="font-medium text-gray-900">{current}</span>
          <span className="text-gray-500">/</span>
          <span className="text-gray-500">{totalPages}</span>
        </div>
        <button
          type="button"
          onClick={() => setPage(Math.min(totalPages, current + 1))}
          disabled={current >= totalPages}
          className="px-3 py-1.5 border border-gray-200 rounded text-gray-600 disabled:opacity-50 hover:bg-gray-100 bg-white"
        >
          Suivant
        </button>
      </div>
    </div>
  );
}
