import React, { useMemo, useState } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { Briefcase, ChevronDown, ChevronRight, Search } from 'lucide-react';

interface ClientRow {
  key: string;
  clientId: number | null;
  name: string;
  heures: number;
  cout: number;
  honoraires: number;
  marge: number;
  tauxMarge: number | null;
  honorairesParHeure: number | null;
  coutParHeure: number | null;
  resteAPayer: number;
  tachesSansTaux: number;
}

const nf = (n: number, d = 0) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Un montant, à l'entier près — sauf s'il s'arrondirait à zéro sans l'être.
 *
 * Ce tableau est large et se lit en diagonale : sur des honoraires à quatre
 * chiffres, les millimes sont du bruit. Mais afficher « 0 » pour un coût réel
 * affirme que le travail n'a rien coûté, et c'est faux — un cabinet qui
 * démarre, ou une période d'un jour, tombe exactement dans ce cas.
 */
const money = (n: number) => (n !== 0 && Math.abs(n) < 0.5 ? nf(n, 3) : nf(n));

const hoursLabel = (h: number) => {
  const whole = Math.floor(h);
  return `${nf(whole)}h${String(Math.round((h - whole) * 60)).padStart(2, '0')}`;
};

/**
 * Couleur par situation, pas par rang : un client garde sa couleur quand la
 * liste est triée ou filtrée autrement. Recolorer selon la position dans le
 * classement ferait changer les couleurs à chaque filtre et emprunterait les
 * teintes réservées aux statuts.
 */
const zoneOf = (r: ClientRow): 'perte' | 'faible' | 'saine' | 'inconnue' => {
  if (r.tauxMarge === null) return 'inconnue';
  if (r.marge < 0) return 'perte';
  if (r.tauxMarge < 0.3) return 'faible';
  return 'saine';
};
const ZONE = {
  perte:    { dot: '#b42318', chip: 'bg-late-bg text-late-fg',       label: 'Perte' },
  faible:   { dot: '#eb6834', chip: 'bg-orange-50 text-orange-700',  label: 'Marge faible' },
  saine:    { dot: '#2a78d6', chip: 'bg-done-bg text-done-fg',       label: 'Saine' },
  inconnue: { dot: '#98a2b3', chip: 'bg-gray-100 text-gray-500',     label: 'Non facturé' },
} as const;

interface Props {
  clients: ClientRow[];
  /** Ouvre le détail de ce client dans « Activité par client ». */
  onOpenClient?: (key: string, name: string) => void;
}

/**
 * Là où se trouve l'argent : ce que chaque client rapporte comparé au temps
 * qu'il consomme.
 *
 * Le nuage plutôt qu'un camembert — un camembert de rentabilité est illisible
 * au-delà de six clients et ne permet aucune comparaison de ratio. Ici quatre
 * zones se lisent d'un coup d'œil : peu d'heures et forte marge (à répliquer),
 * beaucoup d'heures et forte marge (le socle), peu d'heures et faible marge
 * (à retarifer), beaucoup d'heures et marge négative (à traiter en urgence).
 */
export const ClientProfitability: React.FC<Props> = ({ clients, onOpenClient }) => {
  const [query, setQuery] = useState('');
  const [hideUnbilled, setHideUnbilled] = useState(false);
  const [sort, setSort] = useState<'marge' | 'heures' | 'honoraires' | 'taux'>('marge');
  const [expanded, setExpanded] = useState(true);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = (clients || []).filter(r => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (hideUnbilled && r.honoraires <= 0) return false;
      return true;
    });
    out = [...out].sort((a, b) => {
      switch (sort) {
        case 'heures': return b.heures - a.heures;
        case 'honoraires': return b.honoraires - a.honoraires;
        case 'taux': return (a.tauxMarge ?? 99) - (b.tauxMarge ?? 99);
        default: return a.marge - b.marge;
      }
    });
    return out;
  }, [clients, query, hideUnbilled, sort]);

  const scatter = useMemo(
    () => rows.filter(r => r.tauxMarge !== null && r.heures > 0)
      .map(r => ({ ...r, x: r.heures, y: Math.round(r.tauxMarge! * 100), z: Math.max(1, r.honoraires) })),
    [rows]
  );

  const totals = useMemo(() => rows.reduce(
    (a, r) => ({
      heures: a.heures + r.heures,
      cout: a.cout + r.cout,
      honoraires: a.honoraires + r.honoraires,
      marge: a.marge + r.marge,
    }),
    { heures: 0, cout: 0, honoraires: 0, marge: 0 }
  ), [rows]);

  if (!clients || clients.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs p-8 text-center">
        <Briefcase className="w-8 h-8 text-gray-300 mx-auto mb-3" />
        <p className="text-[13px] text-gray-500">Aucune activité client sur la période sélectionnée.</p>
        <p className="text-[12px] text-gray-400 mt-1">Élargissez la période, ou vérifiez que le temps est bien pointé.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
      <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-extrabold text-gray-800 uppercase tracking-wide">
            Rentabilité du portefeuille
          </h2>
          <p className="text-[11.5px] text-gray-400 mt-0.5">
            Honoraires facturés comparés au coût du temps consommé, client par client.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <div className="relative flex-1 min-w-[150px] lg:flex-none">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filtrer un client…"
              className="pl-8 pr-3 py-1.5 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 w-full lg:w-48"
            />
          </div>
          <label className="flex items-center gap-1.5 text-[11.5px] text-gray-600 shrink-0 cursor-pointer">
            <input type="checkbox" checked={hideUnbilled} onChange={e => setHideUnbilled(e.target.checked)} />
            Masquer les non facturés
          </label>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as any)}
            className="px-2.5 py-1.5 text-[12px] border border-gray-200 rounded-lg bg-white focus:outline-none shrink-0"
          >
            <option value="marge">Marge croissante</option>
            <option value="taux">Taux de marge croissant</option>
            <option value="heures">Heures décroissantes</option>
            <option value="honoraires">Honoraires décroissants</option>
          </select>
        </div>
      </div>

      {scatter.length > 1 && (
        <div className="px-2 sm:px-4 pt-4 pb-1">
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 22, left: 4 }}>
              <CartesianGrid stroke="#f2f4f7" />
              <XAxis
                type="number" dataKey="x" name="Heures"
                tick={{ fontSize: 11, fill: '#667085' }}
                label={{ value: 'Heures consommées', position: 'insideBottom', offset: -12, fontSize: 11, fill: '#667085' }}
              />
              <YAxis
                type="number" dataKey="y" name="Taux de marge" unit=" %"
                tick={{ fontSize: 11, fill: '#667085' }}
                label={{ value: 'Taux de marge', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#667085' }}
              />
              <ZAxis type="number" dataKey="z" range={[50, 420]} name="Honoraires" />
              {/* Le seuil qui compte : en dessous, le client coûte plus qu'il ne rapporte. */}
              <ReferenceLine y={0} stroke="#b42318" strokeDasharray="4 3" />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const r = payload[0].payload as ClientRow & { y: number };
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-[12px]">
                      <div className="font-bold text-gray-900 mb-1">{r.name}</div>
                      <div className="text-gray-600">Heures : <span className="font-mono">{hoursLabel(r.heures)}</span></div>
                      <div className="text-gray-600">Honoraires : <span className="font-mono">{money(r.honoraires)} TND</span></div>
                      <div className="text-gray-600">Coût du temps : <span className="font-mono">{money(r.cout)} TND</span></div>
                      <div className="text-gray-900 font-semibold mt-1">
                        Marge : <span className="font-mono">{money(r.marge)} TND</span> ({r.y} %)
                      </div>
                    </div>
                  );
                }}
              />
              <Scatter data={scatter} isAnimationActive={false}>
                {scatter.map(r => <Cell key={r.key} fill={ZONE[zoneOf(r)].dot} fillOpacity={0.75} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 pb-2 text-[11px] text-gray-500">
            {(['saine', 'faible', 'perte'] as const).map(z => (
              <span key={z} className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: ZONE[z].dot }} />
                {ZONE[z].label}
              </span>
            ))}
            <span className="ml-auto italic">Taille du point = honoraires</span>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 px-4 sm:px-5 py-2.5 border-t border-gray-100 text-[11.5px] font-semibold text-gray-600 hover:bg-gray-50"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        Détail par client ({rows.length})
      </button>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[880px]">
            <thead>
              <tr className="bg-[#F9FAFB] border-y border-gray-200 text-[10.5px] font-semibold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-2.5">Client</th>
                <th className="px-3 py-2.5 text-right">Heures</th>
                <th className="px-3 py-2.5 text-right">Coût du temps</th>
                <th className="px-3 py-2.5 text-right">Honoraires</th>
                <th className="px-3 py-2.5 text-right">Marge</th>
                <th className="px-3 py-2.5 text-right">Taux</th>
                <th className="px-3 py-2.5 text-right">Hon./h</th>
                <th className="px-3 py-2.5 text-right">Reste dû</th>
              </tr>
            </thead>
            <tbody className="text-[12px] divide-y divide-gray-50">
              {rows.map(r => {
                const zone = zoneOf(r);
                return (
                  <tr
                    key={r.key}
                    onClick={() => onOpenClient?.(r.key, r.name)}
                    className={`hover:bg-gray-50 transition-colors ${onOpenClient ? 'cursor-pointer' : ''}`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ZONE[zone].dot }} />
                        <span className="font-medium text-gray-900 truncate" title={r.name}>{r.name}</span>
                        {r.tachesSansTaux > 0 && (
                          <span
                            title={`${r.tachesSansTaux} tâche(s) sans coût employeur — le coût et la marge de ce client sont surévalués.`}
                            className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 text-[9.5px] font-bold shrink-0"
                          >
                            {r.tachesSansTaux} sans taux
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-600">{hoursLabel(r.heures)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-600">{money(r.cout)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-900 font-semibold">
                      {r.honoraires > 0 ? money(r.honoraires) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono font-semibold ${r.marge < 0 ? 'text-late-fg' : 'text-gray-900'}`}>
                      {money(r.marge)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {/* Indéfini quand rien n'a été facturé : « n/a », jamais 0 % ni −100 %. */}
                      {r.tauxMarge === null ? (
                        <span className="text-gray-300" title="Aucun honoraire facturé sur la période : le taux de marge n'a pas de sens.">n/a</span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${ZONE[zone].chip}`}>
                          {Math.round(r.tauxMarge * 100)} %
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-600">
                      {r.honorairesParHeure == null ? <span className="text-gray-300">—</span> : nf(r.honorairesParHeure, 1)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-600">
                      {r.resteAPayer > 0 ? nf(r.resteAPayer) : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-[#F9FAFB] border-t border-gray-200 text-[12px] font-bold text-gray-900">
                <td className="px-4 py-2.5">Total ({rows.length})</td>
                <td className="px-3 py-2.5 text-right font-mono">{hoursLabel(totals.heures)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{money(totals.cout)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{money(totals.honoraires)}</td>
                <td className={`px-3 py-2.5 text-right font-mono ${totals.marge < 0 ? 'text-late-fg' : ''}`}>{money(totals.marge)}</td>
                <td className="px-3 py-2.5 text-right">
                  {totals.honoraires > 0 ? `${Math.round((totals.marge / totals.honoraires) * 100)} %` : '—'}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">
                  {totals.heures > 0 && totals.honoraires > 0 ? nf(totals.honoraires / totals.heures, 1) : '—'}
                </td>
                <td className="px-3 py-2.5" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};
