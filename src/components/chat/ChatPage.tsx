import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { roleMeta } from '../../constants/roles';
import { Loader2, Send, MessageCircle, Check, CheckCheck, ArrowLeft, Users, Plus, Settings2 } from 'lucide-react';
import { GroupModal, type ChatGroup } from './GroupModal';

interface Contact {
  id: number;
  username: string;
  fullName: string;
  role: string;
  lastMessage: { body: string; createdAt: string; fromUserId: number } | null;
  unreadCount: number;
}

interface ChatMessage {
  id: string;
  fromUserId: number;
  toUserId: number | null;
  /** Présent = message de groupe ; le destinataire n'est plus unique. */
  groupId?: string | null;
  body: string;
  createdAt: string;
  readAt: string | null;
  /** Lecteurs d'un message de groupe — `readAt` ne sait porter qu'un lecteur. */
  readBy?: number[];
}

/**
 * Une conversation ouverte : un collègue, ou un groupe. Un type somme plutôt
 * que deux états parallèles — deux `selected` auraient fini par être tous
 * deux renseignés, et le fil affiché n'aurait plus eu de source unique.
 */
type Selection =
  | { kind: 'dm'; contact: Contact }
  | { kind: 'group'; group: ChatGroup };

const selectionId = (s: Selection) => (s.kind === 'dm' ? String(s.contact.id) : s.group.id);

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase())
    .join('') || '?';

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

const formatDay = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return "Aujourd'hui";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * Simple 1:1 chat. Any authenticated user can message any other user (see
 * GET /api/messages/contacts on the server) — this is an internal team tool,
 * not gated behind a permission the way Clients/Cash/HR are.
 */
export const ChatPage: React.FC<{ onUnreadChange?: (count: number) => void }> = ({ onUnreadChange }) => {
  const { token, user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  /** `false` = fermé, `null` = création, objet = modification. */
  const [groupEditor, setGroupEditor] = useState<false | { group: ChatGroup | null }>(false);
  const [thread, setThread] = useState<ChatMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<Selection | null>(null);
  selectedRef.current = selected;
  // Reporting the unread total to the shell happens in an effect below, never
  // from inside a state updater: those run during render, and updating App
  // while rendering ChatPage is a React violation.
  const onUnreadRef = useRef(onUnreadChange);
  onUnreadRef.current = onUnreadChange;
  // `sending` is state and does not settle until the next render, so two send
  // calls in the same tick would both read false. This latch flips at once.
  const sendingRef = useRef(false);
  const pendingSeq = useRef(0);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/contacts', { headers: authHeaders });
      if (res.ok) {
        const data: Contact[] = await res.json();
        setContacts(data);
      }
    } catch (e) {
      console.error('Failed to load contacts', e);
    } finally {
      setLoadingContacts(false);
    }
  }, [token]);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/groups', { headers: authHeaders });
      if (res.ok) {
        const data: ChatGroup[] = await res.json();
        setGroups(data);
        // Le groupe ouvert suit ses propres mises à jour (renommage, membres,
        // non-lus) ; s'il a disparu — supprimé, ou j'en ai été retiré — le fil
        // se referme au lieu de rester affiché sur un groupe qui n'existe plus.
        setSelected(prev => {
          if (prev?.kind !== 'group') return prev;
          const fresh = data.find(g => g.id === prev.group.id);
          return fresh ? { kind: 'group', group: fresh } : null;
        });
      }
    } catch (e) {
      console.error('Failed to load groups', e);
    }
  }, [token]);

  useEffect(() => { fetchContacts(); fetchGroups(); }, [fetchContacts, fetchGroups]);

  useEffect(() => {
    if (loadingContacts) return;
    // Les groupes comptent dans la même pastille que les fils directs : un
    // total qui en ignore la moitié ne veut plus rien dire.
    onUnreadRef.current?.(
      contacts.reduce((s, c) => s + c.unreadCount, 0) + groups.reduce((s, g) => s + g.unreadCount, 0),
    );
  }, [contacts, groups, loadingContacts]);

  /** Un seul chemin pour les deux sortes de fil : l'URL seule diffère. */
  const openThread = async (sel: Selection) => {
    setSelected(sel);
    setLoadingThread(true);
    const url = sel.kind === 'dm'
      ? `/api/messages/thread/${sel.contact.id}`
      : `/api/messages/group/${sel.group.id}`;
    try {
      const res = await fetch(url, { headers: authHeaders });
      if (res.ok) setThread(await res.json());
      // Ouvrir le fil le marque lu côté serveur ; on le reflète tout de suite.
      if (sel.kind === 'dm') {
        setContacts(prev => prev.map(c => (c.id === sel.contact.id ? { ...c, unreadCount: 0 } : c)));
      } else {
        setGroups(prev => prev.map(g => (g.id === sel.group.id ? { ...g, unreadCount: 0 } : g)));
      }
    } catch (e) {
      console.error('Failed to load thread', e);
    } finally {
      setLoadingThread(false);
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread]);

  // Live updates: reconnects with backoff, same pattern as the time-entries stream.
  useEffect(() => {
    if (!token) return;
    let source: EventSource | null = null;
    let retryDelay = 1000;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      source = new EventSource(`/api/messages/stream?token=${token}`);

      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'message') {
            const msg: ChatMessage = payload.message;
            const cur = selectedRef.current;

            if (msg.groupId) {
              const isOpen = cur?.kind === 'group' && cur.group.id === msg.groupId;
              if (isOpen) {
                setThread(prev => mergeIncoming(prev, msg));
                // Le fil est sous les yeux : le marquer lu tout de suite, comme
                // pour un message direct.
                if (msg.fromUserId !== user?.id) {
                  fetch(`/api/messages/group/${msg.groupId}`, { headers: authHeaders }).catch(() => {});
                }
              }
              fetchGroups();
            } else {
              const other = msg.fromUserId === user?.id ? msg.toUserId : msg.fromUserId;
              const isOpen = cur?.kind === 'dm' && cur.contact.id === other;
              if (isOpen) {
                setThread(prev => mergeIncoming(prev, msg));
                if (msg.toUserId === user?.id) {
                  // I have the thread open, so mark it read right away.
                  fetch(`/api/messages/thread/${other}`, { headers: authHeaders }).catch(() => {});
                }
              }
              fetchContacts();
            }
          } else if (payload.type === 'read') {
            const cur = selectedRef.current;
            if (cur?.kind === 'dm' && cur.contact.id === payload.by) {
              setThread(prev => prev.map(m => (m.toUserId === payload.by ? m : { ...m, readAt: m.readAt ?? new Date().toISOString() })));
            }
          } else if (payload.type === 'groups' || payload.type === 'groupRead') {
            // Un groupe créé, renommé, quitté ou lu par quelqu'un d'autre :
            // la liste se recharge, elle porte déjà tout ce qui change.
            fetchGroups();
          }
        } catch (e) {
          console.error('Bad SSE payload', e);
        }
      };

      source.onerror = () => {
        source?.close();
        if (closed) return;
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15000);
      };

      source.onopen = () => { retryDelay = 1000; };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [token, user?.id]);

  /**
   * Folds a server message into the thread, whichever arrives first.
   *
   * The server echoes a sent message back to its author over SSE, and the POST
   * also returns it. Either can win the race, so both paths go through here:
   * an id we already hold is ignored, and a message that matches a still
   * pending optimistic entry replaces it rather than being appended — that
   * double-add was what made a sent message appear twice.
   */
  const mergeIncoming = (prev: ChatMessage[], msg: ChatMessage): ChatMessage[] => {
    const twin = (m: ChatMessage) =>
      m.id.startsWith('pending-') &&
      m.fromUserId === msg.fromUserId &&
      String(m.toUserId ?? '') === String(msg.toUserId ?? '') &&
      String(m.groupId ?? '') === String(msg.groupId ?? '') &&
      m.body === msg.body;

    if (prev.some(m => m.id === msg.id)) return prev.filter(m => !twin(m));
    const i = prev.findIndex(twin);
    if (i !== -1) return prev.map((m, idx) => (idx === i ? msg : m));
    return [...prev, msg];
  };

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || !selected || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setDraft('');
    // Optimistic: show it immediately, replace on failure with nothing (kept simple).
    const isGroup = selected.kind === 'group';
    const optimistic: ChatMessage = {
      id: `pending-${++pendingSeq.current}`,
      fromUserId: user!.id,
      toUserId: isGroup ? null : selected.contact.id,
      groupId: isGroup ? selected.group.id : null,
      body,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    setThread(prev => [...prev, optimistic]);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(isGroup ? { groupId: selected.group.id, body } : { toUserId: selected.contact.id, body }),
      });
      if (res.ok) {
        const saved: ChatMessage = await res.json();
        setThread(prev => mergeIncoming(prev, saved));
        if (isGroup) fetchGroups(); else fetchContacts();
      } else {
        setThread(prev => prev.filter(m => m.id !== optimistic.id));
      }
    } catch (e) {
      console.error('Failed to send message', e);
      setThread(prev => prev.filter(m => m.id !== optimistic.id));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    /**
     * Master-detail, and on a phone the two panes take turns rather than
     * sharing the width: a 280px list beside a thread left the thread about
     * 110px wide, which is not a chat. Below `md` the list is the whole page
     * until a conversation is picked, then the thread is — with a back arrow
     * in its header, since there is no router to give the browser's own back
     * button anything to do.
     */
    <div className="flex-1 flex min-w-0 overflow-hidden bg-canvas">
      {/* Conversation list */}
      <aside
        className={`w-full md:w-[280px] md:shrink-0 border-r border-gray-200 bg-white flex-col ${
          selected ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="p-4 border-b border-gray-100 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-[16px] font-bold text-gray-900">Messages</h1>
            <p className="text-[12px] text-gray-500 mt-0.5">Discutez avec l'équipe</p>
          </div>
          {/* Un compte portail n'a pas de groupes : le bouton n'existe pas
              pour lui, et le serveur refuserait la création de toute façon. */}
          {user?.role !== 'CLIENT' && (
            <button
              onClick={() => setGroupEditor({ group: null })}
              title="Créer un groupe de discussion"
              className="shrink-0 px-2.5 py-1.5 rounded-lg bg-navy text-white text-[11.5px] font-semibold hover:bg-navy-hover flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Groupe
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {groups.length > 0 && (
            <>
              <div className="px-4 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3 h-3" /> Groupes
              </div>
              {groups.map(g => {
                const isActive = selected?.kind === 'group' && selected.group.id === g.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => openThread({ kind: 'group', group: g })}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-50 transition-colors ${
                      isActive ? 'bg-gray-100' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-turquoise/15 text-turquoise flex items-center justify-center shrink-0">
                      <Users className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-gray-900 truncate">{g.name}</span>
                        {g.lastMessage && (
                          <span className="text-[10px] text-gray-400 shrink-0">{formatTime(g.lastMessage.createdAt)}</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="text-[11px] text-gray-500 truncate">
                          {g.lastMessage ? g.lastMessage.body : `${g.members.length} participants`}
                        </span>
                        {g.unreadCount > 0 && (
                          <span className="shrink-0 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                            {g.unreadCount > 99 ? '99+' : g.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
              <div className="px-4 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Messages directs
              </div>
            </>
          )}
          {loadingContacts ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="p-4 text-[12px] text-gray-400 text-center">Aucun collègue trouvé</div>
          ) : (
            contacts.map(c => {
              const meta = roleMeta(c.role);
              const isActive = selected?.kind === 'dm' && selected.contact.id === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => openThread({ kind: 'dm', contact: c })}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-50 transition-colors ${
                    isActive ? 'bg-gray-100' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-slate-800 text-white text-[12px] font-bold flex items-center justify-center shrink-0">
                    {initials(c.fullName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium text-gray-900 truncate">{c.fullName}</span>
                      {c.lastMessage && (
                        <span className="text-[10px] text-gray-400 shrink-0">{formatTime(c.lastMessage.createdAt)}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-[11px] text-gray-500 truncate">
                        {c.lastMessage ? c.lastMessage.body : <span className={`px-1.5 py-0.5 rounded text-[10px] ${meta.badgeClass}`}>{meta.label}</span>}
                      </span>
                      {c.unreadCount > 0 && (
                        <span className="shrink-0 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                          {c.unreadCount > 99 ? '99+' : c.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Thread */}
      <div className={`flex-1 flex-col min-w-0 ${selected ? 'flex' : 'hidden md:flex'}`}>
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2 px-6 text-center">
            <MessageCircle className="w-10 h-10" />
            <span className="text-[13px]">Sélectionnez une conversation pour commencer</span>
          </div>
        ) : (
          <>
            <div className="px-3 sm:px-5 py-3 border-b border-gray-200 bg-white flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => setSelected(null)}
                className="md:hidden -ml-1 p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 shrink-0"
                aria-label="Retour aux conversations"
              >
                <ArrowLeft className="w-[18px] h-[18px]" />
              </button>
              {selected.kind === 'group' ? (
                <>
                  <div className="w-8 h-8 rounded-full bg-turquoise/15 text-turquoise flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-gray-900 truncate">{selected.group.name}</div>
                    <div className="text-[11px] text-gray-400 truncate">
                      {selected.group.members.map(m => m.fullName).join(', ')}
                    </div>
                  </div>
                  <button
                    onClick={() => setGroupEditor({ group: selected.group })}
                    title="Modifier le groupe"
                    className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                  >
                    <Settings2 className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <div className="w-8 h-8 rounded-full bg-slate-800 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    {initials(selected.contact.fullName)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900 truncate">{selected.contact.fullName}</div>
                    <div className="text-[11px] text-gray-400 truncate">{roleMeta(selected.contact.role).label}</div>
                  </div>
                </>
              )}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-1">
              {loadingThread ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              ) : thread.length === 0 ? (
                <div className="flex items-center justify-center h-full text-[12px] text-gray-400">
                  Aucun message. Dites bonjour !
                </div>
              ) : (
                thread.map((m, i) => {
                  const mine = m.fromUserId === user?.id;
                  const prev = thread[i - 1];
                  const showDay = !prev || formatDay(prev.createdAt) !== formatDay(m.createdAt);
                  // Dans un groupe, « qui parle » n'est plus déductible du
                  // côté de la bulle. Le nom n'est répété que lorsque
                  // l'auteur change, sinon une suite de messages du même
                  // collègue devient illisible.
                  const showAuthor = selected.kind === 'group' && !mine
                    && (!prev || prev.fromUserId !== m.fromUserId || showDay);
                  const authorName = showAuthor
                    ? (selected.kind === 'group'
                      ? selected.group.members.find(x => x.id === m.fromUserId)?.fullName
                      : '') || 'Collaborateur'
                    : '';
                  return (
                    <React.Fragment key={m.id}>
                      {showDay && (
                        <div className="flex justify-center my-3">
                          <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{formatDay(m.createdAt)}</span>
                        </div>
                      )}
                      <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[82%] sm:max-w-[65%] px-3 py-2 rounded-2xl text-[13px] leading-snug ${
                            mine
                              ? 'bg-slate-800 text-white rounded-br-sm'
                              : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm'
                          }`}
                        >
                          {showAuthor && (
                            <div className="text-[10.5px] font-semibold text-turquoise mb-0.5">{authorName}</div>
                          )}
                          <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          <div className={`flex items-center gap-1 mt-1 ${mine ? 'justify-end text-white/60' : 'justify-end text-gray-400'}`}>
                            <span className="text-[10px]">{formatTime(m.createdAt)}</span>
                            {/* Dans un groupe, « lu » n'a pas de réponse
                                unique : la double coche dirait que tout le
                                monde a lu alors qu'on ne sait que compter les
                                lecteurs. On ne l'affiche donc que pour un fil
                                direct. */}
                            {mine && selected.kind === 'dm'
                              && (m.readAt ? <CheckCheck className="w-3 h-3" /> : <Check className="w-3 h-3" />)}
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })
              )}
            </div>

            {/* pb picks up the home-indicator inset so the composer isn't
                half under the gesture bar on a phone. */}
            <div
              className="p-3 sm:p-4 border-t border-gray-200 bg-white flex items-center gap-2"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              <input
                type="text"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Écrivez un message..."
                /* 16px below sm: anything smaller makes iOS Safari zoom the
                   page in on focus and never zoom back out. */
                className="flex-1 min-w-0 text-[16px] sm:text-[13px] px-3 py-2 rounded-lg border border-gray-200 outline-none focus:border-gray-400"
              />
              <button
                onClick={handleSend}
                disabled={!draft.trim() || sending}
                className="w-10 h-10 sm:w-9 sm:h-9 rounded-lg bg-slate-800 text-white flex items-center justify-center disabled:opacity-40 shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>

      {groupEditor && (
        <GroupModal
          group={groupEditor.group}
          contacts={contacts}
          onClose={() => setGroupEditor(false)}
          onSaved={(g) => {
            setGroupEditor(false);
            fetchGroups();
            openThread({ kind: 'group', group: g });
          }}
          onDeleted={() => {
            setGroupEditor(false);
            setSelected(null);
            setThread([]);
            fetchGroups();
          }}
        />
      )}
    </div>
  );
};
