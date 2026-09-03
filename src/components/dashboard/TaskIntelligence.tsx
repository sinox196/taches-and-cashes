import React, { useMemo, useState } from 'react';
import { ListTree, ChevronDown, ChevronRight, Search, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

interface TaskTypeRow {
  name: string;
  heures: number;
  taches: number;
  tachesSansTaux: number;
  cout?: number;
}

interface MissionRow {
  pole: string;
  heures: number;
  heuresPrev: number;
  taches: number;
  tachesSansTaux: number;
  collaborateurs: number;
  clients: number;
  dureeMoyenneH: number;
  cout?: number;
  taskTypes: TaskTypeRow[];
}

interface Props {
  missions: MissionRow[];
}

const nf = (n: number, d = 0) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

const hoursLabel = (h: number) => {
  const whole = Math.floor(h);
  return `${nf(whole)}h${String(Math.round((h - whole) * 60)).padStart(2, '0')}`;
};

const money = (n: number) => (n !== 0 && Math.abs(n) < 0.5 ? nf(n, 3) : nf(n));

type SortField = 'pole' | 'heures' | 'cout' | 'taches' | 'dureeMoyenneH' | 'collaborateurs' | 'clients';
type SortDirection = 'asc' | 'desc';

const fieldRaw = (r: MissionRow, field: SortField): number | string | undefined => {
  switch (field) {
    case 'pole': return r.pole.toLowerCase();
    default: return r[field];
  }
};

/**
 * Où part le temps, mission par mission puis type de tâche par type de
 * tâche — heures et coût employeur uniquement, jamais de marge ni de
 * rentabilité : rien ne relie une tâche à une facture (voir « Ce qui n'est
 * délibérément pas construit » dans le Tableau de bord Direction), donc
 * l'inventer ici serait exactement ce que la règle des taux interdit
 * ailleurs sur cet écran. C'est un outil opérationnel — « où est le temps
 * consommé » — pas un outil de tarification.
 */
export const TaskIntelligence: React.FC<Props> = ({ missions }) => {
  const [query, setQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('heures');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [expandedMission, setExpandedMission] = useState<string | null>(null);
  const [tableExpanded, setTableExpanded] = useState(true);

  const showMoney = (missions || []).some(m => m.cout !== undefined);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'pole' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-gray-300 group-hover/th:text-gray-500 inline ml-1 transition-colors" />;
    return sortDirection === 'asc'
      ? <ArrowUp className="w-3 h-3 text-navy inline ml-1" />
      : <ArrowDown className="w-3 h-3 text-navy inline ml-1" />;
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = (missions || []).filter(m => !q || m.pole.toLowerCase().includes(q));
    return [...out].sort((a, b) => {
      const av = fieldRaw(a, sortField);
      const bv = fieldRaw(b, sortField);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') {
        return sortDirection === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      }
      return sortDirection === 'asc' ? av - (bv as number) : (bv as number) - av;
    });
  }, [missions, query, sortField, sortDirection]);

  const totals = useMemo(() => rows.reduce(
    (a, r) => ({
      heures: a.heures + r.heures,
      cout: a.cout + (r.cout ?? 0),
      taches: a.taches + r.taches,
    }),
    { heures: 0, cout: 0, taches: 0 }
  ), [rows]);

  if (!missions || missions.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs p-8 text-center">
        <ListTree className="w-8 h-8 text-gray-300 mx-auto mb-3" />
        <p className="text-[13px] text-gray-500">Aucune tâche pointée sur la période sélectionnée.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
      <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-extrabold text-gray-800 uppercase tracking-wide">
            Missions &amp; types de tâche
          </h2>
          <p className="text-[11.5px] text-gray-400 mt-0.5">
            Où part le temps consommé — heures et coût employeur, pas une rentabilité (rien ne relie une tâche à une facture).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <div className="relative flex-1 min-w-[150px] lg:flex-none">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filtrer une mission…"
              className="pl-8 pr-3 py-1.5 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 w-full lg:w-48"
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setTableExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 px-4 sm:px-5 py-2.5 text-[11.5px] font-semibold text-gray-600 hover:bg-gray-50"
      >
        {tableExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        Détail par mission ({rows.length})
      </button>

      {tableExpanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead>
              <tr className="bg-[#F9FAFB] border-y border-gray-200 text-[10.5px] font-semibold text-gray-500 uppercase tracking-wider">
                <th onClick={() => handleSort('pole')} className="px-4 py-2.5 cursor-pointer select-none group/th hover:bg-gray-100 transition-colors">
                  Mission {renderSortIcon('pole')}
                </th>
                <th onClick={() => handleSort('heures')} className="px-3 py-2.5 text-right cursor-pointer select-none group/th hover:bg-gray-100 transition-colors">
                  Heures {renderSortIcon('heures')}
                </th>
                {showMoney && (
                  <th onClick={() => handleSort('cout')} className="px-3 py-2.5 text-right cursor-pointer select-none group/th hover:bg-gray-100 transition-colors">
                    Coût {renderSortIcon('cout')}
                  </th>
                )}
                <th onClick={() => handleSort('taches')} className="px-3 py-2.5 text-right cursor-pointer select-none group/th hover:bg-gray-100 transition-colors">
                  Tâches {renderSortIcon('taches')}
                </th>
                <th onClick={() => handleSort('dureeMoyenneH')} className="px-3 py-2.5 text-right cursor-pointer select-none group/th hover:bg-gray-100 transition-colors">
                  Durée moy. {renderSortIcon('dureeMoyenneH')}
                </th>
                <th onClick={() => handleSort('collaborateurs')} className="px-3 py-2.5 text-right cursor-pointer select-none group/th hover:bg-gray-100 transition-colors">
                  Collab. {renderSortIcon('collaborateurs')}
                </th>
                <th onClick={() => handleSort('clients')} className="px-3 py-2.5 text-right cursor-pointer select-none group/th hover:bg-gray-100 transition-colors">
                  Clients {renderSortIcon('clients')}
                </th>
              </tr>
            </thead>
            <tbody className="text-[12px] divide-y divide-gray-50">
              {rows.map(r => {
                const isOpen = expandedMission === r.pole;
                return (
                  <React.Fragment key={r.pole}>
                    <tr
                      onClick={() => setExpandedMission(isOpen ? null : r.pole)}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                          <span className="font-medium text-gray-900 truncate" title={r.pole}>{r.pole}</span>
                          {r.tachesSansTaux > 0 && (
                            <span
                              title={`${r.tachesSansTaux} tâche(s) sans coût employeur — le coût de cette mission est sous-évalué.`}
                              className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 text-[9.5px] font-bold shrink-0"
                            >
                              {r.tachesSansTaux} sans taux
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-900 font-semibold">{hoursLabel(r.heures)}</td>
                      {showMoney && (
                        <td className="px-3 py-2.5 text-right font-mono text-gray-600">
                          {r.cout !== undefined ? money(r.cout) : <span className="text-gray-300">—</span>}
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-right font-mono text-gray-600">{r.taches}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-600">{hoursLabel(r.dureeMoyenneH)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-600">{r.collaborateurs}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-600">{r.clients}</td>
                    </tr>
                    {isOpen && r.taskTypes.map(t => (
                      <tr key={`${r.pole}::${t.name}`} className="bg-[#FAFBFC]">
                        <td className="px-4 py-2 pl-11">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-gray-600 truncate" title={t.name}>{t.name}</span>
                            {t.tachesSansTaux > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 text-[9px] font-bold shrink-0">
                                {t.tachesSansTaux} sans taux
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-gray-500">{hoursLabel(t.heures)}</td>
                        {showMoney && (
                          <td className="px-3 py-2 text-right font-mono text-gray-500">
                            {t.cout !== undefined ? money(t.cout) : <span className="text-gray-300">—</span>}
                          </td>
                        )}
                        <td className="px-3 py-2 text-right font-mono text-gray-500">{t.taches}</td>
                        <td className="px-3 py-2 text-right" />
                        <td className="px-3 py-2 text-right" />
                        <td className="px-3 py-2 text-right" />
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-[#F9FAFB] border-t border-gray-200 text-[12px] font-bold text-gray-900">
                <td className="px-4 py-2.5">Total ({rows.length})</td>
                <td className="px-3 py-2.5 text-right font-mono">{hoursLabel(totals.heures)}</td>
                {showMoney && <td className="px-3 py-2.5 text-right font-mono">{money(totals.cout)}</td>}
                <td className="px-3 py-2.5 text-right font-mono">{totals.taches}</td>
                <td className="px-3 py-2.5" colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};
