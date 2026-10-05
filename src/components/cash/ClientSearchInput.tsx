import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface ClientSearchInputProps {
  value: string;
  /** `id` is undefined when the name was typed free-hand rather than picked. */
  onChange: (name: string, id?: number) => void;
  placeholder?: string;
  /** Overrides the wrapper's background, which defaults to white — used to
   *  make an editable table cell visibly distinct from the surrounding
   *  table instead of blending into it. */
  bgClassName?: string;
}

/**
 * Type-ahead over the client list, debounced and capped at 8 rows — the
 * client list is never fully loaded into the browser (see the scale rules),
 * so this asks the server as you type.
 *
 * A free-typed name is kept as-is rather than forced through the dropdown:
 * the brouillard is filled in fast from paper, and the ledger already falls
 * back to matching a client by name when no id was ever linked.
 *
 * **The results panel is rendered in a portal on `document.body`, in fixed
 * position computed from the field's own bounding rect** — the same
 * technique `SearchableSelect` already uses for exactly this reason. This
 * field is reused across the app (Cash's two journals, the "Nouveau compte
 * client" dossier picker, the Notes list in Tâches…), and several of those
 * call sites put it inside a scrolling container (a table body under
 * `overflow-auto`, a tall modal under `overflow-y-auto`). A plain
 * `position: absolute` child gets clipped by that ancestor's overflow the
 * moment the dropdown would extend past the visible edge — it reads as the
 * suggestion box floating off to the side or getting cut short, detached
 * from the field that opened it, in whichever view happens to scroll. A
 * fixed-position portal measures the real screen position of the field
 * instead, so the panel always lands flush under (or, near the bottom of
 * the viewport, above) the actual input, regardless of what scrolls it.
 */
export const ClientSearchInput: React.FC<ClientSearchInputProps> = ({ value, onChange, placeholder, bgClassName = 'bg-white' }) => {
  const { token } = useAuth();
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // État, pas seulement un ref, pour accrocher le ResizeObserver au moment où
  // le panneau apparaît vraiment dans le DOM — même raison que dans
  // SearchableSelect.
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    const term = value.trim();
    if (!open || term.length < 1) { setResults([]); return; }
    let cancelled = false;
    const h = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(term)}&page=1&limit=8`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (!cancelled) setResults(Array.isArray(body) ? body : (body.data ?? []));
      } catch { if (!cancelled) setResults([]); }
    }, 250);
    return () => { cancelled = true; clearTimeout(h); };
  }, [value, open, token]);

  /** Position du panneau, en coordonnées écran — même logique que `place()` dans SearchableSelect. */
  const place = () => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, 200);
    const PANEL_MAX = 192; // max-h-48
    const panelH = panelRef.current?.getBoundingClientRect().height || PANEL_MAX;
    const openUp = r.bottom + panelH > window.innerHeight && r.top > panelH;
    setPos({
      left: Math.min(Math.max(8, r.left), window.innerWidth - width - 8),
      top: openUp ? r.top - 4 - panelH : r.bottom + 4,
      width,
    });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]);

  // Remesure une fois le panneau vraiment monté, puis à chaque changement de
  // son contenu (le nombre de résultats varie en tapant).
  useEffect(() => {
    if (!open || !panelEl) return;
    const ro = new ResizeObserver(() => place());
    ro.observe(panelEl);
    return () => ro.disconnect();
  }, [open, panelEl]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  // Clicking away closes the list — the panel is a portal sibling now, not a
  // DOM descendant of the field, so it has to be checked separately.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <div className={`flex items-center border border-gray-300 rounded ${bgClassName} focus-within:border-gray-500`}>
        <Search className="w-3 h-3 text-gray-400 ml-2" />
        <input
          value={value}
          onChange={e => { onChange(e.target.value, undefined); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? 'Client…'}
          className="w-full px-2 py-1 text-[12px] focus:outline-none bg-transparent rounded"
        />
      </div>
      {open && pos && value.trim().length >= 1 && results.length > 0 && createPortal(
        <div
          ref={el => { panelRef.current = el; setPanelEl(el); }}
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, zIndex: 9999 }}
          className="bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {results.map(c => (
            <div
              key={c.id}
              onClick={() => { onChange(c.name, c.id); setOpen(false); }}
              className="px-3 py-1.5 text-[12px] text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              {c.name}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
};
