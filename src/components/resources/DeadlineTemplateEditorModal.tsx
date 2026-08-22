import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { X, Loader, Trash2 } from 'lucide-react';
import { friendlyError } from '../../utils/errors';

export interface DeadlineTemplate {
  id: string;
  name: string;
  recurrenceRule: string;
  leadTimeDays: number;
  isActive: boolean;
  isSystem: boolean;
}

interface DeadlineTemplateEditorModalProps {
  template: DeadlineTemplate | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}

type Pattern = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

/** Splits `MONTHLY(day=28)` / `QUARTERLY` / `ANNUAL(month=3,day=25)` into form fields. */
const parseRule = (rule?: string) => {
  if (!rule) return { pattern: 'MONTHLY' as Pattern, day: 28, month: 1 };
  let m = /^MONTHLY\(day=(\d+)\)$/.exec(rule);
  if (m) return { pattern: 'MONTHLY' as Pattern, day: Number(m[1]), month: 1 };
  m = /^QUARTERLY(?:\(day=(\d+)\))?$/.exec(rule);
  if (m) return { pattern: 'QUARTERLY' as Pattern, day: Number(m[1] || 28), month: 1 };
  m = /^ANNUAL\(month=(\d+),day=(\d+)\)$/.exec(rule);
  if (m) return { pattern: 'ANNUAL' as Pattern, day: Number(m[2]), month: Number(m[1]) };
  return { pattern: 'MONTHLY' as Pattern, day: 28, month: 1 };
};

const buildRule = (pattern: Pattern, day: number, month: number) => {
  if (pattern === 'MONTHLY') return `MONTHLY(day=${day})`;
  if (pattern === 'QUARTERLY') return `QUARTERLY(day=${day})`;
  return `ANNUAL(month=${month},day=${day})`;
};

/** The only place a modèle d'échéance récurrente is created or edited. */
export const DeadlineTemplateEditorModal: React.FC<DeadlineTemplateEditorModalProps> = ({ template, onClose, onSaved, onDeleted }) => {
  const { token } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const parsed = parseRule(template?.recurrenceRule);
  const [name, setName] = useState(template?.name ?? '');
  const [pattern, setPattern] = useState<Pattern>(parsed.pattern);
  const [day, setDay] = useState(parsed.day);
  const [month, setMonth] = useState(parsed.month);
  const [leadTimeDays, setLeadTimeDays] = useState(template?.leadTimeDays ?? 7);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const request = async (url: string, method: string, body?: any) => {
    const res = await fetch(url, { method, headers: authHeaders, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Une erreur est survenue');
    }
    return res.json().catch(() => ({}));
  };

  const handleSave = async () => {
    const templateName = name.trim();
    if (!templateName) { setError('Le nom est requis.'); return; }
    setError('');
    setIsSaving(true);
    try {
      const payload = { name: templateName, recurrenceRule: buildRule(pattern, day, month), leadTimeDays };
      if (template) await request(`/api/deadline-templates/${template.id}`, 'PUT', payload);
      else await request('/api/deadline-templates', 'POST', payload);
      onSaved();
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!template) return;
    setError('');
    setIsSaving(true);
    try {
      await request(`/api/deadline-templates/${template.id}`, 'DELETE');
      onDeleted?.();
    } catch (e: any) {
      setError(friendlyError(e, 'Suppression impossible'));
      setConfirmingDelete(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-[16px] font-bold text-gray-900">{template ? "Modifier l'échéance" : 'Nouvelle échéance récurrente'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">{error}</div>
          )}

          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">Nom</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              placeholder="Ex: Déclaration mensuelle de TVA"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">Récurrence</label>
            <div className="grid grid-cols-3 gap-2">
              {(['MONTHLY', 'QUARTERLY', 'ANNUAL'] as Pattern[]).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPattern(p)}
                  className={`px-2 py-1.5 rounded-lg text-[12px] font-medium border ${
                    pattern === p ? 'bg-navy text-white border-navy' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {p === 'MONTHLY' ? 'Mensuelle' : p === 'QUARTERLY' ? 'Trimestrielle' : 'Annuelle'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            {pattern === 'ANNUAL' && (
              <div className="flex-1">
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Mois</label>
                <input
                  type="number" min={1} max={12}
                  value={month}
                  onChange={e => setMonth(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                />
              </div>
            )}
            <div className="flex-1">
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Jour</label>
              <input
                type="number" min={1} max={31}
                value={day}
                onChange={e => setDay(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Alerte J-</label>
              <input
                type="number" min={0} max={60}
                value={leadTimeDays}
                onChange={e => setLeadTimeDays(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
              />
            </div>
          </div>
          <p className="text-[11px] text-gray-400">
            {pattern === 'QUARTERLY'
              ? `Échéance le ${day} du mois suivant chaque trimestre (janvier, avril, juillet, octobre).`
              : pattern === 'ANNUAL'
                ? `Échéance chaque année le ${day}/${month}.`
                : `Échéance le ${day} de chaque mois.`}
          </p>

          <div className="pt-3 border-t border-gray-200 flex items-center justify-between gap-3">
            {template && onDeleted ? (
              confirmingDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] text-red-700 font-medium">Supprimer ?</span>
                  <button onClick={handleDelete} disabled={isSaving} className="px-2.5 py-1 bg-red-600 text-white rounded-md text-[12px] font-semibold hover:bg-red-700 disabled:opacity-50">Oui</button>
                  <button onClick={() => setConfirmingDelete(false)} className="px-2.5 py-1 border border-gray-300 rounded-md text-[12px] font-medium text-gray-600 hover:bg-gray-50">Non</button>
                </div>
              ) : (
                <button onClick={() => setConfirmingDelete(true)} className="px-3 py-2 text-[13px] font-medium text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1.5">
                  <Trash2 className="w-4 h-4" />
                  Supprimer
                </button>
              )
            ) : <span />}

            <div className="flex gap-3">
              <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-100 bg-white">Annuler</button>
              <button
                onClick={handleSave}
                disabled={isSaving || !name.trim()}
                className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover flex items-center gap-2 disabled:opacity-50"
              >
                {isSaving && <Loader className="w-4 h-4 animate-spin" />}
                {template ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
