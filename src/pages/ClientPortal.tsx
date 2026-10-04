import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Logo } from '../components/Logo';
import { NotificationBell } from '../components/NotificationBell';
import { ChatPage } from '../components/chat/ChatPage';
import { InvoicePreview } from '../components/cash/InvoicePreview';
import { downloadClientReportPdf, ClientReport } from '../components/portal/clientReportPdf';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { useAuth } from '../context/AuthContext';
import { formatCostTND } from '../utils/formatters';
import { ExportButton } from '../components/ExportButton';
import { csvNumber, CsvColumn } from '../utils/exportCsv';
import { paymentModeLabel, isCashMode } from '../constants/paymentModes';
import { companyHasResourcesModule } from '../constants/secteurs';
import {
  LogOut, FileText, ClipboardCheck, FolderCheck, CalendarClock, MessageCircle,
  AlertTriangle, CheckCircle2, Loader2, Menu, X, Wallet, BarChart3, Download, Landmark,
  Plus, Pencil, Trash2, Upload, ChevronRight, ChevronDown, Building2,
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
  /**
   * Présent sur une ligne FACTURE (ouvre le document) et sur une ligne
   * ENCAISSEMENT qui vient réellement d'une fiche/du brouillard (ouvre le
   * détail du règlement) — absent sur le montant hérité en simple nombre,
   * qui n'a pas d'id à rouvrir.
   */
  id?: string;
  date: string;
  label: string;
  reference: string;
  dueDate?: string | null;
  paymentMethod?: string;
  bankAccount?: string;
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

interface BankLine {
  id: string;
  date: string;
  libelle: string;
  dateValeur: string;
  debit: number;
  credit: number;
  justif: string;
  /** Saisie par le cabinet, jamais par le client — voir CLAUDE.md « Relevé
   *  bancaire ». Sert à regrouper le relevé par banque dans le portail. */
  banque: string;
  statut: 'OK' | 'SANS_JUSTIF';
}

interface EcheanceColumn { id: string; year: number; month: number; label: string; sortOrder: number }
interface EcheanceStatusCell { columnId: string; status: string | null; quittanceNumber?: string | null; montant?: number | null }
interface EcheanceStatusOption { id: string; label: string; color?: string }
interface EcheanceData { columns: EcheanceColumn[]; statuses: EcheanceStatusCell[]; statusOptions: EcheanceStatusOption[] }

type Tab = 'statement' | 'tasks' | 'deliverables' | 'echeances' | 'report' | 'bankStatement' | 'messages';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'statement', label: 'Relevé de compte', icon: FileText },
  { id: 'tasks', label: 'Travaux', icon: ClipboardCheck },
  { id: 'deliverables', label: 'Livrables', icon: FolderCheck },
  // Réservé aux secteurs où Ressources métier existe côté cabinet — même
  // garde que `companyHasResourcesModule` ailleurs, sinon l'onglet serait
  // toujours vide pour une entreprise qui n'a jamais eu de grille.
  { id: 'echeances', label: 'Échéances', icon: CalendarClock },
  { id: 'report', label: 'Rapport mensuel', icon: BarChart3 },
  { id: 'bankStatement', label: 'Relevé bancaire', icon: Landmark },
  { id: 'messages', label: 'Messages', icon: MessageCircle },
];

/**
 * Où `NotificationBell` envoie le clic, traduit vers l'onglet du portail —
 * `TYPE_META`/`PUSH_NAV_FOR_TYPE` désignent la destination par ces mêmes
 * chaînes côté serveur (`Echeances`/`Statement`/`Deliverables`/`Tasks`/
 * `Report`), qui n'existent que pour les cinq types de notification réservés
 * à un compte CLIENT. `Messages` couvre à la fois le type back-office par
 * défaut (`Dashboard`, absent d'ici, donc le repli) et le clic sur un contact
 * aux messages non lus, qui appelait déjà `onNavigate('Messages')` — c'était
 * jusqu'ici la seule destination que ce callback savait atteindre.
 */
const PORTAL_NAV_TO_TAB: Record<string, Tab> = {
  Echeances: 'echeances',
  Statement: 'statement',
  Deliverables: 'deliverables',
  Tasks: 'tasks',
  Report: 'report',
  BankStatement: 'bankStatement',
  Messages: 'messages',
};

const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/**
 * Les mêmes clés de couleur que `EcheancesGrid.tsx` (les tokens réservés
 * `done`/`late`/`run`/`pause`/`admin`/`collab`, jamais un hex inventé ici) —
 * le portail ne fait que lire la couleur assignée par le cabinet à chaque
 * valeur, il n'en choisit aucune.
 */
const ECHEANCE_COLOR_TOKENS: Record<string, { bg: string; fg: string }> = {
  done: { bg: 'bg-done-bg', fg: 'text-done-fg' },
  late: { bg: 'bg-late-bg', fg: 'text-late-fg' },
  run: { bg: 'bg-run-bg', fg: 'text-run-fg' },
  pause: { bg: 'bg-pause-bg', fg: 'text-pause-fg' },
  admin: { bg: 'bg-admin-bg', fg: 'text-admin-fg' },
  collab: { bg: 'bg-collab-bg', fg: 'text-collab-fg' },
  gray: { bg: 'bg-gray-50', fg: 'text-gray-400' },
};
const ECHEANCE_EMPTY_STYLE = { bg: 'bg-white', fg: 'text-gray-300' };

const fdate = (iso: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

export const ClientPortal: React.FC = () => {
  const { token, user, logout, isImpersonating } = useAuth();
  const [tab, setTab] = useState<Tab>('statement');
  const [menuOpen, setMenuOpen] = useState(false);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [statement, setStatement] = useState<{ soldeAnterieur: number; lines: StatementLine[]; soldeGlobal: number } | null>(null);
  const [tasks, setTasks] = useState<PortalTask[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [echeances, setEcheances] = useState<EcheanceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Même garde que côté back-office : un secteur sans Ressources métier n'a
  // jamais eu de grille d'échéances à afficher, donc l'onglet ne se propose
  // même pas plutôt que de rendre une carte toujours vide.
  const hasEcheances = companyHasResourcesModule(user?.company?.secteur);
  const visibleTabs = useMemo(() => TABS.filter(t => t.id !== 'echeances' || hasEcheances), [hasEcheances]);

  // Facture ouverte depuis le relevé — chargée à la demande, pas embarquée
  // dans chaque ligne du relevé.
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
  const [openInvoice, setOpenInvoice] = useState<any | null>(null);
  const [invoiceError, setInvoiceError] = useState('');

  // Règlement ouvert depuis le relevé — déjà entièrement dans la ligne
  // (contrairement à une facture, un règlement n'a pas de document séparé à
  // charger), donc pas de round-trip réseau ici.
  const [openReglement, setOpenReglement] = useState<StatementLine | null>(null);

  // Rapport mensuel — chargé seulement quand l'onglet est ouvert, pas dans le
  // chargement initial : c'est un calcul de plus par requête pour un onglet
  // que tout le monde ne consulte pas à chaque visite.
  const [report, setReport] = useState<ClientReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');

  // Relevé bancaire — même paresse que le rapport mensuel : chargé à
  // l'ouverture de l'onglet, pas dans la salve initiale, puisque tous les
  // clients n'en ont pas.
  const [bankLines, setBankLines] = useState<BankLine[] | null>(null);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankError, setBankError] = useState('');

  const get = useCallback(async (path: string) => {
    const res = await fetch(`/api/portal/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Erreur de chargement.');
    }
    return res.json();
  }, [token]);

  useEffect(() => {
    if (!openInvoiceId) { setOpenInvoice(null); return; }
    let cancelled = false;
    setInvoiceError('');
    get(`invoices/${openInvoiceId}`)
      .then(inv => { if (!cancelled) setOpenInvoice(inv); })
      .catch(e => { if (!cancelled) { setInvoiceError(e.message || 'Erreur de chargement.'); setOpenInvoiceId(null); } });
    return () => { cancelled = true; };
  }, [openInvoiceId, get]);

  useEffect(() => {
    if (tab !== 'report' || report) return;
    let cancelled = false;
    setReportLoading(true);
    setReportError('');
    get('report')
      .then(r => { if (!cancelled) setReport(r); })
      .catch(e => { if (!cancelled) setReportError(e.message || 'Erreur de chargement.'); })
      .finally(() => { if (!cancelled) setReportLoading(false); });
    return () => { cancelled = true; };
  }, [tab, report, get]);

  useEffect(() => {
    if (tab !== 'bankStatement' || bankLines) return;
    let cancelled = false;
    setBankLoading(true);
    setBankError('');
    get('bank-statement')
      .then(r => { if (!cancelled) setBankLines(Array.isArray(r) ? r : []); })
      .catch(e => { if (!cancelled) setBankError(e.message || 'Erreur de chargement.'); })
      .finally(() => { if (!cancelled) setBankLoading(false); });
    return () => { cancelled = true; };
  }, [tab, bankLines, get]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const calls = [get('summary'), get('statement'), get('tasks'), get('deliverables')];
        // Un appel de plus seulement pour un secteur qui a réellement une
        // grille — pas la peine de le demander pour une entreprise dont
        // l'onglet n'apparaît de toute façon pas.
        if (hasEcheances) calls.push(get('echeances'));
        const [s, st, t, d, ech] = await Promise.all(calls);
        if (cancelled) return;
        setSummary(s); setStatement(st); setTasks(t); setDeliverables(d);
        if (hasEcheances) setEcheances(ech);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Erreur de chargement.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, get, hasEcheances]);

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
          <NotificationBell onNavigate={section => setTab(PORTAL_NAV_TO_TAB[section] || 'messages')} />
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
          {visibleTabs.map(t => {
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
              {/* Situation financière — visible sur les onglets de suivi qui en
                  parlent, c'est la question que le client se pose en
                  arrivant ; absente sur Échéances, qui ne porte aucun
                  montant, et sur Rapport mensuel, qui porte les siennes
                  propres (bornées au mois, pas au solde global). */}
              {summary && tab !== 'echeances' && tab !== 'report' && tab !== 'bankStatement' && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard label="Solde antérieur" value={formatCostTND(summary.soldeAnterieur)} />
                  <StatCard label="Total facturé" value={formatCostTND(summary.montantFacture)} />
                  <StatCard label="Total encaissé" value={formatCostTND(summary.totalEncaisse)} tone="good" />
                  <StatCard label="Solde à payer" value={formatCostTND(summary.soldeGlobal)} tone={summary.soldeGlobal > 0 ? 'due' : 'good'} strong />
                </div>
              )}

              {invoiceError && (
                <p className="text-[12.5px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{invoiceError}</p>
              )}

              {tab === 'statement' && (
                <StatementView statement={statement} onOpenInvoice={setOpenInvoiceId} onOpenReglement={setOpenReglement} />
              )}
              {tab === 'tasks' && <TasksView tasks={tasks} />}
              {tab === 'deliverables' && <DeliverablesView deliverables={deliverables} />}
              {tab === 'echeances' && <EcheancesView data={echeances} />}
              {tab === 'report' && <ReportView report={report} loading={reportLoading} error={reportError} />}
              {tab === 'bankStatement' && (
                <BankStatementView
                  lines={bankLines} loading={bankLoading} error={bankError}
                  canManage={isImpersonating}
                  onJustifSaved={(id, justif, statut) => setBankLines(prev => prev
                    ? prev.map(l => l.id === id ? { ...l, justif, statut } : l) : prev)}
                  onLineSaved={line => setBankLines(prev => {
                    if (!prev) return [line];
                    const exists = prev.some(l => l.id === line.id);
                    return exists ? prev.map(l => l.id === line.id ? line : l) : [...prev, line];
                  })}
                  onLineDeleted={id => setBankLines(prev => prev ? prev.filter(l => l.id !== id) : prev)}
                  onLinesDeleted={ids => setBankLines(prev => prev ? prev.filter(l => !ids.includes(l.id)) : prev)}
                  onLinesImported={lines => setBankLines(prev => [...(prev || []), ...lines])}
                />
              )}
            </>
          )}
        </main>
      </div>

      {openInvoice && (
        <InvoicePreview
          invoice={openInvoice}
          onClose={() => setOpenInvoiceId(null)}
          companyEndpoint="/api/portal/company"
        />
      )}

      {openReglement && (
        <ReglementDetailModal reglement={openReglement} onClose={() => setOpenReglement(null)} />
      )}
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

/** Une ligne cliquable ouvre soit une facture, soit le détail d'un règlement — jamais les deux. */
const lineClickHandler = (
  l: StatementLine,
  onOpenInvoice: (id: string) => void,
  onOpenReglement: (l: StatementLine) => void,
): (() => void) | undefined => {
  if (l.kind === 'FACTURE' && l.id) return () => onOpenInvoice(l.id!);
  if (l.kind === 'ENCAISSEMENT' && l.id) return () => onOpenReglement(l);
  return undefined;
};

/** Relevé de compte : une ligne par facture ou règlement, avec le solde qui court. */
const StatementView: React.FC<{
  statement: { soldeAnterieur: number; lines: StatementLine[]; soldeGlobal: number } | null;
  onOpenInvoice: (id: string) => void;
  onOpenReglement: (l: StatementLine) => void;
}> = ({ statement, onOpenInvoice, onOpenReglement }) => {
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
            ) : statement.lines.map((l, i) => {
              const onClick = lineClickHandler(l, onOpenInvoice, onOpenReglement);
              return (
              <tr
                key={i}
                onClick={onClick}
                className={`hover:bg-gray-50 ${onClick ? 'cursor-pointer' : ''}`}
              >
                <td className="px-5 py-2.5 whitespace-nowrap text-gray-700">{fdate(l.date)}</td>
                <td className="px-5 py-2.5">
                  <span className={onClick ? 'text-navy font-medium hover:underline' : 'text-gray-900'}>{l.label}</span>
                  {l.paymentMethod && <span className="ml-2 text-[11px] text-gray-400">{paymentModeLabel(l.paymentMethod)}</span>}
                  {l.kind === 'FACTURE' && l.dueDate && (
                    <span className="ml-2 text-[11px] text-gray-400">échéance {fdate(l.dueDate)}</span>
                  )}
                </td>
                <td className="px-5 py-2.5 text-right font-mono text-gray-900">{l.debit ? formatCostTND(l.debit) : '—'}</td>
                <td className="px-5 py-2.5 text-right font-mono text-emerald-700">{l.credit ? formatCostTND(l.credit) : '—'}</td>
                <td className="px-5 py-2.5 text-right font-mono font-semibold text-gray-900">{formatCostTND(l.solde)}</td>
              </tr>
              );
            })}
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
        ) : statement.lines.map((l, i) => {
          const onClick = lineClickHandler(l, onOpenInvoice, onOpenReglement);
          return (
          <div
            key={i}
            onClick={onClick}
            className={`border border-gray-200 rounded-lg p-3 ${onClick ? 'cursor-pointer' : ''}`}
          >
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <span className={`text-[13px] font-semibold truncate ${onClick ? 'text-navy' : 'text-gray-900'}`}>{l.label}</span>
              <span className="text-[12px] text-gray-500 shrink-0">{fdate(l.date)}</span>
            </div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className={l.credit ? 'text-emerald-700' : 'text-gray-700'}>
                {l.credit ? `Réglé ${formatCostTND(l.credit)}` : `Facturé ${formatCostTND(l.debit)}`}
              </span>
              <span className="font-mono font-semibold text-gray-900">{formatCostTND(l.solde)}</span>
            </div>
          </div>
          );
        })}
        <div className="flex justify-between text-[13px] font-bold px-1 pt-2 border-t border-gray-200">
          <span>Solde à payer</span>
          <span className="font-mono">{formatCostTND(statement.soldeGlobal)}</span>
        </div>
      </div>
    </div>
  );
};

/**
 * Détail d'un règlement, ouvert depuis une ligne ENCAISSEMENT du relevé —
 * les mêmes champs que Règlements clients côté Cash (objet, mode, compte
 * bancaire, référence, montant), pas de round-trip réseau puisque
 * `/api/portal/statement` les porte déjà tous dans la ligne.
 */
const ReglementDetailModal: React.FC<{ reglement: StatementLine; onClose: () => void }> = ({ reglement, onClose }) => {
  useEscapeToClose(onClose);
  const cash = isCashMode(reglement.paymentMethod);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <Wallet className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-[14px] font-bold text-gray-900">Règlement reçu</h2>
              <p className="text-[11.5px] text-gray-500">{fdate(reglement.date)}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3 text-[13px]">
          <Row label="Objet du règlement" value={reglement.label} />
          <Row label="Mode de règlement" value={paymentModeLabel(reglement.paymentMethod) || 'Espèce'} />
          {!cash && <Row label="Compte bancaire" value={reglement.bankAccount || '—'} />}
          <Row label="Référence" value={reglement.reference || '—'} />
          <div className="flex justify-between items-center pt-3 border-t border-gray-100">
            <span className="text-gray-500 font-medium">Montant</span>
            <span className="font-mono font-bold text-[16px] text-emerald-700">{formatCostTND(reglement.credit)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-3">
    <span className="text-gray-500 shrink-0">{label}</span>
    <span className="text-gray-900 font-medium text-right truncate">{value}</span>
  </div>
);

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

/**
 * Échéances — la même grille que le back-office (`EcheancesGrid.tsx`), mais
 * réduite à ce qu'un client a besoin d'en voir : son propre calendrier, en
 * lecture seule (pas de menu, pas de crayon/poubelle — poser une valeur ou
 * gérer le vocabulaire reste `MANAGE_RESOURCES`, réservé au cabinet). C'est
 * le format « Calendrier par client » de l'écran admin, sans la recherche
 * puisque le client n'a qu'un seul dossier à regarder : le sien.
 */
const EcheancesView: React.FC<{ data: EcheanceData | null }> = ({ data }) => {
  const years = useMemo(() => {
    const s = new Set<number>((data?.columns || []).map(c => c.year));
    s.add(new Date().getFullYear());
    return Array.from(s).sort((a, b) => b - a);
  }, [data]);
  const [year, setYear] = useState(() => new Date().getFullYear());

  if (!data) return null;

  const yearColumns = data.columns.filter(c => c.year === year).sort((a, b) => a.sortOrder - b.sortOrder);
  const monthGroups: { month: number; cols: EcheanceColumn[] }[] = [];
  for (const c of yearColumns) {
    const g = monthGroups.find(g => g.month === c.month);
    if (g) g.cols.push(c); else monthGroups.push({ month: c.month, cols: [c] });
  }
  const cellByColumn = new Map<string, EcheanceStatusCell>(data.statuses.map(s => [s.columnId, s]));
  const styleFor = (status: string | null) => {
    if (!status) return ECHEANCE_EMPTY_STYLE;
    const opt = data.statusOptions.find(o => o.label === status);
    return ECHEANCE_COLOR_TOKENS[opt?.color || 'gray'] ?? ECHEANCE_COLOR_TOKENS.gray;
  };
  /** Same "N°… · … DT" second line as the admin grid — read-only here, the portal never writes échéances. */
  const detailLine = (cell: EcheanceStatusCell | undefined) => {
    if (!cell || (!cell.quittanceNumber && cell.montant == null)) return '';
    const parts: string[] = [];
    if (cell.quittanceNumber) parts.push(`N°${cell.quittanceNumber}`);
    if (cell.montant != null) parts.push(`${Number(cell.montant).toLocaleString('fr-FR')} DT`);
    return parts.join(' · ');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-white border border-gray-200 rounded-xl px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">Échéances</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">Le suivi mensuel de vos échéances fiscales et sociales.</p>
        </div>
        {years.length > 1 && (
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-gray-700"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>

      {monthGroups.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl"><Empty>Aucune échéance définie pour {year}.</Empty></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {monthGroups.map(g => (
            <div key={g.month} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-3.5 py-2 bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                {MONTH_NAMES[g.month - 1]}
              </div>
              <div>
                {g.cols.map(col => {
                  const cell = cellByColumn.get(col.id);
                  const status = cell?.status ?? null;
                  const style = styleFor(status);
                  const detail = detailLine(cell);
                  return (
                    <div key={col.id} className="flex items-stretch justify-between gap-0 border-t border-gray-200">
                      <span className="flex-1 min-w-0 truncate text-[12.5px] text-gray-700 px-3.5 py-2 border-r border-gray-200">{col.label}</span>
                      <span className={`shrink-0 flex flex-col items-end justify-center px-2.5 py-1 text-[10.5px] font-semibold ${style.bg} ${style.fg}`}>
                        <span>{status || 'Vide'}</span>
                        {detail && <span className="text-[9px] font-normal opacity-80">{detail}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Rapport mensuel — toujours le mois civil précédent, calculé à la demande
 * par `/api/portal/report`. Trois blocs, les mêmes questions que le tableau
 * de bord Direction (finances du mois, missions affectées, l'activité du
 * dossier), jamais de coût employeur ni de performance de collaborateur —
 * ce que le serveur envoie ne porte déjà aucun des deux. Le PDF est le seul
 * format de restitution ; l'écran n'en est qu'un aperçu synthétique avant le
 * téléchargement.
 *
 * Les titres « Où est l'argent ? » et « Où part le temps ? » — repris du
 * tableau de bord Direction dans la première version — ont été retirés à la
 * demande de l'utilisateur : le premier a disparu (les trois chiffres du
 * bloc financier n'ont plus d'intitulé de section, seulement leurs propres
 * libellés de carte), le second est devenu « Missions affectés ».
 */
const ReportView: React.FC<{ report: ClientReport | null; loading: boolean; error: string }> = ({ report, loading, error }) => {
  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl py-16 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl">
        <Empty>{error}</Empty>
      </div>
    );
  }
  if (!report) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-gray-200 rounded-xl px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">Rapport mensuel — {report.period.label}</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">Finances, missions affectées et activité du dossier sur le mois écoulé.</p>
        </div>
        <button
          onClick={() => downloadClientReportPdf(report)}
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-navy text-white text-[13px] font-medium rounded-lg hover:bg-navy-hover transition-colors"
        >
          <Download className="w-4 h-4" /> Télécharger le PDF
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Honoraires facturés" value={formatCostTND(report.finance.honoraires)} />
        <StatCard label="Encaissements" value={formatCostTND(report.finance.encaisse)} tone="good" />
        <StatCard label="Solde net du mois" value={formatCostTND(report.finance.soldeNet)} tone={report.finance.soldeNet > 0 ? 'due' : 'good'} strong />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100">
          <h3 className="text-[14px] font-semibold text-gray-900">Missions affectés</h3>
        </div>
        {report.missions.length === 0 ? (
          <Empty>Aucune activité enregistrée sur ce mois.</Empty>
        ) : (
          <ul className="divide-y divide-gray-100">
            {report.missions.map(m => (
              <li key={m.pole} className="px-4 sm:px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13.5px] font-medium text-gray-900">{m.pole}</span>
                  <span className="text-[12.5px] text-gray-500 shrink-0">{m.taches} tâche(s) · {m.heures.toFixed(1)} h</span>
                </div>
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {m.types.map(t => (
                    <li key={t.name} className="flex items-center justify-between gap-3 text-[12px] text-gray-500 pl-3">
                      <span>{t.name}</span>
                      <span className="shrink-0">{t.taches} · {t.heures.toFixed(1)} h</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100">
          <h3 className="text-[14px] font-semibold text-gray-900">Activité du dossier</h3>
        </div>
        {report.activites.length === 0 ? (
          <Empty>Aucune tâche terminée sur ce mois.</Empty>
        ) : (
          <ul className="divide-y divide-gray-100">
            {report.activites.map((a, i) => (
              <li key={i} className="px-4 sm:px-5 py-2.5 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-gray-900">{[a.mission, a.typeTache].filter(Boolean).join(' · ') || '—'}</p>
                  {a.responsable && <p className="text-[11.5px] text-gray-500">{a.responsable}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0 text-[12px] text-gray-500">
                  <span>{a.date}</span>
                  <span className="font-mono">{a.dureeFormatted}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const BANK_MONTH_NAMES = MONTH_NAMES;
const bankYearOf = (iso: string) => Number(String(iso || '').slice(0, 4)) || 0;
const bankMonthOf = (iso: string) => Number(String(iso || '').slice(5, 7)) || 0;
/**
 * `bankYearOf`/`bankMonthOf` slice fixed character positions assuming an
 * ISO `YYYY-MM-DD` string — correct for anything `parseBankDateToIso`
 * actually recognised, but that function falls back to returning the raw
 * text unchanged for a date it couldn't parse (see its own comment). Slicing
 * arbitrary text at those positions can yield a non-zero, truthy, but
 * out-of-range "month" (14, 67…) — truthy was the only check this used to
 * make, and `BANK_MONTH_NAMES[m - 1]` for such a value is `undefined`,
 * which crashed the whole portal page on `.charAt(0)`. A date only counts
 * as known when its month actually falls in 1-12.
 */
const isValidBankMonth = (m: number) => m >= 1 && m <= 12;

/**
 * Relevé bancaire — un vrai client lit toutes les colonnes mais n'en modifie
 * qu'une : « Justif ». `JustifCell` sauvegarde au blur (une seule valeur à
 * confirmer ne justifie pas un mode édition avec boutons Enregistrer/
 * Annuler comme le reste de l'app) et redescend le `statut` recalculé par
 * le serveur plutôt que de le dériver ici — une seconde implémentation de
 * la même règle pourrait un jour diverger de celle du serveur.
 *
 * Un administrateur en « Espace client » (voir CLAUDE.md « Relevé
 * bancaire ») en fait plus : créer, corriger n'importe quel champ, supprimer
 * et importer un relevé Excel — `canManage` (= `isImpersonating`) bascule
 * entre les deux, le serveur appliquant la même frontière de son côté.
 */
const JustifCell: React.FC<{ line: BankLine; onSaved: (id: string, justif: string, statut: 'OK' | 'SANS_JUSTIF') => void }> = ({ line, onSaved }) => {
  const { token } = useAuth();
  const [value, setValue] = useState(line.justif || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (value === (line.justif || '')) return;
    setSaving(true);
    setErr('');
    try {
      const res = await fetch(`/api/portal/bank-statement/${line.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ justif: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible.');
      onSaved(line.id, data.justif ?? value, data.statut);
    } catch (e: any) {
      setErr(e.message || 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-w-[160px]">
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        disabled={saving}
        placeholder="Ajouter un justificatif…"
        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-[12.5px] focus:outline-none focus:border-navy disabled:opacity-60"
      />
      {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
    </div>
  );
};

interface BankLineDraft { date: string; libelle: string; dateValeur: string; debit: string; credit: string; justif: string; banque: string }

const emptyBankDraft = (): BankLineDraft => ({ date: '', libelle: '', dateValeur: '', debit: '', credit: '', justif: '', banque: '' });
const draftFromLine = (l: BankLine): BankLineDraft => ({
  date: l.date || '', libelle: l.libelle || '', dateValeur: l.dateValeur || '',
  debit: l.debit ? String(l.debit) : '', credit: l.credit ? String(l.credit) : '', justif: l.justif || '', banque: l.banque || '',
});

/** Ligne éditable — création (`lineId` absent) ou correction complète d'une
 *  ligne existante, réservée à une session élevée. Même teinte turquoise que
 *  les éditeurs de ligne de Cash (Brouillard de caisse, Règlements clients) :
 *  une cellule blanche de plus dans un tableau déjà blanc ne se lit pas comme
 *  éditable. */
const BankLineEditRow: React.FC<{
  initial: BankLineDraft;
  lineId?: string;
  onSaved: (line: BankLine) => void;
  onCancel: () => void;
}> = ({ initial, lineId, onSaved, onCancel }) => {
  const { token } = useAuth();
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const field = (k: keyof BankLineDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft(d => ({ ...d, [k]: e.target.value }));

  const inputCls = 'w-full px-2 py-1.5 border border-turquoise/30 rounded-lg text-[12.5px] bg-turquoise/10 focus:outline-none focus:border-navy';

  const save = async () => {
    if (!draft.date || !draft.libelle.trim()) { setErr('Date et libellé sont obligatoires.'); return; }
    setSaving(true);
    setErr('');
    try {
      const body = {
        date: draft.date, libelle: draft.libelle, dateValeur: draft.dateValeur,
        debit: Number(draft.debit) || 0, credit: Number(draft.credit) || 0, justif: draft.justif, banque: draft.banque,
      };
      const res = await fetch(lineId ? `/api/portal/bank-statement/${lineId}` : '/api/portal/bank-statement', {
        method: lineId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible.');
      onSaved(data);
    } catch (e: any) {
      setErr(e.message || 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="border-b border-gray-100">
      <td className="px-3 py-2"><input type="date" value={draft.date} onChange={field('date')} className={inputCls} /></td>
      <td className="px-3 py-2"><input value={draft.banque} onChange={field('banque')} placeholder="Banque" className={inputCls} /></td>
      <td className="px-3 py-2"><input value={draft.libelle} onChange={field('libelle')} placeholder="Libellé de l'opération" className={inputCls} /></td>
      <td className="px-3 py-2"><input type="date" value={draft.dateValeur} onChange={field('dateValeur')} className={inputCls} /></td>
      <td className="px-3 py-2"><input value={draft.debit} onChange={field('debit')} placeholder="0,000" className={`${inputCls} text-right`} /></td>
      <td className="px-3 py-2"><input value={draft.credit} onChange={field('credit')} placeholder="0,000" className={`${inputCls} text-right`} /></td>
      <td className="px-3 py-2"><input value={draft.justif} onChange={field('justif')} placeholder="Justificatif" className={inputCls} /></td>
      <td className="px-3 py-2 text-gray-300 text-[11px]">—</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button onClick={save} disabled={saving} title="Enregistrer"
            className="p-1.5 rounded-lg bg-navy text-white hover:bg-navy-hover disabled:opacity-60">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onCancel} disabled={saving} title="Annuler"
            className="p-1.5 rounded-lg bg-gray-100 border border-gray-300 hover:bg-gray-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {err && <p className="text-[11px] text-red-600 mt-1 whitespace-normal max-w-[160px]">{err}</p>}
      </td>
    </tr>
  );
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Jour 0 d'Excel (30/12/1899 — le décalage qui compense le faux 29 février
 *  1900 qu'Excel modélise) : une colonne de date dont le format numérique
 *  n'est pas reconnu comme tel par le classeur source ressort de SheetJS en
 *  simple nombre de série plutôt qu'en texte formaté, même avec `raw: false`
 *  — `raw: false` ne reformate que ce que le classeur a lui-même marqué
 *  comme une date. */
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);

/**
 * Un relevé bancaire réel ne tient à aucun format unique : `DD/MM/YYYY`,
 * `DD-MM-YYYY`, `DD.MM.YYYY`, une année sur deux chiffres, une heure
 * accolée (« 15/01/2026 00:00:00 »), ou un nombre de série Excel brut quand
 * la colonne n'est pas typée Date dans le fichier source — tous rencontrés
 * en pratique, d'où une ligne qui atterrissait sous « Date inconnue » sans
 * que rien n'explique pourquoi. Le seul format volontairement **non**
 * couvert est `MM/DD/YYYY` (anglo-saxon) : sur une plage 1-12/1-12 il est
 * indiscernable du format français, et le prendre en charge romprait
 * silencieusement l'autre.
 */
const parseBankDateToIso = (raw: any): string => {
  if (raw === null || raw === undefined) return '';

  // Numérique brut (type number, ou chaîne purement numérique renvoyée pour
  // une cellule que le classeur ne marque pas comme une date) — plage
  // 1954-2064, largement au-delà de ce qu'un relevé bancaire peut porter.
  const asNumericSerial = typeof raw === 'number' ? raw
    : (/^\d{4,6}(\.\d+)?$/.test(String(raw).trim()) ? Number(raw) : NaN);
  if (Number.isFinite(asNumericSerial) && asNumericSerial > 19700 && asNumericSerial < 60000) {
    const d = new Date(EXCEL_EPOCH_UTC_MS + Math.round(asNumericSerial) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  let s = String(raw).trim();
  if (!s) return '';
  // Une heure accolée ne change rien au jour civil — mais seule une heure
  // reconnaissable (chiffres et deux-points) est coupée : un « 15 Jan 2026 »
  // a aussi un espace, et le couper au premier espace aurait tronqué le mois
  // en toutes lettres plus bas.
  s = s.replace(/T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/, '').replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*$/, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) {
    const [, d, mo, yRaw] = m;
    const y = yRaw.length === 2 ? (Number(yRaw) > 50 ? `19${yRaw}` : `20${yRaw}`) : yRaw;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Dernier recours : un format avec un nom de mois en toutes lettres
  // (« 15 Jan 2026 », « Jan 15, 2026 ») — jamais tenté sur un format tout en
  // chiffres, où le navigateur résoudrait jour/mois à sa propre façon
  // plutôt qu'à la française.
  if (/[a-zA-ZéûîôâêÉÛÎÔÂÊ]/.test(s)) {
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
  }
  return s;
};

const BANK_HEADER_CANDIDATES = {
  date: ['date', "date de l'operation", 'date operation', 'date transaction', 'date txn'],
  libelle: ["libelle de l'operation", 'libelle operation', 'libelle', 'operation', 'description', 'intitule'],
  dateValeur: ['date de valeur', 'date valeur'],
  debit: ['debit'],
  credit: ['credit'],
  banque: ['banque', 'nom de la banque', 'nom banque', 'bank', 'etablissement', 'etablissement bancaire', 'banque emettrice'],
} as const;

/**
 * Lit la même structure que le modèle attaché (Date, Libellé de l'opération,
 * Date de valeur, Débit, Crédit) — le fichier est analysé entièrement dans le
 * navigateur (SheetJS, même idiome que l'import de clients), le serveur ne
 * voit jamais le fichier, seulement le tableau déjà mappé.
 */
async function parseBankStatementExcel(file: File) {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Le fichier ne contient aucune feuille.');
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(workbook.Sheets[sheetName], { defval: '', raw: false });
  if (raw.length === 0) throw new Error('La feuille est vide.');

  const keys = Object.keys(raw[0]);
  const keyFor = (candidates: readonly string[]) => keys.find(k => candidates.includes(fold(k)));
  const dateKey = keyFor(BANK_HEADER_CANDIDATES.date);
  const libelleKey = keyFor(BANK_HEADER_CANDIDATES.libelle);
  const dateValeurKey = keyFor(BANK_HEADER_CANDIDATES.dateValeur);
  const debitKey = keyFor(BANK_HEADER_CANDIDATES.debit);
  const creditKey = keyFor(BANK_HEADER_CANDIDATES.credit);
  const banqueKey = keyFor(BANK_HEADER_CANDIDATES.banque);
  if (!dateKey) throw new Error('Colonne « Date » introuvable dans le fichier.');

  const toNumber = (v: any): number => {
    const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  return raw
    .map(r => ({
      date: parseBankDateToIso(r[dateKey]),
      libelle: String(libelleKey ? r[libelleKey] : '').trim(),
      dateValeur: parseBankDateToIso(dateValeurKey ? r[dateValeurKey] : ''),
      debit: toNumber(debitKey ? r[debitKey] : ''),
      credit: toNumber(creditKey ? r[creditKey] : ''),
      banque: String(banqueKey ? r[banqueKey] : '').trim(),
    }))
    .filter(row => row.date); // une ligne sans date n'a rien d'une transaction
}

/**
 * Après l'import, combien de lignes n'ont ni date ni banque reconnues —
 * affiché tout de suite plutôt que découvert en dépliant un groupe
 * « Date inconnue »/« Banque non renseignée » au hasard. `bankYearOf` rend
 * 0 pour une date que `parseBankDateToIso` n'a pas su convertir — c'est ce
 * qui dit qu'un format du fichier source n'a pas été reconnu.
 */
const summarizeImportGaps = (rows: BankLine[]): string | null => {
  const noDate = rows.filter(r => !bankYearOf(r.date)).length;
  const noBank = rows.filter(r => !String(r.banque ?? '').trim()).length;
  if (!noDate && !noBank) return null;
  const parts: string[] = [];
  if (noDate) parts.push(`${noDate} ligne${noDate > 1 ? 's' : ''} avec une date non reconnue (vérifiez le format du fichier)`);
  if (noBank) parts.push(`${noBank} ligne${noBank > 1 ? 's' : ''} sans banque`);
  return parts.join(' · ');
};

/**
 * Un relevé exporté depuis une banque ne porte presque jamais sa propre
 * colonne « Banque » — c'est tout le fichier qui vient d'un seul compte.
 * Le champ « Banque » couvre ce cas courant : appliqué à toute ligne que le
 * fichier lui-même ne renseigne pas, jamais pour écraser une colonne
 * « Banque » réellement présente dans le classeur. Désormais **obligatoire**
 * avant même de pouvoir choisir un fichier — à la demande explicite : sans
 * lui, un import dont le fichier ne porte pas sa propre colonne Banque
 * atterrissait entièrement dans le compartiment « Banque non renseignée »,
 * et corriger après coup ligne par ligne est plus de travail que de la
 * saisir une fois avant d'importer.
 */
const ImportBankStatementButton: React.FC<{ onImported: (lines: BankLine[]) => void }> = ({ onImported }) => {
  const { token } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [bankFallback, setBankFallback] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [warning, setWarning] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setErr('');
    setWarning(null);
    try {
      const parsed = await parseBankStatementExcel(file);
      if (!parsed.length) throw new Error('Aucune ligne exploitable dans ce fichier.');
      const rows = parsed.map(r => ({ ...r, banque: r.banque || bankFallback.trim() }));
      const res = await fetch('/api/portal/bank-statement/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import impossible.');
      const imported: BankLine[] = data.rows || [];
      onImported(imported);
      setWarning(summarizeImportGaps(imported));
    } catch (e: any) {
      setErr(e.message || 'Import impossible.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const bankMissing = !bankFallback.trim();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input value={bankFallback} onChange={e => setBankFallback(e.target.value)} placeholder="Banque *"
          title="Nom de la banque — obligatoire avant d'importer"
          className="w-[170px] px-2.5 py-2 text-[12px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-gray-400" />
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        <button onClick={() => inputRef.current?.click()} disabled={busy || bankMissing}
          title={bankMissing ? 'Indiquez la banque avant d\'importer' : undefined}
          className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Importer Excel
        </button>
      </div>
      {bankMissing && (
        <p className="text-[11px] text-gray-400">Indiquez la banque avant d'importer.</p>
      )}
      {err && <p className="text-[11.5px] text-red-600 max-w-[320px]">{err}</p>}
      {warning && (
        <p className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 max-w-[320px]">{warning}</p>
      )}
    </div>
  );
};

interface BankMonthGroup {
  monthKey: string;
  label: string;
  lines: BankLine[];
  banks: { name: string; lines: BankLine[] }[];
}

/**
 * Mêmes colonnes que le tableau à l'écran, dans le même ordre — même règle
 * que partout ailleurs dans l'app (voir CLAUDE.md « Export CSV ») : ce que
 * `filtered` retient (le filtre année), pas la seule page affichée ni le
 * repli/dépli des groupes mois/banque, qui n'est qu'un état d'écran.
 * Ouvert au client comme à l'admin — exporter ce qu'on voit déjà n'est pas
 * une action de gestion.
 */
const BANK_STATEMENT_EXPORT_COLUMNS: CsvColumn<BankLine>[] = [
  { header: 'Date', value: l => fdate(l.date) },
  { header: 'Banque', value: l => l.banque || '' },
  { header: "Libellé de l'opération", value: l => l.libelle },
  { header: 'Date de valeur', value: l => (l.dateValeur ? fdate(l.dateValeur) : '') },
  { header: 'Débit', value: l => csvNumber(l.debit) },
  { header: 'Crédit', value: l => csvNumber(l.credit) },
  { header: 'Justif', value: l => l.justif || '' },
  { header: 'Statut', value: l => (l.statut === 'OK' ? 'OK' : 'Sans justif') },
];

/** « Sans banque » toujours en dernier, le reste par ordre alphabétique —
 *  une ligne créée avant ce champ, ou importée d'un relevé sans colonne
 *  Banque et sans « Banque (pour cet import) », n'a pas de quoi se classer
 *  ailleurs. */
const BANK_NO_NAME = '—';
const sortBankNames = (a: string, b: string) => {
  if (a === BANK_NO_NAME) return 1;
  if (b === BANK_NO_NAME) return -1;
  return a.localeCompare(b, 'fr');
};

const BankStatementView: React.FC<{
  lines: BankLine[] | null;
  loading: boolean;
  error: string;
  canManage: boolean;
  onJustifSaved: (id: string, justif: string, statut: 'OK' | 'SANS_JUSTIF') => void;
  onLineSaved: (line: BankLine) => void;
  onLineDeleted: (id: string) => void;
  onLinesDeleted: (ids: string[]) => void;
  onLinesImported: (lines: BankLine[]) => void;
}> = ({ lines, loading, error, canManage, onJustifSaved, onLineSaved, onLineDeleted, onLinesDeleted, onLinesImported }) => {
  const { token } = useAuth();
  const [year, setYear] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingMonth, setDeletingMonth] = useState<string | null>(null);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const didInitCollapse = useRef(false);

  const years = useMemo(() => {
    const set = new Set<number>((lines || []).map(l => bankYearOf(l.date)).filter(Boolean));
    set.add(new Date().getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [lines]);

  const filtered = useMemo(() => (lines || []).filter(l => !year || bankYearOf(l.date) === year), [lines, year]);

  /** Regroupé mois d'abord (le plus récent en tête, bascule pliée/dépliée),
   *  banque ensuite à l'intérieur de chaque mois — la banque est saisie par
   *  le cabinet, jamais par le client, voir CLAUDE.md « Relevé bancaire ». */
  const grouped = useMemo<BankMonthGroup[]>(() => {
    const byMonth = new Map<string, BankLine[]>();
    for (const l of filtered) {
      const y = bankYearOf(l.date), m = bankMonthOf(l.date);
      const key = y && isValidBankMonth(m) ? `${y}-${String(m).padStart(2, '0')}` : '0000-00';
      (byMonth.get(key) ?? byMonth.set(key, []).get(key)!).push(l);
    }
    return [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([monthKey, monthLines]) => {
        const [yStr, mStr] = monthKey.split('-');
        const y = Number(yStr), m = Number(mStr);
        const label = y && isValidBankMonth(m)
          ? `${BANK_MONTH_NAMES[m - 1].charAt(0).toUpperCase()}${BANK_MONTH_NAMES[m - 1].slice(1)} ${y}`
          : 'Date inconnue';
        const byBank = new Map<string, BankLine[]>();
        for (const l of monthLines) {
          const key = (l.banque || '').trim() || BANK_NO_NAME;
          (byBank.get(key) ?? byBank.set(key, []).get(key)!).push(l);
        }
        const banks = [...byBank.entries()].sort((a, b) => sortBankNames(a[0], b[0])).map(([name, bankLines]) => ({ name, lines: bankLines }));
        return { monthKey, label, lines: monthLines, banks };
      });
  }, [filtered]);

  // Le mois le plus récent s'ouvre déplié, les autres partent pliés — sinon
  // un relevé de plusieurs années s'afficherait d'un bloc. Posé une seule
  // fois, au premier chargement des lignes : un repli choisi par la suite ne
  // doit pas revenir au rechargement d'une ligne ailleurs dans la liste.
  useEffect(() => {
    if (didInitCollapse.current || grouped.length === 0) return;
    didInitCollapse.current = true;
    setCollapsedMonths(new Set(grouped.slice(1).map(g => g.monthKey)));
  }, [grouped]);

  const toggleMonth = (key: string) => setCollapsedMonths(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const deleteLine = async (id: string) => {
    if (!window.confirm('Supprimer cette ligne du relevé bancaire ?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/portal/bank-statement/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Suppression impossible.'); }
      onLineDeleted(id);
    } catch (e: any) {
      window.alert(e.message || 'Suppression impossible.');
    } finally {
      setDeletingId(null);
    }
  };

  /** Pendant en masse de `deleteLine`, pour le bouton « Supprimer le mois »
   *  du groupe — une seule confirmation, un seul appel réseau. */
  const deleteMonthGroup = async (group: BankMonthGroup) => {
    const n = group.lines.length;
    if (!window.confirm(`Supprimer les ${n} ligne${n > 1 ? 's' : ''} de ${group.label} ? Cette action est irréversible.`)) return;
    setDeletingMonth(group.monthKey);
    try {
      const [yStr, mStr] = group.monthKey.split('-');
      const params = group.monthKey === '0000-00' ? 'unknown=1' : `year=${yStr}&month=${mStr}`;
      const res = await fetch(`/api/portal/bank-statement/by-month?${params}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Suppression impossible.'); }
      onLinesDeleted(group.lines.map(l => l.id));
    } catch (e: any) {
      window.alert(e.message || 'Suppression impossible.');
    } finally {
      setDeletingMonth(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl py-16 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }
  if (error) {
    return <div className="bg-white border border-gray-200 rounded-xl"><Empty>{error}</Empty></div>;
  }

  const colSpan = canManage ? 9 : 8;

  const renderRow = (l: BankLine) => editingId === l.id ? (
    <BankLineEditRow key={l.id} initial={draftFromLine(l)} lineId={l.id} onCancel={() => setEditingId(null)}
      onSaved={line => { onLineSaved(line); setEditingId(null); }} />
  ) : (
    <tr key={l.id} className={`border-b border-gray-100 last:border-b-0 ${l.statut === 'SANS_JUSTIF' ? 'bg-amber-50/50' : 'bg-done-bg/40'}`}>
      <td className="px-3 py-2 text-gray-600">{fdate(l.date)}</td>
      <td className="px-3 py-2 text-gray-600">{l.banque || <span className="text-gray-300">—</span>}</td>
      <td className="px-3 py-2 text-gray-800">{l.libelle || <span className="text-gray-300">—</span>}</td>
      <td className="px-3 py-2 text-gray-600">{l.dateValeur ? fdate(l.dateValeur) : <span className="text-gray-300">—</span>}</td>
      <td className="px-3 py-2 text-right font-mono text-late-fg">{l.debit ? formatCostTND(l.debit) : ''}</td>
      <td className="px-3 py-2 text-right font-mono text-done-fg">{l.credit ? formatCostTND(l.credit) : ''}</td>
      <td className="px-3 py-2">
        {canManage ? (l.justif || <span className="text-gray-300">—</span>) : <JustifCell line={l} onSaved={onJustifSaved} />}
      </td>
      <td className="px-3 py-2">
        {l.statut === 'OK' ? (
          <span className="px-2 py-0.5 rounded-full bg-done-bg text-done-fg text-[11px] font-bold">OK</span>
        ) : (
          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold">Sans justif</span>
        )}
      </td>
      {canManage && (
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setEditingId(l.id); setCreating(false); }} title="Modifier"
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => deleteLine(l.id)} disabled={deletingId === l.id} title="Supprimer"
              className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 disabled:opacity-60">
              {deletingId === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </td>
      )}
    </tr>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="px-2.5 py-2 text-[12px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-gray-400">
            <option value={0}>Toutes les années</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <ExportButton
            fileName="releve-bancaire"
            columns={BANK_STATEMENT_EXPORT_COLUMNS}
            rows={filtered}
          />
        </div>
        {canManage && (
          <div className="flex items-start gap-2">
            <ImportBankStatementButton onImported={onLinesImported} />
            <button onClick={() => { setCreating(true); setEditingId(null); }}
              className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium bg-navy text-white rounded-lg hover:bg-navy-hover">
              <Plus className="w-3.5 h-3.5" /> Nouvelle ligne
            </button>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {filtered.length === 0 && !creating ? (
          <Empty>Aucune ligne pour cette période.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Date</th>
                  <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Banque</th>
                  <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Libellé de l'opération</th>
                  <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Date de valeur</th>
                  <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider text-right">Débit</th>
                  <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider text-right">Crédit</th>
                  <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Justif</th>
                  <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Statut</th>
                  {canManage && <th className="px-3 py-2.5 font-bold text-gray-500 uppercase text-[10.5px] tracking-wider">Actions</th>}
                </tr>
              </thead>
              {creating && (
                <tbody className="text-[12.5px]">
                  <BankLineEditRow initial={emptyBankDraft()} onCancel={() => setCreating(false)}
                    onSaved={line => { onLineSaved(line); setCreating(false); }} />
                </tbody>
              )}
              {grouped.map(group => {
                const isCollapsed = collapsedMonths.has(group.monthKey);
                return (
                  <tbody key={group.monthKey} className="text-[12.5px]">
                    <tr className="bg-gray-100 border-b border-gray-200 cursor-pointer hover:bg-gray-200/60 select-none"
                      onClick={() => toggleMonth(group.monthKey)}>
                      <td colSpan={colSpan} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-bold text-gray-700 text-[12.5px]">
                            {isCollapsed ? <ChevronRight className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                            {group.label}
                            <span className="text-gray-400 font-normal text-[11.5px]">· {group.lines.length} ligne{group.lines.length > 1 ? 's' : ''}</span>
                          </div>
                          {canManage && (
                            <button
                              onClick={e => { e.stopPropagation(); deleteMonthGroup(group); }}
                              disabled={deletingMonth === group.monthKey}
                              title="Supprimer toutes les lignes de ce mois"
                              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
                            >
                              {deletingMonth === group.monthKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                              Supprimer le mois
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {!isCollapsed && group.banks.map(bank => (
                      <React.Fragment key={bank.name}>
                        <tr className="bg-gray-50/80 border-b border-gray-100">
                          <td colSpan={colSpan} className="px-3 py-1.5">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                              <Building2 className="w-3 h-3" />
                              {bank.name === BANK_NO_NAME ? 'Banque non renseignée' : bank.name}
                            </div>
                          </td>
                        </tr>
                        {bank.lines.map(renderRow)}
                      </React.Fragment>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
