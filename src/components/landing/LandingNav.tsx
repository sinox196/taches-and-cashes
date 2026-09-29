import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';
import { Logo } from '../Logo';

export type PublicView = 'home' | 'fonctionnalites' | 'tarifs' | 'apropos' | 'support' | 'contact';
const links: { id: PublicView; label: string }[] = [
  { id: 'fonctionnalites', label: 'Fonctionnalités' },
  { id: 'tarifs', label: 'Tarifs' },
  { id: 'apropos', label: 'À propos' },
  { id: 'support', label: 'Support' },
  { id: 'contact', label: 'Contact' },
];

export function LandingNav({ view, scrolled, onNavigate, onLogin }: {
  view: PublicView; scrolled: boolean; onNavigate: (view: PublicView) => void; onLogin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) { setOpen(false); toggle.current?.focus(); }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  const navigate = (next: PublicView) => { setOpen(false); onNavigate(next); };
  return (
    <header ref={header} className={`public-header ${scrolled ? 'is-scrolled' : ''}`}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <div className="public-nav">
        <button onClick={() => navigate('home')} className="brand-lockup" aria-label="Tâches & Cash — accueil">
          <Logo size={36} variant="color" />
          <span>Tâches <span className="text-turquoise">&</span> Cash<small>VOTRE TEMPS A DE LA VALEUR</small></span>
        </button>
        <nav className="public-desktop-nav" aria-label="Navigation principale">
          {links.map(link => <button key={link.id} onClick={() => navigate(link.id)} className="landing-navlink"
            data-active={view === link.id} aria-current={view === link.id ? 'page' : undefined}>{link.label}</button>)}
        </nav>
        <div className="public-nav-actions">
          <button onClick={onLogin} className="public-login">Se connecter</button>
          <button onClick={() => navigate('tarifs')} className="public-button public-nav-cta">Essayer gratuitement <ArrowRight size={15} /></button>
          <button ref={toggle} onClick={() => setOpen(v => !v)} className="public-menu-toggle" aria-expanded={open}
            aria-controls="public-mobile-menu" aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}>
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {open && <nav id="public-mobile-menu" className="public-mobile-nav" aria-label="Navigation mobile">
        {links.map((link, i) => <button key={link.id} onClick={() => navigate(link.id)} aria-current={view === link.id ? 'page' : undefined}>
          <span><small>0{i + 1}</small>{link.label}</span><ArrowRight size={17} />
        </button>)}
        <button className="public-button" onClick={() => navigate('tarifs')}>Essayer gratuitement <ArrowRight size={17} /></button>
      </nav>}
    </header>
  );
}
