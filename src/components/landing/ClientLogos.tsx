import React, { useState } from 'react';

/**
 * « Ils nous font confiance » — le bandeau des logos clients.
 *
 * ⚠️ AUCUN LOGO RÉEL N'EST LIVRÉ ICI. Chaque entrée sans `src` s'affiche en
 * **emplacement vide** clairement identifié. Afficher le logo d'une entreprise
 * qui n'est pas cliente lui fait dire qu'elle vous recommande : c'est un faux
 * témoignage, et un usage de marque sans autorisation.
 *
 * Pour mettre les vrais : déposer les fichiers dans `public/logos/clients/`
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
  { name: 'Logo client 1' },
  { name: 'Logo client 2' },
  { name: 'Logo client 3' },
  { name: 'Logo client 4' },
  { name: 'Logo client 5' },
  { name: 'Logo client 6' },
  { name: 'Logo client 7' },
  { name: 'Logo client 8' },
];

const Tile: React.FC<{ logo: ClientLogo }> = ({ logo }) => {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(logo.src) && !failed;

  return (
    <div className="shrink-0 mx-5 sm:mx-8 h-[64px] w-[150px] sm:w-[176px] flex items-center justify-center">
      {showImage ? (
        // En nuances de gris au repos : huit logos de marques différentes
        // côte à côte se disputent l'attention et font oublier la page. La
        // couleur revient sur celui qu'on survole.
        <img
          src={logo.src}
          alt={logo.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="max-h-[44px] max-w-full w-auto object-contain grayscale opacity-60 transition-all duration-300 hover:grayscale-0 hover:opacity-100 hover:scale-105"
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
  <section className="py-16 sm:py-20 bg-white overflow-hidden">
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
