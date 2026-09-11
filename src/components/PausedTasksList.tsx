import React, { useMemo, useState } from 'react';
import { Play, Search } from 'lucide-react';
import { TimeEntry } from '../types';

interface PausedTasksListProps {
  entries: TimeEntry[];
  onResume: (entry: TimeEntry) => void;
}

/** Repliage des accents, même règle que SearchableSelect et le sélecteur d'objet du brouillard. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const PausedTasksList: React.FC<PausedTasksListProps> = ({ entries, onResume }) => {
  const [query, setQuery] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const q = fold(query.trim());

  const filtered = useMemo(
    () => (q ? entries.filter(e => fold(e.client || '').includes(q)) : entries),
    [entries, q],
  );

  // Noms de clients distincts déjà présents dans les tâches en pause — pas un
  // second appel réseau, la liste ne porte que ce qui a effectivement une
  // tâche en pause en ce moment, comme les filtres de l'Historique de
  // Ressources métier. Tape la première lettre, la suggestion propose le nom.
  const suggestions = useMemo(() => {
    if (!q) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of entries) {
      const name = e.client || '';
      if (!name || seen.has(name)) continue;
      if (!fold(name).includes(q)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  }, [entries, q]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 border-t-[3px] border-t-sky-600 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-sky-100 bg-sky-50/60 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-sky-500 animate-pulse"></div>
        <h3 className="text-[12px] font-bold text-sky-800 uppercase tracking-wide">Tâches en pause</h3>
      </div>

      {entries.length > 1 && (
        <div className="relative px-5 pt-3">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-8 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSuggestOpen(true); }}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
            placeholder="Rechercher un client…"
            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-[12.5px] text-gray-800 focus:outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500"
          />
          {suggestOpen && suggestions.length > 0 && (
            <div className="absolute left-5 right-5 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
              {suggestions.map(name => (
                <button
                  key={name}
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { setQuery(name); setSuggestOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-gray-700 hover:bg-sky-50"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="divide-y divide-gray-50">
        {filtered.map((entry) => (
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
                className="w-10 h-10 rounded-full bg-sky-500 text-white flex items-center justify-center group-hover:bg-sky-600 transition-colors"
                title="Reprendre"
              >
                <Play className="w-4 h-4 fill-current ml-0.5" />
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="px-5 py-4 text-[12px] text-gray-400 italic">Aucune tâche en pause ne correspond à « {query} ».</p>
        )}
      </div>
    </div>
  );
};
