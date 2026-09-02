import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogIn, LogOut, Smartphone, Clock, CheckCircle2, AlertTriangle, X, Coffee } from 'lucide-react';
import { usePeriodPage, PeriodFilter, PaginationBar } from '../PeriodPager';
import { MultiSelectFilterDropdown } from '../MultiSelectFilterDropdown';

interface AttendanceRecord {
  id: number;
  userId: number;
  userName?: string;
  date: string; // YYYY-MM-DD
  checkinAt: string | null;
  checkinViaPhone: boolean | null;
  checkinLateMinutes: number | null;
  checkoutAt: string | null;
  checkoutViaPhone: boolean | null;
  checkoutLateMinutes: number | null;
  /** Break allowance snapshotted from the user's shift at check-in. Absent on rows written before the field existed. */
  breakMinutes?: number | null;
}

interface TodayResponse {
  shiftStart: string | null;
  shiftEnd: string | null;
  /** Meal-break allowance in minutes, set per user on the Équipe page. */
  breakMinutes: number | null;
  toleranceMinutes: number;
  record: AttendanceRecord | null;
}

/**
 * "45" -> "45 min", "60" -> "1 h", "90" -> "1 h 30", "543" -> "9 h 03".
 * Shared by the pause and présence columns. Les minutes sont sur deux
 * chiffres : « 9 h 3 » se lit comme une durée tronquée, pas comme 9 h 03.
 */
const formatBreak = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
};

/**
 * Temps écoulé entre les deux pointages, en minutes.
 *
 * `null` tant que la journée n'est pas close par une sortie — une présence
 * calculée sur une sortie absente se lirait comme « 0 » alors que la personne
 * est encore là. La pause n'est **pas** déduite ici : la colonne dit ce que
 * les deux pointages disent, et la colonne pause d'à côté porte ce qui s'en
 * retranche (le net est dans l'info-bulle).
 */
const presenceMinutes = (r: AttendanceRecord): number | null => {
  if (!r.checkinAt || !r.checkoutAt) return null;
  const ms = new Date(r.checkoutAt).getTime() - new Date(r.checkinAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 60000);
};

const time = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * Within tolerance -> "à l'heure"; beyond it -> flagged, direction-aware for
 * checkout.
 *
 * `compact` sert aux cartes du téléphone : « Retard de 45 min » repassait à la
 * ligne dans les ~180 px qui restent à droite de l'heure, et la carte se
 * lisait de travers. La forme courte garde le signe (+ en retard, − en
 * avance), la couleur et l'info-bulle, qui portent la même information sans
 * la faire déborder.
 */
const punctualityBadge = (
  minutes: number | null | undefined,
  tolerance: number,
  kind: 'checkin' | 'checkout',
  compact = false,
) => {
  if (minutes == null) return <span className="text-gray-400">—</span>;
  if (Math.abs(minutes) <= tolerance) {
    return <span className="inline-flex items-center gap-1 text-emerald-700 whitespace-nowrap"><CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> À l'heure</span>;
  }
  const long = kind === 'checkin'
    ? `Retard de ${minutes} min`
    : minutes < 0
      ? `Départ anticipé (${Math.abs(minutes)} min)`
      : `Départ tardif (${minutes} min)`;
  const tone = kind === 'checkin' ? 'text-red-700' : 'text-amber-700';
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${tone}`} title={compact ? long : undefined}>
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      {compact ? `${minutes > 0 ? '+' : '−'}${Math.abs(minutes)} min` : long}
    </span>
  );
};

/**
 * Pointage — manual check-in/check-out against the shift the admin set on
 * the Équipe page, distinct from Time Tracking's task timers: this tracks
 * whether (and how punctually) a collaborator showed up, not what they
 * worked on. Everyone with VIEW_HR sees their own log; ADMIN/SUPERVISEUR
 * see the whole team's, mirroring the KPI dashboard's own split.
 */
export const AttendanceTab: React.FC = () => {
  const { token, user } = useAuth();
  const isTeamViewer = user?.role === 'ADMIN' || user?.role === 'SUPERVISEUR';
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  /** 409 from /checkout: a task is still running — a plain inline error is easy to miss, this is not. */
  const [runningTaskWarning, setRunningTaskWarning] = useState('');

  const fetchToday = () => {
    fetch('/api/attendance/today', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setToday(data))
      .catch(() => {});
  };

  // A full year, not the 30 days this started with: the année/mois filter
  // below can only ever narrow what was fetched, so a shorter window would
  // make picking any earlier month read as "aucun pointage". 365 is also the
  // server's own cap on `days`.
  const fetchLog = () => {
    fetch('/api/attendance?days=365', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setRecords(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    if (!token) return;
    fetchToday();
    fetchLog();
  }, [token]);

  // Collaborateur filter, then année/mois + pagination. The collaborator
  // narrowing happens *before* usePeriodPage so the page count and the
  // "X sur Y" footer describe what is actually on screen. Only a team viewer
  // gets it — everyone else has exactly one name in their own log.
  const [collabFilter, setCollabFilter] = useState<string[]>([]);
  const uniqueCollaborateurs = useMemo(
    () => Array.from(new Set(records.map(r => r.userName || 'Inconnu'))).sort((a: string, b: string) => a.localeCompare(b)),
    [records],
  );
  const scopedRecords = useMemo(
    () => (collabFilter.length === 0
      ? records
      : records.filter(r => collabFilter.includes(r.userName || 'Inconnu'))),
    [records, collabFilter],
  );

  const recordDate = React.useCallback((r: AttendanceRecord) => r.date, []);
  // 15 lignes par page ici plutôt que les 10 des autres onglets RH : une
  // ligne de pointage est courte (deux heures et deux durées) et la page se
  // lit d'un coup, là où une demande de congé porte des motifs et des
  // commentaires qui la font respirer.
  const pager = usePeriodPage<AttendanceRecord>(scopedRecords, recordDate, 15);

  const handleCheckin = async () => {
    setActionError('');
    setIsWorking(true);
    try {
      const res = await fetch('/api/attendance/checkin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) { fetchToday(); fetchLog(); }
      else setActionError(data.error || "Échec du pointage d'arrivée.");
    } catch {
      setActionError('Erreur de connexion.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleCheckout = async () => {
    setActionError('');
    setIsWorking(true);
    try {
      const res = await fetch('/api/attendance/checkout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) { fetchToday(); fetchLog(); }
      else if (res.status === 409) setRunningTaskWarning(data.error);
      else setActionError(data.error || 'Échec du pointage de départ.');
    } catch {
      setActionError('Erreur de connexion.');
    } finally {
      setIsWorking(false);
    }
  };

  const tolerance = today?.toleranceMinutes ?? 15;
  const record = today?.record;

  return (
    <div className="flex flex-col sm:h-full">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Pointage</h2>
        <div className="flex flex-wrap items-center gap-2 self-start">
          {isTeamViewer && (
            <MultiSelectFilterDropdown
              allLabel="Tous (Collabs)"
              searchPlaceholder="Rechercher un collaborateur…"
              options={uniqueCollaborateurs}
              selected={collabFilter}
              onChange={next => { setCollabFilter(next); pager.setPage(1); }}
              widthClass="max-w-[150px]"
            />
          )}
          <PeriodFilter page={pager} />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 mb-4 sm:mb-5 shrink-0">
        {today && !today.shiftStart && !today.shiftEnd ? (
          <p className="text-sm text-gray-500">Aucun shift n'est configuré pour vous. Contactez un administrateur (page Équipe).</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] sm:text-[13px] text-gray-600 mb-3 sm:mb-4">
              <Clock className="w-4 h-4 text-gray-400" />
              Shift : {today?.shiftStart || '—'} - {today?.shiftEnd || '—'}
              {today?.breakMinutes ? (
                <span className="inline-flex items-center gap-1 text-gray-500">
                  <Coffee className="w-3.5 h-3.5 text-gray-400" />
                  Pause ftour : {formatBreak(today.breakMinutes)}
                </span>
              ) : null}
              <span className="text-gray-400">(tolérance {tolerance} min)</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3">
              <button
                onClick={handleCheckin}
                disabled={isWorking || !!record?.checkinAt}
                className="flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <LogIn className="w-4 h-4" /> Pointer mon arrivée
              </button>
              <button
                onClick={handleCheckout}
                disabled={isWorking || !record?.checkinAt || !!record?.checkoutAt}
                className="flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <LogOut className="w-4 h-4" /> Pointer mon départ
              </button>
            </div>
            {actionError && <p className="mt-3 text-[12px] text-red-600 font-medium">{actionError}</p>}
            {record && (
              <div className="mt-4 flex flex-col sm:flex-row sm:flex-wrap gap-x-8 gap-y-1.5 text-[12px] text-gray-600">
                <span>Heure entrée : <span className="font-semibold text-gray-900">{time(record.checkinAt)}</span> {record.checkinViaPhone && <Smartphone className="w-3.5 h-3.5 inline text-gray-400 ml-1" title="Pointé depuis un téléphone" />} — {punctualityBadge(record.checkinLateMinutes, tolerance, 'checkin')}</span>
                {record.checkoutAt && (
                  <span>Heure sortie : <span className="font-semibold text-gray-900">{time(record.checkoutAt)}</span> {record.checkoutViaPhone && <Smartphone className="w-3.5 h-3.5 inline text-gray-400 ml-1" title="Pointé depuis un téléphone" />} — {punctualityBadge(record.checkoutLateMinutes, tolerance, 'checkout')}</span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="hidden sm:block sm:overflow-auto sm:flex-1 sm:min-h-[260px] border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {isTeamViewer && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employé</th>}
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Heure entrée</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Heure sortie</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Durée de pause</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Durée de présence</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ponctualité</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {isLoading ? (
              <tr><td colSpan={isTeamViewer ? 7 : 6} className="px-6 py-8 text-center text-sm text-gray-500">Chargement…</td></tr>
            ) : pager.pageRows.length === 0 ? (
              <tr><td colSpan={isTeamViewer ? 7 : 6} className="px-6 py-8 text-center text-sm text-gray-500">Aucun pointage trouvé.</td></tr>
            ) : (
              pager.pageRows.map(r => {
                const presence = presenceMinutes(r);
                const pause = r.breakMinutes ?? null;
                return (
                <tr key={r.id} className="hover:bg-gray-50">
                  {isTeamViewer && <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{r.userName}</td>}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{r.date}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                    {time(r.checkinAt)} {r.checkinViaPhone && <Smartphone className="w-3.5 h-3.5 inline text-gray-400 ml-1" title="Via téléphone" />}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                    {time(r.checkoutAt)} {r.checkoutViaPhone && <Smartphone className="w-3.5 h-3.5 inline text-gray-400 ml-1" title="Via téléphone" />}
                  </td>
                  {/* Pause ftour figée à l'entrée — « — » sur une ligne écrite avant que le champ existe. */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                    {pause == null ? <span className="text-gray-300">—</span> : formatBreak(pause)}
                  </td>
                  {/* Présence = sortie − entrée, pause non déduite (le net est dans l'info-bulle). */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {presence == null ? (
                      <span className="text-gray-300" title="Journée non close : aucune sortie pointée.">—</span>
                    ) : (
                      <span title={pause ? `Pause déduite : ${formatBreak(pause)} — net ${formatBreak(Math.max(0, presence - pause))}` : undefined}>
                        {formatBreak(presence)}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-[12px]">
                    <div className="flex flex-col gap-0.5">
                      {punctualityBadge(r.checkinLateMinutes, tolerance, 'checkin')}
                      {r.checkoutAt && punctualityBadge(r.checkoutLateMinutes, tolerance, 'checkout')}
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Même page, en cartes, sous `sm`. Les sept colonnes demandent 825 px
          dans un conteneur qui en fait 307 sur un téléphone : un tableau qui
          défile latéralement obligerait à balayer de côté pour lire l'heure de
          sortie d'une ligne dont on vient de lire l'entrée. Une carte par
          journée tient dans la largeur et se lit d'un coup d'œil. */}
      <div className="sm:hidden flex flex-col gap-2.5">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-gray-500">Chargement…</p>
        ) : pager.pageRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">Aucun pointage trouvé.</p>
        ) : (
          pager.pageRows.map(r => {
            const presence = presenceMinutes(r);
            const pause = r.breakMinutes ?? null;
            return (
              <div key={r.id} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <span className="text-[13px] font-semibold text-gray-900">{r.date}</span>
                  {isTeamViewer && <span className="text-[12px] text-gray-500 truncate">{r.userName}</span>}
                </div>

                <div className="flex flex-col gap-1.5 text-[12.5px]">
                  <div className="flex items-center gap-2">
                    <span className="w-[86px] shrink-0 text-gray-500">Heure entrée</span>
                    <span className="font-medium text-gray-900 tabular-nums">{time(r.checkinAt)}</span>
                    {r.checkinViaPhone && <Smartphone className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                    <span className="ml-auto">{punctualityBadge(r.checkinLateMinutes, tolerance, 'checkin', true)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-[86px] shrink-0 text-gray-500">Heure sortie</span>
                    <span className="font-medium text-gray-900 tabular-nums">{time(r.checkoutAt)}</span>
                    {r.checkoutViaPhone && <Smartphone className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                    {r.checkoutAt && (
                      <span className="ml-auto">{punctualityBadge(r.checkoutLateMinutes, tolerance, 'checkout', true)}</span>
                    )}
                  </div>
                </div>

                <div className="mt-2.5 pt-2.5 border-t border-gray-100 flex items-center gap-4 text-[12px]">
                  <span className="inline-flex items-center gap-1.5 text-gray-600">
                    <Coffee className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    Pause {pause == null ? <span className="text-gray-300">—</span> : formatBreak(pause)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-gray-600">
                    <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    Présence{' '}
                    {presence == null
                      ? <span className="text-gray-300">—</span>
                      : <span className="font-semibold text-gray-900">{formatBreak(presence)}</span>}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <PaginationBar page={pager} unit="pointages" />

      {runningTaskWarning && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <h3 className="text-[15px] font-bold text-gray-900">Tâche en cours</h3>
              </div>
              <p className="text-[13px] text-gray-600">{runningTaskWarning}</p>
              <p className="text-[12px] text-gray-400 mt-2">Rendez-vous sur Tâches pour l'arrêter, puis pointez votre départ.</p>
              <div className="mt-5 flex justify-end">
                <button
                  onClick={() => setRunningTaskWarning('')}
                  className="flex items-center gap-1.5 px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover"
                >
                  <X className="w-3.5 h-3.5" /> Compris
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
