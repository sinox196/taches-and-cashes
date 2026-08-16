import React from 'react';
import { Square, Play, Pause } from 'lucide-react';
import { ActiveTimerState } from '../types';
import { formatHHMMSS, formatVerboseDuration } from '../utils/formatters';
import { useAuth } from '../context/AuthContext';

interface ActiveTimerCardProps {
  timerState: ActiveTimerState;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
}

export const ActiveTimerCard: React.FC<ActiveTimerCardProps> = ({
  timerState,
  onStart,
  onPause,
  onStop,
}) => {
  const { client, task, elapsedSeconds, isRunning } = timerState;
  const { hasPermission } = useAuth();

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 flex flex-col md:flex-row items-center justify-between gap-6 font-sans">
      {/* Left Section: Information */}
      <div className="flex-1 border-b md:border-b-0 md:border-r border-gray-100 pb-4 md:pb-0 md:pr-6 w-full md:w-auto">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
          CHRONOMÈTRE ACTIF
        </p>
        <p className="text-[13px] font-medium text-gray-800">
          Client: <span className="text-gray-500 font-normal">{client}</span>
        </p>
        <p className="text-[13px] font-medium text-gray-800 mt-0.5">
          Tâche: <span className="text-gray-500 font-normal">{task}</span>
        </p>
      </div>

      {/* Center Section: Live Display */}
      <div className="px-4 md:px-10 text-center flex-1">
        <div className="text-[32px] font-bold text-gray-900 leading-none tracking-tight">
          {formatHHMMSS(elapsedSeconds)}
        </div>
        <div className="text-[13px] text-gray-500 mt-1 font-medium">
          {formatVerboseDuration(elapsedSeconds)}
        </div>
      </div>

      {/* Far Right: Action Buttons */}
      {hasPermission('EDIT') && (
        <div className="flex flex-col sm:flex-row gap-2 pl-0 md:pl-6 w-full md:w-auto shrink-0 min-w-[140px]">
          {isRunning ? (
            <button
              onClick={onPause}
              className="w-full sm:w-auto bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-2 transition-colors uppercase tracking-wide cursor-pointer"
            >
              <Pause className="w-3 h-3 fill-current" />
              <span>PAUSE</span>
            </button>
          ) : (
            <button
              onClick={onStart}
              className="w-full sm:w-auto bg-[#12B76A] hover:bg-[#0e9f5b] text-white px-4 py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-2 transition-colors uppercase tracking-wide cursor-pointer"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>DÉMARRER</span>
            </button>
          )}

          <button
            onClick={onStop}
            className="w-full sm:w-auto bg-[#D92D20] hover:bg-[#b42318] text-white px-4 py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-2 transition-colors uppercase tracking-wide cursor-pointer"
          >
            <Square className="w-3 h-3 fill-current" />
            <span>ARRÊTER</span>
          </button>
        </div>
      )}
    </div>
  );
};
