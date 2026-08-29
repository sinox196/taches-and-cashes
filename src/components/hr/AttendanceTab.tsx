import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogIn, LogOut, Smartphone, Clock, CheckCircle2, AlertTriangle, X } from 'lucide-react';

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
}

interface TodayResponse {
  shiftStart: string | null;
  shiftEnd: string | null;
  toleranceMinutes: number;
  record: AttendanceRecord | null;
}

const time = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';

/** Within tolerance -> "à l'heure"; beyond it -> flagged, direction-aware for checkout. */
const punctualityBadge = (minutes: number | null | undefined, tolerance: number, kind: 'checkin' | 'checkout') => {
  if (minutes == null) return <span className="text-gray-400">—</span>;
  if (Math.abs(minutes) <= tolerance) {
    return <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> À l'heure</span>;
  }
  if (kind === 'checkin') {
    return <span className="inline-flex items-center gap-1 text-red-700"><AlertTriangle className="w-3.5 h-3.5" /> Retard de {minutes} min</span>;
  }
  return minutes < 0
    ? <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="w-3.5 h-3.5" /> Départ anticipé ({Math.abs(minutes)} min)</span>
    : <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="w-3.5 h-3.5" /> Départ tardif ({minutes} min)</span>;
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

  const fetchLog = () => {
    fetch('/api/attendance?days=30', { headers: { Authorization: `Bearer ${token}` } })
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
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Pointage</h2>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        {today && !today.shiftStart && !today.shiftEnd ? (
          <p className="text-sm text-gray-500">Aucun shift n'est configuré pour vous. Contactez un administrateur (page Équipe).</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-gray-600 mb-4">
              <Clock className="w-4 h-4 text-gray-400" />
              Shift : {today?.shiftStart || '—'} - {today?.shiftEnd || '—'}
              <span className="text-gray-400">(tolérance {tolerance} min)</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleCheckin}
                disabled={isWorking || !!record?.checkinAt}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <LogIn className="w-4 h-4" /> Pointer mon arrivée
              </button>
              <button
                onClick={handleCheckout}
                disabled={isWorking || !record?.checkinAt || !!record?.checkoutAt}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <LogOut className="w-4 h-4" /> Pointer mon départ
              </button>
            </div>
            {actionError && <p className="mt-3 text-[12px] text-red-600 font-medium">{actionError}</p>}
            {record && (
              <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-[12px] text-gray-600">
                <span>Arrivée : <span className="font-semibold text-gray-900">{time(record.checkinAt)}</span> {record.checkinViaPhone && <Smartphone className="w-3.5 h-3.5 inline text-gray-400 ml-1" title="Pointé depuis un téléphone" />} — {punctualityBadge(record.checkinLateMinutes, tolerance, 'checkin')}</span>
                {record.checkoutAt && (
                  <span>Départ : <span className="font-semibold text-gray-900">{time(record.checkoutAt)}</span> {record.checkoutViaPhone && <Smartphone className="w-3.5 h-3.5 inline text-gray-400 ml-1" title="Pointé depuis un téléphone" />} — {punctualityBadge(record.checkoutLateMinutes, tolerance, 'checkout')}</span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="overflow-x-auto flex-1 border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {isTeamViewer && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employé</th>}
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Arrivée</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Départ</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ponctualité</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {isLoading ? (
              <tr><td colSpan={isTeamViewer ? 5 : 4} className="px-6 py-8 text-center text-sm text-gray-500">Chargement…</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={isTeamViewer ? 5 : 4} className="px-6 py-8 text-center text-sm text-gray-500">Aucun pointage sur les 30 derniers jours.</td></tr>
            ) : (
              records.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  {isTeamViewer && <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{r.userName}</td>}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{r.date}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                    {time(r.checkinAt)} {r.checkinViaPhone && <Smartphone className="w-3.5 h-3.5 inline text-gray-400 ml-1" title="Via téléphone" />}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                    {time(r.checkoutAt)} {r.checkoutViaPhone && <Smartphone className="w-3.5 h-3.5 inline text-gray-400 ml-1" title="Via téléphone" />}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-[12px]">
                    <div className="flex flex-col gap-0.5">
                      {punctualityBadge(r.checkinLateMinutes, tolerance, 'checkin')}
                      {r.checkoutAt && punctualityBadge(r.checkoutLateMinutes, tolerance, 'checkout')}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
