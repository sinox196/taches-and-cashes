import React, { useEffect, useRef, useState } from 'react';
import { X, Loader, Send, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { friendlyError } from '../../utils/errors';

/** §4.1 of the cahier des charges — "Affecter une ressource à un client". */

interface AssignResourceModalProps {
  /** Preselected and locked — always opened from the "Mon travail" flow, which already has a client in context. */
  client: { id: number; name: string };
  onClose: () => void;
  onAssigned: () => void;
}

export const AssignResourceModal: React.FC<AssignResourceModalProps> = ({ client, onClose, onAssigned }) => {
  const { token } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [templates, setTemplates] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [templateId, setTemplateId] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [isTemplateDropdownOpen, setIsTemplateDropdownOpen] = useState(false);
  const templateDropdownRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) setIsTemplateDropdownOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    fetch('/api/resource-templates', { headers: authHeaders })
      .then(r => r.json())
      .then(t => setTemplates(Array.isArray(t) ? t.filter(x => x.type === 'document_checklist' && x.isActive) : []))
      .catch(() => setTemplates([]))
      .finally(() => setIsLoading(false));
  }, [token]);

  const normalize = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const searchTerm = normalize(templateSearch.trim());
  const options = searchTerm ? templates.filter(t => normalize(t.name).includes(searchTerm)) : templates;
  const selectedTemplate = templates.find(t => t.id === templateId) ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId) return;
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/client-resources', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ clientId: client.id, templateId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Affectation impossible.');
      setDone(true);
      onAssigned();
    } catch (e: any) {
      setError(friendlyError(e, 'Affectation impossible.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-4">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-[14px] font-bold text-gray-900">Affecter une ressource</h2>
            <p className="text-[11.5px] text-gray-500 mt-0.5">Pour {client.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {done ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
              <Send className="w-5 h-5" />
            </div>
            <p className="text-[13px] font-semibold text-gray-900">Ressource affectée.</p>
            <p className="text-[12px] text-gray-500 mt-1">Elle apparaît maintenant dans le suivi de ce client.</p>
            <button onClick={onClose} className="mt-4 px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover">
              Fermer
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-3.5">
            <div className="relative" ref={templateDropdownRef}>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">Modèle</label>
              {isLoading ? (
                <div className="flex items-center gap-2 text-[12px] text-gray-400 py-2">
                  <Loader className="w-3.5 h-3.5 animate-spin" /> Chargement…
                </div>
              ) : templates.length === 0 ? (
                <div className="w-full border border-dashed border-gray-200 rounded-md px-3 py-2 text-[11px] text-gray-400 italic">
                  Aucun modèle disponible — créez-en un dans Ressources métier.
                </div>
              ) : (
                <>
                  <div className="flex items-center border border-gray-200 rounded-md bg-white focus-within:border-gray-400">
                    <Search className="w-3.5 h-3.5 text-gray-400 ml-2 shrink-0" />
                    <input
                      value={selectedTemplate ? selectedTemplate.name : templateSearch}
                      onChange={e => {
                        setTemplateSearch(e.target.value);
                        setIsTemplateDropdownOpen(true);
                        if (selectedTemplate) setTemplateId('');
                      }}
                      onFocus={() => setIsTemplateDropdownOpen(true)}
                      placeholder="Taper pour rechercher un modèle…"
                      className="w-full px-2 py-2 text-[13px] font-medium text-gray-800 focus:outline-none bg-transparent"
                    />
                  </div>
                  {isTemplateDropdownOpen && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-100 rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {options.length > 0 ? (
                        options.map(t => (
                          <div
                            key={t.id}
                            onClick={() => { setTemplateId(t.id); setTemplateSearch(''); setIsTemplateDropdownOpen(false); }}
                            className="px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50 cursor-pointer"
                          >
                            {t.name}{t.isSystem ? ' (système)' : ''}
                          </div>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-[12px] text-gray-500 italic">Aucun modèle trouvé.</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {error && (
              <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">{error}</div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-100 bg-white">
                Annuler
              </button>
              <button
                type="submit"
                disabled={!templateId || saving}
                className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving && <Loader className="w-4 h-4 animate-spin" />}
                Affecter
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
