import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Filter, Check, X } from 'lucide-react';

interface MultiSelectFilterDropdownProps {
  /** Shown on the trigger when nothing is selected, e.g. "Tous (Clients)". */
  allLabel: string;
  /** Shown in the search box placeholder, e.g. "Rechercher un client…". */
  searchPlaceholder: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  widthClass?: string;
}

/**
 * A searchable multi-select for the table filter bar — replaces a plain
 * `<select>` where a collaborator may want several clients/missions/
 * collaborateurs at once, and the option list is long enough that scrolling
 * it beats typing two letters.
 *
 * Options come from the caller's own in-memory list (the unique values
 * already present in the loaded entries), so this never hits the server —
 * unlike MultiSelectAutocomplete, which is built for a KPI search endpoint.
 */
export const MultiSelectFilterDropdown: React.FC<MultiSelectFilterDropdownProps> = ({
  allLabel,
  searchPlaceholder,
  options,
  selected,
  onChange,
  widthClass = 'max-w-[150px]',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => o.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);
  };

  const triggerLabel =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? selected[0]
        : `${selected.length} sélectionnés`;

  return (
    <div className={`relative ${widthClass}`} ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={selected.length > 0 ? selected.join(', ') : allLabel}
        className={`w-full flex items-center justify-between gap-1 bg-white border rounded-md pl-2.5 pr-2 py-1 text-[11px] font-semibold truncate cursor-pointer focus:outline-none ${
          selected.length > 0
            ? 'border-navy/40 text-navy bg-navy/5'
            : 'border-gray-200 hover:border-gray-300 text-gray-700'
        }`}
      >
        <span className="truncate">{triggerLabel}</span>
        <Filter className="w-3 h-3 shrink-0 opacity-70" />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-gray-100">
            <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full text-[12px] focus:outline-none"
            />
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {matches.map(option => {
              const isSelected = selected.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggle(option)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-gray-50"
                >
                  <span
                    className={`w-3.5 h-3.5 rounded shrink-0 border flex items-center justify-center ${
                      isSelected ? 'bg-navy border-navy' : 'border-gray-300'
                    }`}
                  >
                    {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                  </span>
                  <span className={`text-[12px] truncate ${isSelected ? 'font-semibold text-navy' : 'text-gray-700'}`}>
                    {option}
                  </span>
                </button>
              );
            })}
            {matches.length === 0 && (
              <p className="px-2.5 py-2 text-[11.5px] text-gray-400 italic">Aucun résultat.</p>
            )}
          </div>

          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 border-t border-gray-100 text-[11.5px] font-medium text-gray-500 hover:bg-gray-50 hover:text-red-600"
            >
              <X className="w-3 h-3" /> Effacer la sélection
            </button>
          )}
        </div>
      )}
    </div>
  );
};
