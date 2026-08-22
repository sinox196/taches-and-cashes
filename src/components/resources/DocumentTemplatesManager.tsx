import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Plus, Trash2, FileSpreadsheet, Search, FileCheck2, Loader2, Loader, Check } from 'lucide-react';
import { friendlyError } from '../../utils/errors';

export interface ResourceTemplate {
  id: string;
  type: 'document_checklist';
  name: string;
  sector: string | null;
  isSequential: boolean;
  isActive: boolean;
  isSystem: boolean;
}

export interface ResourceTemplateItem {
  id: string;
  templateId: string;
  label: string;
  sortOrder: number;
}

interface DraftItem {
  id?: string;
  label: string;
  originalLabel?: string;
}

interface DocumentTemplatesManagerProps {
  templates: ResourceTemplate[];
  items: ResourceTemplateItem[];
  onImport: () => void;
  reload: () => Promise<void>;
}

/**
 * A master-detail layout instead of one long stack of expanded cards: with a
 * few dozen modèles, scrolling a single page to find and edit one became the
 * complaint. The list on the left scrolls on its own (bounded height) and can
 * be filtered by name; the right pane edits the selected modèle inline — no
 * modal, no "dupliquer avant de modifier" step, every modèle (seeded or not)
 * is directly editable and removable.
 */
export const DocumentTemplatesManager: React.FC<DocumentTemplatesManagerProps> = ({ templates, items, onImport, reload }) => {
  const { token } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState('');
  const [sector, setSector] = useState('');
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [newItemLabel, setNewItemLabel] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const selected = templates.find(t => t.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    setName(selected.name);
    setSector(selected.sector ?? '');
    setDraftItems(
      items.filter(i => i.templateId === selected.id).sort((a, b) => a.sortOrder - b.sortOrder)
        .map(i => ({ id: i.id, label: i.label, originalLabel: i.label })),
    );
    setRemovedIds([]);
    setError('');
    setSaved(false);
    setConfirmingDelete(false);
  }, [selectedId]);

  const normalize = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const term = normalize(search.trim());
  const filtered = term
    ? templates.filter(t => normalize(t.name).includes(term) || normalize(t.sector ?? '').includes(term))
    : templates;

  const request = async (url: string, method: string, body?: any) => {
    const res = await fetch(url, { method, headers: authHeaders, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Une erreur est survenue');
    }
    return res.json().catch(() => ({}));
  };

  const createTemplate = async () => {
    setCreating(true);
    setError('');
    try {
      const created = await request('/api/resource-templates', 'POST', {
        type: 'document_checklist', name: 'Nouvelle liste de documents', sector: '',
      });
      await reload();
      setSelectedId(created.id);
      setSearch('');
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setCreating(false);
    }
  };

  const addItem = () => {
    const v = newItemLabel.trim();
    if (!v) return;
    setDraftItems(prev => [...prev, { label: v }]);
    setNewItemLabel('');
  };
  const updateItem = (index: number, label: string) =>
    setDraftItems(prev => prev.map((it, i) => (i === index ? { ...it, label } : it)));
  const removeItem = (index: number) => {
    const target = draftItems[index];
    if (target.id) setRemovedIds(prev => [...prev, target.id!]);
    setDraftItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!selected) return;
    const templateName = name.trim();
    if (!templateName) { setError('Le titre est requis.'); return; }
    if (draftItems.some(i => !i.label.trim())) { setError('Un document ne peut pas être vide.'); return; }

    setError('');
    setIsSaving(true);
    try {
      await request(`/api/resource-templates/${selected.id}`, 'PUT', { name: templateName, sector: sector.trim() });
      for (const id of removedIds) {
        await request(`/api/resource-template-items/${id}`, 'DELETE');
      }
      for (const draft of draftItems) {
        const label = draft.label.trim();
        if (!draft.id) {
          await request('/api/resource-template-items', 'POST', { templateId: selected.id, label });
        } else if (label !== draft.originalLabel) {
          await request(`/api/resource-template-items/${draft.id}`, 'PUT', { label });
        }
      }
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setIsSaving(true);
    try {
      await request(`/api/resource-templates/${selected.id}`, 'DELETE');
      setSelectedId(null);
      await reload();
    } catch (e: any) {
      setError(friendlyError(e, 'Suppression impossible'));
      setConfirmingDelete(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={createTemplate}
          disabled={creating}
          className="bg-navy hover:bg-navy-hover text-white px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          {creating ? <Loader className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Nouvelle liste de documents
        </button>
        <button
          onClick={onImport}
          className="bg-white border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2 hover:bg-gray-50 transition-colors"
        >
          <FileSpreadsheet className="w-4 h-4" />
          Importer un modèle Excel
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
          <FileCheck2 className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-[13px] text-gray-500">Aucun modèle pour le moment.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,280px)_1fr] gap-4 items-start">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="p-2.5 border-b border-gray-100">
              <div className="flex items-center border border-gray-200 rounded-md bg-white focus-within:border-gray-400">
                <Search className="w-3.5 h-3.5 text-gray-400 ml-2 shrink-0" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Rechercher un modèle…"
                  className="w-full px-2 py-1.5 text-[12.5px] text-gray-800 focus:outline-none bg-transparent"
                />
              </div>
            </div>
            <div className="max-h-[65vh] overflow-y-auto divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <p className="text-[12px] text-gray-400 italic p-4">Aucun modèle ne correspond.</p>
              ) : (
                filtered.map(t => {
                  const count = items.filter(i => i.templateId === t.id).length;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      className={`w-full text-left px-3.5 py-2.5 transition-colors ${
                        selectedId === t.id ? 'bg-navy/[0.06]' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className={`text-[13px] font-medium leading-snug break-words ${selectedId === t.id ? 'text-navy' : 'text-gray-800'}`}>
                        {t.name}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {count} item(s){t.sector ? ` · ${t.sector}` : ''}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            {!selected ? (
              <div className="text-center py-14">
                <FileCheck2 className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                <p className="text-[13px] text-gray-500">Sélectionnez un modèle à gauche pour le consulter ou le modifier.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {error && (
                  <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">{error}</div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Secteur</label>
                    <input
                      value={sector}
                      onChange={e => setSector(e.target.value)}
                      placeholder="Ex: Banque"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Titre de la liste</label>
                    <input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <h3 className="text-[13px] font-bold text-gray-800 mb-2">Document | Suivi</h3>
                  {draftItems.length === 0 ? (
                    <p className="text-[12px] text-gray-400 italic mb-2">Aucun document pour l'instant.</p>
                  ) : (
                    <div className="space-y-1.5 mb-2 max-h-[40vh] overflow-y-auto pr-1">
                      {draftItems.map((it, i) => (
                        <div key={it.id ?? `new-${i}`} className="flex items-center gap-2">
                          <input
                            value={it.label}
                            onChange={e => updateItem(i, e.target.value)}
                            className="flex-1 px-2.5 py-1.5 border border-gray-300 rounded-md text-[12.5px] focus:ring-2 focus:ring-navy focus:border-transparent"
                          />
                          <button onClick={() => removeItem(i)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={newItemLabel}
                      onChange={e => setNewItemLabel(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
                      placeholder="Ajouter un document"
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-[12.5px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    />
                    <button
                      onClick={addItem}
                      disabled={!newItemLabel.trim()}
                      className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-[12px] font-medium hover:bg-gray-50 disabled:opacity-40 shrink-0"
                    >
                      Ajouter
                    </button>
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-200 flex items-center justify-between gap-3">
                  {confirmingDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11.5px] text-red-700 font-medium">Supprimer ce modèle ?</span>
                      <button onClick={handleDelete} disabled={isSaving} className="px-2.5 py-1 bg-red-600 text-white rounded-md text-[12px] font-semibold hover:bg-red-700 disabled:opacity-50">Oui</button>
                      <button onClick={() => setConfirmingDelete(false)} className="px-2.5 py-1 border border-gray-300 rounded-md text-[12px] font-medium text-gray-600 hover:bg-gray-50">Non</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmingDelete(true)} className="px-3 py-2 text-[13px] font-medium text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1.5">
                      <Trash2 className="w-4 h-4" />
                      Supprimer
                    </button>
                  )}

                  <div className="flex items-center gap-3">
                    {saved && (
                      <span className="text-[12px] text-emerald-600 font-medium flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Enregistré
                      </span>
                    )}
                    <button
                      onClick={handleSave}
                      disabled={isSaving || !name.trim()}
                      className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover flex items-center gap-2 disabled:opacity-50"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Enregistrer
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
