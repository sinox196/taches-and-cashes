import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Building2, CalendarCheck, Check, ChevronDown, FileText, FolderKanban, Gift, Globe, LayoutDashboard, ListChecks, MessageSquare, Pause, Play, RotateCcw, Timer, Users, Wallet } from 'lucide-react';
import { Reveal } from './Reveal';
import '../../styles/home.css';

const previews = [
  { label: 'Pilotage', icon: LayoutDashboard, shot: 'pilotage', alt: 'Deux professionnels analysent des graphiques financiers pour piloter leur activité.', title: 'Une vue claire. Des décisions éclairées.', text: 'Reliez le temps travaillé, les coûts et les revenus. Identifiez les missions qui créent de la valeur pour votre activité.', points: ['Indicateurs par période et collaborateur', 'Rentabilité par client et par mission', 'Suivi des coûts et des créances'] },
  { label: 'Tâches & temps', icon: Timer, shot: 'temps', alt: 'Une consultante organise ses tâches dans un agenda, une horloge posée sur son bureau.', title: 'Chaque minute trouve sa mission.', text: 'Planifiez, déléguez et suivez le travail de votre équipe. Un chronomètre reste à portée de main, où que vous soyez dans la plateforme.', points: ['Démarrage et pause en un clic', 'Historique par client et collaborateur', 'Temps facturable et non facturable'] },
  { label: 'Facturation', icon: Wallet, shot: 'facturation', alt: 'Une comptable vérifie une facture avec une calculatrice et ses documents financiers.', title: 'Du travail réalisé au cash encaissé.', text: 'Retrouvez vos factures, vos règlements et votre trésorerie dans un seul espace, avec les paramètres de facturation adaptés à votre activité.', points: ['Documents et calcul des taxes', 'Règlements et soldes clients', 'Encaissements et décaissements'] },
  { label: 'Équipe & RH', icon: Users, shot: 'equipe', alt: 'Une équipe échange autour d’un calendrier pour organiser le travail ensemble.', title: 'Une équipe organisée, un quotidien plus simple.', text: 'Centralisez les demandes de congés, les présences et la paie. Chacun retrouve les informations utiles à son rôle.', points: ['Congés et autorisations d’absence', 'Prêts, avances et bulletins de paie', 'Gestion des droits par collaborateur'] },
];

const modules = [
  { icon: LayoutDashboard, name: 'Tableau de bord', text: 'Vos indicateurs, réunis.' },
  { icon: Timer, name: 'Tâches & chrono', text: 'Chaque minute compte.' },
  { icon: ListChecks, name: 'Missions', text: 'Le travail bien structuré.' },
  { icon: Building2, name: 'Clients', text: 'Vos dossiers, centralisés.' },
  { icon: FileText, name: 'Facturation', text: 'Du service à la facture.' },
  { icon: Wallet, name: 'Trésorerie', text: 'Gardez le fil du cash.' },
  { icon: CalendarCheck, name: 'Échéances', text: 'Anticipez vos obligations.' },
  { icon: FolderKanban, name: 'Outils de travail', text: 'Vos ressources au bon endroit.' },
  { icon: Users, name: 'GRH & paie', text: 'Prenez soin de votre équipe.' },
  { icon: MessageSquare, name: 'Messagerie', text: 'La collaboration en direct.' },
  { icon: Globe, name: 'Portail client', text: 'Un lien avec vos clients.' },
  { icon: Gift, name: 'Parrainage', text: 'Grandissez ensemble.' },
];

const questions = [
  { title: 'À qui s’adresse Tâches & Cash ?', answer: 'Aux cabinets comptables, consultants, avocats, architectes, ingénieurs-conseils et autres professionnels des services qui souhaitent réunir la gestion de leur équipe, de leur temps et de leur facturation.' },
  { title: 'Puis-je essayer la plateforme gratuitement ?', answer: 'Oui. Choisissez votre offre sur la page Tarifs pour demander votre accès. L’essai est gratuit et ne nécessite aucune carte bancaire. Notre équipe vous accompagne dans le choix de votre offre définitive.' },
  { title: 'Tous les modules sont-ils inclus dans mon offre ?', answer: 'Les modules accessibles dépendent de l’offre choisie. La page Tarifs détaille les fonctionnalités et le nombre d’utilisateurs de chaque formule, avec des offres adaptées aux indépendants et aux équipes.' },
  { title: 'Comment être accompagné au démarrage ?', answer: 'Notre centre d’assistance propose des guides illustrés par module. Vous pouvez aussi contacter notre équipe par e-mail, téléphone ou WhatsApp pour échanger sur vos besoins.' },
];

function TimerDemo() {
  const [seconds, setSeconds] = useState(24 * 60 + 38);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const initial = seconds;
    const interval = window.setInterval(() => setSeconds(initial + Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(interval);
    // The baseline is captured only when the visitor starts or resumes.
  }, [running]);
  return <div className="home-timer-demo">
    <div className="home-demo-top"><span><i className={running ? 'is-running' : ''} />{running ? 'En cours' : 'En pause'}</span><small>DÉMO INTERACTIVE</small></div>
    <p>Révision comptable <span>Client de démonstration</span></p>
    <div className="home-timer-value" role="timer" aria-label="Durée de la tâche de démonstration">{String(Math.floor(seconds / 3600)).padStart(2, '0')}<span>:</span>{String(Math.floor(seconds / 60) % 60).padStart(2, '0')}<span>:</span>{String(seconds % 60).padStart(2, '0')}</div>
    <div className="home-timer-controls"><button onClick={() => setRunning(v => !v)} aria-pressed={running}>{running ? <Pause size={16} /> : <Play size={16} />}{running ? 'Mettre en pause' : 'Tester le chrono'}</button><button aria-label="Réinitialiser le chronomètre de démonstration" onClick={() => { setRunning(false); setSeconds(24 * 60 + 38); }}><RotateCcw size={17} /></button></div>
  </div>;
}

export function HomeView({ onStart, onFeatures, onContact }: { onStart: () => void; onFeatures: () => void; onContact: () => void }) {
  const [active, setActive] = useState(0);
  const selected = previews[active];
  const hero = useRef<HTMLElement>(null);
  const [motionPaused, setMotionPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [heroVisible, setHeroVisible] = useState(true);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    const observer = new IntersectionObserver(([entry]) => setHeroVisible(entry.isIntersecting));
    if (hero.current) observer.observe(hero.current);
    return () => { preference.removeEventListener('change', update); observer.disconnect(); };
  }, []);
  const explore = () => document.getElementById('home-product')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });

  return <div className="home-redesign" data-motion={motionPaused || reducedMotion ? 'paused' : 'playing'}>
    <section ref={hero} className="home-hero" aria-labelledby="home-title" data-visible={heroVisible}>
      <img className="home-cover" src="/landing/team-cover.webp" width="1536" height="1024" fetchPriority="high" alt="Deux professionnels collaborent sur un dossier dans un bureau lumineux." />
      <div className="home-hero-shade" aria-hidden="true" />
      <div className="home-hero-atmosphere" aria-hidden="true"><i /><i /><span /></div>
      <button className="home-motion-toggle" onClick={() => setMotionPaused(v => !v)} disabled={reducedMotion} aria-pressed={motionPaused || reducedMotion} aria-label={reducedMotion ? 'Animations désactivées selon vos préférences' : motionPaused ? 'Reprendre les animations' : 'Mettre les animations en pause'}>{motionPaused || reducedMotion ? <Play size={13} /> : <Pause size={13} />}<span>{reducedMotion ? 'Mouvement réduit' : motionPaused ? 'Reprendre' : 'Pause animations'}</span></button>
      <div className="home-container home-hero-content">
        <div className="home-hero-copy">
          <div className="home-kicker"><span />LE LOGICIEL QUI RELIE TEMPS, ÉQUIPE & CASH</div>
          <h1 id="home-title"><span className="home-title-line"><span>Votre talent.</span></span><span className="home-title-line"><span>Votre temps.</span></span><span className="home-title-line"><em>Votre valeur.</em></span></h1>
          <svg className="home-title-stroke" viewBox="0 0 220 12" fill="none" aria-hidden="true"><path d="M3 9C65 1 143 1 216 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" pathLength="1" /></svg>
          <p>Faites grandir votre activité, pas vos tableurs.</p>
          <p className="home-hero-description">Missions, chronomètres, équipe et facturation : tout se connecte pour vous donner une vision claire de votre rentabilité.</p>
          <div className="home-actions"><button className="home-btn home-btn-mint" onClick={onStart}>Commencer gratuitement <ArrowUpRight size={19} /></button><button className="home-watch" onClick={explore}><span><Play size={14} fill="currentColor" /></span>Découvrir la plateforme</button></div>
          <div className="home-trial-note"><Check size={14} /> Essai gratuit <span /> Sans carte bancaire</div>
        </div>
        <div className="home-value-motion" aria-hidden="true">
          <svg className="home-value-track" viewBox="0 0 420 80" fill="none"><path d="M45 40H375" stroke="rgba(150,234,210,.25)" strokeWidth="1" /><path className="home-value-current" d="M45 40H375" stroke="#96ead2" strokeWidth="2" strokeLinecap="round" strokeDasharray="35 295" /></svg>
          <div className="home-value-node"><span><Timer size={21} /><i /></span><small>Votre temps</small></div>
          <div className="home-value-node"><span><ListChecks size={21} /><i /></span><small>Vos missions</small></div>
          <div className="home-value-node"><span><Wallet size={21} /><i /></span><small>Votre cash</small></div>
        </div>
        <div className="home-hero-bottom"><span>MOINS DE DISPERSION. PLUS DE VISION.</span><button onClick={explore} aria-label="Explorer la plateforme plus bas"><ArrowDown size={19} /></button><span>CONÇU POUR LES MÉTIERS DE SERVICES</span></div>
      </div>
    </section>

    <section className="home-trust home-container" aria-label="Nos clients"><p>Ils nous font<br /><strong>confiance.</strong></p><div>{[{ name: 'IQRATIC', file: 'iqratic' }, { name: 'Business Eco', file: 'business-eco' }, { name: 'TechITEasy', file: 'techiteasy' }, { name: 'Accord Expertise Comptable', file: 'accord-expertise' }].map(logo => <img key={logo.file} src={`/logos/clients/${logo.file}.png`} alt={logo.name} width="170" height="65" loading="lazy" />)}</div></section>

    <section id="home-product" className="home-product home-section">
      <div className="home-container">
        <Reveal className="home-section-heading"><span className="home-eyebrow">UNE VUE D’ENSEMBLE. ENFIN.</span><h2>Votre activité prend<br /><span>tout son sens.</span></h2><p>Moins d’allers-retours entre les outils.<br />Plus de temps pour ce que vous faites de mieux.</p></Reveal>
        <div className="home-activity-switcher" role="tablist" aria-label="Activités de la plateforme" onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (active + 1) % previews.length : event.key === 'ArrowLeft' ? (active + previews.length - 1) % previews.length : event.key === 'Home' ? 0 : event.key === 'End' ? previews.length - 1 : null;
          if (next !== null) { event.preventDefault(); setActive(next); document.getElementById(`home-tab-${next}`)?.focus(); }
        }}>{previews.map((item, i) => <button key={item.shot} id={`home-tab-${i}`} role="tab" tabIndex={active === i ? 0 : -1} aria-selected={active === i} aria-controls="home-preview-panel" onClick={() => setActive(i)} className="home-activity-switch-card"><span className="home-activity-tab-number">0{i + 1}</span><span className="home-activity-tab-icon"><item.icon size={19} /></span><span><strong>{item.label}</strong><small>{i === 0 ? 'Décider avec clarté' : i === 1 ? 'Organiser chaque minute' : i === 2 ? 'Suivre la valeur créée' : 'Faire avancer l’équipe'}</small></span><ArrowRight className="home-activity-tab-arrow" size={16} /></button>)}</div>
        <div className="home-product-panel" role="tabpanel" id="home-preview-panel" aria-labelledby={`home-tab-${active}`} tabIndex={0}>
          <div className="home-product-copy" data-activity={selected.shot}><span className="home-step-number">0{active + 1} / 04</span><h3>{selected.title}</h3><p>{selected.text}</p><ul>{selected.points.map(point => <li key={point}><Check size={16} />{point}</li>)}</ul><button className="home-link" onClick={onFeatures}>Explorer les fonctionnalités <ArrowRight size={17} /></button></div>
          <figure className="home-activity-photo" key={selected.shot}>
            <img src={`/landing/activity-${selected.shot}.webp`} width="1536" height="1024" loading="lazy" alt={selected.alt} />
            <div className="home-activity-scrim" aria-hidden="true" />
            <figcaption><span className="home-activity-icon"><selected.icon size={23} /></span><div><small>VOTRE QUOTIDIEN, SIMPLIFIÉ</small><strong>{selected.label}</strong></div><span className="home-activity-index">0{active + 1}<i> / 04</i></span></figcaption>
          </figure>
        </div>
      </div>
    </section>

    <section id="fonctionnalites" className="home-benefits home-section"><div className="home-container">
      <Reveal className="home-heading-row"><div><span className="home-eyebrow">LE QUOTIDIEN, EN PLUS SIMPLE</span><h2>Du temps bien investi.<br /><span>Une équipe qui avance.</span></h2></div><p>Les bons outils, au bon endroit.<br />Du premier chronomètre au dernier règlement.</p></Reveal>
      <div className="home-bento">
        <Reveal className="home-benefit home-benefit-time"><div className="home-card-icon"><Timer size={23} /></div><h3>Concentrez-vous.<br />Le chrono suit.</h3><p>Démarrez, mettez en pause, reprenez. Chaque heure retrouve son client et sa mission.</p><TimerDemo /></Reveal>
        <Reveal delay={90} className="home-benefit home-benefit-team"><div className="home-card-icon"><Users size={23} /></div><h3>Chacun sait<br />où il en est.</h3><p>Tâches déléguées, congés et présences : l’équipe partage une même vision du travail.</p><div className="home-team-demo" aria-label="Exemple de planification"><div className="home-demo-top"><strong>Planning de l’équipe</strong><small>EXEMPLE</small></div>{[{ initials: 'AM', task: 'Révision comptable', state: 'En cours', color: 'mint' }, { initials: 'SB', task: 'Mission de conseil', state: 'Planifiée', color: 'blue' }, { initials: 'YR', task: 'Dossier client', state: 'Terminée', color: 'sand' }].map(row => <div className="home-team-row" key={row.initials}><span className={`home-avatar ${row.color}`}>{row.initials}</span><div><strong>{row.task}</strong><small>{row.state}</small></div><span className={`home-task-progress ${row.color}`}><i /></span></div>)}</div></Reveal>
        <Reveal delay={180} className="home-benefit home-benefit-cash"><div className="home-card-icon"><Wallet size={23} /></div><h3>Le travail a une valeur.<br />Rendez-la visible.</h3><p>Reliez vos prestations à vos factures et vos règlements. Gardez une lecture claire de votre cash.</p><div className="home-cash-demo"><div className="home-demo-top"><span>Facturation & trésorerie</span><small>EXEMPLE</small></div><div className="home-cash-total">2 400 <span>DT HT</span></div><div className="home-cash-bars" aria-hidden="true">{[30, 49, 40, 67, 57, 83, 100].map((height, i) => <i key={i} style={{ height: `${height}%`, animationDelay: `${i * 90}ms` }} />)}</div><div className="home-cash-bottom"><span>Prestation de conseil</span><span><Check size={12} /> Facturée</span></div></div></Reveal>
      </div>
    </div></section>

    <section className="home-flow home-section"><div className="home-container"><Reveal className="home-heading-row"><div><span className="home-eyebrow">TOUT SE CONNECTE</span><h2>De la mission au cash.<br /><span>Sans perdre le fil.</span></h2></div><p>Une continuité entre le travail de votre équipe<br />et le pilotage de votre entreprise.</p></Reveal><div className="home-flow-grid">{[{ n: '01', icon: ListChecks, title: 'Organisez le travail', text: 'Un client, une mission, un collaborateur. Planifiez et déléguez avec une vision partagée.' }, { n: '02', icon: Timer, title: 'Mesurez l’effort', text: 'Les chronomètres alimentent votre historique. Retrouvez le temps passé et les coûts associés.' }, { n: '03', icon: Wallet, title: 'Pilotez la valeur', text: 'Facturez vos prestations, suivez les règlements et analysez votre rentabilité.' }].map((step, i) => <Reveal key={step.n} delay={i * 100} className="home-flow-step"><div><span>{step.n}</span><step.icon size={24} /></div><h3>{step.title}</h3><p>{step.text}</p></Reveal>)}</div></div></section>

    <section id="modules" className="home-modules home-section"><div className="home-container"><Reveal className="home-heading-row"><div><span className="home-eyebrow">UN SEUL ESPACE DE TRAVAIL</span><h2>Douze modules.<br /><span>Votre façon de travailler.</span></h2></div><div><p>Composez votre quotidien avec les modules<br />inclus dans l’offre adaptée à votre activité.</p><button className="home-link" onClick={onStart}>Comparer les offres <ArrowRight size={17} /></button></div></Reveal><div className="home-module-grid">{modules.map((item, i) => <Reveal key={item.name} delay={(i % 4) * 50}><button onClick={onFeatures} className="home-module"><item.icon size={23} /><span><strong>{item.name}</strong><small>{item.text}</small></span><ArrowUpRight size={16} /></button></Reveal>)}</div></div></section>

    <section className="home-faq home-section"><div className="home-container home-faq-grid"><Reveal><span className="home-eyebrow">ON VOUS RÉPOND</span><h2>Avant de<br /><span>vous lancer.</span></h2><p>Une question sur votre activité ?<br />Parlons-en simplement.</p><button onClick={onContact} className="home-link">Échanger avec notre équipe <ArrowUpRight size={17} /></button></Reveal><div>{questions.map(q => <details key={q.title}><summary>{q.title}<ChevronDown size={19} /></summary><p>{q.answer}</p></details>)}</div></div></section>

    <section className="home-final"><div className="home-container"><Reveal><span className="home-eyebrow">ET SI VOUS VOYIEZ PLUS CLAIR ?</span><h2>Votre prochaine étape :<br /><em>reprendre la main.</em></h2><p>Donnez à votre équipe un espace à la hauteur de son travail.</p><div className="home-actions"><button className="home-btn home-btn-mint" onClick={onStart}>Essayer Tâches & Cash <ArrowUpRight size={19} /></button><button className="home-final-contact" onClick={onContact}>Parlons de vos besoins <ArrowRight size={17} /></button></div><div className="home-trial-note"><Check size={14} /> Essai gratuit <span /> Sans carte bancaire</div></Reveal></div></section>
  </div>;
}
