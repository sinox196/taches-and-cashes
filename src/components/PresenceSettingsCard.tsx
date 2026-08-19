import React, { useEffect, useState } from 'react';
import { Clock, Check, Loader } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePresence } from '../context/PresenceContext';
import {
  DEFAULT_AWAY_AFTER_MINUTES,
  MIN_AWAY_AFTER_MINUTES,
  MAX_AWAY_AFTER_MINUTES,
} from '../constants/presence';

/**
 * Sets how long a user may sit idle before they show as "absent".
 *
 * Lives on the Users page rather than in a settings page of its own: it is a
 * user-status rule, and the project deliberately keeps one place per concern
 * instead of a global settings screen.
 *
 * Only the *away* threshold is exposed. "Inactif" is not configurable and must
 * not become so — it is derived from missing heartbeats, and a value near the
 * heartbeat interval would make everyone flicker offline on one dropped request.
 */
export const PresenceSettingsCard: React.FC = () => {
  const { token, hasPermission } = useAuth();
  const { awayAfterMinutes, refreshAwayAfter } = usePresence();

  const [value, setValue] = useState<number | ''>(awayAfterMinutes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Adopt the server's value once it has loaded, unless the user is mid-edit.
  useEffect(() => { if (!saving) setValue(awayAfterMinutes); }, [awayAfterMinutes]);

  if (!hasPermission('MANAGE_PRESENCE_SETTINGS')) return null;

  const dirty = value !== '' && value !== awayAfterMinutes;

  const save = async () => {
    if (value === '') { setError('Indiquez un nombre de minutes.'); return; }
    if (value < MIN_AWAY_AFTER_MINUTES || value > MAX_AWAY_AFTER_MINUTES) {
      setError(`Entre ${MIN_AWAY_AFTER_MINUTES} et ${MAX_AWAY_AFTER_MINUTES} minutes.`);
      return;
    }
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/presence/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ awayAfterMinutes: value }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Enregistrement impossible.');
      refreshAwayAfter();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
          <Clock className="w-4 h-4 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-bold text-gray-800">Statut de présence</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">
            Durée d'inactivité (souris et clavier) avant qu'un utilisateur passe en{' '}
            <span className="font-medium text-amber-600">absent</span>. Il repasse en actif
            dès qu'il touche la souris ou le clavier.
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <input
              type="number"
              min={MIN_AWAY_AFTER_MINUTES}
              max={MAX_AWAY_AFTER_MINUTES}
              value={value}
              onChange={e => {
                setError('');
                setValue(e.target.value === '' ? '' : Number(e.target.value));
              }}
              className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 outline-none"
            />
            <span className="text-[13px] text-gray-600">minutes</span>

            <button
              onClick={save}
              disabled={!dirty || saving}
              className="ml-1 px-3 py-2 bg-[#101828] text-white rounded-lg text-[12px] font-medium hover:bg-[#1d2939] disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {saving && <Loader className="w-3.5 h-3.5 animate-spin" />}
              Enregistrer
            </button>

            {saved && !dirty && (
              <span className="text-[12px] text-green-600 font-medium flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Enregistré
              </span>
            )}
            {value !== DEFAULT_AWAY_AFTER_MINUTES && (
              <button
                onClick={() => { setError(''); setValue(DEFAULT_AWAY_AFTER_MINUTES); }}
                className="text-[12px] text-gray-500 hover:text-gray-700 underline underline-offset-2"
              >
                Rétablir {DEFAULT_AWAY_AFTER_MINUTES} min
              </button>
            )}
          </div>

          {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}
        </div>
      </div>
    </div>
  );
};
