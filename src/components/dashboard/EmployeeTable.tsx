import React, { useState, useMemo } from 'react';
import { User, Shield, ArrowUpDown, ArrowUp, ArrowDown, Clock, DollarSign, ListFilter } from 'lucide-react';
import { formatDurationHoursMinutes, formatCostTND } from '../../utils/formatters';
import { roleMeta, roleLabel } from '../../constants/roles';
import { useAuth } from '../../context/AuthContext';
import { usePresence } from '../../context/PresenceContext';
import { PresenceBadge } from '../PresenceBadge';

interface EmployeeTableProps {
  employees: any[];
  onRowClick: (emp: any) => void;
  /** Drill into the tasks behind an employee's "Clients traités" figure. */
  onClientsClick?: (emp: any) => void;
}

type SortField = 
  | 'name' 
  | 'role' 
  | 'tasks' 
  | 'completed' 
  | 'inProgress' 
  | 'paused' 
  | 'clients' 
  | 'duration' 
  | 'cost' 
  | 'leavesTaken' 
  | 'leavesRemaining' 
  | 'authorizations'
  | 'completionRate'
  | 'punctuality';

type SortDirection = 'asc' | 'desc';

export const EmployeeTable: React.FC<EmployeeTableProps> = ({ employees, onRowClick, onClientsClick }) => {
  const { user } = useAuth();
  const { presenceOf } = usePresence();
  const isAdmin = user?.role === 'ADMIN';
  const [sortField, setSortField] = useState<SortField>('duration');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedEmployees = useMemo(() => {
    return [...employees].sort((a, b) => {
      let valA: any = 0;
      let valB: any = 0;

      switch (sortField) {
        case 'name':
          valA = (a.name || '').toLowerCase();
          valB = (b.name || '').toLowerCase();
          return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'role':
          valA = (a.role || '').toLowerCase();
          valB = (b.role || '').toLowerCase();
          return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'tasks':
          valA = a.tasks?.total || 0;
          valB = b.tasks?.total || 0;
          break;
        case 'completed':
          valA = a.tasks?.completed || 0;
          valB = b.tasks?.completed || 0;
          break;
        case 'inProgress':
          valA = a.tasks?.inProgress || 0;
          valB = b.tasks?.inProgress || 0;
          break;
        case 'paused':
          valA = a.tasks?.paused || 0;
          valB = b.tasks?.paused || 0;
          break;
        case 'clients':
          valA = a.clients?.totalHandled || 0;
          valB = b.clients?.totalHandled || 0;
          break;
        case 'duration':
          valA = a.totalDurationSeconds ?? a.tasks?.totalDurationSeconds ?? 0;
          valB = b.totalDurationSeconds ?? b.tasks?.totalDurationSeconds ?? 0;
          break;
        case 'cost':
          valA = a.totalCost ?? a.tasks?.totalCost ?? 0;
          valB = b.totalCost ?? b.tasks?.totalCost ?? 0;
          break;
        case 'leavesTaken':
          valA = a.leaves?.daysTaken || 0;
          valB = b.leaves?.daysTaken || 0;
          break;
        case 'leavesRemaining':
          valA = a.leaves?.balance?.available ?? 0;
          valB = b.leaves?.balance?.available ?? 0;
          break;
        case 'authorizations':
          valA = a.authorizations?.total || 0;
          valB = b.authorizations?.total || 0;
          break;
        case 'completionRate':
          valA = a.tasks?.completionRate || 0;
          valB = b.tasks?.completionRate || 0;
          break;
        case 'punctuality':
          valA = a.attendance?.punctualityRate ?? -1;
          valB = b.attendance?.punctualityRate ?? -1;
          break;
        default:
          valA = 0;
          valB = 0;
      }

      if (sortDirection === 'asc') {
        return valA > valB ? 1 : valA < valB ? -1 : 0;
      } else {
        return valA < valB ? 1 : valA > valB ? -1 : 0;
      }
    });
  }, [employees, sortField, sortDirection]);

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-gray-300 group-hover/th:text-gray-500 inline ml-1 transition-colors" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-blue-600 inline ml-1" />
      : <ArrowDown className="w-3 h-3 text-blue-600 inline ml-1" />;
  };

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden flex flex-col">
      <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-bold text-gray-900">Performance des collaborateurs</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">Vue consolidée des activités opérationnelles, durées, coûts et RH</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-gray-500 flex items-center gap-1">
            <ListFilter className="w-3.5 h-3.5" />
            Trier par:
          </span>
          <select 
            value={sortField} 
            onChange={(e) => handleSort(e.target.value as SortField)}
            className="text-[12px] bg-gray-50 border border-gray-200 text-gray-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer font-medium"
          >
            <option value="duration">Durée totale</option>
            {isAdmin && <option value="cost">Coût employeur</option>}
            <option value="tasks">Nombre de tâches</option>
            <option value="completed">Tâches terminées</option>
            <option value="clients">Nombre de clients</option>
            <option value="completionRate">Taux de réalisation</option>
            <option value="leavesTaken">Congés pris</option>
            <option value="authorizations">Autorisations</option>
            <option value="name">Collaborateur (A-Z)</option>
          </select>
          <button
            onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
            title={sortDirection === 'asc' ? 'Ordre croissant' : 'Ordre décroissant'}
            className="p-1.5 text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
          >
            {sortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600" />}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left whitespace-nowrap">
          <thead>
            <tr className="bg-[#F9FAFB] border-b border-gray-200">
              <th 
                onClick={() => handleSort('name')}
                className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none group/th hover:bg-gray-100 transition-colors"
              >
                Collaborateur {renderSortIcon('name')}
              </th>
              <th 
                onClick={() => handleSort('role')}
                className="px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none group/th hover:bg-gray-100 transition-colors text-center"
              >
                Rôle {renderSortIcon('role')}
              </th>
              <th 
                onClick={() => handleSort('tasks')}
                className="px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none group/th hover:bg-gray-100 transition-colors text-center"
              >
                Tâches {renderSortIcon('tasks')}
              </th>
              <th 
                onClick={() => handleSort('completed')}
                className="px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none group/th hover:bg-gray-100 transition-colors text-center"
              >
                Terminées {renderSortIcon('completed')}
              </th>
              <th 
                onClick={() => handleSort('inProgress')}
                className="px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none group/th hover:bg-gray-100 transition-colors text-center"
              >
                En cours {renderSortIcon('inProgress')}
              </th>
              <th 
                onClick={() => handleSort('paused')}
                className="px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none group/th hover:bg-gray-100 transition-colors text-center"
              >
                Paused {renderSortIcon('paused')}
              </th>
              <th 
                onClick={() => handleSort('clients')}
                className="px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none group/th hover:bg-gray-100 transition-colors text-center"
              >
                Clients {renderSortIcon('clients')}
              </th>
              <th 
                onClick={() => handleSort('duration')}
                className="px-4 py-3 text-[11px] font-semibold text-gray-600 uppercase tracking-wider cursor-pointer select-none group/th hover:bg-gray-100 transition-colors text-center bg-blue-50/40"
              >
                Durée totale {renderSortIcon('duration')}
              </th>
              {isAdmin && (
                <th
                  onClick={() => handleSort('cost')}
                  className="px-4 py-3 text-[11px] font-semibold text-gray-600 uppercase tracking-wider cursor-pointer select-none group/th hover:bg-gray-100 transition-colors text-center bg-emerald-50/40"
                >
                  Coût employeur {renderSortIcon('cost')}
                </th>
              )}
              <th 
                onClick={() => handleSort('leavesTaken')}
                className="px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none group/th hover:bg-gray-100 transition-colors text-center"
              >
                Congés pris {renderSortIcon('leavesTaken')}
              </th>
              <th 
                onClick={() => handleSort('leavesRemaining')}
                className="px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none group/th hover:bg-gray-100 transition-colors text-center"
              >
                Congés restants {renderSortIcon('leavesRemaining')}
              </th>
              <th 
                onClick={() => handleSort('authorizations')}
                className="px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none group/th hover:bg-gray-100 transition-colors text-center"
              >
                Autorisations {renderSortIcon('authorizations')}
              </th>
              <th
                onClick={() => handleSort('punctuality')}
                className="px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none group/th hover:bg-gray-100 transition-colors text-center"
                title="Pointage : arrivées à l'heure (± 15 min), sur le nombre d'arrivées pointées"
              >
                Ponctualité {renderSortIcon('punctuality')}
              </th>
            </tr>
          </thead>
          <tbody className="text-[12px] divide-y divide-gray-50">
            {sortedEmployees.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-5 py-8 text-center text-gray-500 italic">
                  Aucune donnée disponible pour cette période et ces filtres
                </td>
              </tr>
            ) : sortedEmployees.map(emp => {
              const durSecs = emp.totalDurationSeconds ?? emp.tasks?.totalDurationSeconds ?? 0;
              const formattedDuration = emp.totalDurationFormatted ?? formatDurationHoursMinutes(durSecs);
              
              const rawCost = emp.totalCost ?? emp.tasks?.totalCost ?? 0;
              const formattedCost = emp.totalCostFormatted ?? formatCostTND(rawCost);

              const daysTaken = emp.leaves?.daysTaken || 0;
              // `available` is already net of days taken — subtracting daysTaken
              // again here used to double-count and understate the remainder.
              const remainingDays = emp.leaves?.balance?.available ?? 0;

              return (
                <tr 
                  key={emp.id} 
                  onClick={() => onRowClick(emp)}
                  className="hover:bg-gray-50 cursor-pointer transition-colors group"
                >
                  {/* Collaborateur */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${roleMeta(emp.role).badgeClass}`}>
                        {roleMeta(emp.role).hasShield ? <Shield className="w-4 h-4" /> : <User className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors flex items-center gap-1.5">
                          {(() => { const p = presenceOf(emp.id);
                            return <PresenceBadge state={p.state} idleMs={p.idleMs} variant="dot" />; })()}
                          {emp.name}
                        </div>
                        <div className="text-[11px] text-gray-400">{emp.department && emp.department !== 'N/A' ? emp.department : roleLabel(emp.role)}</div>
                      </div>
                    </div>
                  </td>

                  {/* Rôle */}
                  <td className="px-3 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border border-current/20 ${roleMeta(emp.role).badgeClass}`}>
                      {roleLabel(emp.role)}
                    </span>
                  </td>

                  {/* Tâches */}
                  <td className="px-3 py-3 text-center font-semibold text-gray-800">{emp.tasks?.total || 0}</td>

                  {/* Terminées */}
                  <td className="px-3 py-3 text-center font-semibold text-emerald-600">{emp.tasks?.completed || 0}</td>

                  {/* En cours */}
                  <td className="px-3 py-3 text-center font-semibold text-amber-600">{emp.tasks?.inProgress || 0}</td>

                  {/* Paused */}
                  <td className="px-3 py-3 text-center font-medium text-gray-500">{emp.tasks?.paused || 0}</td>

                  {/* Clients traités — click to see which tasks, and their status */}
                  <td className="px-3 py-3 text-center">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onClientsClick?.(emp); }}
                      disabled={!(emp.clients?.totalHandled)}
                      title={emp.clients?.totalHandled ? 'Voir les tâches réalisées et leur statut' : 'Aucun client traité'}
                      className="font-semibold text-blue-600 underline decoration-dotted underline-offset-4 hover:text-blue-800 disabled:text-gray-400 disabled:no-underline disabled:cursor-default"
                    >
                      {emp.clients?.totalHandled || 0}
                    </button>
                  </td>

                  {/* Durée totale */}
                  <td className="px-4 py-3 text-center font-bold text-gray-900 bg-blue-50/20">
                    <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-900 font-mono text-[12px]">
                      {formattedDuration}
                    </span>
                  </td>

                  {/* Coût employeur — each task at the rate in force when it was logged */}
                  {isAdmin && (
                    <td className="px-4 py-3 text-center font-bold text-gray-900 bg-emerald-50/20">
                      {emp.pricedTasks === 0 ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-gray-400 font-medium text-[12px]"
                          title="Aucune tâche chiffrée : renseignez le salaire brut et le régime horaire de ce collaborateur."
                        >
                          Non configuré
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-900 font-semibold text-[12px]"
                          title={
                            `Somme des tâches, chacune au taux en vigueur lors de sa saisie.` +
                            (emp.hourlyRate != null ? ` Taux actuel : ${emp.hourlyRate.toFixed(3)} DT/h.` : '') +
                            (emp.unpricedTasks ? ` ${emp.unpricedTasks} tâche(s) non chiffrée(s).` : '')
                          }
                        >
                          {formattedCost}
                          {emp.unpricedTasks > 0 && <span className="ml-1 text-amber-600">*</span>}
                        </span>
                      )}
                    </td>
                  )}

                  {/* Congés pris */}
                  <td className="px-3 py-3 text-center font-medium text-gray-700">
                    {daysTaken} j
                  </td>

                  {/* Congés restants */}
                  <td className="px-3 py-3 text-center font-medium text-gray-600">
                    {remainingDays} j
                  </td>

                  {/* Autorisations */}
                  <td className="px-3 py-3 text-center">
                    <span className="font-semibold text-gray-800">{emp.authorizations?.total || 0}</span>
                    {emp.authorizations?.totalDuration ? (
                      <span className="text-[10px] text-gray-400 ml-1">({emp.authorizations.totalDuration}h)</span>
                    ) : null}
                  </td>

                  {/* Ponctualité — pointage arrivées à l'heure sur le total pointé */}
                  <td className="px-3 py-3 text-center">
                    {emp.attendance?.checkins ? (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          emp.attendance.punctualityRate >= 90
                            ? 'bg-emerald-50 text-emerald-700'
                            : emp.attendance.punctualityRate >= 70
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-red-50 text-red-700'
                        }`}
                        title={`${emp.attendance.onTimeCheckins}/${emp.attendance.checkins} arrivées à l'heure${emp.attendance.viaPhone ? `, ${emp.attendance.viaPhone} pointage(s) via téléphone` : ''}`}
                      >
                        {emp.attendance.onTimeCheckins}/{emp.attendance.checkins}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

