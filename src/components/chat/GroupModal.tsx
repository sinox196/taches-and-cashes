import React, { useMemo, useState } from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { X, Loader2, Users, Trash2, Check, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { friendlyError } from '../../utils/errors';
import { roleMeta } from '../../constants/roles';

export interface ChatGroup {
  id: string;
  name: string;
  memberIds: number[];
  members: { id: number; fullName: string; role: string }[];
  createdBy: number;
  lastMessage: { body: string; createdAt: string; fromUserId: number } | null;
  unreadCount: number;
}

interface Props {
  /** null = créer un groupe. */
  group: ChatGroup | null;
  /** L'annuaire du cabinet, tel que le rend /api/messages/contacts. */
  contacts: { id: number; fullName: string; role: string }[];
  onClose: () => void;
  onSaved: (group: ChatGroup) => void;
  onDeleted: (groupId: string) => void;
}

/** Repliage des accents, comme partout ailleurs où l'on cherche un nom. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Création et modification d'un groupe de discussion.
 *
 * L'annuaire proposé est celui que le serveur rend déjà pour les messages
 * directs : il exclut les comptes portail, ce qui est exactement la règle des
 * groupes — ils sont internes au cabinet. Le serveur la revérifie de son côté.
 */
export const GroupModal: React.FC<Props> = ({ group, contacts, onClose, onSaved, onDeleted }) => {
  useEscapeToClose(onClose);
  const { token, user } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [name, setName] = useState(group?.name ?? '');
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<number[]>(
    // Moi excepté : je fais partie du groupe par construction, et une case à
    // cocher que l'on ne peut pas décocher n'apporte rien.
    (group?.memberIds ?? []).filter(id => id !== user?.id),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const matches = useMemo(() => {
    const q = fold(query.trim());
    return q ? contacts.filter(c => fold(c.fullName).includes(q)) : contacts;
  }, [contacts, query]);

  const toggle = (id: number) =>
    setMembers(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const save = async () => {
    if (!name.trim() || members.length === 0) return;
    setError('');
    setSaving(true);
    try {
      const res = await fetch(group ? `/api/messages/groups/${group.id}` : '/api/messages/groups', {
        method: group ? 'PUT' : 'POST',
        headers: authHeaders,
        body: JSON.stringify({ name: name.trim(), memberIds: members }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible.');
      onSaved(data);
    } catch (e: any) {
      setError(friendlyError(e, 'Enregistrement impossible.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!group) return;
    if (!confirm(`Supprimer le groupe « ${group.name} » et toute sa conversation ?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/messages/groups/${group.id}`, { method: 'DELETE', headers: authHeaders });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Suppression impossible.');
      onDeleted(group.id);
    } catch (e: any) {
      setError(friendlyError(e, 'Suppression impossible.'));
      setSaving(false);
    }
  };

  const canDelete = !!group && (group.createdBy === user?.id || user?.role === 'ADMIN');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-[15px] font-bold text-navy flex items-center gap-2">
            <Users className="w-4 h-4" />
            {group ? 'Modifier le groupe' : 'Nouveau groupe'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded-md">
              <p className="text-[12.5px] text-red-700 font-medium">{error}</p>
            </div>
          )}

          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">Nom du groupe</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex : Équipe Fiscalité"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-navy/20"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[12px] font-semibold text-gray-700">Participants</label>
              <span className="text-[11px] text-gray-400">{members.length} sélectionné(s)</span>
            </div>
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Rechercher un collègue…"
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-[12.5px] focus:outline-none focus:ring-2 focus:ring-navy/20"
              />
            </div>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
              {matches.length === 0 ? (
                <p className="px-3 py-3 text-[12px] text-gray-400 italic">Aucun collègue ne correspond.</p>
              ) : (
                matches.map(c => {
                  const on = members.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggle(c.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50"
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                        on ? 'bg-navy border-navy text-white' : 'border-gray-300'
                      }`}>
                        {on && <Check className="w-3 h-3" />}
                      </span>
                      <span className="text-[13px] text-gray-800 truncate flex-1">{c.fullName}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${roleMeta(c.role).badgeClass}`}>
                        {roleMeta(c.role).label}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Vous faites partie du groupe. Les comptes du portail client n'y ont pas accès.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-2 shrink-0">
          {canDelete ? (
            <button
              onClick={remove}
              disabled={saving}
              className="px-3 py-2 border border-red-200 rounded-lg text-[12.5px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> Supprimer
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50">
              Annuler
            </button>
            <button
              onClick={save}
              disabled={saving || !name.trim() || members.length === 0}
              className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-semibold hover:bg-navy-hover disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {group ? 'Enregistrer' : 'Créer le groupe'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
