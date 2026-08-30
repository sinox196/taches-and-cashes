import React, { useCallback, useEffect, useState } from 'react';
import { Logo } from '../components/Logo';
import { NotificationBell } from '../components/NotificationBell';
import { ChatPage } from '../components/chat/ChatPage';
import { useAuth } from '../context/AuthContext';
import { formatCostTND } from '../utils/formatters';
import {
  LogOut, FileText, ClipboardCheck, FolderCheck, MessageCircle,
  AlertTriangle, CheckCircle2, Loader2, Menu, X,
} from 'lucide-react';

/**
 * Portail client.
 *
 * Le client se connecte par le **même écran** que les collaborateurs ; c'est
 * son rôle qui l'amène ici au lieu du back-office (voir App.tsx). Il ne voit
 * que son propre dossier, et jamais le temps passé ni le coût interne — ce
 * filtrage est fait par le serveur, dans `/api/portal/*`, pas ici : masquer
 * une colonne dans le navigateur laisserait les chiffres partir dans la
 * réponse JSON, lisibles dans l'onglet réseau.
 */

interface Summary {
  client: { id: number; name: string; taxId: string; email: string };
  soldeAnterieur: number;
  montantFacture: number;
  totalEncaisse: number;
  soldeGlobal: number;
  invoiceCount: number;
}

interface StatementLine {
  kind: 'FACTURE' | 'ENCAISSEMENT';
  date: string;
  label: string;
  reference: string;
  dueDate?: string | null;
  paymentMethod?: string;
  debit: number;
  credit: number;
  solde: number;
}

interface PortalTask {
  id: string;
  date: string;
  libelle: string;
  mission: string;
  typeTache: string;
  statut: string;
  responsable: string;
}

interface Deliverable {
  id: string;
  name: string;
  type: string;
  status: string;
  createdAt: string;
  progress: { done: number; total: number };
  items: { id: string; label: string; done: boolean }[];
}

type Tab = 'statement' | 'tasks' | 'deliverables' | 'messages';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'statement', label: 'Relevé de compte', icon: FileText },
  { id: 'tasks', label: 'Travaux', icon: ClipboardCheck },
  { id: 'deliverables', label: 'Livrables', icon: FolderCheck },
  { id: 'messages', label: 'Messages', icon: MessageCircle },
];

const fdate = (iso: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

export const ClientPortal: React.FC = () => {
  const { token, user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('statement');
  const [menuOpen, setMenuOpen] = useState(false);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [statement, setStatement] = useState<{ soldeAnterieur: number; lines: StatementLine[]; soldeGlobal: number } | null>(null);
  const [tasks, setTasks] = useState<PortalTask[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const get = useCallback(async (path: string) => {
    const res = await fetch(`/api/portal/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Erreur de chargement.');
    }
    return res.json();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [s, st, t, d] = await Promise.all([
          get('summary'), get('statement'), get('tasks'), get('deliverables'),
        ]);
        if (cancelled) return;
        setSummary(s); setStatement(st); setTasks(t); setDeliverables(d);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Erreur de chargement.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, get]);

  // Un compte client que personne n'a rattaché à un dossier : le serveur
  // répond 403 avec sa raison, et l'afficher vaut mieux qu'un portail vide
  // dont le client ne saurait pas quoi faire.
  if (error) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-sm text-center shadow-sm">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <p className="text-[14px] text-gray-800 font-medium mb-1">Portail indisponible</p>
          <p className="text-[13px] text-gray-600 mb-4">{error}</p>
          <button onClick={() => logout()} className="px-4 py-2 text-[13px] font-medium border border-gray-300 rounded-lg hover:bg-gray-50">
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-canvas flex flex-col font-sans antialiased text-gray-900">
      <header className="bg-navy text-white shrink-0">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Logo size={28} variant="white" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold leading-tight truncate">{summary?.client.name || 'Espace client'}</p>
            <p className="text-[11px] text-white/60 leading-tight">Espace client</p>
          </div>
          <NotificationBell onNavigate={() => setTab('messages')} />
          <button
            onClick={() => logout()}
            title="Se déconnecter"
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="sm:hidden p-2 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Menu"
          >
            {menuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>

        {/* Onglets : en ligne dès `sm`, repliés derrière le menu sur téléphone. */}
        <nav className={`${menuOpen ? 'flex' : 'hidden'} sm:flex flex-col sm:flex-row max-w-[1200px] mx-auto px-4 sm:px-6 gap-1 sm:gap-2 pb-2`}>
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setMenuOpen(false); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                  tab === t.id ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <main className="max-w-[1200px] mx-auto p-4 sm:p-6 flex flex-col gap-4 sm:gap-6 min-h-full">
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : tab === 'messages' ? (
            <div className="flex-1 min-h-[540px] bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
              <ChatPage />
            </div>
          ) : (
            <>
              {/* Situation financière — visible sur les trois onglets de suivi,
                  c'est la question que le client se pose en arrivant. */}
              {summary && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard label="Solde antérieur" value={formatCostTND(summary.soldeAnterieur)} />
                  <StatCard label="Total facturé" value={formatCostTND(summary.montantFacture)} />
                  <StatCard label="Total encaissé" value={formatCostTND(summary.totalEncaisse)} tone="good" />
                  <StatCard label="Solde à payer" value={formatCostTND(summary.soldeGlobal)} tone={summary.soldeGlobal > 0 ? 'due' : 'good'} strong />
                </div>
              )}

              {tab === 'statement' && <StatementView statement={statement} />}
              {tab === 'tasks' && <TasksView tasks={tasks} />}
              {tab === 'deliverables' && <DeliverablesView deliverables={deliverables} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; tone?: 'good' | 'due'; strong?: boolean }> = ({ label, value, tone, strong }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-3 sm:p-4">
    <p className="text-[11.5px] sm:text-[12px] text-gray-500 leading-snug mb-1">{label}</p>
    <p className={`font-mono font-bold ${strong ? 'text-[16px] sm:text-[18px]' : 'text-[14px] sm:text-[16px]'} ${
      tone === 'due' ? 'text-red-700' : tone === 'good' ? 'text-emerald-700' : 'text-gray-900'
    }`}>
      {value}
    </p>
  </div>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="py-10 text-center text-[13px] text-gray-500">{children}</p>
);

/** Relevé de compte : une ligne par facture ou règlement, avec le solde qui court. */
const StatementView: React.FC<{ statement: { soldeAnterieur: number; lines: StatementLine[]; soldeGlobal: number } | null }> = ({ statement }) => {
  if (!statement) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-gray-100">
        <h2 className="text-[15px] font-semibold text-gray-900">Relevé de compte</h2>
        <p className="text-[12px] text-gray-500 mt-0.5">Vos factures et vos règlements, dans l'ordre chronologique.</p>
      </div>

      {/* Tableau à partir de `sm`, cartes en dessous : cinq colonnes de chiffres
          ne tiennent pas dans la largeur d'un téléphone. */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="min-w-full text-[13px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-5 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-5 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Libellé</th>
              <th className="px-5 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Facturé</th>
              <th className="px-5 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Réglé</th>
              <th className="px-5 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Solde</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr className="bg-gray-50/60">
              <td className="px-5 py-2.5 text-gray-500" colSpan={4}>Solde antérieur</td>
              <td className="px-5 py-2.5 text-right font-mono font-semibold">{formatCostTND(statement.soldeAnterieur)}</td>
            </tr>
            {statement.lines.length === 0 ? (
              <tr><td colSpan={5}><Empty>Aucun mouvement enregistré.</Empty></td></tr>
            ) : statement.lines.map((l, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-5 py-2.5 whitespace-nowrap text-gray-700">{fdate(l.date)}</td>
                <td className="px-5 py-2.5">
                  <span className="text-gray-900">{l.label}</span>
                  {l.paymentMethod && <span className="ml-2 text-[11px] text-gray-400">{l.paymentMethod}</span>}
                  {l.kind === 'FACTURE' && l.dueDate && (
                    <span className="ml-2 text-[11px] text-gray-400">échéance {fdate(l.dueDate)}</span>
                  )}
                </td>
                <td className="px-5 py-2.5 text-right font-mono text-gray-900">{l.debit ? formatCostTND(l.debit) : '—'}</td>
                <td className="px-5 py-2.5 text-right font-mono text-emerald-700">{l.credit ? formatCostTND(l.credit) : '—'}</td>
                <td className="px-5 py-2.5 text-right font-mono font-semibold text-gray-900">{formatCostTND(l.solde)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 border-t border-gray-200">
              <td className="px-5 py-3 font-bold text-gray-900" colSpan={4}>Solde à payer</td>
              <td className="px-5 py-3 text-right font-mono font-bold text-gray-900">{formatCostTND(statement.soldeGlobal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="sm:hidden p-3 flex flex-col gap-2.5">
        <div className="flex justify-between text-[12.5px] px-1">
          <span className="text-gray-500">Solde antérieur</span>
          <span className="font-mono font-semibold">{formatCostTND(statement.soldeAnterieur)}</span>
        </div>
        {statement.lines.length === 0 ? (
          <Empty>Aucun mouvement enregistré.</Empty>
        ) : statement.lines.map((l, i) => (
          <div key={i} className="border border-gray-200 rounded-lg p-3">
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <span className="text-[13px] font-semibold text-gray-900 truncate">{l.label}</span>
              <span className="text-[12px] text-gray-500 shrink-0">{fdate(l.date)}</span>
            </div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className={l.credit ? 'text-emerald-700' : 'text-gray-700'}>
                {l.credit ? `Réglé ${formatCostTND(l.credit)}` : `Facturé ${formatCostTND(l.debit)}`}
              </span>
              <span className="font-mono font-semibold text-gray-900">{formatCostTND(l.solde)}</span>
            </div>
          </div>
        ))}
        <div className="flex justify-between text-[13px] font-bold px-1 pt-2 border-t border-gray-200">
          <span>Solde à payer</span>
          <span className="font-mono">{formatCostTND(statement.soldeGlobal)}</span>
        </div>
      </div>
    </div>
  );
};

/** Travaux réalisés — avancement uniquement, jamais le temps passé ni le coût. */
const TasksView: React.FC<{ tasks: PortalTask[] }> = ({ tasks }) => (
  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
    <div className="px-4 sm:px-5 py-3 border-b border-gray-100">
      <h2 className="text-[15px] font-semibold text-gray-900">Travaux réalisés</h2>
      <p className="text-[12px] text-gray-500 mt-0.5">Les missions terminées sur votre dossier.</p>
    </div>
    {tasks.length === 0 ? (
      <Empty>Aucun travail terminé pour le moment.</Empty>
    ) : (
      <ul className="divide-y divide-gray-100">
        {tasks.map(t => (
          <li key={t.id} className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-gray-900">{t.libelle}</p>
              <p className="text-[12px] text-gray-500">
                {[t.mission, t.typeTache].filter(Boolean).join(' · ') || '—'}
                {t.responsable && <> · {t.responsable}</>}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[12px] text-gray-500">{t.date}</span>
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-medium bg-emerald-50 text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" /> Terminé
              </span>
            </div>
          </li>
        ))}
      </ul>
    )}
  </div>
);

/** Livrables métier — où en est chaque dossier, sans qui y a passé du temps. */
const DeliverablesView: React.FC<{ deliverables: Deliverable[] }> = ({ deliverables }) => (
  <div className="flex flex-col gap-3">
    <div className="bg-white border border-gray-200 rounded-xl px-4 sm:px-5 py-3">
      <h2 className="text-[15px] font-semibold text-gray-900">Livrables</h2>
      <p className="text-[12px] text-gray-500 mt-0.5">L'avancement des pièces attendues sur votre dossier.</p>
    </div>
    {deliverables.length === 0 ? (
      <div className="bg-white border border-gray-200 rounded-xl"><Empty>Aucun livrable en cours.</Empty></div>
    ) : deliverables.map(d => {
      const pct = d.progress.total ? Math.round((d.progress.done / d.progress.total) * 100) : 0;
      return (
        <div key={d.id} className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <p className="text-[14px] font-semibold text-gray-900">{d.name}</p>
            <span className="text-[12px] text-gray-500">{d.progress.done} / {d.progress.total} éléments</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3">
            <div
              className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-turquoise'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <ul className="flex flex-col gap-1">
            {d.items.map(i => (
              <li key={i.id} className="flex items-start gap-2 text-[12.5px]">
                {i.done
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  : <span className="w-3.5 h-3.5 rounded-full border border-gray-300 shrink-0 mt-0.5" />}
                <span className={i.done ? 'text-gray-500 line-through' : 'text-gray-800'}>{i.label}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    })}
  </div>
);
