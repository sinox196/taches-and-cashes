import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, Trash2, Check } from 'lucide-react';

export interface CashCategory { id: string; label: string; }

/**
 * Accent-insensitive folding for the search box. Half this list carries
 * accents — Télécommunications, Dépannage, Produits d'hygiène, Femme de
 * ménage — and someone typing "tele" or "depannage" plainly means those.
 */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

interface CategoryPickerProps {
  value: string;
  onChange: (label: string) => void;
  categories: CashCategory[];
  /** Adds a new objet to the shared list, then selects it. */
  onCreate: (label: string) => Promise<CashCategory | null>;
  onDelete: (c: CashCategory) => void;
  canManage: boolean;
}

/**
 * The objet picker for a journal row: a searchable list rather than a plain
 * `<select>`, because the cabinet's list is long and still growing — typing
 * two letters beats scrolling fifteen-plus options on every line.
 *
 * Anything typed that matches nothing can be added to the list from here, so
 * a new objet never needs a code change or a trip to a settings screen.
 */
export const CategoryPicker: React.FC<CategoryPickerProps> = ({
  value, onChange, categories, onCreate, onDelete, canManage,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const matches = useMemo(() => {
    const q = fold(query.trim());
    // Already sorted alphabetically by the server; filtering preserves it.
    return q ? categories.filter(c => fold(c.label).includes(q)) : categories;
  }, [categories, query]);

  const exact = categories.some(c => fold(c.label) === fold(query.trim()));

  const create = async () => {
    const label = query.trim();
    if (!label || busy) return;
    setBusy(true);
    const made = await onCreate(label);
    setBusy(false);
    if (made) { onChange(made.label); setOpen(false); setQuery(''); }
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-2 py-1 border border-gray-300 rounded text-[12px] bg-white hover:border-gray-400 truncate min-w-[150px]"
        title={value || 'Choisir un objet'}
      >
        {value || <span className="text-gray-400">Objet…</span>}
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-gray-100">
            <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !exact && query.trim()) { e.preventDefault(); create(); } }}
              placeholder="Rechercher un objet…"
              className="w-full text-[12px] focus:outline-none"
            />
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {matches.map(c => (
              <div key={c.id} className="group flex items-center justify-between px-2.5 py-1.5 hover:bg-gray-50">
                <button
                  type="button"
                  onClick={() => { onChange(c.label); setOpen(false); setQuery(''); }}
                  className="flex-1 text-left text-[12px] text-gray-700 flex items-center gap-1.5"
                >
                  {c.label === value && <Check className="w-3 h-3 text-navy shrink-0" />}
                  <span className={c.label === value ? 'font-semibold text-navy' : ''}>{c.label}</span>
                </button>
                {canManage && (
                  <button
                    type="button"
                    title="Retirer de la liste"
                    onClick={() => onDelete(c)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            {matches.length === 0 && (
              <p className="px-2.5 py-2 text-[11.5px] text-gray-400 italic">Aucun objet ne correspond.</p>
            )}
          </div>

          {canManage && query.trim() && !exact && (
            <button
              type="button"
              onClick={create}
              disabled={busy}
              className="w-full flex items-center gap-1.5 px-2.5 py-2 border-t border-gray-100 text-[12px] font-medium text-navy hover:bg-gray-50 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" /> Ajouter « {query.trim()} »
            </button>
          )}
        </div>
      )}
    </div>
  );
};
