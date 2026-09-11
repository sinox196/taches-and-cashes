import React, { useState, useEffect } from 'react';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { PresenceSettingsCard } from './PresenceSettingsCard';
import { useAuth, User } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { ROLES, roleMeta, CLIENT_ROLE, type Role } from '../constants/roles';
import { usePresence } from '../context/PresenceContext';
import { PresenceBadge } from './PresenceBadge';
import { Plus, Pencil, Trash2, Shield, X, Loader2, Info, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { ExportButton } from './ExportButton';
import { ClientSearchInput } from './cash/ClientSearchInput';
import { planMeta } from '../constants/plans';

const PERMISSIONS_GROUPED = [
  {
    group: 'Gestion des tâches',
    permissions: [
      { id: 'VIEW', label: 'Voir', desc: 'Peut consulter le suivi du temps' },
      { id: 'EDIT', label: 'Modifier', desc: 'Peut modifier le suivi du temps' },
      { id: 'DELETE', label: 'Supprimer', desc: 'Peut supprimer des données du suivi du temps' },
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
      { id: 'VIEW_CLIENT_FINANCIALS', label: 'Voir totaux financiers', desc: 'Peut voir les colonnes Solde antérieur, Montant de facture, Encaissements et Reste à payer sur la liste des clients, ainsi que la barre "Total Général". Sans cette permission, ces chiffres ne sont pas envoyés au navigateur.' },
      { id: 'ACCESS_CLIENT_PORTAL', label: 'Espace client', desc: "Peut ouvrir l'espace client (portail) d'un dossier depuis sa fiche, sans connaître son mot de passe." },
    ]
  },
  {
    group: 'Facturation & Trésorerie',
    permissions: [
      { id: 'VIEW_CASH', label: 'Voir Cash', desc: "Peut consulter l'onglet Facturation — les factures et documents émis" },
      { id: 'MANAGE_CASH', label: 'Gérer Cash', desc: 'Peut créer, modifier et supprimer des documents' },
      { id: 'VIEW_CASH_TOTALS', label: 'Voir les totaux financiers', desc: 'Peut voir le bandeau "Total Général" (Total HT, Montant de facture) de l\'onglet Facturation. Sans cette permission, ces montants ne sont pas envoyés au navigateur.' },
      { id: 'VIEW_CLIENT_PAYMENTS', label: 'Voir Règlements clients', desc: 'Peut consulter l\'onglet Règlements clients — ce que chaque client a réglé et par quel moyen.' },
      { id: 'VIEW_CASH_JOURNAL', label: 'Voir Brouillard de caisse', desc: 'Peut consulter le brouillard de caisse — tous les mouvements de caisse, entrées et sorties.' },
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
      { id: 'CREATE_LOAN_REQUEST', label: 'Demander prêt/avance', desc: "Peut soumettre une demande de prêt ou d'avance" },
      { id: 'MANAGE_LOANS_ADVANCES', label: 'Gérer prêts & avances', desc: 'Peut approuver, refuser et suivre les demandes de prêts et avances des collaborateurs' },
    ]
  },
  {
    group: 'Outils de travail',
    permissions: [
      { id: 'VIEW_RESOURCES', label: 'Voir les ressources', desc: 'Peut consulter documents, procédures, liens utiles et échéances' },
      { id: 'MANAGE_RESOURCES', label: 'Gérer le référentiel', desc: 'Peut créer, modifier et supprimer les modèles, liens et échéances du cabinet' },
    ]
  },
  {
    group: 'Gestion des paies',
    permissions: [
      { id: 'VIEW_PAYROLL', label: 'Voir les bulletins', desc: 'Peut consulter et imprimer les bulletins de paie' },
      { id: 'MANAGE_PAYROLL', label: 'Générer les bulletins', desc: 'Peut générer, modifier et supprimer les bulletins de paie' },
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
  const { token, user, hasPermission, logout } = useAuth();
  // Un siège unique n'a personne d'autre à ajouter — le pack Freelancer, mais
  // écrit contre le siège plutôt que l'id de l'offre pour couvrir toute
  // future offre à un seul compte de la même façon. Le bouton ne fait
  // qu'anticiper le refus déjà posé par seatLimitError() côté serveur.
  //
  // Résolu fiche d'abord (`user.company.seatLimit`, le nombre réellement
  // accordé), offre ensuite (`planMeta(...).seatLimit`) — même ordre que
  // `seatLimitError()` côté serveur. Une offre dynamique (RH & Paie,
  // Facturation, Complet) porte toujours `seatLimit: 1` au catalogue, qui
  // n'est qu'un repli d'affichage ; s'arrêter à lui masquerait « Nouvel
  // utilisateur »/« Exporter » pour une entreprise ayant réellement acheté
  // plusieurs sièges sur l'une de ces offres.
  const singleSeatPlan = (user?.company?.seatLimit ?? planMeta(user?.company?.plan)?.seatLimit ?? Infinity) <= 1;
  const { presenceOf } = usePresence();
  const { t } = useLanguage();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  useEscapeToClose(() => setIsModalOpen(false), isModalOpen);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  /** « Équipe » (back-office) et « Comptes clients » (portail) sont deux
   *  populations qu'on ne lit jamais ensemble — mélanger les deux dans une
   *  seule liste noierait les quelques comptes clients dans des dizaines de
   *  collaborateurs, et inversement. */
  const [teamTab, setTeamTab] = useState<'staff' | 'clients'>('staff');
  const [userSearch, setUserSearch] = useState('');
  
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
  /** "HH:MM" shift boundaries — drive the pointage check-in/check-out gate. Empty = no shift, no gate. */
  const [formShiftStart, setFormShiftStart] = useState('');
  const [formShiftEnd, setFormShiftEnd] = useState('');
  /** Pause ftour, en minutes — déduite des heures du shift. */
  const [formBreakMinutes, setFormBreakMinutes] = useState<number | ''>('');
  /** Dossier rattaché, pour un compte de rôle CLIENT uniquement. */
  const [formClientId, setFormClientId] = useState<number | null>(null);
  const [formClientName, setFormClientName] = useState('');
  /** Days already consumed — read-only context so the admin sets the allowance knowingly. */
  const [formCongesUtilises, setFormCongesUtilises] = useState<number>(0);
  /** Gestion des paies — dossier administratif/paie, purement déclaratif : aucun de ces champs n'entre dans employerHourlyRate() ni dans aucun calcul de pointage. */
  const [paieCollapsed, setPaieCollapsed] = useState(true);
  const [formMatricule, setFormMatricule] = useState('');
  const [formNumCin, setFormNumCin] = useState('');
  const [formNumCnss, setFormNumCnss] = useState('');
  const [formQualification, setFormQualification] = useState('');
  const [formDepartement, setFormDepartement] = useState('');
  const [formBanque, setFormBanque] = useState('');
  const [formNumeroCompte, setFormNumeroCompte] = useState('');
  const [formSituationFamiliale, setFormSituationFamiliale] = useState('');
  const [formNombreEnfants, setFormNombreEnfants] = useState<number | ''>('');
  const [formCategorie, setFormCategorie] = useState('');
  const [formEchelon, setFormEchelon] = useState('');
  const [formSalHeure, setFormSalHeure] = useState<number | ''>('');
  /** Paramètres de la paie — Tableau des Déductions Fiscales : chaque valeur
   * saisie ici devient une déduction du salaire brut imposable, voir
   * computePayslip() côté serveur. Marié(e) n'a pas de champ ici : il se lit
   * sur « Situation familiale » ci-dessus (Gestion des paies), pour ne pas
   * dupliquer la même information à deux endroits du formulaire. */
  const [paieParamsCollapsed, setPaieParamsCollapsed] = useState(true);
  const [formPaieEnfantsInfirmes, setFormPaieEnfantsInfirmes] = useState<number | ''>('');
  const [formPaieEnfantsEtudiants, setFormPaieEnfantsEtudiants] = useState<number | ''>('');
  const [formPaieParentsACharge, setFormPaieParentsACharge] = useState<number | ''>('');
  const [formPaieAssuranceVie, setFormPaieAssuranceVie] = useState<number | ''>('');
  const [formPaieCEA, setFormPaieCEA] = useState<number | ''>('');
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

  const handleOpenCreate = (defaultRole: Role = 'COLLABORATOR') => {
    setEditingUserId(null);
    setFormUsername('');
    setFormPassword('');
    setFormRole(defaultRole);
    setFormPermissions([]);
    setFormSalaireBrut('');
    setFormRegimeHoraire(48);
    setFormCnss(globalSettings?.cnss ?? 17.07);
    setFormTfp(globalSettings?.tfp ?? 2.0);
    setFormFoprolos(globalSettings?.foprolos ?? 1.0);
    setFormAccidentTravail(globalSettings?.accidentTravail ?? 0.5);
    setFormPrimesFraisNonCotisables('');
    setFormSoldeConge(20);
    setFormCongesUtilises(0);
    setFormShiftStart('');
    setFormShiftEnd('');
    setFormBreakMinutes('');
    setFormClientId(null);
    setFormClientName('');
    setFormMatricule('');
    setFormNumCin('');
    setFormNumCnss('');
    setFormQualification('');
    setFormDepartement('');
    setFormBanque('');
    setFormNumeroCompte('');
    setFormSituationFamiliale('');
    setFormNombreEnfants('');
    setFormCategorie('');
    setFormEchelon('');
    setFormSalHeure('');
    setPaieCollapsed(true);
    setFormPaieEnfantsInfirmes('');
    setFormPaieEnfantsEtudiants('');
    setFormPaieParentsACharge('');
    setFormPaieAssuranceVie('');
    setFormPaieCEA('');
    setPaieParamsCollapsed(true);
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
    setFormCnss(typeof user.cnss === 'number' ? user.cnss : (globalSettings?.cnss ?? 17.07));
    setFormTfp(typeof user.tfp === 'number' ? user.tfp : (globalSettings?.tfp ?? 2.0));
    setFormFoprolos(typeof user.foprolos === 'number' ? user.foprolos : (globalSettings?.foprolos ?? 1.0));
    setFormAccidentTravail(typeof user.accidentTravail === 'number' ? user.accidentTravail : (globalSettings?.accidentTravail ?? 0.5));
    setFormPrimesFraisNonCotisables(typeof user.primesFraisNonCotisables === 'number' ? user.primesFraisNonCotisables : '');
    setFormSoldeConge(typeof user.soldeConge === 'number' ? user.soldeConge : 20);
    setFormCongesUtilises(typeof user.congesUtilises === 'number' ? user.congesUtilises : 0);
    setFormShiftStart(user.shiftStart || '');
    setFormShiftEnd(user.shiftEnd || '');
    setFormBreakMinutes(typeof user.breakMinutes === 'number' ? user.breakMinutes : '');
    setFormClientId(user.clientId ?? null);
    setFormClientName(user.clientName ?? '');
    setFormBreakMinutes(typeof user.breakMinutes === 'number' ? user.breakMinutes : '');
    setFormMatricule(user.matricule ?? '');
    setFormNumCin(user.numCin ?? '');
    setFormNumCnss(user.numCnss ?? '');
    setFormQualification(user.qualification ?? '');
    setFormDepartement(user.departement ?? '');
    setFormBanque(user.banque ?? '');
    setFormNumeroCompte(user.numeroCompte ?? '');
    setFormSituationFamiliale(user.situationFamiliale ?? '');
    setFormNombreEnfants(typeof user.nombreEnfants === 'number' ? user.nombreEnfants : '');
    setFormCategorie(user.categorie ?? '');
    setFormEchelon(user.echelon ?? '');
    setFormSalHeure(typeof user.salHeure === 'number' ? user.salHeure : '');
    setPaieCollapsed(true);
    setFormPaieEnfantsInfirmes(typeof user.paieEnfantsInfirmes === 'number' ? user.paieEnfantsInfirmes : '');
    setFormPaieEnfantsEtudiants(typeof user.paieEnfantsEtudiants === 'number' ? user.paieEnfantsEtudiants : '');
    setFormPaieParentsACharge(typeof user.paieParentsACharge === 'number' ? user.paieParentsACharge : '');
    setFormPaieAssuranceVie(typeof user.paieAssuranceVie === 'number' ? user.paieAssuranceVie : '');
    setFormPaieCEA(typeof user.paieCEA === 'number' ? user.paieCEA : '');
    setPaieParamsCollapsed(true);
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

  /** Tout cocher/décocher pour un groupe entier en un clic. */
  const toggleGroupAll = (groupPermIds: string[], allSelected: boolean) => {
    setFormPermissions(prev => allSelected
      ? prev.filter(p => !groupPermIds.includes(p))
      : Array.from(new Set([...prev, ...groupPermIds])));
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
        soldeConge: formSoldeConge === '' ? 0 : Number(formSoldeConge),
        shiftStart: formShiftStart || null,
        shiftEnd: formShiftEnd || null,
        breakMinutes: formBreakMinutes === '' ? null : Number(formBreakMinutes),
        clientId: formRole === CLIENT_ROLE ? formClientId : null,
        matricule: formMatricule || null,
        numCin: formNumCin || null,
        numCnss: formNumCnss || null,
        qualification: formQualification || null,
        departement: formDepartement || null,
        banque: formBanque || null,
        numeroCompte: formNumeroCompte || null,
        situationFamiliale: formSituationFamiliale || null,
        nombreEnfants: formNombreEnfants === '' ? null : Number(formNombreEnfants),
        categorie: formCategorie || null,
        echelon: formEchelon || null,
        salHeure: formSalHeure === '' ? null : Number(formSalHeure),
        paieEnfantsInfirmes: formPaieEnfantsInfirmes === '' ? null : Number(formPaieEnfantsInfirmes),
        paieEnfantsEtudiants: formPaieEnfantsEtudiants === '' ? null : Number(formPaieEnfantsEtudiants),
        paieParentsACharge: formPaieParentsACharge === '' ? null : Number(formPaieParentsACharge),
        paieAssuranceVie: formPaieAssuranceVie === '' ? null : Number(formPaieAssuranceVie),
        paieCEA: formPaieCEA === '' ? null : Number(formPaieCEA),
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

  /**
   * Durée effective du shift, pause ftour déduite — affichée sous le champ
   * pour que l'admin voie tout de suite ce qu'il vient de configurer. `null`
   * tant que le shift n'est pas complet : sans les deux bornes il n'y a rien
   * à calculer. Un shift qui passe minuit est traité comme allant au
   * lendemain (l'équipe de nuit existe), pas comme une durée négative.
   */
  const heuresTravaillees = (() => {
    if (!formShiftStart || !formShiftEnd) return null;
    const [sh, sm] = formShiftStart.split(':').map(Number);
    const [eh, em] = formShiftEnd.split(':').map(Number);
    if ([sh, sm, eh, em].some(n => !Number.isFinite(n))) return null;
    let minutes = (eh * 60 + em) - (sh * 60 + sm);
    if (minutes <= 0) minutes += 24 * 60;
    minutes -= typeof formBreakMinutes === 'number' ? formBreakMinutes : 0;
    if (minutes <= 0) return '0 h';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
  })();

  const clientAccountsCount = users.filter(u => u.role === CLIENT_ROLE).length;
  const visibleUsers = users
    .filter(u => (teamTab === 'clients' ? u.role === CLIENT_ROLE : u.role !== CLIENT_ROLE))
    .filter(u => !userSearch.trim() || u.username.toLowerCase().includes(userSearch.trim().toLowerCase()));

  return (
    <div className="flex-1 flex flex-col space-y-4 sm:space-y-6 max-w-[1000px] w-full mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-gray-800 tracking-tight">
            {t('users.title')}
          </h1>
          <p className="text-[12px] text-gray-500 mt-1">
            {t('users.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
        {!singleSeatPlan && (
        <ExportButton
          fileName={teamTab === 'clients' ? 'comptes-clients' : 'utilisateurs'}
          rows={visibleUsers}
          columns={teamTab === 'clients' ? [
            { header: 'Utilisateur', value: (u: any) => u.username },
          ] : [
            { header: 'Utilisateur', value: (u: any) => u.username },
            { header: 'Rôle', value: (u: any) => roleMeta(u.role).label },
            { header: 'Permissions', value: (u: any) => (u.role === 'ADMIN' ? 'Accès complet' : (u.permissions || []).join(' | ')) },
            { header: 'Solde congés (jours)', value: (u: any) => u.soldeConge ?? '' },
          ]}
        />
        )}
        {!singleSeatPlan && (
        <button
          onClick={() => handleOpenCreate(teamTab === 'clients' ? CLIENT_ROLE : 'COLLABORATOR')}
          className="bg-navy hover:bg-navy-hover text-white px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center justify-center gap-2 transition-colors shrink-0 whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>{teamTab === 'clients' ? 'Nouveau compte client' : t('users.add')}</span>
        </button>
        )}
        </div>
      </div>

      <PresenceSettingsCard />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 border-b border-gray-200 sm:border-b-0">
          {([
            { id: 'staff' as const, label: 'Équipe' },
            { id: 'clients' as const, label: 'Comptes clients', count: clientAccountsCount },
          ]).map(tb => (
            <button
              key={tb.id}
              onClick={() => setTeamTab(tb.id)}
              className={`px-3.5 py-2 text-[13px] font-medium flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
                teamTab === tb.id ? 'border-navy text-navy' : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {tb.label}
              {'count' in tb && !!tb.count && (
                <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                  teamTab === tb.id ? 'bg-navy text-white' : 'bg-blue-50 text-blue-600'
                }`}>
                  {tb.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
            placeholder="Rechercher un nom d'utilisateur…"
            className="w-full pl-8 pr-3 py-2 text-[12.5px] border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400"
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[560px]">
            <thead>
              <tr className="bg-[#F9FAFB] border-b border-gray-200">
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Utilisateur
                </th>
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Statut
                </th>
                {teamTab !== 'clients' && (
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    Rôle
                  </th>
                )}
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map(user => (
                <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors group">
                  <td className="px-5 py-3">
                    <div className="font-semibold text-gray-900 text-[13px]">{user.username}</div>
                  </td>
                  <td className="px-5 py-3">
                    {(() => { const p = presenceOf(user.id);
                      return <PresenceBadge state={p.state} idleMs={p.idleMs} onLeaveUntil={p.onLeaveUntil} />; })()}
                  </td>
                  {teamTab !== 'clients' && (
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${roleMeta(user.role).badgeClass}`}>
                        {roleMeta(user.role).hasShield && <Shield className="w-3 h-3" />}
                        {roleMeta(user.role).label}
                      </span>
                    </td>
                  )}
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
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
              {visibleUsers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-gray-500 text-[13px]">
                    {userSearch.trim()
                      ? 'Aucun utilisateur ne correspond à cette recherche.'
                      : teamTab === 'clients' ? 'Aucun compte client pour le moment.' : 'Aucun utilisateur trouvé.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
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
                {(() => {
                  const usernameField = (
                    <div key="username">
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
                  );

                  const passwordField = (
                    <div key="password">
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                        Mot de passe {editingUserId && <span className="text-gray-400 font-normal">(laisser vide pour ne pas changer)</span>}
                      </label>
                      <input
                        type="password"
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore
                        data-form-type="other"
                        required={!editingUserId}
                        value={formPassword}
                        onChange={e => setFormPassword(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        placeholder="••••••••"
                      />
                    </div>
                  );

                  const roleField = (
                    <div key="role" className="pt-4 border-t border-gray-200 mt-4">
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
                  );

                  // Un compte client n'a de sens que rattaché à un dossier :
                  // sans lui le portail n'a rien à montrer et le dit. Le
                  // choix passe par la recherche serveur, jamais par une
                  // liste complète — il y a des centaines de clients.
                  const dossierField = (
                    <div key="dossier">
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">Dossier client rattaché</label>
                      {formClientId && !formClientName ? (
                        <div className="flex items-center justify-between gap-2 px-3 py-2 border border-gray-300 rounded-lg text-[13px] bg-gray-50">
                          <span className="text-gray-700">Dossier n° {formClientId}</span>
                          <button
                            type="button"
                            onClick={() => { setFormClientId(null); setFormClientName(''); }}
                            className="text-[12px] text-blue-600 hover:underline shrink-0"
                          >
                            Changer
                          </button>
                        </div>
                      ) : (
                        <ClientSearchInput
                          value={formClientName}
                          onChange={(name, id) => {
                            setFormClientName(name);
                            setFormClientId(id ?? null);
                            // Le compte portail se connecte sous le nom du
                            // client, pas un identifiant que l'admin invente —
                            // uniquement à la création : une fois le compte
                            // créé, le nom d'utilisateur ne se change plus
                            // (champ désactivé plus haut).
                            if (!editingUserId) setFormUsername(name);
                          }}
                          placeholder="Rechercher un client…"
                        />
                      )}
                      <p className="text-[11px] text-gray-500 mt-1">
                        Ce compte ne verra que ce dossier. Plusieurs comptes peuvent viser le même client (gérant, comptable…).
                      </p>
                    </div>
                  );

                  // Pour un compte client, choisir le dossier remplit le nom
                  // d'utilisateur juste en dessous (voir ClientSearchInput
                  // ci-dessus) — le champ qui en alimente un autre doit donc
                  // précéder celui qu'il remplit, pas le suivre. Le Rôle,
                  // déjà posé sur Client par « Nouveau compte client », passe
                  // en dernier : rien au-dessus de lui n'a plus besoin d'être
                  // révélé par un choix qui est déjà fait.
                  return formRole === CLIENT_ROLE
                    ? <>{dossierField}{usernameField}{passwordField}{roleField}</>
                    : <>{usernameField}{passwordField}{roleField}</>;
                })()}

                {/* Salaire, shift et congés n'ont aucun sens pour un client :
                    il n'est pas employé du cabinet. */}
                {formRole !== CLIENT_ROLE && (
                <>
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

                  <h3 className="text-[13px] font-bold text-gray-800 mt-8 mb-4">Shift de présence (pointage)</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">Heure d'arrivée</label>
                      <input
                        type="time"
                        value={formShiftStart}
                        onChange={e => setFormShiftStart(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">Heure de départ</label>
                      <input
                        type="time"
                        value={formShiftEnd}
                        onChange={e => setFormShiftEnd(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">Pause ftour (minutes)</label>
                      <input
                        type="number"
                        min="0"
                        step="5"
                        value={formBreakMinutes}
                        onChange={e => setFormBreakMinutes(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        placeholder="Ex: 60"
                      />
                      {heuresTravaillees !== null && (
                        <p className="text-[11px] text-gray-400 mt-1">
                          Temps de travail effectif : {heuresTravaillees}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    Laissez vide pour ne pas assujettir ce collaborateur au pointage. Une tolérance de 15 minutes s'applique à l'arrivée comme au départ ; la pause ftour est déduite du temps de travail.
                  </p>

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

                {/* Dossier administratif de paie — purement déclaratif, ne
                    nourrit ni employerHourlyRate() ni aucun calcul de
                    pointage. Repliée par défaut : douze champs de plus
                    grossiraient le formulaire pour tout le monde alors que
                    seule la paie en a besoin au quotidien. */}
                <div className="pt-4 border-t border-gray-200 mt-4">
                  <div
                    className="flex items-center gap-1.5 cursor-pointer select-none"
                    onClick={() => setPaieCollapsed(prev => !prev)}
                  >
                    {paieCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                    <h3 className="text-[13px] font-bold text-gray-800">Gestion des paies</h3>
                  </div>
                  {!paieCollapsed && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                      <div>
                        <label className="block text-[12px] font-semibold text-gray-700 mb-1">Matricule</label>
                        <input
                          type="text"
                          value={formMatricule}
                          onChange={e => setFormMatricule(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-semibold text-gray-700 mb-1">N° CIN</label>
                        <input
                          type="text"
                          value={formNumCin}
                          onChange={e => setFormNumCin(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-semibold text-gray-700 mb-1">N° CNSS</label>
                        <input
                          type="text"
                          value={formNumCnss}
                          onChange={e => setFormNumCnss(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-semibold text-gray-700 mb-1">Qualification</label>
                        <input
                          type="text"
                          value={formQualification}
                          onChange={e => setFormQualification(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-semibold text-gray-700 mb-1">Département</label>
                        <input
                          type="text"
                          value={formDepartement}
                          onChange={e => setFormDepartement(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-semibold text-gray-700 mb-1">Banque / Poste</label>
                        <input
                          type="text"
                          value={formBanque}
                          onChange={e => setFormBanque(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-semibold text-gray-700 mb-1">Numéro de compte</label>
                        <input
                          type="text"
                          value={formNumeroCompte}
                          onChange={e => setFormNumeroCompte(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-semibold text-gray-700 mb-1">Situation familiale</label>
                        <input
                          type="text"
                          value={formSituationFamiliale}
                          onChange={e => setFormSituationFamiliale(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                          placeholder="Ex: Marié(e)"
                        />
                        <p className="text-[10.5px] text-gray-500 mt-1">Sert aussi à la déduction « Marié(e) » (300 DT/an) dans « Paramètres de la paie » ci-dessous, dès qu'elle contient « Marié(e) ».</p>
                      </div>
                      <div>
                        <label className="block text-[12px] font-semibold text-gray-700 mb-1">Catégorie</label>
                        <input
                          type="text"
                          value={formCategorie}
                          onChange={e => setFormCategorie(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-semibold text-gray-700 mb-1">Échelon</label>
                        <input
                          type="text"
                          value={formEchelon}
                          onChange={e => setFormEchelon(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-semibold text-gray-700 mb-1">Salaire / heure (DT)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={formSalHeure}
                          onChange={e => setFormSalHeure(e.target.value === '' ? '' : parseFloat(e.target.value))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Tableau des Déductions Fiscales : ce qu'on coche/saisit ici
                    devient une déduction du salaire brut imposable dans
                    computePayslip() côté serveur — jamais un calcul côté
                    client. Repliée par défaut, même raison que Gestion des
                    paies juste au-dessus : six champs de plus grossiraient
                    le formulaire pour tout le monde. */}
                <div className="pt-4 border-t border-gray-200 mt-4">
                  <div
                    className="flex items-center gap-1.5 cursor-pointer select-none"
                    onClick={() => setPaieParamsCollapsed(prev => !prev)}
                  >
                    {paieParamsCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                    <h3 className="text-[13px] font-bold text-gray-800">Paramètres de la paie</h3>
                  </div>
                  {!paieParamsCollapsed && (
                    <div className="mt-4 space-y-4">
                      <p className="text-[11px] text-gray-500">
                        Marié(e) (déduction 300 DT/an) se déduit de « Situation familiale », dans « Gestion des paies » ci-dessus — pas de case à part ici, pour ne pas saisir la même information deux fois.
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                            Nombre d'enfants à charge
                          </label>
                          <input
                            type="number" min="0" max="4" step="1"
                            value={formNombreEnfants}
                            onChange={e => setFormNombreEnfants(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                          />
                          <p className="text-[10.5px] text-gray-500 mt-1">100/200/300/400 DT/an selon le nombre (1 à 4), plafonné à 4.</p>
                        </div>
                        <div>
                          <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                            Enfants infirmes (handicapés)
                          </label>
                          <input
                            type="number" min="0" step="1"
                            value={formPaieEnfantsInfirmes}
                            onChange={e => setFormPaieEnfantsInfirmes(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                          />
                          <p className="text-[10.5px] text-gray-500 mt-1">2 000 DT/an par enfant, sans limite de nombre.</p>
                        </div>
                        <div>
                          <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                            Enfants étudiants non boursiers (&lt; 25 ans)
                          </label>
                          <input
                            type="number" min="0" max="4" step="1"
                            value={formPaieEnfantsEtudiants}
                            onChange={e => setFormPaieEnfantsEtudiants(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                          />
                          <p className="text-[10.5px] text-gray-500 mt-1">1 000 DT/an par enfant, plafonné à 4.</p>
                        </div>
                        <div>
                          <label className="block text-[12px] font-semibold text-gray-700 mb-1">Parents à charge</label>
                          <select
                            value={formPaieParentsACharge}
                            onChange={e => setFormPaieParentsACharge(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy"
                          >
                            <option value="">Aucun</option>
                            <option value="1">1</option>
                            <option value="2">2</option>
                          </select>
                          <p className="text-[10.5px] text-gray-500 mt-1">5 % du revenu imposable par parent, plafonné à 450 DT/an chacun.</p>
                        </div>
                        <div>
                          <label className="block text-[12px] font-semibold text-gray-700 mb-1">Assurance vie (DT/an)</label>
                          <input
                            type="number" min="0" step="0.001"
                            value={formPaieAssuranceVie}
                            onChange={e => setFormPaieAssuranceVie(e.target.value === '' ? '' : parseFloat(e.target.value))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                          />
                          <p className="text-[10.5px] text-gray-500 mt-1">Plafonné à 100 000 DT/an.</p>
                        </div>
                        <div>
                          <label className="block text-[12px] font-semibold text-gray-700 mb-1">Compte épargne en actions (CEA) (DT/an)</label>
                          <input
                            type="number" min="0" step="0.001"
                            value={formPaieCEA}
                            onChange={e => setFormPaieCEA(e.target.value === '' ? '' : parseFloat(e.target.value))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                          />
                          <p className="text-[10.5px] text-gray-500 mt-1">Plafonné à 100 000 DT/an.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                </>
                )}

                {formRole !== 'ADMIN' && formRole !== CLIENT_ROLE && (
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-2 mt-2">Permissions</label>
                    <div className="space-y-4 border border-gray-200 rounded-lg p-3 bg-gray-50 max-h-[300px] overflow-y-auto">
                      {PERMISSIONS_GROUPED.map(group => {
                        const isCollapsed = collapsedGroups[group.group];
                        const groupPermIds = group.permissions.map(p => p.id);
                        const groupSelectedCount = groupPermIds.filter(id => formPermissions.includes(id)).length;
                        const allSelected = groupSelectedCount === group.permissions.length;
                        return (
                        <div key={group.group} className="space-y-2">
                          <div
                            className="flex items-center justify-between border-b border-gray-200 pb-1 mb-2 hover:bg-gray-100 p-1 -mx-1 rounded transition-colors"
                          >
                            <div className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                title="Tout sélectionner pour ce groupe"
                                className="rounded border-gray-300 text-navy focus:ring-navy"
                                checked={allSelected}
                                ref={el => { if (el) el.indeterminate = groupSelectedCount > 0 && !allSelected; }}
                                onChange={() => toggleGroupAll(groupPermIds, allSelected)}
                                onClick={e => e.stopPropagation()}
                              />
                              <div
                                className="flex items-center gap-1.5 cursor-pointer"
                                onClick={() => toggleGroup(group.group)}
                              >
                                {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                                <h4 className="text-[11px] font-bold text-gray-800 uppercase tracking-wide mb-0 select-none">
                                  {group.group}
                                </h4>
                              </div>
                            </div>
                            <span
                              className="text-[10px] font-bold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded cursor-pointer"
                              onClick={() => toggleGroup(group.group)}
                            >
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
