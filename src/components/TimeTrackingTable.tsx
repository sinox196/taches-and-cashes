import React, { useState } from 'react';
import {
  Pencil,
  Trash2,
  Search,
  Filter,
  ArrowUpDown,
  Download,
  ChevronDown,
  ChevronRight,
  Play,
  Pause,
  Square,
  Calendar,
} from 'lucide-react';
import { TimeEntry, TaskStatus } from '../types';
import { useAuth } from '../context/AuthContext';
import { formatCostDT } from '../utils/formatters';
import { usePresence } from '../context/PresenceContext';
import { PresenceBadge } from './PresenceBadge';
import { MultiSelectFilterDropdown } from './MultiSelectFilterDropdown';
import { EntryDeviceBadge } from './EntryDeviceBadge';
import { ExportButton } from './ExportButton';
import { csvNumber } from '../utils/exportCsv';

interface TimeTrackingTableProps {
  entries: TimeEntry[];
  onEdit: (entry: TimeEntry) => void;
  onDelete: (id: string) => void;
  onSelectAsActive?: (entry: TimeEntry) => void;
  /** Admin override: change any collaborator's task status directly. */
  onChangeStatus?: (entry: TimeEntry, statut: TaskStatus) => void;
  /** Entries held server-side; the table shows the most recent page of them. */
  totalEntries?: number;
  /** Pulls in the next page of older entries beyond what's already loaded. */
  onLoadMore?: () => void;
}

export const TimeTrackingTable: React.FC<TimeTrackingTableProps & { hasRunningTask?: boolean }> = ({
  hasRunningTask = false,
  entries,
  onEdit,
  onDelete,
  onSelectAsActive,
  onChangeStatus,
  totalEntries,
  onLoadMore,
}) => {
  const { hasPermission, user, token } = useAuth();
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
  // Multi-select: an empty array means "no filter applied", not "match nothing".
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [poleFilter, setPoleFilter] = useState<string[]>([]);
  const [collabFilter, setCollabFilter] = useState<string[]>([]);
  // Du/Au — same idiom as the dashboard's own range picker, ISO (YYYY-MM-DD)
  // to match what <input type="date"> emits. Empty means unbounded on that side.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const uniqueClients = Array.from(new Set(entries.map(e => e.client))).sort((a: string, b: string) => a.localeCompare(b));
  const uniquePoles = Array.from(new Set(entries.map(e => e.pole))).sort((a: string, b: string) => a.localeCompare(b));
  const uniqueCollaborateurs = Array.from(new Set(entries.map(e => e.userName || 'Unknown'))).sort((a: string, b: string) => a.localeCompare(b));

  /**
   * entry.date is DD/MM/YYYY (server-written display string, see CLAUDE.md
   * "Date formats are mixed"); rearranged to YYYY-MM-DD it compares correctly
   * as a plain string against the ISO value a date input already emits —
   * no `Date` round-trip, so no timezone to get wrong.
   */
  const toIsoDateKey = (frDate: string): string => {
    const [day, month, year] = (frDate || '').split('/');
    return day && month && year ? `${year}-${month}-${day}` : '';
  };

  /**
   * Le même prédicat sert au filtrage de ce qui est déjà chargé et, plus bas,
   * à l'export « toute la période » — une seule définition, pour que le
   * fichier exporté ne puisse jamais s'écarter de ce que l'écran filtre.
   */
  const matchesFilters = (item: TimeEntry) => {
    const matchesStatus =
      statusFilter === 'ALL' ? true : item.statut === statusFilter;

    const matchesClient = clientFilter.length === 0 || clientFilter.includes(item.client);
    const matchesPole = poleFilter.length === 0 || poleFilter.includes(item.pole);
    const matchesCollab = collabFilter.length === 0 || collabFilter.includes(item.userName || 'Unknown');

    const dateKey = toIsoDateKey(item.date);
    const matchesDateFrom = !dateFrom || (!!dateKey && dateKey >= dateFrom);
    const matchesDateTo = !dateTo || (!!dateKey && dateKey <= dateTo);

    return matchesStatus && matchesClient && matchesPole && matchesCollab && matchesDateFrom && matchesDateTo;
  };

  // Filter entries based on search & status
  const filteredEntries = entries.filter(matchesFilters);

  /**
   * Pour « Exporter » — `entries` ne porte que ce qui est chargé à l'écran
   * (200 par défaut, jusqu'à 1000 via « Charger plus »), donc un export basé
   * dessus subirait la même troncature. La route plafonne `limit` à 1000 par
   * appel (server.ts), donc on boucle par tranches de 1000 jusqu'à avoir tout
   * ce que `total` annonce — même raisonnement que `fetchAllFilteredInvoices`
   * dans CashManagement.tsx — puis on applique les mêmes filtres que l'écran
   * sur l'ensemble complet, pas seulement sur la page chargée. Le filtre Du/Au
   * n'est donc plus borné par ce qui est déjà chargé : n'importe quelle
   * période s'exporte en entier, même au-delà de 1000 tâches au total.
   */
  const fetchAllFilteredEntries = async (): Promise<TimeEntry[]> => {
    const CHUNK = 1000;
    let offset = 0;
    let all: TimeEntry[] = [];
    // Bornée par le total annoncé par le premier appel, pour ne jamais
    // boucler indéfiniment si la réponse venait à changer entre deux appels.
    let total = Infinity;
    while (offset < total) {
      const res = await fetch(`/api/time-entries?limit=${CHUNK}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) break;
      const body = await res.json();
      const chunk = body.data ?? [];
      if (chunk.length === 0) break;
      all = all.concat(chunk);
      total = typeof body.total === 'number' ? body.total : all.length;
      offset += CHUNK;
    }
    // A tâche en cours/en pause épinglée en tête de la première page (voir
    // server.ts) peut aussi apparaître à sa position naturelle dans une page
    // suivante — dédoublonnée ici par id plutôt que d'exclure l'épinglage du
    // calcul de pagination, ce qui serait plus fragile.
    const seen = new Set<string | number>();
    const deduped: TimeEntry[] = [];
    for (const e of all) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      deduped.push(e);
    }
    return deduped.filter(matchesFilters);
  };

  /** Libellés de statut, partagés par l'affichage et l'export. */
  const STATUT_LABEL: Record<string, string> = {
    COMPLETED: 'Terminée', RUNNING: 'En cours', PAUSED: 'En pause',
  };

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
      <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-[13px] font-extrabold text-gray-800 uppercase tracking-wide whitespace-nowrap">
              Suivi des tâches de l'équipe
            </h2>
            <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
              {filteredEntries.length} entrées
            </span>
          </div>
          <p className="text-[11px] text-gray-400">
            Consultez en temps réel le temps passé et le coût valorisé de vos équipes
          </p>
        </div>

        {/* Header Controls: Search & Filter */}
        <div className="flex flex-wrap items-center justify-start sm:justify-end gap-2 min-w-0 w-full sm:w-auto">
          {/* Date range — Du/Au, same idiom as the dashboard's own range
              picker. Client-side over whatever's already loaded, like every
              other filter in this header: a range reaching further back than
              what's loaded needs "Charger plus" first (see the footer). */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-white px-2.5 py-1.5 rounded-lg border border-gray-300">
            <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[11px] text-gray-500 font-medium">Du</span>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="text-[11px] outline-none text-gray-700 bg-transparent min-w-0 w-[104px]"
              />
            </div>
            <span className="text-gray-300 hidden sm:inline">|</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[11px] text-gray-500 font-medium">Au</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="text-[11px] outline-none text-gray-700 bg-transparent min-w-0 w-[104px]"
              />
            </div>
          </div>

          {/* Collaborator Filter — searchable, multiple at once */}
          {isAdmin && (
            <MultiSelectFilterDropdown
              allLabel="Tous (Collabs)"
              searchPlaceholder="Rechercher un collaborateur…"
              options={uniqueCollaborateurs}
              selected={collabFilter}
              onChange={setCollabFilter}
              widthClass="max-w-[130px]"
            />
          )}

          {/* Client Filter — searchable, multiple at once */}
          <MultiSelectFilterDropdown
            allLabel="Tous (Clients)"
            searchPlaceholder="Rechercher un client…"
            options={uniqueClients}
            selected={clientFilter}
            onChange={setClientFilter}
            widthClass="max-w-[130px]"
          />

          {/* Mission Filter — searchable, multiple at once */}
          <MultiSelectFilterDropdown
            allLabel="Toutes (Missions)"
            searchPlaceholder="Rechercher une mission…"
            options={uniquePoles}
            selected={poleFilter}
            onChange={setPoleFilter}
            widthClass="max-w-[130px]"
          />

          <ExportButton
            fileName="pointage"
            rows={filteredEntries}
            fetchAllRows={fetchAllFilteredEntries}
            columns={[
              { header: 'Collaborateur', value: (e: TimeEntry) => e.userName || '' },
              { header: 'Date', value: (e: TimeEntry) => e.date },
              { header: 'Client', value: (e: TimeEntry) => e.client },
              { header: 'Facturable', value: (e: TimeEntry) => (e.facturable === false ? 'Non' : 'Oui') },
              { header: 'Description', value: (e: TimeEntry) => e.description },
              { header: 'Mission', value: (e: TimeEntry) => e.pole },
              { header: 'Type de tâche', value: (e: TimeEntry) => e.taskType || '' },
              { header: 'Début', value: (e: TimeEntry) => e.heureDebut },
              { header: 'Fin', value: (e: TimeEntry) => e.heureFin || '' },
              { header: 'Durée (h)', value: (e: TimeEntry) => csvNumber((e.dureeSeconds || 0) / 3600, 2) },
              { header: 'Statut', value: (e: TimeEntry) => STATUT_LABEL[e.statut] ?? e.statut },
              // Le coût ne sort du fichier que s'il sort déjà de l'écran :
              // le serveur ne l'envoie pas à un non-admin.
              ...(isAdmin ? [{
                header: 'Coût employeur (TND)',
                value: (e: TimeEntry) => (e.hourlyRate == null ? '' : csvNumber(((e.dureeSeconds || 0) / 3600) * e.hourlyRate)),
              }] : []),
            ]}
          />

          {/* Status: a segmented control rather than a dropdown — four states,
              constantly switched, worth showing without opening a menu. */}
          <div className="flex flex-wrap items-center gap-1.5">
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
                    row.statut === 'RUNNING' ? 'bg-[#EFF8FF]/40' : ''
                  }`}
                >
                  {/* Collaborator */}
                  <td className="px-3 py-2.5 font-medium text-gray-900 truncate" title={row.userName || 'Unknown'}>
                    <span className="inline-flex items-center gap-1.5 max-w-full">
                      {(() => { const p = presenceOf(row.userId);
                        return <PresenceBadge state={p.state} idleMs={p.idleMs} onLeaveUntil={p.onLeaveUntil} variant="dot" />; })()}
                      <span className="truncate">{row.userName || 'Unknown'}</span>
                      <EntryDeviceBadge entry={row} />
                    </span>
                  </td>
                  {/* Date */}
                  <td className="px-2 py-2.5 whitespace-nowrap text-gray-600">
                    {row.date}
                  </td>

                  {/* Client — un client non facturable est signalé ici plutôt
                      que dans la colonne Coût : le coût employeur reste réel,
                      c'est la refacturation qui n'a pas lieu. */}
                  <td className="px-2 py-2.5 font-medium text-gray-900 truncate" title={row.client}>
                    <span className="inline-flex items-center gap-1.5 max-w-full">
                      <span className="truncate">{row.client}</span>
                      {row.facturable === false && (
                        <span
                          title="Client non facturable : ce temps ne sera couvert par aucun honoraire."
                          className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[9px] font-bold uppercase tracking-wide shrink-0"
                        >
                          non fact.
                        </span>
                      )}
                    </span>
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

                  {/* Statut — Terminée green, En cours blue, En pause orange.
                      Label is French throughout; only the underlying
                      `statut` value (RUNNING/PAUSED/COMPLETED) stays in
                      English, since that's the API/DB enum, not UI copy. */}
                  <td className="px-2 py-2.5">
                    {row.statut === 'COMPLETED' ? (
                      <span className="px-2 py-0.5 rounded-full bg-[#ECFDF3] text-[#12B76A] font-bold text-[9px] uppercase tracking-wide inline-block">
                        Terminée
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
                            ? 'bg-[#EFF8FF] text-[#175CD3] ' + (hasPermission('EDIT') && user?.id === row.userId && !hasRunningTask ? 'hover:bg-[#dceafe]' : '')
                            : 'bg-[#FFFAEB] text-[#B54708] ' + (hasPermission('EDIT') && user?.id === row.userId && !hasRunningTask ? 'hover:bg-[#feeec8]' : '')
                        }`}
                      >
                        {row.statut === 'RUNNING' ? 'En cours' : 'En pause'}
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
        <span className="flex items-center gap-2 flex-wrap">
          <span>
            Affichage de {filteredEntries.length} sur {entries.length} activités
            {totalEntries != null && totalEntries > entries.length && (
              <span className="text-gray-400">
                {' '}· {totalEntries} au total (les {entries.length} plus récentes sont chargées)
              </span>
            )}
          </span>
          {/* Only offered while there's genuinely more to fetch — the server
              caps a single page at 1000, so past that "load more" would just
              re-request the same page and do nothing. */}
          {onLoadMore && totalEntries != null && totalEntries > entries.length && entries.length < 1000 && (
            <button
              onClick={onLoadMore}
              className="px-2.5 py-1 rounded-lg border border-gray-300 bg-white text-gray-700 text-[10.5px] font-bold hover:border-gray-400 hover:bg-gray-50 transition-colors"
            >
              Charger plus
            </button>
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
