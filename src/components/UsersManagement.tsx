import React, { useState, useEffect } from 'react';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { PresenceSettingsCard } from './PresenceSettingsCard';
import { useAuth, User } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { ROLES, roleMeta, type Role } from '../constants/roles';
import { usePresence } from '../context/PresenceContext';
import { PresenceBadge } from './PresenceBadge';
import { Plus, Pencil, Trash2, Shield, X, Loader2, Info, ChevronDown, ChevronRight } from 'lucide-react';

const PERMISSIONS_GROUPED = [
  {
    group: 'Time Tracking',
    permissions: [
      { id: 'VIEW', label: 'Voir (VIEW)', desc: 'Peut consulter le suivi du temps' },
      { id: 'EDIT', label: 'Modifier (EDIT)', desc: 'Peut modifier le suivi du temps' },
      { id: 'DELETE', label: 'Supprimer (DELETE)', desc: 'Peut supprimer des données du suivi du temps' },
      { id: 'MANAGE_SERVICES', label: 'Gérer missions & types de tâches', desc: 'Peut ajouter, modifier et supprimer les missions et leurs types de tâches' },
      { id: 'ASSIGN_TASKS', label: 'Assigner des tâches', desc: 'Peut assigner une mission et un type de tâche à un collaborateur' },
    ]
  },
  {
    group: 'Clients',
    permissions: [
      { id: 'VIEW_CLIENTS', label: 'Voir clients', desc: 'Peut consulter la base clients' },
      { id: 'CREATE_CLIENTS', label: 'Créer clients', desc: 'Peut ajouter de nouveaux clients' },
      { id: 'EDIT_CLIENTS', label: 'Modifier clients', desc: 'Peut modifier les clients existants' },
      { id: 'DELETE_CLIENTS', label: 'Supprimer clients', desc: 'Peut archiver/supprimer des clients' },
      { id: 'MANAGE_CLIENT_FIELDS', label: 'Gérer champs', desc: 'Peut gérer les champs personnalisés' },
    ]
  },
  {
    group: 'Cash (Facturation)',
    permissions: [
      { id: 'VIEW_CASH', label: 'Voir Cash', desc: 'Peut consulter les factures et documents' },
      { id: 'MANAGE_CASH', label: 'Gérer Cash', desc: 'Peut créer, modifier et supprimer des documents' },
    ]
  },
  {
    group: 'Ressources Humaines (HR)',
    permissions: [
      { id: 'VIEW_HR', label: 'Voir RH', desc: 'Peut accéder au module RH' },
      { id: 'CREATE_LEAVE_REQUEST', label: 'Demander congé', desc: 'Peut soumettre une demande de congé' },
      { id: 'MANAGE_LEAVE_REQUESTS', label: 'Gérer congés', desc: 'Peut approuver/refuser les congés' },
      { id: 'CREATE_ABSENCE_AUTHORIZATION', label: 'Demander autorisation', desc: 'Peut soumettre une demande d\'absence' },
      { id: 'MANAGE_ABSENCE_AUTHORIZATIONS', label: 'Gérer autorisations', desc: 'Peut approuver/refuser les autorisations' },
      { id: 'MANAGE_LOANS_ADVANCES', label: 'Gérer prêts & avances', desc: 'Peut accorder et suivre les prêts et avances des collaborateurs' },
    ]
  },
  {
    group: 'Ressources Métier',
    permissions: [
      { id: 'VIEW_RESOURCES', label: 'Voir les ressources', desc: 'Peut consulter documents, procédures, liens utiles et échéances' },
      { id: 'MANAGE_RESOURCES', label: 'Gérer le référentiel', desc: 'Peut créer, modifier et supprimer les modèles, liens et échéances du cabinet' },
    ]
  },
  {
    group: 'Administration',
    permissions: [
      { id: 'MANAGE_USERS', label: 'Gérer les utilisateurs', desc: 'Accès administrateur complet' },
      { id: 'MANAGE_PRESENCE_SETTINGS', label: 'Gérer le statut de présence', desc: 'Peut régler le délai avant le passage en absent' },
    ]
  }
];

export const UsersManagement: React.FC = () => {
  const { token, hasPermission, logout } = useAuth();
  const { presenceOf } = usePresence();
  const { t } = useLanguage();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  useEscapeToClose(() => setIsModalOpen(false), isModalOpen);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  
  const toggleGroup = (groupName: string) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
  };
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<Role>('COLLABORATOR');
  const [formPermissions, setFormPermissions] = useState<string[]>([]);
  const [formSalaireBrut, setFormSalaireBrut] = useState<number | ''>('');
  const [formRegimeHoraire, setFormRegimeHoraire] = useState<number | ''>(48);
  const [formCnss, setFormCnss] = useState<number | ''>('');
  const [formTfp, setFormTfp] = useState<number | ''>('');
  const [formFoprolos, setFormFoprolos] = useState<number | ''>('');
  const [formAccidentTravail, setFormAccidentTravail] = useState<number | ''>('');
  const [formPrimesFraisNonCotisables, setFormPrimesFraisNonCotisables] = useState<number | ''>('');
  const [formSoldeConge, setFormSoldeConge] = useState<number | ''>(20);
  /** Days already consumed — read-only context so the admin sets the allowance knowingly. */
  const [formCongesUtilises, setFormCongesUtilises] = useState<number>(0);
  const [globalSettings, setGlobalSettings] = useState<any>(null);
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchUsers();
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setGlobalSettings(data.employerCharges);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenCreate = () => {
    setEditingUserId(null);
    setFormUsername('');
    setFormPassword('');
    setFormRole('COLLABORATOR');
    setFormPermissions([]);
    setFormSalaireBrut('');
    setFormRegimeHoraire(48);
    setFormCnss(globalSettings?.cnss ?? 16.57);
    setFormTfp(globalSettings?.tfp ?? 2.0);
    setFormFoprolos(globalSettings?.foprolos ?? 1.0);
    setFormAccidentTravail(globalSettings?.accidentTravail ?? 0.5);
    setFormPrimesFraisNonCotisables('');
    setFormSoldeConge(20);
    setFormCongesUtilises(0);
    setFormError('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUserId(user.id);
    setFormUsername(user.username);
    setFormPassword(''); // Password is not returned, leave blank to not change
    setFormRole(user.role);
    setFormPermissions(user.permissions);
    setFormSalaireBrut(user.salaireBrut || '');
    setFormRegimeHoraire(user.regimeHoraire || 48);
    setFormCnss(typeof user.cnss === 'number' ? user.cnss : (globalSettings?.cnss ?? 16.57));
    setFormTfp(typeof user.tfp === 'number' ? user.tfp : (globalSettings?.tfp ?? 2.0));
    setFormFoprolos(typeof user.foprolos === 'number' ? user.foprolos : (globalSettings?.foprolos ?? 1.0));
    setFormAccidentTravail(typeof user.accidentTravail === 'number' ? user.accidentTravail : (globalSettings?.accidentTravail ?? 0.5));
    setFormPrimesFraisNonCotisables(typeof user.primesFraisNonCotisables === 'number' ? user.primesFraisNonCotisables : '');
    setFormSoldeConge(typeof user.soldeConge === 'number' ? user.soldeConge : 20);
    setFormCongesUtilises(typeof user.congesUtilises === 'number' ? user.congesUtilises : 0);
    setFormError('');
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cet utilisateur ?')) return;
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setUsers(users.filter(u => u.id !== id));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const togglePermission = (permId: string) => {
    setFormPermissions(prev => 
      prev.includes(permId) 
        ? prev.filter(p => p !== permId)
        : [...prev, permId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setIsSaving(true);

    if (!editingUserId && !formPassword) {
      setFormError('Le mot de passe est requis pour un nouvel utilisateur.');
      setIsSaving(false);
      return;
    }

    try {
      const payload: any = {
        role: formRole,
        permissions: formPermissions,
        salaireBrut: formSalaireBrut === '' ? null : Number(formSalaireBrut),
        regimeHoraire: formRegimeHoraire === '' ? null : Number(formRegimeHoraire),
        cnss: formCnss === '' ? null : Number(formCnss),
        tfp: formTfp === '' ? null : Number(formTfp),
        foprolos: formFoprolos === '' ? null : Number(formFoprolos),
        accidentTravail: formAccidentTravail === '' ? null : Number(formAccidentTravail),
        primesFraisNonCotisables: formPrimesFraisNonCotisables === '' ? null : Number(formPrimesFraisNonCotisables),
        soldeConge: formSoldeConge === '' ? 0 : Number(formSoldeConge)
      };
      if (formPassword) payload.password = formPassword;
      if (!editingUserId) payload.username = formUsername;

      const url = editingUserId ? `/api/users/${editingUserId}` : '/api/users';
      const method = editingUserId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok) {
        // The API always returns permissions as an array, but guard anyway so a
        // shape mismatch can never crash the table behind the modal.
        const saved = { ...data, permissions: Array.isArray(data.permissions) ? data.permissions : [] };
        if (editingUserId) {
          setUsers(users.map(u => u.id === editingUserId ? saved : u));
        } else {
          setUsers([...users, saved]);
        }
        setIsModalOpen(false);
      } else if (res.status === 401) {
        // Expired or stale session: sending the user back to the login screen is
        // the only useful action, an inline "Unauthorized" is a dead end.
        logout('Votre session a expiré. Veuillez vous reconnecter.');
      } else {
        setFormError(data.error || 'Une erreur est survenue');
      }
    } catch (e) {
      setFormError('Erreur de connexion');
    } finally {
      setIsSaving(false);
    }
  };

  if (!hasPermission('MANAGE_USERS')) {
    return (
      <div className="p-8 text-center text-gray-500">
        Vous n'avez pas l'autorisation d'accéder à cette page.
      </div>
    );
  }

  const simSalaire = typeof formSalaireBrut === 'number' ? formSalaireBrut : 0;
  const simRegime = typeof formRegimeHoraire === 'number' ? formRegimeHoraire : 0;
  const totalChargesPct = (typeof formCnss === 'number' ? formCnss : 0) + 
                          (typeof formTfp === 'number' ? formTfp : 0) + 
                          (typeof formFoprolos === 'number' ? formFoprolos : 0) + 
                          (typeof formAccidentTravail === 'number' ? formAccidentTravail : 0);
  const montantsCharges = simSalaire * (totalChargesPct / 100);
  const simPrimes = typeof formPrimesFraisNonCotisables === 'number' ? formPrimesFraisNonCotisables : 0;
  const coutTotalEmployeur = simSalaire + montantsCharges + simPrimes;
  const heuresMensuelles = simRegime * 4.33;
  const coutHoraireEmployeur = heuresMensuelles > 0 ? coutTotalEmployeur / heuresMensuelles : 0;

  return (
    <div className="flex-1 flex flex-col space-y-4 sm:space-y-6 max-w-[1000px] w-full mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-gray-800 tracking-tight">
            {t('users.title')}
          </h1>
          <p className="text-[12px] text-gray-500 mt-1">
            {t('users.subtitle')}
          </p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="bg-navy hover:bg-navy-hover text-white px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('users.add')}</span>
        </button>
      </div>

      <PresenceSettingsCard />

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F9FAFB] border-b border-gray-200">
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Utilisateur
                </th>
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Rôle
                </th>
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Permissions
                </th>
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors group">
                  <td className="px-5 py-3">
                    <div className="font-semibold text-gray-900 text-[13px]">{user.username}</div>
                  </td>
                  <td className="px-5 py-3">
                    {(() => { const p = presenceOf(user.id);
                      return <PresenceBadge state={p.state} idleMs={p.idleMs} />; })()}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${roleMeta(user.role).badgeClass}`}>
                      {roleMeta(user.role).hasShield && <Shield className="w-3 h-3" />}
                      {roleMeta(user.role).label}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {user.role === 'ADMIN' ? (
                        <span className="text-[11px] text-gray-500 italic">Accès complet</span>
                      ) : user.permissions.length > 0 ? (
                        user.permissions.map(p => (
                          <span key={p} className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px] font-medium border border-gray-200">
                            {p}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-gray-400 italic">Aucune</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleOpenEdit(user)}
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(user.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-gray-500 text-[13px]">
                    Aucun utilisateur trouvé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h2 className="text-[16px] font-bold text-gray-900">
                {editingUserId ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}
              </h2>
              <button type="button" onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 overflow-y-auto flex-1">
              {formError && (
                <div className="mb-4 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
                  {formError}
                </div>
              )}
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Nom d'utilisateur</label>
                  <input
                    type="text"
                    required
                    disabled={!!editingUserId}
                    value={formUsername}
                    onChange={e => setFormUsername(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500"
                    placeholder="Ex: jean.dupont"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                    Mot de passe {editingUserId && <span className="text-gray-400 font-normal">(laisser vide pour ne pas changer)</span>}
                  </label>
                  <input
                    type="password"
                    required={!editingUserId}
                    value={formPassword}
                    onChange={e => setFormPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    placeholder="••••••••"
                  />
                </div>

                <div className="pt-4 border-t border-gray-200 mt-4">
                  <h3 className="text-[13px] font-bold text-gray-800 mb-4">Coût employeur</h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">Salaire brut mensuel (DT)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formSalaireBrut}
                        onChange={e => setFormSalaireBrut(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        placeholder="Ex: 2000.00"
                      />
                    </div>

                    <div className="flex justify-between items-center text-[13px] text-gray-700 max-w-sm">
                      <span>Charges patronales ({totalChargesPct.toFixed(2)}%)</span>
                      <span className="font-medium text-gray-900">+{montantsCharges.toFixed(2)} DT</span>
                    </div>

                    <div className="flex justify-between items-center text-[13px] text-gray-700 max-w-sm">
                      <span>Sous-total</span>
                      <span className="font-medium text-gray-900">{(simSalaire + montantsCharges).toFixed(2)} DT</span>
                    </div>

                    <div>
                      <label className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-700 mb-1">
                        Primes & frais non cotisables (DT)
                        <div className="group relative flex items-center">
                          <Info className="w-3.5 h-3.5 text-gray-400 cursor-help" />
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-gray-900 text-white text-[11.5px] leading-relaxed rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 text-center pointer-events-none">
                            Saisissez ici les frais professionnels et indemnités exonérés de charges patronales (ex: remboursement de frais de déplacement sur justificatifs). Ces montants s'ajoutent directement au coût total sans appliquer les charges patronales.
                          </div>
                        </div>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formPrimesFraisNonCotisables}
                        onChange={e => setFormPrimesFraisNonCotisables(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        placeholder="Ex: 100.00"
                      />
                    </div>

                    <div className="pt-4 border-t border-gray-200 max-w-sm">
                      <div className="flex justify-between items-center text-[14px] font-bold text-gray-900">
                        <span>COÛT TOTAL EMPLOYEUR</span>
                        <span>{coutTotalEmployeur.toFixed(2)} DT</span>
                      </div>
                    </div>
                  </div>

                  <h3 className="text-[13px] font-bold text-gray-800 mt-8 mb-4">Configuration des charges & Heures</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">Régime horaire (Heures)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={formRegimeHoraire}
                        onChange={e => setFormRegimeHoraire(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        placeholder="Ex: 48"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">CNSS patronale (%)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formCnss}
                        onChange={e => setFormCnss(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">TFP (%)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formTfp}
                        onChange={e => setFormTfp(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">FOPROLOS (%)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formFoprolos}
                        onChange={e => setFormFoprolos(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">Accident du travail (%)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formAccidentTravail}
                        onChange={e => setFormAccidentTravail(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                      />
                    </div>
                  </div>

                  <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-1.5 max-w-sm">
                    <div className="flex justify-between text-[12px]">
                      <span className="text-gray-600">Heures mensuelles:</span>
                      <span className="font-semibold text-gray-800">{heuresMensuelles.toFixed(2)} h</span>
                    </div>
                    <div className="flex justify-between text-[12px]">
                      <span className="text-gray-600">Coût horaire employeur:</span>
                      <span className="font-bold text-blue-600">{coutHoraireEmployeur.toFixed(3)} DT/h</span>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-200 mt-4">
                  <h3 className="text-[13px] font-bold text-gray-800 mb-4">Congés</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                        Solde de congé annuel (jours)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={formSoldeConge}
                        onChange={e => setFormSoldeConge(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        placeholder="Ex: 20"
                      />
                    </div>

                    {editingUserId && (
                      <div>
                        <label className="block text-[12px] font-semibold text-gray-700 mb-1">Congés déjà pris</label>
                        <div className="px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg text-[13px] text-gray-600">
                          {formCongesUtilises} j
                        </div>
                      </div>
                    )}
                  </div>

                  {editingUserId && (
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 flex justify-between text-[12px] max-w-sm">
                      <span className="text-gray-600">Solde restant:</span>
                      <span
                        className={`font-bold ${
                          (typeof formSoldeConge === 'number' ? formSoldeConge : 0) - formCongesUtilises < 0
                            ? 'text-red-600'
                            : 'text-blue-600'
                        }`}
                      >
                        {(typeof formSoldeConge === 'number' ? formSoldeConge : 0) - formCongesUtilises} j
                      </span>
                    </div>
                  )}
                  <p className="text-[11px] text-gray-500 mt-2">
                    Modifier le solde annuel n'affecte pas les congés déjà pris.
                  </p>
                </div>

                <div className="pt-4 border-t border-gray-200 mt-4">
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Rôle</label>
                  <select
                    value={formRole}
                    onChange={e => setFormRole(e.target.value as Role)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy"
                  >
                    {ROLES.map(r => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                </div>

                {formRole !== 'ADMIN' && (
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-2 mt-2">Permissions</label>
                    <div className="space-y-4 border border-gray-200 rounded-lg p-3 bg-gray-50 max-h-[300px] overflow-y-auto">
                      {PERMISSIONS_GROUPED.map(group => {
                        const isCollapsed = collapsedGroups[group.group];
                        const groupSelectedCount = group.permissions.filter(p => formPermissions.includes(p.id)).length;
                        return (
                        <div key={group.group} className="space-y-2">
                          <div 
                            className="flex items-center justify-between border-b border-gray-200 pb-1 mb-2 cursor-pointer hover:bg-gray-100 p-1 -mx-1 rounded transition-colors"
                            onClick={() => toggleGroup(group.group)}
                          >
                            <div className="flex items-center gap-1.5">
                              {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                              <h4 className="text-[11px] font-bold text-gray-800 uppercase tracking-wide mb-0 select-none">
                                {group.group}
                              </h4>
                            </div>
                            <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                              {groupSelectedCount} / {group.permissions.length}
                            </span>
                          </div>
                          {!isCollapsed && group.permissions.map(perm => (
                            <label key={perm.id} className="flex items-start gap-2 cursor-pointer ml-1">
                              <input
                                type="checkbox"
                                className="mt-0.5 rounded border-gray-300 text-navy focus:ring-navy"
                                checked={formPermissions.includes(perm.id)}
                                onChange={() => togglePermission(perm.id)}
                              />
                              <div>
                                <div className="text-[13px] font-medium text-gray-900 leading-none mb-1">{perm.label}</div>
                                <div className="text-[11px] text-gray-500 leading-snug">{perm.desc}</div>
                              </div>
                            </label>
                          ))}
                        </div>
                      )})}
                    </div>
                  </div>
                )}

                {/* Actions live at the very bottom of the scrollable form, not in a
                    pinned footer: the user has to pass through the cost and
                    permission settings before they can submit. */}
                <div className="pt-5 mt-2 border-t border-gray-200 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-100 transition-colors bg-white"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover flex items-center gap-2 transition-colors disabled:opacity-60"
                  >
                    {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {editingUserId ? 'Enregistrer' : 'Créer l\'utilisateur'}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
