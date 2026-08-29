import React from 'react';
import { Download } from 'lucide-react';
import { exportToCsv, CsvColumn } from '../utils/exportCsv';

interface ExportButtonProps<T> {
  /** Base du nom de fichier — la date du jour y est ajoutée. */
  fileName: string;
  columns: CsvColumn<T>[];
  /** Les lignes telles qu'elles sont affichées, filtres compris. */
  rows: T[];
  label?: string;
  className?: string;
}

/**
 * Exporte ce que le tableau affiche — filtres, tris et recherche compris.
 *
 * Exporter la totalité des données plutôt que la vue en cours serait un piège :
 * on filtre sur un mois, on exporte, et on se retrouve avec l'année entière
 * sans s'en apercevoir. Le fichier doit correspondre à l'écran.
 *
 * Le bouton se désactive quand il n'y a rien à exporter, plutôt que de
 * produire un fichier vide qui se lit comme une erreur de l'application.
 */
export function ExportButton<T>({ fileName, columns, rows, label = 'Exporter', className = '' }: ExportButtonProps<T>) {
  const empty = !rows || rows.length === 0;
  return (
    <button
      type="button"
      onClick={() => exportToCsv(fileName, columns, rows)}
      disabled={empty}
      title={empty ? 'Rien à exporter pour cette sélection' : `Exporter ${rows.length} ligne${rows.length > 1 ? 's' : ''} en CSV`}
      className={`px-3 py-2 border border-gray-300 rounded-lg text-[12.5px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0 whitespace-nowrap ${className}`}
    >
      <Download className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
