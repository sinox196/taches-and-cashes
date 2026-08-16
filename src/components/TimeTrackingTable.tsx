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
} from 'lucide-react';
import { TimeEntry } from '../types';
import { useAuth } from '../context/AuthContext';

interface TimeTrackingTableProps {
  entries: TimeEntry[];
  onEdit: (entry: TimeEntry) => void;
  onDelete: (id: string) => void;
  onMore: (entry: TimeEntry) => void;
  onSelectAsActive?: (entry: TimeEntry) => void;
}

export const TimeTrackingTable: React.FC<TimeTrackingTableProps & { hasRunningTask?: boolean }> = ({
  hasRunningTask = false,
  entries,
  onEdit,
  onDelete,
  onMore,
  onSelectAsActive,
}) => {
  const { hasPermission, user } = useAuth();
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


  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm mt-6 flex flex-col overflow-hidden font-sans">
      {/* Card Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-[13px] font-bold text-gray-800 uppercase tracking-wide">
            MON TIME TRACKING
          </h2>
          <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
            {filteredEntries.length} entrées
          </span>
        </div>

        {/* Header Controls: Search & Filter */}
        <div className="flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">
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

          {/* Pôle Filter */}
          <div className="relative">
            <select
              value={poleFilter}
              onChange={(e) => setPoleFilter(e.target.value)}
              className="appearance-none bg-white border border-gray-200 hover:border-gray-300 rounded-md pl-2.5 pr-7 py-1 text-[11px] font-semibold text-gray-700 focus:outline-none focus:border-gray-400 cursor-pointer max-w-[110px] truncate"
            >
              <option value="ALL">Tous (Pôles)</option>
              {uniquePoles.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <Filter className="w-3 h-3 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Status Filter */}
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="appearance-none bg-white border border-gray-200 hover:border-gray-300 rounded-md pl-2.5 pr-7 py-1 text-[11px] font-semibold text-gray-700 focus:outline-none focus:border-gray-400 cursor-pointer max-w-[110px] truncate"
            >
              <option value="ALL">Tous (Statuts)</option>
              <option value="COMPLETED">Completed</option>
              <option value="RUNNING">Running</option>
              <option value="PAUSED">Paused</option>
            </select>
            <Filter className="w-3 h-3 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-[11px] text-gray-500 font-bold uppercase select-none">
              <th className="px-4 py-2.5">Collaborateur</th>
              <th className="px-4 py-2.5">Date</th>
              <th className="px-4 py-2.5">Client</th>
              <th className="px-4 py-2.5">Description de l'activité</th>
              <th className="px-4 py-2.5">Pôle</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Début</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Fin</th>
              <th className="px-4 py-2.5">Durée</th>
              {isAdmin && <th className="px-4 py-2.5 whitespace-nowrap">Coût</th>}
              <th className="px-4 py-2.5">Statut</th>
              {isAdmin && <th className="px-4 py-2.5 text-center">Actions</th>}
            </tr>
          </thead>
          {filteredEntries.length === 0 ? (
            <tbody className="text-[11.5px] divide-y divide-gray-50 text-gray-800">
              <tr>
                <td colSpan={isAdmin ? 11 : 9} className="py-8 text-center text-gray-400 italic">
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
                  <td colSpan={isAdmin ? 11 : 9} className="px-4 py-2 font-bold text-gray-700 uppercase tracking-wider text-[10px]">
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
                  <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                    {row.userName || 'Unknown'}
                  </td>
                  {/* Date */}
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">
                    {row.date}
                  </td>

                  {/* Client */}
                  <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                    {row.client}
                  </td>

                  {/* Description */}
                  <td className="px-4 py-2.5 text-gray-600 max-w-xs truncate" title={row.description}>
                    {row.description}
                  </td>

                  {/* Pôle */}
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                    {row.pole}
                  </td>

                  {/* Heure Début */}
                  <td className="px-3 py-2.5 font-mono text-gray-600 whitespace-nowrap">
                    {row.heureDebut}
                  </td>

                  {/* Heure Fin */}
                  <td className="px-3 py-2.5 font-mono text-gray-600 whitespace-nowrap">
                    {row.heureFin}
                  </td>

                  {/* Durée */}
                  <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                    {row.duree}
                  </td>

                  {/* Coût Calculé */}
                  {isAdmin && (
                    <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                      {row.coutCalcule}
                    </td>
                  )}

                  {/* Statut */}
                  <td className="px-4 py-2.5 whitespace-nowrap">
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
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
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
        <span>Affichage de {filteredEntries.length} sur {entries.length} activités</span>
        {isAdmin && (
          <span>Coût total calculé: <strong className="text-gray-800 font-bold">106,005 DT</strong></span>
        )}
      </div>
    </div>
  );
};
