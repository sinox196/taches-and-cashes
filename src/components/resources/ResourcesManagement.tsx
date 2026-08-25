import React, { useEffect, useState } from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { useAuth } from '../../context/AuthContext';
import { Plus, Pencil, Trash2, Loader2, FileCheck2, Link2, CalendarClock, ExternalLink, Briefcase } from 'lucide-react';
import { DocumentTemplatesManager, type ResourceTemplate, type ResourceTemplateItem } from './DocumentTemplatesManager';
import { ImportDocumentTemplateModal } from './ImportDocumentTemplateModal';
import { EcheancesGrid } from './EcheancesGrid';
import { MyResourcesWork } from './MyResourcesWork';
import { friendlyError } from '../../utils/errors';

type Tab = 'work' | 'documents' | 'links' | 'deadlines';

/**
 * Ressources Métier — référentiel cabinet (documents des modèles, liens
 * utiles, échéances) plus the échéances suivi grid. Reuses the same
 * list/edit visual language MissionsManagement already validated, per the
 * cahier des charges' own §4.3 instruction: no new visual ecosystem.
 */
export const ResourcesManagement: React.FC = () => {
  const { token, hasPermission } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const canManage = hasPermission('MANAGE_RESOURCES');

  const [tab, setTab] = useState<Tab>('work');
  const [templates, setTemplates] = useState<ResourceTemplate[]>([]);
  const [items, setItems] = useState<ResourceTemplateItem[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [importingTemplate, setImportingTemplate] = useState(false);
  const [linkForm, setLinkForm] = useState<null | { id?: string; category: string; label: string; url: string; description: string; icon: string }>(null);
  useEscapeToClose(() => setLinkForm(null), !!linkForm);

  const load = async () => {
    try {
      const [t, i, l] = await Promise.all([
        fetch('/api/resource-templates', { headers: authHeaders }).then(r => r.json()),
        fetch('/api/resource-template-items', { headers: authHeaders }).then(r => r.json()),
        fetch('/api/useful-links', { headers: authHeaders }).then(r => r.json()),
      ]);
      if (Array.isArray(t)) setTemplates(t);
      if (Array.isArray(i)) setItems(i);
      if (Array.isArray(l)) setLinks(l);
    } catch (e) {
      setError(friendlyError(e, 'Impossible de charger les ressources.'));
    } finally {
      setIsLoading(false);
    }
  };

  // The référentiel tabs (and their data) are admin-only — a plain
  // VIEW_RESOURCES user only ever sees "Mon travail", which fetches its own
  // data directly, so there is nothing to load here for them.
  useEffect(() => { if (canManage) load(); else setIsLoading(false); }, []);

  const saveLink = async () => {
    if (!linkForm) return;
    const { id, ...payload } = linkForm;
    if (!payload.category.trim() || !payload.label.trim() || !payload.url.trim()) return;
    try {
      const res = await fetch(id ? `/api/useful-links/${id}` : '/api/useful-links', {
        method: id ? 'PUT' : 'POST', headers: authHeaders, body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Enregistrement impossible'); return; }
      setLinkForm(null);
      await load();
    } catch (e) {
      setError(friendlyError(e, 'Enregistrement impossible'));
    }
  };

  const removeLink = async (link: any) => {
    if (!confirm(`Supprimer le lien "${link.label}" ?`)) return;
    try {
      await fetch(`/api/useful-links/${link.id}`, { method: 'DELETE', headers: authHeaders });
      await load();
    } catch (e) {
      setError(friendlyError(e, 'Suppression impossible'));
    }
  };

  const linksByCategory: Record<string, any[]> = {};
  for (const l of links) {
    (linksByCategory[l.category] ||= []).push(l);
  }

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: 'work', label: 'Mon travail', icon: Briefcase },
    ...(canManage ? [
      { id: 'documents' as Tab, label: 'Documents des modèles', icon: FileCheck2 },
      { id: 'links' as Tab, label: 'Liens utiles', icon: Link2 },
      { id: 'deadlines' as Tab, label: 'Échéances', icon: CalendarClock },
    ] : []),
  ];

  return (
    <div className={`flex-1 flex flex-col space-y-6 w-full mx-auto p-6 lg:p-8 ${tab === 'deadlines' ? 'max-w-full' : 'max-w-[1200px]'}`}>
      <div>
        <h1 className="text-[20px] font-bold text-gray-800 tracking-tight flex items-center gap-2">
          <FileCheck2 className="w-5 h-5" />
          Ressources métier
        </h1>
        <p className="text-[12px] text-gray-500 mt-1">
          {canManage
            ? "Documents des modèles, liens utiles et échéances réglementaires, pré-configurés et personnalisables."
            : 'Choisissez un client, puis cochez les documents reçus.'}
        </p>
      </div>

      {TABS.length > 1 && (
        <div className="flex gap-1 border-b border-gray-200">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-2.5 text-[13px] font-medium flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
                tab === t.id ? 'border-navy text-navy' : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">{error}</div>
      )}

      {tab === 'work' ? (
        <MyResourcesWork />
      ) : tab === 'deadlines' ? (
        <EcheancesGrid />
      ) : isLoading ? (
        <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : tab === 'documents' ? (
        <DocumentTemplatesManager
          templates={templates}
          items={items}
          onImport={() => setImportingTemplate(true)}
          reload={load}
        />
      ) : (
        <div className="space-y-5">
          {canManage && (
            <button
              onClick={() => setLinkForm({ category: '', label: '', url: '', description: '', icon: '' })}
              className="self-start bg-navy hover:bg-navy-hover text-white px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Nouveau lien
            </button>
          )}
          {Object.keys(linksByCategory).length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
              <Link2 className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <p className="text-[13px] text-gray-500">Aucun lien pour le moment.</p>
            </div>
          ) : (
            Object.entries(linksByCategory).map(([category, categoryLinks]) => (
              <div key={category}>
                <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">{category}</h3>
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm divide-y divide-gray-100">
                  {categoryLinks.map(l => (
                    <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <a
                        href={l.url} target="_blank" rel="noopener noreferrer"
                        title={`Ouvrir ${l.url}`}
                        className="flex items-center gap-2.5 text-[13px] font-medium text-gray-800 hover:text-navy min-w-0"
                      >
                        {l.icon ? (
                          <img src={l.icon} alt="" className="w-6 h-6 rounded object-contain border border-gray-100 shrink-0 bg-white" />
                        ) : (
                          <ExternalLink className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate">{l.label}</span>
                          {l.description && <span className="block text-[11px] font-normal text-gray-400 truncate">{l.description}</span>}
                        </span>
                      </a>
                      {canManage && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setLinkForm({ id: l.id, category: l.category, label: l.label, url: l.url, description: l.description || '', icon: l.icon || '' })}
                            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => removeLink(l)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {importingTemplate && (
        <ImportDocumentTemplateModal
          onClose={() => setImportingTemplate(false)}
          onImported={load}
        />
      )}

      {linkForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-3">
            <h2 className="text-[15px] font-bold text-gray-900">{linkForm.id ? 'Modifier le lien' : 'Nouveau lien'}</h2>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Catégorie</label>
              <input
                value={linkForm.category}
                onChange={e => setLinkForm({ ...linkForm, category: e.target.value })}
                placeholder="Ex: Plateformes fiscales"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Libellé</label>
              <input
                value={linkForm.label}
                onChange={e => setLinkForm({ ...linkForm, label: e.target.value })}
                placeholder="Ex: Portail des impôts"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">URL</label>
              <input
                value={linkForm.url}
                onChange={e => setLinkForm({ ...linkForm, url: e.target.value })}
                placeholder="https://…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                Description <span className="font-normal text-gray-300">(facultatif)</span>
              </label>
              <input
                value={linkForm.description}
                onChange={e => setLinkForm({ ...linkForm, description: e.target.value })}
                placeholder="Précision affichée sous le libellé"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                Icône <span className="font-normal text-gray-300">(URL, facultatif)</span>
              </label>
              <div className="flex items-center gap-2">
                {linkForm.icon && <img src={linkForm.icon} alt="" className="w-8 h-8 rounded object-contain border border-gray-100 shrink-0" />}
                <input
                  value={linkForm.icon}
                  onChange={e => setLinkForm({ ...linkForm, icon: e.target.value })}
                  placeholder="/logos/exemple.png"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setLinkForm(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-100 bg-white">Annuler</button>
              <button onClick={saveLink} className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover">Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
