import React, { useState } from 'react';
import { Square, Play, Pause, ChevronDown, ChevronUp } from 'lucide-react';
import { formatHHMMSS } from '../utils/formatters';
import { TimeEntry } from '../types';

interface FloatingTimerProps {
  entry: TimeEntry;
  onResume: () => void;
  onPause: () => void;
  onStop: () => void;
  /**
   * Set on a page that pins its own bar to the bottom of the viewport — today
   * only Messages, whose composer runs the full width. On a phone the card is
   * wide enough to cover its Send button, so the clock has to move up rather
   * than sit on top of the one control the page exists for. From `sm` up
   * there is room for both and the corner is the corner.
   */
  raised?: boolean;
}

/**
 * The running (or just-paused) task, pinned to the corner of the viewport on
 * every page — Pointage included. The big ActiveTimerCard only exists on
 * Pointage, so without this, walking over to Clients or Cash meant losing
 * sight of the clock and having to navigate back just to pause or stop.
 *
 * It deliberately also renders a PAUSED task: pausing from here would
 * otherwise make the card vanish, stranding the user with no way to resume
 * without going back to Pointage — the exact trip this is meant to save.
 *
 * `z-40` puts it over page content and the sticky header (z-20) but under
 * modals (z-[60]) and toasts (z-[70]), so an open dialog covers it rather
 * than being fought for the corner.
 */
export const FloatingTimer: React.FC<FloatingTimerProps> = ({ entry, onResume, onPause, onStop, raised = false }) => {
  const [collapsed, setCollapsed] = useState(false);
  const bottom = raised ? 'bottom-24 sm:bottom-4' : 'bottom-4';
  const isRunning = entry.statut === 'RUNNING';
  const subtitle = [entry.pole, entry.taskType].filter(v => v && v !== '-').join(' · ');

  // Collapsed: a bare pill with the clock, for when the card sits over
  // something the user is trying to read. Still one tap from the controls.
  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Afficher le chronomètre"
        className={`fixed ${bottom} right-4 z-40 flex items-center gap-2 bg-navy text-white rounded-full pl-3 pr-3.5 py-2 shadow-lg hover:bg-navy-hover transition-colors`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-run-fg animate-pulse' : 'bg-white/40'}`}
          aria-hidden
        />
        <span className="text-[13px] font-extrabold tabular-nums">{formatHHMMSS(entry.dureeSeconds)}</span>
        <ChevronUp className="w-3.5 h-3.5 opacity-60" />
      </button>
    );
  }

  return (
    <div className={`fixed ${bottom} right-4 z-40 w-[240px] max-w-[calc(100vw-2rem)] bg-navy text-white rounded-xl p-4 shadow-lg font-sans`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRunning ? 'bg-run-fg animate-pulse' : 'bg-white/40'}`}
            aria-hidden
          />
          <p className="text-[9.5px] font-extrabold uppercase tracking-[0.05em] text-white/60 truncate">
            {isRunning ? 'Chronomètre actif' : 'En pause'}
          </p>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          title="Réduire"
          aria-label="Réduire le chronomètre"
          className="text-white/50 hover:text-white transition-colors shrink-0"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      <p className="text-[12.5px] font-bold text-white truncate" title={entry.client}>
        {entry.client}
      </p>
      {subtitle && (
        <p className="text-[11px] text-white/55 truncate mt-0.5" title={subtitle}>
          {subtitle}
        </p>
      )}

      <div className="mt-2.5 text-[26px] font-extrabold tabular-nums leading-none tracking-tight">
        {formatHHMMSS(entry.dureeSeconds)}
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        {isRunning ? (
          <button
            onClick={onPause}
            className="flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg py-2 text-[11px] font-extrabold transition-colors"
          >
            <Pause className="w-3 h-3 fill-current" /> PAUSE
          </button>
        ) : (
          <button
            onClick={onResume}
            className="flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg py-2 text-[11px] font-extrabold transition-colors"
          >
            <Play className="w-3 h-3 fill-current" /> REPRENDRE
          </button>
        )}
        <button
          onClick={onStop}
          className="flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 text-[11px] font-extrabold transition-colors"
        >
          <Square className="w-3 h-3 fill-current" /> ARRÊTER
        </button>
      </div>
    </div>
  );
};
