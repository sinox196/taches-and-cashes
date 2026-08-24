import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Role } from '../constants/roles';

export interface User {
  id: number;
  username: string;
  role: Role;
  permissions: string[];
  salaireBrut?: number;
  regimeHoraire?: number;
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
  /** Runs the platform itself (confirms other companies' payments) — orthogonal to `role`, which is scoped to this user's own company. */
  isPlatformAdmin?: boolean;
  /** This user's own company — trial status, plan, deadline. Absent for a pre-migration /api/login response shape. */
  company?: { id: string; name: string; status: string; plan: string; trialEndsAt: string | null } | null;
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('auth_token'));
  const [isLoading, setIsLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

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
    setToken(null);
    setUser(null);
    // Guard against `onClick={logout}` handing us a click event instead of a
    // message — rendering that object would crash the login screen.
    setAuthMessage(typeof reason === 'string' ? reason : null);
    localStorage.removeItem('auth_token');
  };

  const hasPermission = (permission: string) => {
    if (!user) return false;
    if (user.role === 'ADMIN') return true;
    return user.permissions.includes(permission);
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, authMessage, login, logout, hasPermission }}>
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
