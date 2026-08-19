import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface MultiSelectAutocompleteProps {
  placeholder: string;
  endpoint: string; // e.g. '/api/kpi/users/search'
  selectedItems: { id: number; name: string }[];
  onChange: (items: { id: number; name: string }[]) => void;
}

export const MultiSelectAutocomplete: React.FC<MultiSelectAutocompleteProps> = ({
  placeholder,
  endpoint,
  selectedItems,
  onChange
}) => {
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  
  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [wrapperRef]);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 1) {
      setResults([]);
      return;
    }
    
    const delayDebounceFn = setTimeout(() => {
      setLoading(true);
      fetch(`${endpoint}?q=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setResults(data);
          setIsOpen(true);
        }
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [query, endpoint, token]);

  const handleSelect = (item: { id: number; name: string }) => {
    if (!selectedItems.find(i => i.id === item.id)) {
      onChange([...selectedItems, item]);
    }
    setQuery('');
    setIsOpen(false);
  };

  const handleRemove = (id: number) => {
    onChange(selectedItems.filter(i => i.id !== id));
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="flex flex-wrap items-center gap-1 bg-white px-2 py-1.5 rounded-lg border border-gray-200 min-h-[38px] max-w-sm">
        {selectedItems.map(item => (
          <div key={item.id} className="flex items-center gap-1 bg-gray-100 text-gray-700 text-[12px] px-2 py-1 rounded-md">
            <span>{item.name}</span>
            <button onClick={() => handleRemove(item.id)} className="text-gray-400 hover:text-red-500">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        
        <div className="flex-1 flex items-center min-w-[120px]">
          <Search className="w-4 h-4 text-gray-400 mr-2 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.length > 0) setIsOpen(true);
            }}
            onFocus={() => { if (query.length >= 1 || results.length > 0) setIsOpen(true); }}
            placeholder={selectedItems.length === 0 ? placeholder : ''}
            className="bg-transparent text-[13px] text-gray-700 outline-none w-full"
          />
          {loading && <Loader2 className="w-3 h-3 text-gray-400 animate-spin shrink-0 ml-1" />}
        </div>
      </div>

      {/* Dropdown */}
      {isOpen && query.length >= 1 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
          {results.length > 0 ? (
            <ul className="py-1">
              {results.map((item) => (
                <li
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  className="px-4 py-2 text-[13px] text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  {item.name}
                </li>
              ))}
            </ul>
          ) : !loading ? (
            <div className="px-4 py-3 text-[12px] text-gray-500 italic text-center">Aucun résultat</div>
          ) : null}
        </div>
      )}
    </div>
  );
};
