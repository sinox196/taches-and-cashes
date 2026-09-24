import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Search, HelpCircle, Headphones, MessageCircle, Sparkles, Video, Download,
  ChevronDown, BookOpen, Mail, Clock, Users, LayoutDashboard, Building2, Timer,
  ListChecks, Wallet, CalendarCheck, FolderKanban, MessageSquare, Gift, Globe,
  FileText, ArrowRight, CornerDownLeft, X, Maximize2,
} from 'lucide-react';
import { Reveal } from './Reveal';

/**
 * La page Support.
 *
 * Elle tient dans son propre fichier plutôt que dans `Landing.tsx` comme les
 * vues Tarifs et À propos : contrairement à elles, celle-ci porte un vrai
 * comportement — une recherche qui répond à la frappe, deux accordéons, un
 * filtre, des raccourcis clavier — et la page d'accueil fait déjà 1 500 lignes.
 *
 * Le parti pris : **la barre de recherche est l'interface**, pas un ornement
 * posé au-dessus d'une page statique. Taper ouvre les réponses là où on a
 * tapé ; le reste de la page est ce qu'on parcourt quand on préfère naviguer
 * que demander.
 *
 * Doctrine de mouvement, en deux règles :
 *  - **un seul mouvement ambiant** — les ondes du casque, qui disent que
 *    quelqu'un écoute. Rien d'autre ne bouge tout seul ;
 *  - **tout le reste répond à un geste** : le panneau s'ouvre, une ligne se
 *    déplie, une puce filtre, une réponse trouvée pulse. Aucune entrée au
 *    défilement n'est ajoutée — `Reveal` en porte déjà pour les sections.
 */

/** Un repli d'accents **caractère par caractère** : 'é' donne 'e', une lettre
 *  pour une lettre, donc les index de la chaîne repliée valent aussi pour la
 *  chaîne d'origine. C'est ce qui permet de surligner « déclaration » quand on
 *  a tapé « declaration » sans décaler la découpe d'un cran. */
const foldChar = (c: string) => {
  const f = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return f.length === 1 ? f : (f[0] || c.toLowerCase());
};
const fold = (s: string) => Array.from(s).map(foldChar).join('');

/** Les cinq moments du travail d'un cabinet, dans leur ordre naturel — c'est
 *  aussi l'ordre des chapitres du guide. Des groupes réels, donc, pas des
 *  étiquettes posées pour meubler une barre de filtres. */
const GROUPS = [
  { id: 'demarrer', label: 'Démarrer' },
  { id: 'piloter', label: 'Piloter' },
  { id: 'produire', label: 'Produire' },
  { id: 'encaisser', label: 'Encaisser' },
  { id: 'administrer', label: 'Administrer' },
] as const;

type GroupId = typeof GROUPS[number]['id'];

/**
 * Chaque entrée reprend un chapitre réel du guide utilisateur (téléchargeable
 * plus bas), condensé en ce qu'il faut pour répondre vite plutôt qu'en la
 * marche à suivre complète du document. Du contenu vérifiable uniquement :
 * rien ici ne promet une fonction que l'application n'a pas.
 */
const GUIDE_CHAPTERS: {
  id: string; title: string; summary: string; group: GroupId;
  icon: React.ReactNode;
  /** Capture réelle de l'écran concerné (public/support). Optionnelle : un
   *  chapitre sans capture s'affiche simplement sans. */
  shot?: string;
}[] = [
  {
    id: 'compte',
    shot: '/support/compte.webp',
    title: 'Créer un compte & se connecter',
    group: 'demarrer',
    summary: "Choisissez une offre (Freelancer, gratuite, ou Complet) depuis la page Tarifs, avec ou sans code de parrainage, puis validez le formulaire. L'essai est gratuit et sans carte bancaire — Freelancer, elle, est active immédiatement. La connexion se fait ensuite avec votre identifiant et votre mot de passe.",
    icon: <Users className="w-[18px] h-[18px]" />,
  },
  {
    id: 'dashboard',
    shot: '/support/dashboard.webp',
    title: 'Tableau de bord',
    group: 'piloter',
    summary: "Le bandeau exécutif affiche vos indicateurs clés — marge sur temps, honoraires, coût employeur — filtrables par période, collaborateur ou client. Vous y retrouvez aussi les alertes qui demandent une décision, la rentabilité par client et un résumé rédigé par IA à la demande.",
    icon: <LayoutDashboard className="w-[18px] h-[18px]" />,
  },
  {
    id: 'clients',
    shot: '/support/clients.webp',
    title: 'Clients',
    group: 'piloter',
    summary: "La fiche client centralise coordonnées, facturation, échéances et encaissements. Ajoutez des colonnes personnalisées, importez votre fichier clients en masse depuis un tableur, ou ouvrez l'espace d'un client sans jamais avoir besoin de son mot de passe.",
    icon: <Building2 className="w-[18px] h-[18px]" />,
  },
  {
    id: 'portail',
    shot: '/support/portail.webp',
    title: 'Portail client',
    group: 'piloter',
    summary: "Vos clients consultent leur avancement, leurs échéances, leurs factures et un rapport mensuel — jamais le détail du temps passé ni le coût employeur, qui restent internes au cabinet.",
    icon: <Globe className="w-[18px] h-[18px]" />,
  },
  {
    id: 'pointage',
    shot: '/support/pointage.webp',
    title: 'Gestion des tâches (Pointage)',
    group: 'produire',
    summary: "Choisissez un client puis une mission pour démarrer un chronomètre — le type de tâche s'affiche automatiquement. Un seul chronomètre tourne à la fois par personne ; une tâche se planifie pour plus tard ou se délègue à un collègue.",
    icon: <Timer className="w-[18px] h-[18px]" />,
  },
  {
    id: 'missions',
    shot: '/support/missions.webp',
    title: 'Missions et types de tâches',
    group: 'produire',
    summary: "Une mission (ex. Comptabilité) regroupe des types de tâches (ex. Saisie, Déclaration). Ce catalogue alimente le formulaire de pointage et permet de voir, mission par mission, où va le temps de l'équipe.",
    icon: <ListChecks className="w-[18px] h-[18px]" />,
  },
  {
    id: 'outils',
    shot: '/support/outils.webp',
    title: 'Outils de travail',
    group: 'produire',
    summary: "Affectez des modèles de documents (procédures, checklists) à vos clients et suivez leur avancement point par point. Retrouvez vos liens utiles et la grille annuelle des échéances fiscales et sociales.",
    icon: <FolderKanban className="w-[18px] h-[18px]" />,
  },
  {
    id: 'messagerie',
    shot: '/support/messagerie.webp',
    title: 'Messagerie',
    group: 'produire',
    summary: "Échangez des messages directs ou en groupe avec vos collègues. Un compte client du portail n'a jamais accès aux conversations internes du cabinet — la confidentialité est garantie par construction.",
    icon: <MessageSquare className="w-[18px] h-[18px]" />,
  },
  {
    id: 'cash',
    shot: '/support/cash.webp',
    title: 'Facturation & Trésorerie (Cash)',
    group: 'encaisser',
    summary: "Créez vos factures avec calcul automatique de la TVA, de la retenue à la source et du timbre fiscal. Suivez les règlements de vos clients et tenez votre brouillard de caisse au jour le jour, solde recalculé à chaque mouvement.",
    icon: <Wallet className="w-[18px] h-[18px]" />,
  },
  {
    id: 'grh',
    shot: '/support/grh.webp',
    title: 'GRH & Paie',
    group: 'administrer',
    summary: "Pointez les présences, traitez les demandes de congés et d'autorisations d'absence, suivez les prêts et avances au personnel, et générez les bulletins de paie mensuels avec IRPP, CNSS et retenues calculés automatiquement.",
    icon: <CalendarCheck className="w-[18px] h-[18px]" />,
  },
  {
    id: 'equipe',
    shot: '/support/equipe.webp',
    title: 'Équipe & utilisateurs',
    group: 'administrer',
    summary: "Créez des comptes pour vos collaborateurs, attribuez-leur un rôle (Administrateur, Superviseur, Collaborateur, Stagiaire) et affinez leurs permissions une par une, selon ce qu'ils doivent pouvoir voir ou modifier.",
    icon: <Users className="w-[18px] h-[18px]" />,
  },
  {
    id: 'parrainage',
    shot: '/support/parrainage.webp',
    title: 'Parrainage',
    group: 'administrer',
    summary: "Partagez votre code personnel : dès qu'un filleul souscrit, il profite de 10 % de remise sur son premier abonnement et vous recevez, vous, un mois offert sur le vôtre.",
    icon: <Gift className="w-[18px] h-[18px]" />,
  },
  {
    id: 'export',
    shot: '/support/export.webp',
    title: 'Export & notifications',
    group: 'administrer',
    summary: "Chaque tableau important — Clients, Pointage, RH, Cash… — s'exporte en un clic vers un fichier compatible Excel. La cloche en haut de l'écran centralise vos notifications : tâches assignées, décisions RH, nouveaux messages.",
    icon: <FileText className="w-[18px] h-[18px]" />,
  },
];

const FAQ_ITEMS: { id: string; q: string; a: string }[] = [
  {
    id: 'faq-compte',
    q: 'Comment créer un compte sur Tâches & Cash ?',
    a: "Depuis la page d'accueil, cliquez sur « Commencez gratuitement », choisissez une offre sur la page Tarifs (Freelancer, gratuite, ou Complet), précisez le nombre d'utilisateurs si besoin, puis validez le formulaire. Votre compte démarre en essai gratuit, sans carte bancaire — Freelancer est active immédiatement.",
  },
  {
    id: 'faq-chrono',
    q: 'Comment démarrer un chronomètre sur une tâche ?',
    a: "Sur l'écran Gestion des tâches, choisissez un client puis une mission — le type de tâche s'affiche automatiquement si la mission en a — et cliquez sur Démarrer. Le chronomètre reste visible sur toutes les pages via la carte flottante ; un seul peut tourner à la fois par utilisateur.",
  },
  {
    id: 'faq-facture',
    q: 'Comment générer une facture ?',
    a: "Depuis Facturation & Trésorerie → onglet Facturation, créez un nouveau document : choisissez le client, le mode de facturation (forfait ou détaillée) et le régime de TVA, puis enregistrez. Le numéro légal est attribué automatiquement au moment de l'émission.",
  },
  {
    id: 'faq-conges',
    q: 'Comment gérer les congés et les absences ?',
    a: "Depuis GRH & Paie, les onglets Congés et Autorisations d'absence permettent à un collaborateur de déposer une demande (dates, motif) ; elle part directement vers l'approbateur choisi, qui l'accepte ou la refuse. Le solde de congés se met à jour automatiquement.",
  },
  {
    id: 'faq-import',
    q: 'Comment importer mes clients en masse ?',
    a: "Depuis la page Clients, cliquez sur Importer et déposez votre fichier Excel ou CSV. Associez chaque colonne à un champ (nom, matricule fiscal…) avant de valider — les doublons sont détectés automatiquement par matricule fiscal.",
  },
  {
    id: 'faq-portail',
    q: 'Comment accéder au portail client ?',
    a: "Un client se connecte au portail avec ses propres identifiants, depuis le même écran que l'équipe. Pour lui ouvrir son espace sans connaître son mot de passe, ouvrez sa fiche dans Clients et cliquez sur « Espace client ».",
  },
  {
    id: 'faq-prix',
    q: 'Combien coûte Tâches & Cash ?',
    a: "Freelancer est gratuite pour un utilisateur seul, avec 10 documents de facturation inclus chaque mois. Complet ouvre tout le cabinet à plusieurs comptes, à partir de 15 DT/mois par utilisateur avec l'offre de lancement. Le détail est sur la page Tarifs.",
  },
  {
    id: 'faq-parrainage',
    q: 'Comment fonctionne le programme de parrainage ?',
    a: "Chaque collaborateur d'un abonnement actif a son propre code à partager. Quand un filleul souscrit, il obtient 10 % de remise sur son premier abonnement, et vous recevez un mois offert sur le vôtre.",
  },
  {
    id: 'faq-offre',
    q: "Puis-je changer d'offre en cours d'utilisation ?",
    a: "Oui — contactez notre équipe pour ajuster votre offre ou votre nombre d'utilisateurs. L'accès et le tarif sont mis à jour sans interruption de service.",
  },
  {
    id: 'faq-sauvegarde',
    q: 'Mes données sont-elles sauvegardées ?',
    a: "Oui. En production, Tâches & Cash s'appuie sur une base PostgreSQL avec sauvegardes gérées par la plateforme d'hébergement — vos écritures sont journalisées, sans risque de perte en cas d'incident.",
  },
];

const useReducedMotion = () => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
};

/** Surligne la portion réellement trouvée. `fold` étant lettre pour lettre,
 *  l'index trouvé dans la chaîne repliée découpe correctement l'originale,
 *  accents compris. */
const Highlight: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  if (!query) return <>{text}</>;
  const i = fold(text).indexOf(fold(query));
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-turquoise/25 text-navy rounded-[3px] px-[1px]">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
};

type Result =
  | { kind: 'guide'; id: string; title: string; sub: string }
  | { kind: 'faq'; id: string; title: string; sub: string };

interface SupportViewProps {
  contactEmail: string;
  contactPhone: string;
  whatsappUrl: string;
  guideHref: string;
}

export const SupportView: React.FC<SupportViewProps> = ({
  contactEmail, contactPhone, whatsappUrl, guideHref,
}) => {
  const reduced = useReducedMotion();

  const [query, setQuery] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [group, setGroup] = useState<GroupId | 'all'>('all');
  const [openChapters, setOpenChapters] = useState<Set<string>>(new Set());
  const [openFaq, setOpenFaq] = useState<Set<string>>(new Set());
  const [found, setFound] = useState<string | null>(null);
  const [helpful, setHelpful] = useState<Record<string, 'oui' | 'non'>>({});
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  /** La capture ouverte en grand. Une capture d'écran d'application se lit mal
   *  à 500px de large : la vignette sert à situer, l'agrandissement à lire. */
  const [zoom, setZoom] = useState<{ src: string; title: string } | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo<Result[]>(() => {
    const q = fold(query.trim());
    if (q.length < 2) return [];
    const guide: Result[] = GUIDE_CHAPTERS
      .filter(c => fold(c.title).includes(q) || fold(c.summary).includes(q))
      .slice(0, 4)
      .map(c => ({ kind: 'guide', id: c.id, title: c.title, sub: c.summary }));
    const faq: Result[] = FAQ_ITEMS
      .filter(f => fold(f.q).includes(q) || fold(f.a).includes(q))
      .slice(0, 4)
      .map(f => ({ kind: 'faq', id: f.id, title: f.q, sub: f.a }));
    return [...guide, ...faq];
  }, [query]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  /** Aller à une réponse : on la rend visible (un filtre actif la masquerait),
   *  on la déplie, on y défile, puis on la fait pulser — sans ce dernier point
   *  on est déposé au milieu d'une liste sans savoir quelle ligne répond. */
  const jumpTo = useCallback((kind: 'guide' | 'faq', id: string) => {
    setPanelOpen(false);
    if (kind === 'guide') {
      setGroup('all');
      setOpenChapters(prev => new Set(prev).add(id));
    } else {
      setOpenFaq(prev => new Set(prev).add(id));
    }
    setFound(id);
    window.setTimeout(() => {
      document.getElementById(`support-item-${id}`)?.scrollIntoView({
        behavior: reduced ? 'auto' : 'smooth',
        block: 'center',
      });
    }, 80);
    window.setTimeout(() => setFound(null), 2000);
  }, [reduced]);

  // « / » ramène à la recherche depuis n'importe où sur la page. C'est ce qui
  // remplace une deuxième barre collante sous l'en-tête : la recherche reste
  // joignable en permanence sans ajouter de chrome à l'écran.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reduced]);

  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!searchWrapRef.current?.contains(e.target as Node)) setPanelOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [panelOpen]);

  // Échap ferme l'agrandissement, et le défilement de la page est bloqué tant
  // qu'il est ouvert : défiler derrière une image plein écran ne mène nulle
  // part et fait perdre sa place.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoom(null); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [zoom]);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (query) { setQuery(''); setPanelOpen(false); } else inputRef.current?.blur();
      return;
    }
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setPanelOpen(true);
      setActiveIndex(i => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setPanelOpen(true);
      setActiveIndex(i => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[activeIndex];
      if (r) jumpTo(r.kind, r.id);
    }
  };

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    setter(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const visibleChapters = group === 'all'
    ? GUIDE_CHAPTERS
    : GUIDE_CHAPTERS.filter(c => c.group === group);

  const countFor = (g: GroupId) => GUIDE_CHAPTERS.filter(c => c.group === g).length;

  const onPointerMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    setParallax({
      x: (e.clientX - r.left - r.width / 2) / r.width,
      y: (e.clientY - r.top - r.height / 2) / r.height,
    });
  };

  const guideResults = results.filter(r => r.kind === 'guide');
  const faqResults = results.filter(r => r.kind === 'faq');
  const showPanel = panelOpen && query.trim().length >= 2;

  return (
    <>
      {/* HERO — une surface de travail, pas une bannière : la barre occupe le
          centre optique et répond sur place. Pas d'`overflow-hidden` ici, le
          panneau de résultats en déborde volontairement. */}
      <section className="support-intro support-redesign-intro pt-[88px] px-6 sm:px-10 pb-16 bg-[linear-gradient(180deg,#FBFCFD_0%,#F2F4F7_100%)]">
        <div className="max-w-[1200px] mx-auto flex gap-14 items-center flex-wrap">
          <div style={{ flex: '1 1 480px', minWidth: 0 }} className="relative z-20">
            <Reveal>
              <div className="inline-flex px-3.5 py-1.5 bg-white border border-[#E6E9EE] rounded-full text-[12px] font-bold tracking-[0.06em] uppercase text-[#00857C]">Centre d'assistance</div>
            </Reveal>
            <Reveal delay={80}>
              <h1 className="mt-[18px] text-[34px] sm:text-[42px] font-extrabold text-navy tracking-[-0.02em] leading-[1.15]">
                Comment pouvons-nous vous aider ?
              </h1>
            </Reveal>
            <Reveal delay={150}>
              <p className="mt-[18px] text-[16.5px] text-[#5B6472] leading-[1.6] max-w-[480px]">
                Posez votre question ici : les réponses du guide et de la FAQ s'affichent au fur et à mesure que vous tapez.
              </p>
            </Reveal>

            <Reveal delay={210}>
              <div ref={searchWrapRef} className="mt-8 relative max-w-[520px]">
                <Search className={`absolute left-4 top-[19px] w-[18px] h-[18px] transition-colors ${showPanel ? 'text-turquoise' : 'text-[#8A93A0]'}`} />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setPanelOpen(true); }}
                  onFocus={() => setPanelOpen(true)}
                  onKeyDown={onSearchKeyDown}
                  placeholder="Une facture, un congé, un chronomètre…"
                  aria-label="Rechercher dans l'aide"
                  className={`w-full pl-11 pr-11 py-4 rounded-2xl border bg-white text-[17px] text-navy placeholder:text-[#8A93A0] placeholder:text-[15.5px] focus:outline-none transition-all duration-200 ${
                    showPanel
                      ? 'border-turquoise shadow-[0_18px_40px_-18px_rgba(0,179,166,0.45)] rounded-b-none'
                      : 'border-[#E6E9EE] shadow-[0_10px_24px_-14px_rgba(13,27,42,0.18)] focus:border-turquoise focus:shadow-[0_18px_40px_-18px_rgba(0,179,166,0.35)]'
                  }`}
                />
                {query ? (
                  <button
                    onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                    aria-label="Effacer la recherche"
                    className="absolute right-3 top-[15px] w-7 h-7 rounded-lg flex items-center justify-center text-[#8A93A0] hover:text-navy hover:bg-[#F2F4F7] transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : (
                  <kbd className="hidden sm:flex absolute right-3.5 top-[17px] h-[22px] min-w-[22px] px-1.5 items-center justify-center rounded-md border border-[#E6E9EE] bg-[#F7F9FA] text-[11px] font-bold text-[#8A93A0]">/</kbd>
                )}

                {/* Le panneau de réponses. Il s'ouvre sous le champ, soudé à
                    lui (le champ perd son arrondi bas) : ce qu'on lit est la
                    suite de ce qu'on tape, pas une fenêtre qui se superpose. */}
                {showPanel && (
                  <div
                    className="absolute left-0 right-0 top-full bg-white border border-turquoise border-t-0 rounded-b-2xl overflow-hidden z-30 animate-[landingPanelIn_180ms_ease-out] shadow-[0_28px_60px_-24px_rgba(13,27,42,0.3)]"
                  >
                    {results.length === 0 ? (
                      <div className="px-5 py-6">
                        <p className="text-[14px] font-bold text-navy">Rien ne correspond à « {query.trim()} ».</p>
                        <p className="mt-1.5 text-[13px] text-[#5B6472] leading-[1.55]">Reformulez avec un autre mot, ou posez la question directement — on répond.</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <a href={`mailto:${contactEmail}`} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-navy text-white text-[12.5px] font-bold hover:bg-navy-hover transition-colors">
                            <Mail className="w-3.5 h-3.5" /> Écrire un e-mail
                          </a>
                          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#F2F4F7] text-navy text-[12.5px] font-bold hover:bg-[#E6E9EE] transition-colors">
                            <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="max-h-[46vh] overflow-y-auto py-1.5">
                        {guideResults.length > 0 && (
                          <p className="px-5 pt-2 pb-1 text-[11px] font-bold tracking-[0.06em] uppercase text-[#8A93A0]">Guide</p>
                        )}
                        {results.map((r, i) => (
                          <React.Fragment key={`${r.kind}-${r.id}`}>
                            {r.kind === 'faq' && faqResults[0] === r && (
                              <p className="px-5 pt-3 pb-1 text-[11px] font-bold tracking-[0.06em] uppercase text-[#8A93A0]">Questions</p>
                            )}
                            <button
                              onMouseEnter={() => setActiveIndex(i)}
                              onClick={() => jumpTo(r.kind, r.id)}
                              className={`w-full text-left px-5 py-2.5 flex items-start gap-3 transition-colors ${i === activeIndex ? 'bg-[#F2F9F8]' : 'hover:bg-[#FBFCFD]'}`}
                            >
                              <span className={`mt-0.5 w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${r.kind === 'guide' ? 'bg-[#E3F7F5] text-[#00857C]' : 'bg-[#E9ECFE] text-[#3B52C4]'}`}>
                                {r.kind === 'guide' ? <BookOpen className="w-3.5 h-3.5" /> : <HelpCircle className="w-3.5 h-3.5" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[13.5px] font-bold text-navy leading-snug">
                                  <Highlight text={r.title} query={query.trim()} />
                                </span>
                                <span className="block text-[12px] text-[#8A93A0] leading-snug truncate">{r.sub}</span>
                              </span>
                              {/* Caché sur téléphone, comme la touche « / » :
                                  un rappel de raccourci clavier n'a rien à
                                  dire à qui n'a pas de clavier. */}
                              {i === activeIndex && (
                                <CornerDownLeft className="hidden sm:block w-3.5 h-3.5 text-[#8A93A0] shrink-0 mt-1" />
                              )}
                            </button>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Reveal>

            {/* Alignées sur la largeur du champ, jamais plus larges : le
                panneau de résultats les recouvre alors entièrement quand il
                s'ouvre. Débordantes, elles dépassaient derrière lui et ça se
                lisait comme un défaut d'affichage. */}
            <Reveal delay={260}>
              <div className="mt-4 max-w-[520px] flex flex-wrap items-center gap-2.5">
                <span className="hidden sm:inline text-[12.5px] text-[#8A93A0]">Ou parcourez&nbsp;:</span>
                <button onClick={() => document.getElementById('support-guide')?.scrollIntoView({ behavior: 'smooth' })} className="px-3.5 py-1.5 rounded-full bg-white border border-[#E6E9EE] text-[12.5px] font-semibold text-[#3D4655] hover:border-turquoise/50 hover:text-navy transition-colors">le guide</button>
                <button onClick={() => document.getElementById('support-faq')?.scrollIntoView({ behavior: 'smooth' })} className="px-3.5 py-1.5 rounded-full bg-white border border-[#E6E9EE] text-[12.5px] font-semibold text-[#3D4655] hover:border-turquoise/50 hover:text-navy transition-colors">les questions</button>
                <button onClick={() => document.getElementById('support-contact')?.scrollIntoView({ behavior: 'smooth' })} className="px-3.5 py-1.5 rounded-full bg-white border border-[#E6E9EE] text-[12.5px] font-semibold text-[#3D4655] hover:border-turquoise/50 hover:text-navy transition-colors">nous joindre</button>
              </div>
            </Reveal>
          </div>

          {/* La conseillère, dessinée en formes CSS comme toutes les maquettes
              de ce site. Deux ajouts par rapport à la version précédente : les
              ondes du casque (le seul mouvement ambiant de la page) et une
              parallaxe au pointeur — la scène réagit à vous plutôt que de
              jouer toute seule. */}
          <Reveal direction="left" style={{ flex: '1 1 320px', minWidth: 260 }} className="w-full">
            <div
              onMouseMove={onPointerMove}
              onMouseLeave={() => setParallax({ x: 0, y: 0 })}
              className="relative mx-auto max-w-[360px] bg-white rounded-[28px] p-10 overflow-hidden"
              style={{ boxShadow: '0 30px 70px -30px rgba(13,27,42,0.22)' }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute w-[280px] h-[280px] rounded-full animate-[landingBreathe_7s_ease-in-out_infinite]"
                style={{ background: 'radial-gradient(circle, rgba(0,179,166,0.18), rgba(0,179,166,0) 70%)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}
              />

              <div
                className="relative mx-auto transition-transform duration-500 ease-out"
                style={{ width: 220, height: 230, transform: `translate(${parallax.x * -5}px, ${parallax.y * -4}px)` }}
              >
                {/* Les ondes : deux cercles qui s'écartent du casque, décalés
                    d'une demi-période pour que le signal paraisse continu. */}
                {[0, 1].map(i => (
                  <span
                    key={i}
                    aria-hidden
                    className="absolute rounded-full border-2 border-turquoise/40 animate-[landingSignal_3.4s_ease-out_infinite]"
                    style={{ width: 150, height: 150, top: 18, left: 35, animationDelay: `${i * 1.7}s` }}
                  />
                ))}

                {/* torse */}
                <div className="absolute bg-navy" style={{ bottom: 0, left: 22, width: 176, height: 92, borderRadius: '88px 88px 0 0' }} />
                {/* tête */}
                <div className="absolute rounded-full bg-navy" style={{ top: 34, left: 51, width: 118, height: 118 }} />
                {/* visage — deux yeux, un sourire, rien de plus */}
                <div className="absolute rounded-full bg-white/90" style={{ top: 90, left: 88, width: 7, height: 7 }} />
                <div className="absolute rounded-full bg-white/90" style={{ top: 90, left: 120, width: 7, height: 7 }} />
                <div className="absolute" style={{ top: 101, left: 92, width: 32, height: 16, borderBottom: '3px solid rgba(255,255,255,0.5)', borderRadius: '0 0 16px 16px' }} />
                {/* arceau du casque */}
                <div className="absolute border-turquoise" style={{ top: 12, left: '50%', transform: 'translateX(-50%)', width: 132, height: 66, borderWidth: 7, borderBottomWidth: 0, borderRadius: '66px 66px 0 0' }} />
                {/* écouteurs */}
                <div className="absolute rounded-full" style={{ top: 72, left: 33, width: 26, height: 26, background: '#00857C' }} />
                <div className="absolute rounded-full" style={{ top: 72, left: 161, width: 26, height: 26, background: '#00857C' }} />
                {/* micro */}
                <div className="absolute" style={{ top: 92, left: 172, width: 3, height: 32, background: '#00857C', borderRadius: 2, transform: 'rotate(35deg)', transformOrigin: 'top left' }} />
                <div className="absolute rounded-full" style={{ top: 117, left: 180, width: 8, height: 8, background: '#00857C' }} />
              </div>

              <div
                className="absolute top-6 right-6 bg-white rounded-2xl px-3.5 py-2.5 transition-transform duration-500 ease-out"
                style={{ boxShadow: '0 14px 26px -10px rgba(13,27,42,0.16)', transform: `translate(${parallax.x * 12}px, ${parallax.y * 9}px)` }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-[6px] h-[6px] rounded-full bg-[#22C55E] shrink-0 animate-[landingPulseDot_2s_ease-in-out_infinite]" />
                  <span className="text-[11.5px] font-extrabold text-navy leading-tight whitespace-nowrap">Support en ligne</span>
                </div>
              </div>
              <div
                className="absolute bottom-7 left-4 bg-white rounded-2xl px-3.5 py-2.5 flex items-center gap-2 transition-transform duration-500 ease-out"
                style={{ boxShadow: '0 14px 26px -10px rgba(13,27,42,0.16)', transform: `translate(${parallax.x * 16}px, ${parallax.y * 12}px)` }}
              >
                <div className="w-7 h-7 rounded-[9px] bg-[#E3F7F5] flex items-center justify-center text-[#00857C] shrink-0">
                  <Clock className="w-[14px] h-[14px]" />
                </div>
                <span className="text-[11.5px] font-extrabold text-navy leading-tight whitespace-nowrap">Réponse sous 24h</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* LE GUIDE */}
      <section id="support-guide" className="support-guide-redesign py-20 px-6 sm:px-10 bg-white scroll-mt-6">
        <div className="max-w-[1000px] mx-auto">
          <Reveal>
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div>
                <h2 className="text-[26px] sm:text-[32px] font-extrabold text-navy tracking-[-0.01em]">Le guide, module par module</h2>
                <p className="mt-2 text-[15px] text-[#5B6472]">
                  Les {GUIDE_CHAPTERS.length} chapitres du guide utilisateur, condensés. Ouvrez celui qui vous concerne.
                </p>
              </div>
              <a
                href={guideHref}
                download
                className="landing-shine inline-flex items-center gap-2 px-4.5 py-3 rounded-xl bg-navy text-[13.5px] font-bold text-white hover:bg-turquoise hover:text-navy transition-colors whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                Télécharger le guide complet
              </a>
            </div>

            {/* Filtrer par moment du travail. Des puces plutôt qu'un menu :
                on voit d'un coup d'œil comment le corpus se répartit, et le
                compte dit s'il vaut la peine d'y aller. Dans le même `Reveal`
                que le titre : séparées, les puces restaient invisibles une
                seconde de plus que l'intitulé qu'elles complètent, ce qui se
                lisait comme un trou dans la page. */}
            <div className="mt-7 flex flex-wrap gap-2">
              <button
                onClick={() => setGroup('all')}
                className={`px-4 py-2 rounded-full text-[13px] font-bold transition-colors ${group === 'all' ? 'bg-navy text-white' : 'bg-[#F2F4F7] text-[#3D4655] hover:bg-[#E6E9EE]'}`}
              >
                Tout <span className={group === 'all' ? 'text-white/50' : 'text-[#8A93A0]'}>{GUIDE_CHAPTERS.length}</span>
              </button>
              {GROUPS.map(g => (
                <button
                  key={g.id}
                  onClick={() => setGroup(g.id)}
                  className={`px-4 py-2 rounded-full text-[13px] font-bold transition-colors ${group === g.id ? 'bg-navy text-white' : 'bg-[#F2F4F7] text-[#3D4655] hover:bg-[#E6E9EE]'}`}
                >
                  {g.label} <span className={group === g.id ? 'text-white/50' : 'text-[#8A93A0]'}>{countFor(g.id)}</span>
                </button>
              ))}
            </div>
          </Reveal>

          <div className="support-guide-list mt-6 divide-y divide-[#E6E9EE] border border-[#E6E9EE] rounded-[18px] overflow-hidden bg-white">
            {visibleChapters.map((chapter, i) => {
              const isOpen = openChapters.has(chapter.id);
              return (
                <div
                  key={chapter.id}
                  id={`support-item-${chapter.id}`}
                  className={`scroll-mt-28 ${found === chapter.id ? 'animate-[landingFound_2s_ease-out] relative z-10' : ''}`}
                  style={reduced ? undefined : { animation: `landingItemIn 260ms ease-out ${Math.min(i, 8) * 28}ms both` }}
                >
                  <button
                    onClick={() => toggle(setOpenChapters, chapter.id)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center gap-3.5 px-5 sm:px-6 py-4 text-left hover:bg-[#FBFCFD] transition-colors"
                  >
                    <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 transition-colors ${isOpen ? 'bg-turquoise text-white' : 'bg-[#E3F7F5] text-[#00857C]'}`}>
                      {chapter.icon}
                    </div>
                    <span className="flex-1 text-[14.5px] font-bold text-navy">{chapter.title}</span>
                    <ChevronDown className={`w-[18px] h-[18px] text-[#8A93A0] shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {/* `grid-rows` de 0fr à 1fr : la hauteur réelle du contenu
                      s'anime, là où `height: auto` ne se transitionne pas et
                      où un `max-height` deviné saccade. */}
                  <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <div className="px-5 sm:px-6 pb-6 pl-[62px] sm:pl-[66px] flex flex-col md:flex-row md:items-start gap-5">
                        <p className="md:flex-1 text-[13.5px] leading-[1.65] text-[#5B6472] max-w-[420px]">
                          {chapter.summary}
                        </p>
                        {/* La capture de l'écran dont parle le chapitre.
                            `loading="lazy"` + dimensions explicites : les
                            treize vivent dans le DOM en permanence (repliées),
                            donc rien ne doit être téléchargé avant d'être
                            regardé, ni faire sauter la page en arrivant. */}
                        {chapter.shot && (
                          <button
                            onClick={() => setZoom({ src: chapter.shot!, title: chapter.title })}
                            className="group/shot md:w-[52%] shrink-0 relative block rounded-xl overflow-hidden border border-[#E6E9EE] bg-[#F7F9FA] hover:border-turquoise/50 transition-colors"
                            aria-label={`Agrandir la capture : ${chapter.title}`}
                          >
                            <img
                              src={chapter.shot}
                              alt={`L'écran ${chapter.title} dans Tâches & Cash`}
                              width={1400}
                              height={875}
                              loading="lazy"
                              decoding="async"
                              className="block w-full h-auto"
                            />
                            <span className="absolute inset-0 bg-navy/0 group-hover/shot:bg-navy/[0.06] transition-colors" />
                            {/* Visible au repos, pas seulement au survol : sur
                                un écran tactile le survol n'existe pas, et une
                                vignette qu'on ne sait pas cliquable ne se
                                clique pas. */}
                            <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/90 text-[10.5px] font-bold text-navy opacity-80 group-hover/shot:opacity-100 group-hover/shot:bg-white transition-all">
                              <Maximize2 className="w-3 h-3" /> Agrandir
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Ce qui n'existe pas encore le dit une fois, discrètement, plutôt
              que d'occuper deux cartes pleines dans la rangée principale. */}
          <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-[#8A93A0]">
            <Video className="w-3.5 h-3.5" /> Tutoriels vidéo
            <Sparkles className="w-3.5 h-3.5 ml-2" /> Nouveautés
            <span className="text-[#B6BCC6]">— en préparation, pas encore disponibles.</span>
          </p>
        </div>
      </section>

      {/* QUESTIONS FRÉQUENTES */}
      <section id="support-faq" className="support-faq-redesign py-20 px-6 sm:px-10 bg-[#F2F4F7] scroll-mt-6">
        <div className="max-w-[820px] mx-auto">
          <Reveal>
            <h2 className="text-[26px] sm:text-[32px] font-extrabold text-navy tracking-[-0.01em]">Questions fréquentes</h2>
            <p className="mt-2 text-[15px] text-[#5B6472]">Les {FAQ_ITEMS.length} questions qui nous reviennent le plus souvent.</p>
          </Reveal>

          <div className="mt-8 space-y-2.5">
            {FAQ_ITEMS.map(item => {
              const isOpen = openFaq.has(item.id);
              const vote = helpful[item.id];
              return (
                <div
                  key={item.id}
                  id={`support-item-${item.id}`}
                  className={`scroll-mt-28 bg-white rounded-[16px] border transition-colors ${isOpen ? 'border-turquoise/40' : 'border-[#E6E9EE]'} ${found === item.id ? 'animate-[landingFound_2s_ease-out]' : ''}`}
                >
                  <button
                    onClick={() => toggle(setOpenFaq, item.id)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center gap-3 px-5 sm:px-6 py-4 text-left"
                  >
                    <span className="flex-1 text-[14.5px] font-bold text-navy leading-snug">{item.q}</span>
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 ${isOpen ? 'bg-turquoise text-white rotate-180' : 'bg-[#F2F4F7] text-[#8A93A0]'}`}>
                      <ChevronDown className="w-4 h-4" />
                    </span>
                  </button>
                  <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <div className="px-5 sm:px-6 pb-5">
                        <p className="text-[13.5px] leading-[1.65] text-[#5B6472]">{item.a}</p>

                        {/* Le retour est local — il n'existe aucune route pour
                            le collecter, et prétendre le contraire serait le
                            genre de faux crédible que cette application
                            s'interdit ailleurs. Il sert à l'instant présent :
                            un « non » ouvre les canaux de contact. */}
                        <div className="mt-4 pt-3.5 border-t border-[#F0F2F5]">
                          {!vote ? (
                            <div className="flex flex-wrap items-center gap-2.5">
                              <span className="text-[12.5px] text-[#8A93A0]">Cette réponse vous a aidé&nbsp;?</span>
                              <button onClick={() => setHelpful(p => ({ ...p, [item.id]: 'oui' }))} className="px-3 py-1 rounded-lg bg-[#F2F4F7] text-[12.5px] font-bold text-[#3D4655] hover:bg-[#E3F7F5] hover:text-[#00857C] transition-colors">Oui</button>
                              <button onClick={() => setHelpful(p => ({ ...p, [item.id]: 'non' }))} className="px-3 py-1 rounded-lg bg-[#F2F4F7] text-[12.5px] font-bold text-[#3D4655] hover:bg-[#E6E9EE] transition-colors">Non</button>
                            </div>
                          ) : vote === 'oui' ? (
                            <p className="text-[12.5px] font-semibold text-[#00857C] animate-[landingItemIn_240ms_ease-out]">Parfait, bonne continuation.</p>
                          ) : (
                            <div className="animate-[landingItemIn_240ms_ease-out]">
                              <p className="text-[12.5px] text-[#5B6472]">Désolé — posez-la-nous directement, on vous répond.</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <a href={`mailto:${contactEmail}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-navy text-white text-[12px] font-bold hover:bg-navy-hover transition-colors">
                                  <Mail className="w-3.5 h-3.5" /> Écrire un e-mail
                                </a>
                                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F2F4F7] text-navy text-[12px] font-bold hover:bg-[#E6E9EE] transition-colors">
                                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                                </a>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* NOUS JOINDRE — trois canaux, pas trois cartes identiques : WhatsApp
          porte le remplissage navy parce que c'est le plus rapide des trois,
          et une rangée uniforme ne dirait pas lequel choisir. */}
      <section id="support-contact" className="support-contact-redesign py-20 px-6 sm:px-10 bg-white scroll-mt-6">
        <div className="max-w-[1000px] mx-auto">
          <Reveal className="max-w-[640px]">
            <h2 className="text-[26px] sm:text-[32px] font-extrabold text-navy tracking-[-0.01em]">Vous préférez parler à quelqu'un ?</h2>
            <p className="mt-2 text-[15px] text-[#5B6472]">Trois façons de nous joindre. La plus rapide est WhatsApp.</p>
          </Reveal>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-5">
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="landing-shine group relative bg-navy rounded-[20px] p-7 overflow-hidden hover:-translate-y-1.5 transition-transform duration-300" style={{ boxShadow: '0 26px 50px -24px rgba(13,27,42,0.45)' }}>
              <div aria-hidden className="absolute w-[200px] h-[200px] rounded-full bg-[radial-gradient(circle,rgba(0,179,166,0.3),rgba(0,179,166,0)_70%)] -top-16 -right-12 pointer-events-none" />
              <div className="relative">
                <div className="w-[46px] h-[46px] rounded-xl bg-turquoise text-navy flex items-center justify-center transition-transform duration-300 group-hover:scale-110">
                  <MessageCircle className="w-[22px] h-[22px]" />
                </div>
                <div className="text-[15px] font-bold text-white mt-4">WhatsApp</div>
                <p className="text-[13.5px] text-white/60 mt-2 leading-[1.5]">Le plus direct : vous écrivez, on répond dans la conversation.</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-turquoise">
                  Ouvrir la conversation
                  <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                </span>
              </div>
            </a>

            <a href={`mailto:${contactEmail}`} className="landing-shine group bg-white rounded-[20px] border border-[#E6E9EE] p-7 hover:-translate-y-1.5 hover:border-turquoise/45 hover:shadow-[0_18px_38px_rgba(13,27,42,0.10)] transition-all duration-300">
              <div className="w-[46px] h-[46px] rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110" style={{ background: '#E9ECFE', color: '#3B52C4' }}>
                <Mail className="w-[22px] h-[22px]" />
              </div>
              <div className="text-[15px] font-bold text-navy mt-4">E-mail</div>
              <p className="text-[13.5px] text-[#3D4655] mt-2 font-semibold break-all">{contactEmail}</p>
              <p className="text-[12.5px] text-[#8A93A0] mt-1">Réponse sous 24h</p>
            </a>

            <a href={`tel:${contactPhone.replace(/\s/g, '')}`} className="landing-shine group bg-white rounded-[20px] border border-[#E6E9EE] p-7 hover:-translate-y-1.5 hover:border-turquoise/45 hover:shadow-[0_18px_38px_rgba(13,27,42,0.10)] transition-all duration-300">
              <div className="w-[46px] h-[46px] rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110" style={{ background: '#E3F7F5', color: '#00857C' }}>
                <Headphones className="w-[22px] h-[22px]" />
              </div>
              <div className="text-[15px] font-bold text-navy mt-4">Téléphone</div>
              <p className="text-[14.5px] text-[#3D4655] mt-2 font-semibold">{contactPhone}</p>
            </a>
          </div>
        </div>
      </section>

      {/* L'agrandissement d'une capture. Le fond ferme au clic, Échap aussi,
          et l'image elle-même ne ferme pas — on clique volontiers dessus pour
          regarder un détail. */}
      {zoom && (
        <div
          onClick={() => setZoom(null)}
          role="dialog"
          aria-modal="true"
          aria-label={zoom.title}
          className="fixed inset-0 z-[100] bg-navy/80 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-8 animate-[landingPanelIn_160ms_ease-out]"
        >
          <div className="w-full max-w-[1200px]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-4 mb-3">
              <p className="text-[14px] font-bold text-white">{zoom.title}</p>
              <button
                onClick={() => setZoom(null)}
                aria-label="Fermer l'agrandissement"
                className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={zoom.src}
              alt={`L'écran ${zoom.title} dans Tâches & Cash`}
              className="w-full h-auto max-h-[80vh] object-contain rounded-xl bg-white"
            />
          </div>
        </div>
      )}
    </>
  );
};
