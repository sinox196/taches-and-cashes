import React, { useState } from 'react';
import { ArrowRight, Check, Timer, Wallet, Users, LayoutDashboard } from 'lucide-react';
import { ModuleExplorer } from './ModuleExplorer';

const journeys = [
  { title: 'Temps & missions', icon: Timer, heading: 'Chaque minute retrouve sa mission.', description: 'Organisez le travail, lancez un chronomètre et retrouvez le temps consacré à chaque client.', shot: 'pointage', points: ['Chronomètre et reprise des tâches en pause', 'Planification et délégation à votre équipe', 'Historique par client, mission et collaborateur'] },
  { title: 'Facturation & cash', icon: Wallet, heading: 'Du travail réalisé aux paiements reçus.', description: 'Rassemblez vos documents, vos règlements et votre trésorerie dans le même espace.', shot: 'cash', points: ['Factures et calcul des taxes', 'Suivi des règlements clients', 'Brouillard de caisse et solde courant'] },
  { title: 'Équipe & RH', icon: Users, heading: 'Moins de suivi administratif. Plus de visibilité.', description: 'Centralisez les demandes et retrouvez les informations utiles à la gestion de votre équipe.', shot: 'grh', points: ['Congés et autorisations d’absence', 'Présences, prêts et avances', 'Gestion de la paie et des bulletins'] },
  { title: 'Pilotage', icon: LayoutDashboard, heading: 'Vos décisions commencent par une vue claire.', description: 'Reliez temps, coûts et activité pour comprendre la rentabilité de vos clients et missions.', shot: 'dashboard', points: ['Indicateurs filtrables par période', 'Rentabilité et coût du temps', 'Vision consolidée de l’activité'] },
];

export function FeaturesView({ onStart }: { onStart: () => void }) {
  const [active, setActive] = useState(0);
  const selected = journeys[active];
  return <>
    <section className="public-page-intro">
      <span className="public-eyebrow">UNE PLATEFORME, TOUT VOTRE QUOTIDIEN</span>
      <h1>Moins de dispersion.<br /><span>Plus de maîtrise.</span></h1>
      <p>Du premier chronomètre au dernier règlement, retrouvez vos tâches, votre équipe et votre cash au même endroit.</p>
      <button className="public-button" onClick={onStart}>Trouver mon offre <ArrowRight size={17} /></button>
    </section>
    <section className="feature-workspace" aria-label="Découvrir les fonctionnalités">
      <div className="feature-switcher" role="tablist" aria-label="Votre activité" onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (active + 1) % journeys.length : event.key === 'ArrowLeft' ? (active + journeys.length - 1) % journeys.length : event.key === 'Home' ? 0 : event.key === 'End' ? journeys.length - 1 : null;
        if (next !== null) { event.preventDefault(); setActive(next); document.getElementById(`feature-tab-${next}`)?.focus(); }
      }}>
        {journeys.map((journey, i) => <button key={journey.title} id={`feature-tab-${i}`} role="tab" aria-selected={active === i} aria-controls={`feature-panel-${i}`} tabIndex={active === i ? 0 : -1} onClick={() => setActive(i)}><journey.icon size={20} /><span>{journey.title}</span></button>)}
      </div>
      <div className="feature-story" role="tabpanel" id={`feature-panel-${active}`} aria-labelledby={`feature-tab-${active}`} tabIndex={0}>
        <div className="feature-story-copy"><span className="public-eyebrow">0{active + 1} / {selected.title.toUpperCase()}</span><h2>{selected.heading}</h2><p>{selected.description}</p>
          <ul>{selected.points.map(point => <li key={point}><Check size={17} />{point}</li>)}</ul>
          <button onClick={onStart} className="public-text-link">Découvrir les offres <ArrowRight size={17} /></button>
        </div>
        <figure className="feature-screen"><div className="feature-screen-bar"><span /><span /><span /><small>Tâches & Cash · {selected.title}</small></div><img key={selected.shot} src={`/support/${selected.shot}.webp`} alt={`Aperçu de la vue ${selected.title} dans Tâches & Cash`} /><figcaption>Aperçu de l’interface · Données d’illustration</figcaption></figure>
      </div>
      <p className="feature-plan-note">Les modules disponibles dépendent de l’offre choisie. Retrouvez le détail sur la page Tarifs.</p>
    </section>
    <section className="feature-all"><div className="feature-all-heading"><span className="public-eyebrow">ALLER PLUS LOIN</span><h2>Explorez chaque module.</h2><p>Clients, échéances, messagerie, portail… Tout ce qui accompagne votre travail.</p></div><ModuleExplorer onCta={onStart} /></section>
  </>;
}
