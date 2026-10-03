import React from 'react';
import { SupportView } from './landing/SupportView';

/**
 * L'entrée de nav « Support » à l'intérieur de l'app authentifiée. Même
 * contenu que le site public — guide, FAQ, Démarrage rapide, canaux de
 * contact — monté avec `embedded` pour ne pas réserver la hauteur de la
 * barre de navigation publique fixe qui n'existe pas ici. Les coordonnées de
 * contact sont une copie locale, comme `InvoicePreview.tsx` en garde déjà
 * une : ni l'un ni l'autre ne partage de fichier de constantes dédié avec
 * `Landing.tsx`.
 */
const CONTACT_EMAIL = 'contact@taches-and-cash.com';
const CONTACT_PHONE = '+216 46 229 339';
const CONTACT_WHATSAPP_URL = `https://wa.me/${CONTACT_PHONE.replace(/[^\d]/g, '')}`;

export const SupportPage: React.FC = () => (
  <SupportView
    embedded
    contactEmail={CONTACT_EMAIL}
    contactPhone={CONTACT_PHONE}
    whatsappUrl={CONTACT_WHATSAPP_URL}
    guideHref="/guide/Guide-Taches-et-Cash.docx"
  />
);
