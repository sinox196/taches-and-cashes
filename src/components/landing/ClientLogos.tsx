import React, { useState } from 'react';

/**
 * « Ils nous font confiance » — le bandeau des logos clients.
 *
 * N'y faire figurer que des entreprises qui ont donné leur accord : afficher
 * le logo d'une entreprise qui n'est pas cliente lui fait dire qu'elle vous
 * recommande, et relève de l'usage de marque sans autorisation.
 *
 * Pour en ajouter : déposer les fichiers dans `public/logos/clients/`
 * (servi sur `/logos/clients/…`, comme les logos CNSS/ANETI/TEJ déjà en
 * place), puis renseigner `name` et `src` ci-dessous. Un PNG ou un SVG à fond
 * transparent, hauteur utile ~80 px, donne le meilleur rendu.
 *
 * `src` renseigné mais fichier introuvable ⇒ l'emplacement vide reprend la
 * main plutôt qu'une icône d'image cassée : une faute de frappe dans un nom de
 * fichier se voit alors tout de suite.
 */
interface ClientLogo {
  /** Le nom de l'entreprise — sert aussi de texte alternatif. */
  name: string;
  /** Ex. '/logos/clients/mon-client.png'. Laisser vide tant qu'on ne l'a pas. */
  src?: string;
}

const CLIENT_LOGOS: ClientLogo[] = [
  { name: 'ETAP',                   src: '/logos/clients/etap.png' },
  { name: 'OMV',                    src: '/logos/clients/omv.png' },
  { name: 'DNA Consulting',         src: '/logos/clients/dna-consulting.png' },
  { name: 'SOPAL',                  src: '/logos/clients/sopal.png' },
  { name: 'SECIL',                  src: '/logos/clients/secil.png' },
  { name: 'Ciments de Gabès',       src: '/logos/clients/ciments-de-gabes.png' },
  { name: 'Société Pavé du Sud',    src: '/logos/clients/sps.png' },
  { name: 'Zarzis Park',            src: '/logos/clients/zarzis-park.png' },
  { name: 'OneTech',                src: '/logos/clients/onetech.png' },
  { name: 'Groupe STUDI',           src: '/logos/clients/groupe-studi.png' },
  { name: 'PEEUG',                  src: '/logos/clients/peeug.png' },
  { name: 'SIMG',                   src: '/logos/clients/simg.png' },
  { name: 'M3E',                    src: '/logos/clients/m3e.png' },
  { name: 'MEDGYP',                 src: '/logos/clients/medgyp.png' },
  { name: 'FEEDCOM',                src: '/logos/clients/feedcom.png' },
  { name: 'Green Fruits',           src: '/logos/clients/green-fruits.png' },
  { name: 'ACTIA',                  src: '/logos/clients/actia.png' },
  { name: 'ALKIMIA',                src: '/logos/clients/alkimia.png' },
  { name: 'Tunisie Carmeuse',       src: '/logos/clients/tunisie-carmeuse.png' },
  { name: 'GTI',                    src: '/logos/clients/gti.png' },
  { name: 'Ben Rehouma Industries', src: '/logos/clients/bri.png' },
  { name: 'APII',                   src: '/logos/clients/apii.png' },
  { name: 'APIA',                   src: '/logos/clients/apia.png' },
  { name: 'ACCORD Expertise Comptable', src: '/logos/clients/accord-expertise.png' },
];

const Tile: React.FC<{ logo: ClientLogo }> = ({ logo }) => {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(logo.src) && !failed;

  return (
    <div className="shrink-0 mx-5 sm:mx-8 h-[78px] w-[150px] sm:w-[172px] flex items-center justify-center">
      {showImage ? (
        // En couleur, pas en nuances de gris : la moitié de ces logos sont
        // dans des bleus et des verts clairs qui, désaturés, deviennent
        // illisibles sur fond blanc — vérifié à l'écran. Ils sont assez
        // petits et assez espacés pour ne pas se disputer l'attention.
        <img
          src={logo.src}
          alt={logo.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="max-h-[54px] max-w-full w-auto object-contain opacity-85 transition-all duration-300 hover:opacity-100 hover:scale-110"
        />
      ) : (
        <div className="w-full h-[52px] rounded-xl border border-dashed border-[#CFD6DE] bg-white/60 flex flex-col items-center justify-center gap-0.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#A6AEB9]">{logo.name}</span>
          <span className="text-[9px] text-[#BCC3CC]">à déposer</span>
        </div>
      )}
    </div>
  );
};

export const ClientLogos: React.FC = () => (
  <section className="py-14 sm:py-16 bg-white border-b border-[#EDF0F4] overflow-hidden">
    <p className="px-6 text-center text-[12px] font-bold uppercase tracking-[0.14em] text-[#8A93A0]">
      Ils nous font confiance
    </p>

    {/* Les bords s'estompent : une piste qui défile doit entrer et sortir du
        cadre au lieu d'être tranchée net. */}
    <div
      className="landing-marquee mt-9"
      style={{
        maskImage: 'linear-gradient(90deg, transparent, #000 9%, #000 91%, transparent)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 9%, #000 91%, transparent)',
      }}
    >
      {/* Deux copies de la liste, translation de la moitié : la boucle se
          referme sans saut. Propriétés d'animation une par une, jamais le
          raccourci — il pose `animation-play-state` et un style en ligne
          l'emporte sur la règle de pause au survol. */}
      <div
        className="landing-marquee-track flex w-max items-center"
        style={{
          animationName: 'landingMarquee',
          animationDuration: '44s',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
        }}
      >
        {[0, 1].map(copy => (
          <div key={copy} aria-hidden={copy === 1} className="flex shrink-0 items-center">
            {CLIENT_LOGOS.map(l => <Tile key={l.name} logo={l} />)}
          </div>
        ))}
      </div>
    </div>
  </section>
);
