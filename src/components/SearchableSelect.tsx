import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Check, ChevronDown } from 'lucide-react';

/**
 * Repliage des accents pour la recherche, comme le sélecteur d'objet du
 * brouillard de caisse. Les intitulés du catalogue en sont pleins —
 * « Tenue de comptabilité », « Préparation déclaration », « Dépôt des états
 * financiers » — et qui tape « depot » ou « comptabilite » vise clairement
 * ceux-là.
 */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface SearchableOption {
  id: string | number;
  label: string;
}

interface Props {
  value: string;
  onChange: (id: string) => void;
  options: SearchableOption[];
  placeholder: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  /** Compact (Pointage) ou normal (modales) — la seule différence est la densité. */
  size?: 'sm' | 'md';
}

/**
 * Liste déroulante **cherchable**, pour une mission ou un type de tâche.
 *
 * Un `<select>` natif convenait tant qu'une mission avait trois types. Le
 * catalogue livré en compte trente-deux sous « Fiscalité » et vingt sous
 * « CNSS », tous préfixés pareil (« Préparation déclaration Mois 1/2026 »… ) :
 * les distinguer en déroulant est le mauvais geste, taper « 7/2026 » est le
 * bon. La recherche porte sur n'importe quel morceau de l'intitulé, pas
 * seulement son début, précisément parce que ce qui distingue deux voisins est
 * à la fin.
 *
 * Le champ reste un vrai bouton refermable au clic extérieur et à Échap —
 * ouvert dans une modale qui se ferme elle-même sur Échap, il doit consommer
 * la touche avant elle, sans quoi choisir un type fermerait le formulaire.
 */
export const SearchableSelect: React.FC<Props> = ({
  value, onChange, options, placeholder, searchPlaceholder = 'Rechercher…',
  emptyLabel = 'Aucun résultat.', disabled, size = 'md',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQuery(''); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Fermer la liste, pas la modale qui la contient.
      e.stopPropagation();
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const matches = useMemo(() => {
    const q = fold(query.trim());
    return q ? options.filter(o => fold(o.label).includes(q)) : options;
  }, [options, query]);

  const selected = options.find(o => String(o.id) === String(value)) || null;
  const pad = size === 'sm' ? 'px-3 py-1.5 text-[12px]' : 'px-3 py-2 text-[13px]';

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        title={selected?.label || placeholder}
        className={`w-full text-left bg-white border border-gray-200 rounded-md ${pad} pr-8 font-medium text-gray-800 hover:border-gray-400 focus:outline-none focus:border-gray-400 transition-colors disabled:bg-gray-50 disabled:text-gray-400 truncate`}
      >
        {selected ? selected.label : <span className="text-gray-400 font-normal">{placeholder}</span>}
        <ChevronDown className="w-3 h-3 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      </button>

      {open && !disabled && (
        <div className="absolute z-40 mt-1 w-full min-w-[240px] bg-white border border-gray-200 rounded-lg shadow-lg">
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
          <div className="max-h-60 overflow-y-auto py-1">
            {matches.map(o => (
              <button
                key={o.id}
                type="button"
                onClick={() => { onChange(String(o.id)); setOpen(false); setQuery(''); }}
                className="w-full text-left px-2.5 py-1.5 text-[12px] text-gray-700 hover:bg-gray-50 flex items-start gap-1.5"
              >
                {String(o.id) === String(value)
                  ? <Check className="w-3 h-3 text-navy shrink-0 mt-0.5" />
                  : <span className="w-3 shrink-0" />}
                {/* Les intitulés sont longs et se ressemblent : ils passent à
                    la ligne au lieu d'être tronqués, sinon deux voisins
                    seraient coupés au même endroit et illisibles. */}
                <span className={`break-words ${String(o.id) === String(value) ? 'font-semibold text-navy' : ''}`}>
                  {o.label}
                </span>
              </button>
            ))}
            {matches.length === 0 && (
              <p className="px-2.5 py-2 text-[11.5px] text-gray-400 italic">{emptyLabel}</p>
            )}
          </div>
          {options.length > 8 && (
            <div className="px-2.5 py-1.5 border-t border-gray-100 text-[10.5px] text-gray-400">
              {matches.length} sur {options.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
