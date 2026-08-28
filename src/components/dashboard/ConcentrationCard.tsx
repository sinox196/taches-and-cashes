import React from 'react';
import { PieChart } from 'lucide-react';

interface Props {
  data: {
    total: number;
    top1: { name: string; part: number } | null;
    top5Part: number;
    rows: { name: string; honoraires: number; part: number }[];
  } | null;
  /** Seuil au-delà duquel la dépendance à un client devient un risque. */
  seuil?: number;
}

const nf = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 });

/**
 * Un cabinet dont trois clients font la moitié des honoraires est fragile,
 * quelle que soit sa rentabilité — et aucun autre bloc ne révèle ce risque :
 * la marge d'un gros client est souvent excellente, ce qui rassure au moment
 * précis où il faudrait s'inquiéter.
 */
export const ConcentrationCard: React.FC<Props> = ({ data, seuil = 0.2 }) => {
  if (!data || !data.top1 || data.total <= 0) return null;

  const alerte = data.top1.part > seuil;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
      <div className="px-4 sm:px-5 py-4 border-b border-gray-100">
        <h2 className="text-[13px] font-extrabold text-gray-800 uppercase tracking-wide flex items-center gap-2">
          <PieChart className="w-4 h-4 text-gray-400" />
          Concentration du portefeuille
        </h2>
        <p className="text-[11.5px] text-gray-400 mt-0.5">
          Part des honoraires de la période portée par les plus gros clients.
        </p>
      </div>

      <div className="px-4 sm:px-5 py-4 grid gap-4 sm:grid-cols-2">
        <div className="flex items-baseline gap-2">
          <span className={`text-[24px] font-extrabold tabular-nums leading-none ${alerte ? 'text-late-fg' : 'text-gray-900'}`}>
            {Math.round(data.top1.part * 100)} %
          </span>
          <span className="text-[12px] text-gray-500 min-w-0 truncate">
            pour <span className="font-semibold text-gray-700">{data.top1.name}</span>
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[24px] font-extrabold text-gray-900 tabular-nums leading-none">
            {Math.round(data.top5Part * 100)} %
          </span>
          <span className="text-[12px] text-gray-500">pour les 5 premiers</span>
        </div>
      </div>

      <ul className="px-4 sm:px-5 pb-4 space-y-1.5">
        {data.rows.map(r => (
          <li key={r.name} className="flex items-center gap-3">
            <span className="text-[12px] text-gray-700 w-40 sm:w-52 shrink-0 truncate" title={r.name}>{r.name}</span>
            <span className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
              {/* Une seule teinte : la barre encode une part, pas une catégorie. */}
              <span
                className="block h-full rounded-full bg-navy"
                style={{ width: `${Math.max(2, Math.round(r.part * 100))}%` }}
              />
            </span>
            <span className="text-[11.5px] font-mono text-gray-500 w-11 text-right shrink-0">
              {Math.round(r.part * 100)} %
            </span>
            <span className="text-[11.5px] font-mono text-gray-700 w-20 text-right shrink-0 hidden sm:block">
              {nf(r.honoraires)}
            </span>
          </li>
        ))}
      </ul>

      {alerte && (
        <p className="mx-4 sm:mx-5 mb-4 p-2.5 rounded-lg bg-orange-50 border border-orange-200 text-[11.5px] text-orange-900">
          Au-delà de {Math.round(seuil * 100)} %, la perte de ce client serait difficile à absorber.
          C'est un risque stratégique, indépendant de sa rentabilité.
        </p>
      )}
    </div>
  );
};
