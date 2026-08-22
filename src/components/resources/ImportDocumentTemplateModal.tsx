import React, { useEffect, useRef, useState } from 'react';
import { X, Loader, Upload, Trash2, Search, FileSpreadsheet, Check } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { friendlyError } from '../../utils/errors';
import { parseDocumentTemplateWorkbook } from './parseDocumentTemplateExcel';

interface ImportDocumentTemplateModalProps {
  onClose: () => void;
  onImported: () => void;
}

/**
 * Creates a "Document à fournir" template straight from the cabinet's own
 * Excel/CSV sheet (Secteur / Titre de la liste / Document rows) and, in the
 * same step, affects it to whichever clients are picked here — the two-step
 * "create the référentiel entry, then affect it from the client screen"
 * flow stays available, but this collapses it into one for the common case
 * of "I already have the sheet and I know which clients need it".
 */
export const ImportDocumentTemplateModal: React.FC<ImportDocumentTemplateModalProps> = ({ onClose, onImported }) => {
  const { token } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [sector, setSector] = useState('');
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<string[]>([]);
  const [newItem, setNewItem] = useState('');

  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState<any[]>([]);
  const [isSearchingClients, setIsSearchingClients] = useState(false);
  const [selectedClients, setSelectedClients] = useState<{ id: number; name: string }[]>([]);

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const parsed = title.trim().length > 0 || items.length > 0;

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setFileName(file.name);
    setParsing(true);
    try {
      const result = await parseDocumentTemplateWorkbook(file);
      setSector(result.sector);
      setTitle(result.title);
      setItems(result.items);
    } catch (e: any) {
      setError(friendlyError(e, 'Fichier illisible.'));
    } finally {
      setParsing(false);
    }
  };

  useEffect(() => {
    const term = clientSearch.trim();
    if (term.length < 1) { setClientResults([]); return; }
    let cancelled = false;
    setIsSearchingClients(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(term)}&page=1&limit=8`, { headers: authHeaders });
        const body = await res.json();
        const rows = Array.isArray(body) ? body : (body.data ?? []);
        if (!cancelled) setClientResults(rows);
      } catch {
        if (!cancelled) setClientResults([]);
      } finally {
        if (!cancelled) setIsSearchingClients(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [clientSearch, token]);

  const addClient = (c: any) => {
    if (!selectedClients.some(s => s.id === c.id)) setSelectedClients(prev => [...prev, { id: c.id, name: c.name }]);
    setClientSearch('');
    setClientResults([]);
  };
  const removeClient = (id: number) => setSelectedClients(prev => prev.filter(c => c.id !== id));

  const addItem = () => {
    const v = newItem.trim();
    if (!v) return;
    setItems(prev => [...prev, v]);
    setNewItem('');
  };
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const request = async (url: string, method: string, body?: any) => {
    const res = await fetch(url, { method, headers: authHeaders, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Une erreur est survenue');
    }
    return res.json().catch(() => ({}));
  };

  const handleImport = async () => {
    if (!title.trim() || items.length === 0) return;
    setError('');
    setSaving(true);
    try {
      const template = await request('/api/resource-templates', 'POST', {
        type: 'document_checklist', name: title.trim(), sector: sector.trim() || undefined,
      });
      for (const label of items) {
        await request('/api/resource-template-items', 'POST', { templateId: template.id, label });
      }
      await Promise.all(selectedClients.map(c =>
        request('/api/client-resources', 'POST', { clientId: c.id, templateId: template.id }),
      ));
      setDone(true);
      onImported();
    } catch (e: any) {
      setError(friendlyError(e, "Import impossible."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-4 max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-[14px] font-bold text-gray-900">Importer un modèle Excel</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {done ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
              <Check className="w-5 h-5" />
            </div>
            <p className="text-[13px] font-semibold text-gray-900">Modèle importé.</p>
            <p className="text-[12px] text-gray-500 mt-1">
              {selectedClients.length > 0
                ? `Affecté à ${selectedClients.length} client(s).`
                : 'Disponible dans le référentiel — affectez-le depuis une fiche client.'}
            </p>
            <button onClick={onClose} className="mt-4 px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover">
              Fermer
            </button>
          </div>
        ) : (
          <div className="p-5 overflow-y-auto flex-1 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">{error}</div>
            )}

            <div>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1.5">Fichier (Excel ou CSV)</label>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ''; }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={parsing}
                className="w-full px-3 py-2.5 border border-dashed border-gray-300 rounded-lg text-[12.5px] font-medium text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {parsing ? <Loader className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {fileName || 'Choisir un fichier — Secteur / Titre de la liste / Document'}
              </button>
            </div>

            {parsed && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-gray-400 block mb-1">Secteur</label>
                    <input
                      value={sector}
                      onChange={e => setSector(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-400 block mb-1">Titre de la liste</label>
                    <input
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-gray-400 block mb-1.5">
                    Documents ({items.length})
                  </label>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {items.map((label, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          value={label}
                          onChange={e => setItems(prev => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
                          className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-md text-[12.5px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        />
                        <button onClick={() => removeItem(i)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-1.5">
                    <input
                      value={newItem}
                      onChange={e => setNewItem(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
                      placeholder="Ajouter un document"
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-[12.5px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    />
                    <button
                      onClick={addItem}
                      disabled={!newItem.trim()}
                      className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-[12px] font-medium hover:bg-gray-50 disabled:opacity-40 shrink-0"
                    >
                      Ajouter
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <label className="text-[11px] font-semibold text-gray-400 block mb-1.5">
                    Affecter directement à des clients <span className="font-normal text-gray-300">(facultatif)</span>
                  </label>
                  {selectedClients.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {selectedClients.map(c => (
                        <span key={c.id} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-[12px] px-2 py-1 rounded-md">
                          {c.name}
                          <button onClick={() => removeClient(c.id)} className="text-gray-400 hover:text-red-500">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center border border-gray-200 rounded-md bg-white focus-within:border-gray-400">
                    <Search className="w-3.5 h-3.5 text-gray-400 ml-2" />
                    <input
                      value={clientSearch}
                      onChange={e => setClientSearch(e.target.value)}
                      placeholder="Rechercher un client à ajouter…"
                      className="w-full px-2 py-2 text-[13px] font-medium text-gray-800 focus:outline-none bg-transparent"
                    />
                    {isSearchingClients && <Loader className="w-3.5 h-3.5 text-gray-400 animate-spin mr-2" />}
                  </div>
                  {clientSearch.length >= 1 && clientResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-100 rounded-md shadow-lg max-h-40 overflow-y-auto">
                      {clientResults.map(c => (
                        <div key={c.id} onClick={() => addClient(c)} className="px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50 cursor-pointer">
                          {c.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {!done && (
          <div className="p-4 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3 shrink-0">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-100 bg-white">
              Annuler
            </button>
            <button
              onClick={handleImport}
              disabled={!title.trim() || items.length === 0 || saving}
              className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving ? <Loader className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              Importer
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
