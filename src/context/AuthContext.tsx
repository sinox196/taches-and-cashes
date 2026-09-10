import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Role } from '../constants/roles';
import { RESOURCES_PERMISSIONS, companyHasResourcesModule } from '../constants/secteurs';
import { planAllowsPermission } from '../constants/plans';
import { unsubscribeFromPush } from '../utils/osNotifications';

export interface User {
  id: number;
  username: string;
  role: Role;
  permissions: string[];
  salaireBrut?: number;
  regimeHoraire?: number;
  /** Admin-set shift boundaries, "HH:MM" — drives the pointage punctuality gate. */
  shiftStart?: string | null;
  shiftEnd?: string | null;
  /** Meal-break ("pause ftour") allowance in minutes, deducted from the shift's paid hours. */
  breakMinutes?: number | null;
  /** Dossier client rattaché — renseigné uniquement pour un compte de rôle CLIENT. */
  clientId?: number | null;
  /** Nom du dossier rattaché, résolu par le serveur pour l'écran Équipe — jamais saisi côté client. */
  clientName?: string | null;
  cnss?: number;
  tfp?: number;
  foprolos?: number;
  accidentTravail?: number;
  primesFraisNonCotisables?: number;
  coutTotalEmployeur?: number;
  coutHoraireEmployeur?: number;
  /** Admin-set annual leave allowance, in days. */
  soldeConge?: number;
  congesUtilises?: number;
  congesRestants?: number;
  /** Gestion des paies — dossier administratif/paie de l'employé, sans effet sur aucun calcul de coût ou de pointage : ce sont des informations de référence saisies par l'admin, lues nulle part ailleurs dans l'app. */
  matricule?: string | null;
  numCin?: string | null;
  numCnss?: string | null;
  qualification?: string | null;
  departement?: string | null;
  banque?: string | null;
  numeroCompte?: string | null;
  situationFamiliale?: string | null;
  nombreEnfants?: number | null;
  categorie?: string | null;
  echelon?: string | null;
  salHeure?: number | null;
  /** Runs the platform itself (confirms other companies' payments) — orthogonal to `role`, which is scoped to this user's own company. */
  isPlatformAdmin?: boolean;
  /** This user's own company — trial status, plan, deadline, secteur. Absent for a pre-migration /api/login response shape. */
  company?: { id: string; name: string; status: string; plan: string; trialEndsAt: string | null; secteur?: string | null } | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  /** Set when the session ended on its own (expired / rejected), shown on the login screen. */
  authMessage: string | null;
  login: (token: string, user: User) => void;
  logout: (reason?: string) => void;
  hasPermission: (permission: string) => boolean;
  /** True while an admin is viewing a client's portal space in their place. */
  isImpersonating: boolean;
  /** Opens that client's portal space as them — resolves to an error message, or null on success. */
  impersonateClient: (clientId: number) => Promise<string | null>;
  /** Drops the client session and restores the admin's own. */
  stopImpersonating: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('auth_token'));
  const [isLoading, setIsLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  // Le jeton admin de côté pendant qu'on regarde l'espace d'un client — dans
  // une clé distincte de `auth_token`, jamais dans le même état, pour qu'un
  // rechargement de page pendant l'impersonation ne le perde pas.
  const [impersonatorToken, setImpersonatorToken] = useState<string | null>(
    () => localStorage.getItem('impersonator_token'),
  );

  useEffect(() => {
    const fetchMe = async () => {
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/me', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        } else {
          // Invalid token, or a company that expired mid-session (authenticate
          // rejects before /api/me's own handler runs either way) — surface
          // the server's own message (e.g. the trial-expired notice) when
          // there is one, rather than a generic "session expired" for both.
          const data = await response.json().catch(() => ({}));
          setToken(null);
          setUser(null);
          setAuthMessage(data.error || 'Votre session a expiré. Veuillez vous reconnecter.');
          localStorage.removeItem('auth_token');
        }
      } catch (error) {
        console.error('Failed to fetch user', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMe();
  }, [token]);

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    setAuthMessage(null);
    localStorage.setItem('auth_token', newToken);
  };

  const logout = (reason?: string) => {
    // Drop this device's push subscription before the token disappears — the
    // call needs it to authenticate. Not awaited: logging out must not wait
    // on the network, and the row is pruned server-side on its next 404/410
    // either way. Matters most on a shared machine, where the next person
    // would otherwise keep receiving the previous user's chronometer.
    if (token) unsubscribeFromPush(token).catch(() => {});

    setToken(null);
    setUser(null);
    // Guard against `onClick={logout}` handing us a click event instead of a
    // message — rendering that object would crash the login screen.
    setAuthMessage(typeof reason === 'string' ? reason : null);
    localStorage.removeItem('auth_token');
    // Une déconnexion complète efface aussi un retour d'impersonation resté
    // en suspens — il n'y a plus de session admin à retrouver.
    localStorage.removeItem('impersonator_token');
    setImpersonatorToken(null);
  };

  /**
   * Bascule le jeton actif sans passer par `login()` : il n'y a pas d'objet
   * `User` sous la main pour la cible, seulement son jeton — `user` est donc
   * vidé puis réhydraté par le `useEffect` ci-dessus au prochain rendu
   * (`/api/me` sur le nouveau jeton), exactement comme au chargement de l'app.
   */
  const switchToken = (newToken: string) => {
    setUser(null);
    setToken(newToken);
    localStorage.setItem('auth_token', newToken);
  };

  const impersonateClient = async (clientId: number): Promise<string | null> => {
    if (!token) return 'Non authentifié.';
    try {
      const res = await fetch(`/api/clients/${clientId}/impersonate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return body.error || "Impossible d'ouvrir cet espace client.";
      localStorage.setItem('impersonator_token', token);
      setImpersonatorToken(token);
      switchToken(body.token);
      return null;
    } catch {
      return "Impossible d'ouvrir cet espace client.";
    }
  };

  const stopImpersonating = () => {
    if (!impersonatorToken) return;
    switchToken(impersonatorToken);
    localStorage.removeItem('impersonator_token');
    setImpersonatorToken(null);
  };

  const hasPermission = (permission: string) => {
    if (!user) return false;
    // Ressources Métier is gated by the company's own secteur, ahead of the
    // ADMIN bypass below — mirrors requirePermission in server.ts.
    if (RESOURCES_PERMISSIONS.has(permission) && !companyHasResourcesModule(user.company?.secteur)) return false;
    // Une offre restreinte ferme ce qu'elle ne vend pas, avant le
    // court-circuit ADMIN comme côté serveur : c'est l'abonnement de
    // l'entreprise qui décide, pas le rôle de la personne.
    if (!planAllowsPermission(user.company?.plan, permission)) return false;
    if (user.role === 'ADMIN') return true;
    return user.permissions.includes(permission);
  };

  return (
    <AuthContext.Provider value={{
      user, token, isLoading, authMessage, login, logout, hasPermission,
      isImpersonating: !!impersonatorToken, impersonateClient, stopImpersonating,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
