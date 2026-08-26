import React, { useEffect, useState } from 'react';
import { X, Loader2, Pencil, Trash2, Check, XCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { friendlyError } from '../../utils/errors';
import { ROLES, roleMeta } from '../../constants/roles';

interface PlatformUser {
  id: number;
  username: string;
  role: string;
}

interface PlatformUsersModalProps {
  companyId: string;
  companyName: string;
  onClose: () => void;
}

/**
 * Cross-tenant user management for the platform admin — edit or delete any
 * customer company's users (username, role, and an optional password
 * reset). Creating users stays the company's own job, done from its own
 * UsersManagement screen; this is for support/cleanup only.
 */
export const PlatformUsersModal: React.FC<PlatformUsersModalProps> = ({ companyId, companyName, onClose }) => {
  useEscapeToClose(onClose);
  const { token } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [formUsername, setFormUsername] = useState('');
  const [formRole, setFormRole] = useState('COLLABORATOR');
  const [formPassword, setFormPassword] = useState('');
  const [formError, setFormError] = useState('');

  const load = async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/platform/companies/${companyId}/users`, { headers: authHeaders });
      const data = await res.json().catch(() => ([]));
      if (!res.ok) throw new Error((data as any).error || 'Chargement impossible.');
      setUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(friendlyError(e, 'Impossible de charger les utilisateurs.'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [companyId]);

  const startEdit = (u: PlatformUser) => {
    setEditingId(u.id);
    setFormUsername(u.username);
    setFormRole(u.role);
    setFormPassword('');
    setFormError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormError('');
  };

  const saveEdit = async (id: number) => {
    setFormError('');
    setBusyId(id);
    try {
      const payload: any = { username: formUsername.trim(), role: formRole };
      if (formPassword) payload.password = formPassword;
      const res = await fetch(`/api/platform/companies/${companyId}/users/${id}`, {
        method: 'PUT', headers: authHeaders, body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible.');
      setUsers(prev => prev.map(u => (u.id === id ? { ...u, username: data.username, role: data.role } : u)));
      setEditingId(null);
    } catch (e) {
      setFormError(friendlyError(e, 'Enregistrement impossible.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (u: PlatformUser) => {
    if (!confirm(`Supprimer l'utilisateur "${u.username}" de "${companyName}" ?`)) return;
    setBusyId(u.id);
    setError('');
    try {
      const res = await fetch(`/api/platform/companies/${companyId}/users/${u.id}`, {
        method: 'DELETE', headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Suppression impossible.');
      setUsers(prev => prev.filter(x => x.id !== u.id));
    } catch (e) {
      setError(friendlyError(e, 'Suppression impossible.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[85vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-[16px] font-bold text-navy">Utilisateurs</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">{companyName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-2">
          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded-md">
              <p className="text-[12.5px] text-red-700 font-medium">{error}</p>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : users.length === 0 ? (
            <p className="text-[13px] text-gray-500 text-center py-8">Aucun utilisateur.</p>
          ) : (
            users.map(u => (
              <div key={u.id} className="border border-gray-200 rounded-lg p-3">
                {editingId === u.id ? (
                  <div className="space-y-2">
                    {formError && <p className="text-[12px] text-red-600 font-medium">{formError}</p>}
                    <input
                      value={formUsername}
                      onChange={e => setFormUsername(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-[13px]"
                      placeholder="Nom d'utilisateur"
                    />
                    <select
                      value={formRole}
                      onChange={e => setFormRole(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-[13px] bg-white"
                    >
                      {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                    <input
                      type="password"
                      value={formPassword}
                      onChange={e => setFormPassword(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-[13px]"
                      placeholder="Nouveau mot de passe (facultatif)"
                    />
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={cancelEdit}
                        className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Annuler
                      </button>
                      <button
                        onClick={() => saveEdit(u.id)}
                        disabled={busyId === u.id || !formUsername.trim()}
                        className="px-2.5 py-1.5 bg-navy text-white rounded-lg text-[12px] font-semibold hover:bg-navy-hover disabled:opacity-50 flex items-center gap-1"
                      >
                        {busyId === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Enregistrer
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[13.5px] font-semibold text-gray-800">{u.username}</div>
                      <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${roleMeta(u.role).badgeClass}`}>
                        {roleMeta(u.role).label}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => startEdit(u)}
                        title="Modifier"
                        className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-navy"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        disabled={busyId === u.id}
                        title="Supprimer"
                        className="p-1.5 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        {busyId === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
