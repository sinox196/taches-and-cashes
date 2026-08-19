import React, { useState } from 'react';
import {
  Pencil,
  Trash2,
  MoreVertical,
  Search,
  Filter,
  ArrowUpDown,
  Download,
  ChevronDown,
  ChevronRight,
  Play,
  Pause,
  Square,
} from 'lucide-react';
import { TimeEntry, TaskStatus } from '../types';
import { useAuth } from '../context/AuthContext';
import { formatCostDT } from '../utils/formatters';
import { usePresence } from '../context/PresenceContext';
import { PresenceBadge } from './PresenceBadge';

interface TimeTrackingTableProps {
  entries: TimeEntry[];
  onEdit: (entry: TimeEntry) => void;
  onDelete: (id: string) => void;
  onMore: (entry: TimeEntry) => void;
  onSelectAsActive?: (entry: TimeEntry) => void;
  /** Admin override: change any collaborator's task status directly. */
  onChangeStatus?: (entry: TimeEntry, statut: TaskStatus) => void;
  /** Entries held server-side; the table shows the most recent page of them. */
  totalEntries?: number;
}

export const TimeTrackingTable: React.FC<TimeTrackingTableProps & { hasRunningTask?: boolean }> = ({
  hasRunningTask = false,
  entries,
  onEdit,
  onDelete,
  onMore,
  onSelectAsActive,
  onChangeStatus,
  totalEntries,
}) => {
  const { hasPermission, user } = useAuth();
  const { presenceOf } = usePresence();
  const isAdmin = user?.role === 'ADMIN';
  const [collapsedMonths, setCollapsedMonths] = useState<Record<string, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'RUNNING' | 'PAUSED'>('ALL');

  const toggleMonth = (monthKey: string) => {
    setCollapsedMonths(prev => ({
      ...prev,
      [monthKey]: !prev[monthKey]
    }));
  };
  const [clientFilter, setClientFilter] = useState('ALL');
  const [poleFilter, setPoleFilter] = useState('ALL');
  const [collabFilter, setCollabFilter] = useState('ALL');

  const uniqueClients = Array.from(new Set(entries.map(e => e.client))).sort();
  const uniquePoles = Array.from(new Set(entries.map(e => e.pole))).sort();
  const uniqueCollaborateurs = Array.from(new Set(entries.map(e => e.userName || 'Unknown'))).sort();

  // Filter entries based on search & status
  const filteredEntries = entries.filter((item) => {
    const matchesStatus =
      statusFilter === 'ALL' ? true : item.statut === statusFilter;
      
    const matchesClient = clientFilter === 'ALL' || item.client === clientFilter;
    const matchesPole = poleFilter === 'ALL' || item.pole === poleFilter;
    const matchesCollab = collabFilter === 'ALL' || (item.userName || 'Unknown') === collabFilter;

    return matchesStatus && matchesClient && matchesPole && matchesCollab;
  });

  // Group by month
  const MONTHS = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ];
  
  const groupedEntries = filteredEntries.reduce((acc, entry) => {
    // entry.date is DD/MM/YYYY
    const [day, month, year] = entry.date.split('/');
    if (month && year) {
      const monthKey = `${year}-${month}`; // YYYY-MM
      if (!acc[monthKey]) {
        acc[monthKey] = {
          label: `${MONTHS[parseInt(month, 10) - 1]} ${year}`,
          entries: []
        };
      }
      acc[monthKey].entries.push(entry);
    } else {
      // fallback for weird dates
      const fallbackKey = 'Unknown';
      if (!acc[fallbackKey]) acc[fallbackKey] = { label: 'Inconnu', entries: [] };
      acc[fallbackKey].entries.push(entry);
    }
    return acc;
  }, {});

  const sortedMonthKeys = Object.keys(groupedEntries).sort((a, b) => b.localeCompare(a));

  // Only price work whose collaborator has an employer cost configured; the
  // rest is reported separately instead of being costed at a made-up rate.
  const pricedEntries = filteredEntries.filter(e => e.hourlyRate != null);
  const unpricedCount = filteredEntries.length - pricedEntries.length;
  const totalCost = pricedEntries.reduce(
    (sum, e) => sum + ((e.dureeSeconds || 0) / 3600) * (e.hourlyRate as number),
    0
  );


  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm mt-6 flex flex-col overflow-hidden font-sans">
      {/* Card Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 shrink-0">
          <h2 className="text-[13px] font-extrabold text-gray-800 uppercase tracking-wide whitespace-nowrap">
            MON TIME TRACKING
          </h2>
          <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
            {filteredEntries.length} entrées
          </span>
        </div>

        {/* Header Controls: Search & Filter */}
        <div className="flex flex-wrap items-center justify-end gap-2 min-w-0">
          {/* Collaborator Filter */}
          {isAdmin && (
            <div className="relative">
              <select
                value={collabFilter}
                onChange={(e) => setCollabFilter(e.target.value)}
                className="appearance-none bg-white border border-gray-200 hover:border-gray-300 rounded-md pl-2.5 pr-7 py-1 text-[11px] font-semibold text-gray-700 focus:outline-none focus:border-gray-400 cursor-pointer max-w-[130px] truncate"
              >
                <option value="ALL">Tous (Collabs)</option>
                {uniqueCollaborateurs.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <Filter className="w-3 h-3 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}

          {/* Client Filter */}
          <div className="relative">
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="appearance-none bg-white border border-gray-200 hover:border-gray-300 rounded-md pl-2.5 pr-7 py-1 text-[11px] font-semibold text-gray-700 focus:outline-none focus:border-gray-400 cursor-pointer max-w-[130px] truncate"
            >
              <option value="ALL">Tous (Clients)</option>
              {uniqueClients.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <Filter className="w-3 h-3 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Mission Filter */}
          <div className="relative">
            <select
              value={poleFilter}
              onChange={(e) => setPoleFilter(e.target.value)}
              className="appearance-none bg-white border border-gray-200 hover:border-gray-300 rounded-md pl-2.5 pr-7 py-1 text-[11px] font-semibold text-gray-700 focus:outline-none focus:border-gray-400 cursor-pointer max-w-[110px] truncate"
            >
              <option value="ALL">Toutes (Missions)</option>
              {uniquePoles.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <Filter className="w-3 h-3 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Status: a segmented control rather than a dropdown — four states,
              constantly switched, worth showing without opening a menu. */}
          <div className="flex items-center gap-1.5">
            {([
              ['ALL', 'Tous'],
              ['RUNNING', 'En cours'],
              ['PAUSED', 'En pause'],
              ['COMPLETED', 'Terminées'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setStatusFilter(value)}
                aria-pressed={statusFilter === value}
                className={`px-3 py-1.5 rounded-lg border text-[11.5px] font-bold transition-colors ${
                  statusFilter === value
                    ? 'bg-navy border-navy text-white'
                    : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table Container */}
      {/* Only scrolls below a genuinely narrow viewport; at desktop widths the
          fixed layout below makes every column fit. */}
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-left border-collapse min-w-[880px]">
          <colgroup>
            <col className={isAdmin ? 'w-[10%]' : 'w-[11%]'} />{/* Collaborateur */}
            <col className="w-[7.5%]" />{/* Date */}
            <col className={isAdmin ? 'w-[9%]' : 'w-[12%]'} />{/* Client */}
            <col className={isAdmin ? 'w-[11%]' : 'w-[16%]'} />{/* Description */}
            <col className={isAdmin ? 'w-[9%]' : 'w-[13%]'} />{/* Mission */}
            <col className={isAdmin ? 'w-[9%]' : 'w-[13%]'} />{/* Type de tâche */}
            <col className="w-[5%]" />{/* Début */}
            <col className="w-[5%]" />{/* Fin */}
            <col className={isAdmin ? 'w-[6.5%]' : 'w-[8%]'} />{/* Durée */}
            {isAdmin && <col className="w-[7%]" />}{/* Coût */}
            <col className={isAdmin ? 'w-[8%]' : 'w-[9.5%]'} />{/* Statut */}
            {isAdmin && <col className="w-[13%]" />}{/* Actions */}
          </colgroup>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-[10px] text-gray-500 font-extrabold uppercase tracking-[0.04em] select-none">
              <th className="px-3 py-2.5 truncate">Collaborateur</th>
              <th className="px-2 py-2.5 truncate">Date</th>
              <th className="px-2 py-2.5 truncate">Client</th>
              <th className="px-2 py-2.5 truncate">Description</th>
              <th className="px-2 py-2.5 truncate">Mission</th>
              <th className="px-2 py-2.5 truncate">Type</th>
              <th className="px-2 py-2.5 truncate">Début</th>
              <th className="px-2 py-2.5 truncate">Fin</th>
              <th className="px-2 py-2.5 truncate">Durée</th>
              {isAdmin && <th className="px-2 py-2.5 truncate">Coût</th>}
              <th className="px-2 py-2.5 truncate">Statut</th>
              {isAdmin && <th className="px-2 py-2.5 text-center truncate">Actions</th>}
            </tr>
          </thead>
          {filteredEntries.length === 0 ? (
            <tbody className="text-[11.5px] divide-y divide-gray-50 text-gray-800">
              <tr>
                <td colSpan={isAdmin ? 12 : 10} className="py-8 text-center text-gray-400 italic">
                  Aucune donnée ne correspond à votre recherche.
                </td>
              </tr>
            </tbody>
          ) : (
            sortedMonthKeys.map((monthKey) => {
              const isCollapsed = collapsedMonths[monthKey];
              return (
              <tbody key={monthKey} className="text-[11.5px] divide-y divide-gray-50 text-gray-800">
                <tr 
                  className="bg-gray-100/50 cursor-pointer hover:bg-gray-200/50 transition-colors"
                  onClick={() => toggleMonth(monthKey)}
                >
                  <td colSpan={isAdmin ? 12 : 10} className="px-4 py-2 font-bold text-gray-700 uppercase tracking-wider text-[10px]">
                    <div className="flex items-center gap-1.5 select-none">
                      {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                      {groupedEntries[monthKey].label}
                      <span className="ml-2 font-normal text-gray-500 normal-case">
                        ({groupedEntries[monthKey].entries.length} {groupedEntries[monthKey].entries.length > 1 ? 'activités' : 'activité'})
                      </span>
                    </div>
                  </td>
                </tr>
                {!isCollapsed && groupedEntries[monthKey].entries.map((row) => (
                <tr
                  key={row.id}
                  className={`hover:bg-gray-50/80 transition-colors ${
                    row.statut === 'RUNNING' ? 'bg-[#FFFAEB]/30' : ''
                  }`}
                >
                  {/* Collaborator */}
                  <td className="px-3 py-2.5 font-medium text-gray-900 truncate" title={row.userName || 'Unknown'}>
                    <span className="inline-flex items-center gap-1.5 max-w-full">
                      {(() => { const p = presenceOf(row.userId);
                        return <PresenceBadge state={p.state} idleMs={p.idleMs} variant="dot" />; })()}
                      {row.userName || 'Unknown'}
                    </span>
                  </td>
                  {/* Date */}
                  <td className="px-2 py-2.5 whitespace-nowrap text-gray-600">
                    {row.date}
                  </td>

                  {/* Client */}
                  <td className="px-2 py-2.5 font-medium text-gray-900 truncate" title={row.client}>
                    {row.client}
                  </td>

                  {/* Description */}
                  <td className="px-2 py-2.5 text-gray-600 truncate" title={row.description}>
                    {row.description}
                  </td>

                  {/* Mission */}
                  <td className="px-2 py-2.5 text-gray-600 truncate" title={row.pole}>
                    {row.pole}
                  </td>

                  {/* Type de tâche */}
                  <td className="px-2 py-2.5 text-gray-600 truncate" title={row.taskType || ''}>
                    {row.taskType || <span className="text-gray-300">—</span>}
                  </td>

                  {/* Heure Début */}
                  <td className="px-2 py-2.5 font-mono text-gray-600 truncate">
                    {row.heureDebut}
                  </td>

                  {/* Heure Fin — only a completed task has one */}
                  <td className="px-2 py-2.5 font-mono text-gray-600 truncate">
                    {row.heureFin ? row.heureFin : <span className="text-gray-300">—</span>}
                  </td>

                  {/* Durée */}
                  <td className="px-2 py-2.5 font-medium text-gray-900 truncate" title={row.duree}>
                    {row.duree}
                  </td>

                  {/* Coût employeur accumulé pour cette tâche */}
                  {isAdmin && (
                    <td className="px-2 py-2.5 font-medium text-gray-900 truncate">
                      {row.hourlyRate == null ? (
                        <span
                          className="text-gray-300"
                          title={`Coût employeur non configuré pour ${row.userName || 'ce collaborateur'}`}
                        >
                          —
                        </span>
                      ) : (
                        <span title={`Coût employeur : ${row.hourlyRate.toFixed(3)} DT/h`}>
                          {row.coutCalcule}
                        </span>
                      )}
                    </td>
                  )}

                  {/* Statut */}
                  <td className="px-2 py-2.5">
                    {row.statut === 'COMPLETED' ? (
                      <span className="px-2 py-0.5 rounded-full bg-[#ECFDF3] text-[#12B76A] font-bold text-[9px] uppercase tracking-wide inline-block">
                        COMPLETED
                      </span>
                    ) : (
                      <button
                        disabled={!hasPermission('EDIT') || user?.id !== row.userId || hasRunningTask}
                        onClick={() => onSelectAsActive?.(row)}
                        title={hasPermission('EDIT') && user?.id === row.userId && !hasRunningTask ? "Cliquer pour activer ce chrono" : "Statut de l'activité"}
                        className={`px-2 py-0.5 rounded-full font-bold text-[9px] uppercase tracking-wide inline-block transition-colors ${
                          !hasPermission('EDIT') || user?.id !== row.userId || hasRunningTask ? 'cursor-default opacity-80' : 'cursor-pointer'
                        } ${
                          row.statut === 'RUNNING'
                            ? 'bg-[#FFFAEB] text-[#B54708] ' + (hasPermission('EDIT') && user?.id === row.userId && !hasRunningTask ? 'hover:bg-[#feeec8]' : '')
                            : 'bg-gray-100 text-gray-600 ' + (hasPermission('EDIT') && user?.id === row.userId && !hasRunningTask ? 'hover:bg-gray-200' : '')
                        }`}
                      >
                        {row.statut}
                      </button>
                    )}
                  </td>

                  {/* Actions Column */}
                  {isAdmin && (
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        {/* Timer controls — an admin can drive any collaborator's
                            task, not just their own. */}
                        {onChangeStatus && row.statut !== 'COMPLETED' && (
                          <>
                            {row.statut === 'RUNNING' ? (
                              <button
                                onClick={() => onChangeStatus(row, 'PAUSED')}
                                className="w-6 h-6 border border-gray-200 rounded flex items-center justify-center bg-white text-gray-400 hover:text-amber-600 hover:border-amber-200 transition-colors"
                                title={`Mettre en pause la tâche de ${row.userName || 'ce collaborateur'}`}
                              >
                                <Pause className="w-3 h-3 fill-current" />
                              </button>
                            ) : (
                              <button
                                onClick={() => onChangeStatus(row, 'RUNNING')}
                                className="w-6 h-6 border border-gray-200 rounded flex items-center justify-center bg-white text-gray-400 hover:text-emerald-600 hover:border-emerald-200 transition-colors"
                                title={`Reprendre la tâche de ${row.userName || 'ce collaborateur'}`}
                              >
                                <Play className="w-3 h-3 fill-current" />
                              </button>
                            )}
                            <button
                              onClick={() => onChangeStatus(row, 'COMPLETED')}
                              className="w-6 h-6 border border-gray-200 rounded flex items-center justify-center bg-white text-gray-400 hover:text-red-600 hover:border-red-200 transition-colors"
                              title="Arrêter et clôturer cette tâche"
                            >
                              <Square className="w-3 h-3 fill-current" />
                            </button>
                          </>
                        )}

                        {/* Edit button */}
                        {hasPermission('EDIT') && (user?.id === row.userId || user?.role === 'ADMIN') && (
                          <button
                            onClick={() => onEdit(row)}
                            className="w-6 h-6 border border-gray-200 rounded flex items-center justify-center bg-white text-gray-400 hover:text-gray-700 hover:border-gray-300 transition-colors"
                            title="Modifier"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}

                        {/* Delete button */}
                        {hasPermission('DELETE') && (user?.id === row.userId || user?.role === 'ADMIN') && (
                          <button
                            onClick={() => onDelete(row.id)}
                            className="w-6 h-6 border border-gray-200 rounded flex items-center justify-center bg-white text-gray-400 hover:text-red-600 hover:border-red-200 transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}

                        {/* More button */}
                        <button
                          onClick={() => onMore(row)}
                          className="w-6 h-6 border border-gray-200 rounded flex items-center justify-center bg-white text-gray-400 hover:text-gray-700 hover:border-gray-300 transition-colors"
                          title="Options"
                        >
                          <MoreVertical className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
                ))}
              </tbody>
            )})
          )}
        </table>
      </div>

      {/* Footer info bar */}
      <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 text-[11px] text-gray-500 flex items-center justify-between">
        <span>
          Affichage de {filteredEntries.length} sur {entries.length} activités
          {totalEntries != null && totalEntries > entries.length && (
            <span className="text-gray-400">
              {' '}· {totalEntries} au total (les {entries.length} plus récentes sont chargées)
            </span>
          )}
        </span>
        {isAdmin && (
          <span className="flex items-center gap-2">
            {unpricedCount > 0 && (
              <span
                className="text-amber-600"
                title="Renseignez le salaire et le régime horaire de ces collaborateurs dans Utilisateurs pour les inclure."
              >
                {unpricedCount} activité{unpricedCount > 1 ? 's' : ''} sans coût employeur
              </span>
            )}
            <span>
              Coût employeur total:{' '}
              <strong className="text-gray-800 font-bold">{formatCostDT(totalCost)}</strong>
            </span>
          </span>
        )}
      </div>
    </div>
  );
};
