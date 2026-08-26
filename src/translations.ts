export type Language = 'fr' | 'en';

type Translations = Record<Language, Record<string, string>>;

export const translations: Translations = {
  fr: {
    // Nav
    'nav.dashboard': 'Tableau de bord',
    'nav.users': 'Équipe',
    'nav.clients': 'Clients',
    'nav.timeTracking': 'Tâches',
    'nav.invoicing': 'Facturation',
    'nav.hr': 'RH',
    'nav.logout': 'Déconnexion',

    // Common
    'common.cancel': 'Annuler',
    'common.save': 'Enregistrer',
    'common.create': 'Créer',
    'common.edit': 'Modifier',
    'common.delete': 'Supprimer',
    'common.actions': 'Actions',
    'common.status': 'Statut',
    'common.search': 'Rechercher...',
    
    // Login
    'login.title': 'Connexion',
    'login.subtitle': 'Accédez à votre espace',
    'login.username': "Nom d'utilisateur",
    'login.password': 'Mot de passe',
    'login.button': 'Se connecter',
    'login.error': 'Identifiants invalides',

    // Users Management
    'users.title': 'Gestion des utilisateurs',
    'users.subtitle': 'Gérez les accès et les rôles de votre équipe.',
    'users.add': 'Nouvel utilisateur',
    'users.edit': "Modifier l'utilisateur",
    'users.role': 'Rôle',
    'users.permissions': 'Permissions',

    // HR Management
    'hr.title': 'Ressources Humaines',
    'hr.subtitle': 'Gestion des congés et des autorisations d\'absence.',
    'hr.balance.available': 'Congés disponibles',
    'hr.balance.used': 'Congés pris',
    'hr.balance.days': 'jours',
    'hr.tabs.leaves': 'Congés',
    'hr.tabs.absences': 'Autorisations d\'absence',
    
    // Leaves Tab
    'hr.leaves.new': 'Nouvelle demande de congé',
    'hr.leaves.employee': 'Employé',
    'hr.leaves.approver': 'Responsable',
    'hr.leaves.type': 'Type',
    'hr.leaves.dates': 'Dates',
    'hr.leaves.duration': 'Durée',
    'hr.leaves.reason': 'Motif',
    
    // Status
    'status.pending': 'En attente',
    'status.approved': 'Approuvé',
    'status.rejected': 'Refusé',
    'status.cancelled': 'Annulé'
  },
  en: {
    // Nav
    'nav.dashboard': 'Dashboard',
    'nav.users': 'Team',
    'nav.clients': 'Clients',
    'nav.timeTracking': 'Tasks',
    'nav.invoicing': 'Invoicing',
    'nav.hr': 'HR',
    'nav.logout': 'Logout',

    // Common
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.create': 'Create',
    'common.edit': 'Edit',
    'common.delete': 'Delete',
    'common.actions': 'Actions',
    'common.status': 'Status',
    'common.search': 'Search...',
    
    // Login
    'login.title': 'Login',
    'login.subtitle': 'Access your account',
    'login.username': 'Username',
    'login.password': 'Password',
    'login.button': 'Sign In',
    'login.error': 'Invalid credentials',

    // Users Management
    'users.title': 'Users Management',
    'users.subtitle': 'Manage your team access and roles.',
    'users.add': 'New User',
    'users.edit': 'Edit User',
    'users.role': 'Role',
    'users.permissions': 'Permissions',

    // HR Management
    'hr.title': 'Human Resources',
    'hr.subtitle': 'Leave and absence authorizations management.',
    'hr.balance.available': 'Available Leaves',
    'hr.balance.used': 'Used Leaves',
    'hr.balance.days': 'days',
    'hr.tabs.leaves': 'Leave Requests',
    'hr.tabs.absences': 'Absences',
    
    // Leaves Tab
    'hr.leaves.new': 'New Leave Request',
    'hr.leaves.employee': 'Employee',
    'hr.leaves.approver': 'Approver',
    'hr.leaves.type': 'Type',
    'hr.leaves.dates': 'Dates',
    'hr.leaves.duration': 'Duration',
    'hr.leaves.reason': 'Reason',

    // Status
    'status.pending': 'Pending',
    'status.approved': 'Approved',
    'status.rejected': 'Rejected',
    'status.cancelled': 'Cancelled'
  }
};
