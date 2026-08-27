import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface ClientSearchInputProps {
  value: string;
  /** `id` is undefined when the name was typed free-hand rather than picked. */
  onChange: (name: string, id?: number) => void;
  placeholder?: string;
}

/**
 * Type-ahead over the client list, debounced and capped at 8 rows — the
 * client list is never fully loaded into the browser (see the scale rules),
 * so this asks the server as you type.
 *
 * A free-typed name is kept as-is rather than forced through the dropdown:
 * the brouillard is filled in fast from paper, and the ledger already falls
 * back to matching a client by name when no id was ever linked.
 */
export const ClientSearchInput: React.FC<ClientSearchInputProps> = ({ value, onChange, placeholder }) => {
  const { token } = useAuth();
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

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

  // Clicking away closes the list — inside a table row there is no modal
  // backdrop to catch it.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <div className="flex items-center border border-gray-300 rounded bg-white focus-within:border-gray-500">
        <Search className="w-3 h-3 text-gray-400 ml-2" />
        <input
          value={value}
          onChange={e => { onChange(e.target.value, undefined); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? 'Client…'}
          className="w-full px-2 py-1 text-[12px] focus:outline-none bg-transparent rounded"
        />
      </div>
      {open && value.trim().length >= 1 && results.length > 0 && (
        <div className="absolute z-30 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {results.map(c => (
            <div
              key={c.id}
              onClick={() => { onChange(c.name, c.id); setOpen(false); }}
              className="px-3 py-1.5 text-[12px] text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              {c.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
