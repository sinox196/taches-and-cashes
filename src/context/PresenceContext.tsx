import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  DEFAULT_AWAY_AFTER_MS, HEARTBEAT_MS, clampAwayMinutes, type PresenceState,
} from '../constants/presence';
import { CLIENT_ROLE } from '../constants/roles';

interface PresenceEntry {
  state: PresenceState;
  idleMs: number | null;
  lastSeenAt: string | null;
  /**
   * Le poste d'où bat le cœur, `null` dès que le contact est perdu — même
   * règle que `idleMs`. Auto-déclaré par le navigateur, donc falsifiable :
   * ça se lit, ça ne décide de rien (voir `EntryDeviceBadge`).
   */
  device: 'MOBILE' | 'DESKTOP' | null;
}

interface PresenceContextType {
  /** This browser's own state, updated the moment input resumes. */
  own: PresenceState;
  /** Everyone's state, keyed by user id. */
  byUser: Record<string, PresenceEntry>;
  presenceOf: (userId: number | undefined) => PresenceEntry;
  /** The configured away threshold, in minutes. */
  awayAfterMinutes: number;
  /** Re-reads it after an admin changes it, so badges update without a reload. */
  refreshAwayAfter: () => void;
}

const OFFLINE: PresenceEntry = { state: 'INACTIVE', idleMs: null, lastSeenAt: null, device: null };
const PresenceContext = createContext<PresenceContextType | undefined>(undefined);

/** Real user input — pointer, keyboard, wheel, touch. */
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

export const PresenceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token: authToken, user } = useAuth();
  // La présence est un outil interne au cabinet : « qui est à son poste ».
  // Un client n'y a pas sa place, et le portail n'a aucun écran qui la lise.
  // Neutraliser le jeton ici éteint d'un coup le battement, le sondage et la
  // balise de départ — tous déjà gardés par `if (!token) return` — au lieu de
  // laisser partir des requêtes que le serveur refuse en 403.
  const token = authToken && user?.role !== CLIENT_ROLE ? authToken : null;

  const lastActivityRef = useRef<number>(Date.now());
  const [own, setOwn] = useState<PresenceState>('ACTIVE');
  const [byUser, setByUser] = useState<Record<string, PresenceEntry>>({});
  // The threshold is configurable server-side. Held in a ref as well as state
  // so the input handler reads the current value without being re-subscribed
  // (it is attached to mousemove, so re-binding it on every change is wasteful).
  const [awayAfterMs, setAwayAfterMs] = useState(DEFAULT_AWAY_AFTER_MS);
  const awayAfterMsRef = useRef(DEFAULT_AWAY_AFTER_MS);
  awayAfterMsRef.current = awayAfterMs;

  const refreshAwayAfter = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/presence/settings', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const body = await res.json();
      setAwayAfterMs(clampAwayMinutes(body?.awayAfterMinutes) * 60 * 1000);
    } catch { /* keep the default until the next attempt */ }
  }, [token]);

  useEffect(() => { refreshAwayAfter(); }, [refreshAwayAfter]);

  const beat = useCallback(async (idleMs: number) => {
    if (!token) return;
    try {
      await fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ idleMs }),
      });
    } catch { /* a missed heartbeat just delays the transition */ }
  }, [token]);

  // --- track input ---------------------------------------------------------
  useEffect(() => {
    if (!token) return;

    const onActivity = () => {
      const wasAway = Date.now() - lastActivityRef.current >= awayAfterMsRef.current;
      lastActivityRef.current = Date.now();
      if (wasAway) {
        // Coming back from away is the one transition that must feel instant,
        // so it reports immediately instead of waiting for the next heartbeat.
        setOwn('ACTIVE');
        beat(0);
      } else if (own !== 'ACTIVE') {
        setOwn('ACTIVE');
      }
    };

    // mousemove/scroll fire constantly; the handler is cheap but keep it passive.
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, onActivity, { passive: true }));
    return () => ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, onActivity));
  }, [token, own, beat]);

  // --- heartbeat + local away transition -----------------------------------
  useEffect(() => {
    if (!token) return;
    beat(Date.now() - lastActivityRef.current);

    const tick = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      setOwn(idle >= awayAfterMsRef.current ? 'AWAY' : 'ACTIVE');
      beat(idle);
    }, HEARTBEAT_MS);

    return () => clearInterval(tick);
  }, [token, beat]);

  // --- drop to inactive promptly when the tab goes away --------------------
  useEffect(() => {
    if (!token) return;
    const goOffline = () => {
      // keepalive lets the request outlive the page; a normal fetch would be
      // cancelled on unload and the user would linger for ~95s.
      try {
        fetch('/api/presence/offline', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          keepalive: true,
        });
      } catch { /* best effort */ }
    };
    window.addEventListener('pagehide', goOffline);
    return () => {
      window.removeEventListener('pagehide', goOffline);
      goOffline(); // also covers logout, which unmounts the provider
    };
  }, [token]);

  // --- everyone else -------------------------------------------------------
  useEffect(() => {
    if (!token) { setByUser({}); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/presence', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setByUser(body);
      } catch { /* keep the previous snapshot */ }
    };
    load();
    const poll = setInterval(load, HEARTBEAT_MS);
    return () => { cancelled = true; clearInterval(poll); };
  }, [token]);

  const presenceOf = useCallback((userId: number | undefined): PresenceEntry => {
    if (userId == null) return OFFLINE;
    // Trust the local view of ourselves — it reacts to input without waiting
    // for the next poll.
    if (user && userId === user.id) {
      return {
        state: own,
        idleMs: Date.now() - lastActivityRef.current,
        lastSeenAt: null,
        // L'état vient du local (il réagit à la frappe sans attendre le
        // sondage), mais le poste vient du serveur : c'est lui qui l'a lu sur
        // le battement, et le refaire ici serait une deuxième détection à
        // garder en phase avec `deviceFromRequest`.
        device: byUser[String(userId)]?.device ?? null,
      };
    }
    return byUser[String(userId)] ?? OFFLINE;
  }, [byUser, own, user]);

  return (
    <PresenceContext.Provider value={{ own, byUser, presenceOf, awayAfterMinutes: Math.round(awayAfterMs / 60000), refreshAwayAfter }}>
      {children}
    </PresenceContext.Provider>
  );
};

export const usePresence = () => {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error('usePresence must be used within a PresenceProvider');
  return ctx;
};
