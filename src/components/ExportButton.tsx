import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { exportToCsv, CsvColumn } from '../utils/exportCsv';

interface ExportButtonProps<T> {
  /** Base du nom de fichier — la date du jour y est ajoutée. */
  fileName: string;
  columns: CsvColumn<T>[];
  /** Les lignes telles qu'elles sont affichées, filtres compris. */
  rows: T[];
  /**
   * Pour un écran qui pagine côté serveur (`rows` n'y porte alors que la
   * page affichée) : va chercher, au clic, tout ce qui correspond aux mêmes
   * filtres — pas seulement la page chargée — avant d'exporter. `rows` sert
   * toujours au calcul de l'état désactivé et de l'infobulle : une page vide
   * reste le signal le plus simple qu'il n'y a rien à exporter.
   */
  fetchAllRows?: () => Promise<T[]>;
  label?: string;
  className?: string;
}

/**
 * Exporte ce que le tableau affiche — filtres, tris et recherche compris.
 *
 * Exporter la totalité des données plutôt que la vue en cours serait un piège :
 * on filtre sur un mois, on exporte, et on se retrouve avec l'année entière
 * sans s'en apercevoir. Le fichier doit correspondre aux filtres actifs.
 *
 * Un écran qui charge tout côté client (RH, Brouillard de caisse…) passe déjà
 * l'ensemble filtré dans `rows`, et l'export est synchrone. Un écran qui
 * pagine côté serveur (Clients, Facturation) — où `rows` ne contient que la
 * page affichée — passe `fetchAllRows` en plus : au clic, le bouton va
 * chercher tout ce qui correspond aux mêmes filtres avant d'exporter, plutôt
 * que la seule page chargée en mémoire. Sans ça l'export d'un écran paginé se
 * limitait silencieusement à la première page — le même genre de troncature
 * que le plafond de 200 lignes du Suivi des tâches de l'équipe, corrigé là
 * par « Charger plus » (voir CLAUDE.md, Scale constraints).
 *
 * Le bouton se désactive quand il n'y a rien à exporter, plutôt que de
 * produire un fichier vide qui se lit comme une erreur de l'application.
 */
export function ExportButton<T>({ fileName, columns, rows, fetchAllRows, label = 'Exporter', className = '' }: ExportButtonProps<T>) {
  const [loading, setLoading] = useState(false);
  const empty = !rows || rows.length === 0;

  const handleClick = async () => {
    if (!fetchAllRows) {
      exportToCsv(fileName, columns, rows);
      return;
    }
    setLoading(true);
    try {
      const allRows = await fetchAllRows();
      exportToCsv(fileName, columns, allRows);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={empty || loading}
      title={
        empty
          ? 'Rien à exporter pour cette sélection'
          : fetchAllRows
            ? 'Exporter toutes les lignes correspondant aux filtres en cours (pas seulement la page affichée)'
            : `Exporter ${rows.length} ligne${rows.length > 1 ? 's' : ''} en CSV`
      }
      className={`px-3 py-2 border border-gray-300 rounded-lg text-[12.5px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0 whitespace-nowrap ${className}`}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
}
