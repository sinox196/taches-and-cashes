import React from 'react';
import { Play } from 'lucide-react';
import { TimeEntry } from '../types';

interface PausedTasksListProps {
  entries: TimeEntry[];
  onResume: (entry: TimeEntry) => void;
}

export const PausedTasksList: React.FC<PausedTasksListProps> = ({ entries, onResume }) => {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></div>
        <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wide">Tâches en pause</h3>
      </div>
      <div className="divide-y divide-gray-50">
        {entries.map((entry) => (
          <div 
            key={entry.id} 
            onClick={() => onResume(entry)}
            className="p-4 flex items-center justify-between hover:bg-gray-50 cursor-pointer transition-colors group"
          >
            <div className="flex flex-col gap-1 min-w-0">
              <span className="font-bold text-[13px] text-gray-900 truncate" title={entry.client}>
                {entry.client}
              </span>
              <span className="text-[12px] text-gray-600 truncate" title={`${entry.pole || ''} · ${entry.taskType || ''}`}>
                {entry.pole || '—'}
                {entry.taskType ? <span className="text-gray-400"> · {entry.taskType}</span> : null}
              </span>
            </div>
            
            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="text-[14px] font-mono font-bold text-gray-800">{entry.duree}</div>
                <div className="text-[10px] text-gray-400">Durée accumulée</div>
              </div>
              
              <button 
                className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center group-hover:bg-amber-500 group-hover:text-white transition-colors"
                title="Reprendre"
              >
                <Play className="w-4 h-4 fill-current ml-0.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
