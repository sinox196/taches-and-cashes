import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { CalendarDays, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { friendlyError } from '../../utils/errors';

interface Holiday {
  id: string;
  date: string; // 'YYYY-MM-DD'
  label: string;
}

const DAYS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// Une date civile pure (pas d'heure, pas de fuseau) — parsée à la main plutôt
// que via `new Date('YYYY-MM-DD')`, qui l'interprète en UTC et peut afficher
// la veille selon le fuseau du navigateur. Même piège que `civilDateKeyTN`
// documente côté serveur pour un instant ; ici la valeur n'en est même pas un.
const fmtHoliday = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dow = DAYS_FR[new Date(y, m - 1, d).getDay()];
  return `${dow} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
};

/**
 * Calendrier des jours fériés — un calendrier de référence géré par l'admin,
 * volontairement sans effet sur le pointage : aucune date ici ne bloque une
 * saisie, n'en pré-remplit une, ni ne modifie un calcul de capacité. C'est un
 * aide-mémoire pour le cabinet, pas une règle appliquée ailleurs dans l'app.
 */
export const HolidaysTab: React.FC = () => {
  const { token, hasPermission } = useAuth();
  const canManage = hasPermission('MANAGE_LEAVE_REQUESTS');
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<null | { id?: string; date: string; label: string }>(null);
  useEscapeToClose(() => setForm(null), !!form);

  const load = () => {
    fetch('/api/hr/holidays', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setHolidays(data); })
      .catch(e => setError(friendlyError(e, 'Impossible de charger le calendrier.')))
      .finally(() => setIsLoading(false));
  };

  useEffect(load, [token]);

  const save = async () => {
    if (!form) return;
    if (!form.date.trim() || !form.label.trim()) return;
    try {
      const res = await fetch(form.id ? `/api/hr/holidays/${form.id}` : '/api/hr/holidays', {
        method: form.id ? 'PUT' : 'POST',
        headers: authHeaders,
        body: JSON.stringify({ date: form.date, label: form.label.trim() }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Enregistrement impossible'); return; }
      setForm(null);
      load();
    } catch (e) {
      setError(friendlyError(e, 'Enregistrement impossible'));
    }
  };

  const remove = async (h: Holiday) => {
    if (!confirm(`Supprimer "${h.label}" (${fmtHoliday(h.date)}) ?`)) return;
    try {
      await fetch(`/api/hr/holidays/${h.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      load();
    } catch (e) {
      setError(friendlyError(e, 'Suppression impossible'));
    }
  };

  const byYear: Record<string, Holiday[]> = {};
  for (const h of holidays.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    (byYear[h.date.slice(0, 4)] ||= []).push(h);
  }
  const years = Object.keys(byYear).sort();

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-[12px] text-gray-500 max-w-xl">
          Calendrier de référence pour le cabinet — ces dates n'ont aucun effet sur le pointage : aucune saisie
          n'est bloquée, pré-remplie ou recalculée un jour férié.
        </p>
        {canManage ? (
          <button
            onClick={() => setForm({ date: '', label: '' })}
            className="shrink-0 bg-navy hover:bg-navy-hover text-white px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Ajouter un jour férié
          </button>
        ) : (
          <span className="shrink-0 text-[11px] text-gray-400 italic">Consultation</span>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">{error}</div>
      )}

      {years.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
          <CalendarDays className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-[13px] text-gray-500">Aucun jour férié pour le moment.</p>
        </div>
      ) : (
        years.map(year => (
          <div key={year}>
            <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">{year}</h3>
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm divide-y divide-gray-100">
              {byYear[year].map(h => (
                <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CalendarDays className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-gray-800 truncate">{h.label}</span>
                      <span className="block text-[11px] text-gray-400">{fmtHoliday(h.date)}</span>
                    </span>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setForm({ id: h.id, date: h.date, label: h.label })}
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => remove(h)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
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

      {form && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-3">
            <h2 className="text-[15px] font-bold text-gray-900">{form.id ? 'Modifier le jour férié' : 'Nouveau jour férié'}</h2>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm({ ...form, date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Libellé</label>
              <input
                value={form.label}
                onChange={e => setForm({ ...form, label: e.target.value })}
                placeholder="Ex : Fête de l'Indépendance"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
              />
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setForm(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-100 bg-white">Annuler</button>
              <button onClick={save} className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover">Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
