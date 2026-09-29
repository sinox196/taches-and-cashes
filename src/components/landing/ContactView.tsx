import React, { useState } from 'react';
import { ArrowRight, Mail, Phone, MessageCircle, LifeBuoy, Check } from 'lucide-react';

export function ContactView({ email, phone, whatsappUrl, onSupport }: {
  email: string; phone: string; whatsappUrl: string; onSupport: () => void;
}) {
  const [intent, setIntent] = useState('Découvrir la plateforme');
  const [prepared, setPrepared] = useState(false);
  const [draftHref, setDraftHref] = useState('');
  const prepare = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = `Bonjour,\n\n${data.get('message')}\n\n${data.get('name')}\n${data.get('company') || ''}\n${data.get('email')}`;
    const href = `mailto:${email}?subject=${encodeURIComponent(intent)}&body=${encodeURIComponent(body)}`;
    setDraftHref(href);
    setPrepared(true);
    window.location.href = href;
  };
  return (
    <div className="contact-page">
      <section className="public-page-intro">
        <span className="public-eyebrow">PARLONS DE VOTRE ÉQUIPE</span>
        <h1>Un projet, une question ?<br /><span>Faisons connaissance.</span></h1>
        <p>Choisir une offre, découvrir la plateforme ou accompagner votre équipe : échangeons sur ce dont vous avez besoin.</p>
      </section>
      <section className="contact-layout" aria-label="Nous contacter">
        <div className="contact-details">
          <div className="contact-note"><span className="public-eyebrow">TÂCHES & CASH</span><h2>Votre activité mérite<br />toute notre attention.</h2><p>Expliquez-nous votre quotidien. Nous vous aiderons à trouver le bon point de départ.</p></div>
          {[
            { icon: Mail, title: 'Écrivez-nous', value: email, href: `mailto:${email}` },
            { icon: Phone, title: 'Appelez-nous', value: phone, href: `tel:${phone.replace(/\s/g, '')}` },
            { icon: MessageCircle, title: 'Échangeons sur WhatsApp', value: 'Ouvrir la conversation', href: whatsappUrl },
          ].map(({ icon: Icon, title, value, href }) => <a key={title} href={href} className="contact-channel" {...(href.startsWith('https:') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            <span className="contact-channel-icon"><Icon size={21} /></span><span><small>{title}</small><strong>{value}</strong></span><ArrowRight size={18} />
          </a>)}
          <button onClick={onSupport} className="contact-help"><LifeBuoy size={21} /><span>Déjà utilisateur ?<strong>Consulter le centre d’assistance</strong></span><ArrowRight size={17} /></button>
        </div>
        <form onSubmit={prepare} className="contact-form" onChange={() => setPrepared(false)}>
          <span className="public-eyebrow">VOTRE MESSAGE</span><h2>Comment pouvons-nous vous aider ?</h2>
          <fieldset><legend>Je souhaite…</legend><div className="contact-intents">
            {['Découvrir la plateforme', 'Choisir une offre', 'Être accompagné'].map(item => <label key={item}>
              <input type="radio" name="intent" value={item} checked={intent === item} onChange={() => setIntent(item)} /><span>{item}</span>
            </label>)}
          </div></fieldset>
          <div className="contact-field-row">
            <label>Votre nom<input name="name" autoComplete="name" required maxLength={100} placeholder="Prénom et nom" /></label>
            <label>Votre entreprise <small>(facultatif)</small><input name="company" autoComplete="organization" maxLength={150} placeholder="Nom de votre entreprise" /></label>
          </div>
          <label>Votre adresse email<input name="email" type="email" autoComplete="email" required placeholder="vous@entreprise.com" /></label>
          <label>Votre message<textarea name="message" required minLength={10} maxLength={3000} rows={5} placeholder="Votre équipe, votre activité, ce que vous aimeriez simplifier…" /></label>
          <button type="submit" className="public-button">Préparer mon email <ArrowRight size={17} /></button>
          <p className="contact-form-hint">Votre messagerie s’ouvre avec ce message prérempli. Vous pourrez le vérifier avant de l’envoyer.</p>
          {prepared && <div role="status" className="contact-confirmation"><Check size={18} /><p>Votre message est prêt. Finalisez l’envoi dans votre messagerie. <a href={draftHref}>Rouvrir le brouillon</a> ou écrivez à {email}.</p></div>}
        </form>
      </section>
    </div>
  );
}
