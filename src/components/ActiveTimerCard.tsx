import React from 'react';
import { Square, Play, Pause } from 'lucide-react';
import { ActiveTimerState } from '../types';
import { formatHHMMSS, formatCostDT } from '../utils/formatters';
import { useAuth } from '../context/AuthContext';

interface ActiveTimerCardProps {
  timerState: ActiveTimerState;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
}

/**
 * The running timer, as a dark panel in the right-hand column — the same slot
 * the "démarrer une tâche" form occupies when nothing is running, so the column
 * always answers one question: what are you on right now.
 *
 * The work is identified by Mission and Type de tâche; the description is free
 * text and often empty, so it only appears when there is one.
 */
export const ActiveTimerCard: React.FC<ActiveTimerCardProps> = ({
  timerState,
  onStart,
  onPause,
  onStop,
}) => {
  const { client, task, pole, taskType, elapsedSeconds, isRunning, costRatePerHour } = timerState;
  const { user } = useAuth();
  // Employer cost (and the DT/h rate) is admin-only information.
  const isAdmin = user?.role === 'ADMIN';
  const liveCost = costRatePerHour == null ? null : (elapsedSeconds / 3600) * costRatePerHour;

  const subtitle = [pole, taskType].filter(v => v && v !== '-').join(' · ');

  return (
    <div className="bg-navy text-white rounded-xl p-5 font-sans shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`w-1.5 h-1.5 rounded-full bg-run-fg ${isRunning ? 'animate-pulse' : ''}`}
          aria-hidden
        />
        <p className="text-[10px] font-extrabold uppercase tracking-[0.05em] text-white/60">
          Chronomètre actif
        </p>
      </div>

      <p className="text-[13px] font-bold text-white truncate" title={client}>
        {client}
      </p>
      <p className="text-[11.5px] text-white/55 truncate mt-0.5" title={subtitle}>
        {subtitle || '—'}
      </p>
      {task && task !== '-' && (
        <p className="text-[11px] text-white/40 italic truncate mt-0.5" title={task}>
          {task}
        </p>
      )}

      <div className="mt-4 text-[32px] font-extrabold tabular-nums leading-none tracking-tight">
        {formatHHMMSS(elapsedSeconds)}
      </div>

      {/* Live employer cost accruing for this task — admins only. */}
      {isAdmin && (
        <div className="mt-1.5 text-[12px]">
          {liveCost === null ? (
            <span
              className="text-white/40 italic"
              title="Aucun coût employeur configuré pour ce collaborateur"
            >
              Coût non configuré
            </span>
          ) : (
            <span className="font-bold text-done-bg">{formatCostDT(liveCost)}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-4">
        {isRunning ? (
          <button
            onClick={onPause}
            className="flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg py-2.5 text-[12px] font-extrabold transition-colors"
          >
            <Pause className="w-3.5 h-3.5 fill-current" /> PAUSE
          </button>
        ) : (
          <button
            onClick={onStart}
            className="flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg py-2.5 text-[12px] font-extrabold transition-colors"
          >
            <Play className="w-3.5 h-3.5 fill-current" /> REPRENDRE
          </button>
        )}
        <button
          onClick={onStop}
          className="flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2.5 text-[12px] font-extrabold transition-colors"
        >
          <Square className="w-3.5 h-3.5 fill-current" /> ARRÊTER
        </button>
      </div>
    </div>
  );
};
