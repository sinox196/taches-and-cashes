import React from 'react';
import { Star, Quote } from 'lucide-react';

/**
 * Les avis clients.
 *
 * ⚠️ CONTENU À REMPLACER. Les témoignages ci-dessous sont des **exemples de
 * mise en page**, pas de vrais avis : ils servent à caler la typographie et la
 * longueur des citations. Publier un avis inventé sous le nom d'un cabinet qui
 * ne l'a pas donné est trompeur pour le visiteur — et, dans la plupart des
 * pays, sanctionné comme pratique commerciale déloyale. Remplacer chaque
 * entrée par une citation réellement recueillie, avec l'accord de son auteur,
 * avant la mise en ligne.
 *
 * La note globale (`RATING`) suit la même règle : elle doit refléter des avis
 * réels ou disparaître.
 */
interface Testimonial {
  quote: string;
  name: string;
  role: string;
  initials: string;
  stars: number;
}

const TESTIMONIALS: Testimonial[] = [
  {
    quote: "Avant, je savais ce que je facturais. Je ne savais pas ce que ça me coûtait. La marge par client a changé la façon dont on choisit nos dossiers.",
    name: 'Exemple à remplacer', role: 'Expert-comptable', initials: 'EC', stars: 5,
  },
  {
    quote: "La grille des échéances est exactement notre feuille de suivi, en version partagée. Plus personne ne demande où on en est sur une déclaration.",
    name: 'Exemple à remplacer', role: 'Responsable fiscal', initials: 'RF', stars: 5,
  },
  {
    quote: "Le portail a supprimé la moitié des appels de relance. Le client voit son solde et ses factures, il n'a plus besoin de nous téléphoner.",
    name: 'Exemple à remplacer', role: 'Associé gérant', initials: 'AG', stars: 5,
  },
  {
    quote: "Le chronomètre suit les collaborateurs de page en page. On a récupéré des heures qui n'étaient tout simplement jamais saisies.",
    name: 'Exemple à remplacer', role: 'Directrice de mission', initials: 'DM', stars: 5,
  },
  {
    quote: "Les congés, les avances et les autorisations sont partis du papier en une semaine. Le solde se met à jour tout seul.",
    name: 'Exemple à remplacer', role: 'Office manager', initials: 'OM', stars: 4,
  },
  {
    quote: "La facture sort conforme du premier coup — retenue, timbre, montant en lettres. On ne repasse plus derrière.",
    name: 'Exemple à remplacer', role: 'Comptable senior', initials: 'CS', stars: 5,
  },
];

const RATING = { score: '4,9', count: 'avis vérifiés' };

const Card: React.FC<{ t: Testimonial }> = ({ t }) => (
  <figure className="w-[330px] sm:w-[380px] shrink-0 bg-white rounded-[20px] border border-[#E6E9EE] p-6 mx-3 transition-all duration-300 hover:-translate-y-1.5 hover:border-turquoise/45 hover:shadow-[0_18px_38px_rgba(13,27,42,0.10)]">
    <div className="flex items-center justify-between">
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            className={`w-4 h-4 ${i < t.stars ? 'fill-[#F5A524] text-[#F5A524]' : 'text-[#D7DCE3]'}`}
          />
        ))}
      </div>
      <Quote className="w-6 h-6 text-turquoise/25" />
    </div>
    <blockquote className="mt-4 text-[14.5px] leading-[1.65] text-[#3D4655]">“{t.quote}”</blockquote>
    <figcaption className="mt-5 pt-4 border-t border-[#F0F2F5] flex items-center gap-3">
      <span className="w-9 h-9 rounded-full bg-navy text-white text-[12px] font-extrabold flex items-center justify-center shrink-0">
        {t.initials}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-bold text-navy truncate">{t.name}</span>
        <span className="block text-[12px] text-[#8A93A0] truncate">{t.role}</span>
      </span>
    </figcaption>
  </figure>
);

/**
 * Deux pistes qui défilent en sens inverse, et s'arrêtent au survol : on lit
 * l'avis qu'on vise au lieu de le poursuivre. Chaque piste porte deux fois sa
 * liste et se translate de la moitié de sa largeur — la boucle se referme sans
 * saut, quelle que soit la largeur de l'écran. La seconde copie est
 * `aria-hidden` pour qu'un lecteur d'écran n'énumère pas les avis en double.
 */
const Row: React.FC<{ items: Testimonial[]; reverse?: boolean; duration: number }> = ({
  items, reverse, duration,
}) => (
  <div className="landing-marquee overflow-hidden py-3">
    {/* Les propriétés une par une, jamais le raccourci `animation` : le
        raccourci pose aussi `animation-play-state: running`, et un style en
        ligne l'emporte sur la feuille — la pause au survol ne prenait jamais. */}
    <div
      className="landing-marquee-track flex w-max"
      style={{
        animationName: reverse ? 'landingMarqueeBack' : 'landingMarquee',
        animationDuration: `${duration}s`,
        animationTimingFunction: 'linear',
        animationIterationCount: 'infinite',
      }}
    >
      {[0, 1].map(copy => (
        <div key={copy} aria-hidden={copy === 1} className="flex shrink-0">
          {items.map(t => <Card key={t.quote} t={t} />)}
        </div>
      ))}
    </div>
  </div>
);

export const Testimonials: React.FC = () => (
  <section id="avis" className="py-24 sm:py-[104px] bg-[#F2F4F7] overflow-hidden">
    <div className="px-6 sm:px-10">
      <div className="max-w-[640px] mx-auto text-center">
        <div className="inline-flex px-3.5 py-1.5 bg-white border border-[#E6E9EE] rounded-full text-[12px] font-bold tracking-[0.06em] uppercase text-[#00857C]">
          Avis clients
        </div>
        <h2 className="mt-[18px] text-[26px] sm:text-[32px] font-extrabold text-navy tracking-[-0.01em]">
          Ce que les cabinets en disent
        </h2>
        <div className="mt-5 inline-flex items-center gap-3 bg-white border border-[#E6E9EE] rounded-full pl-4 pr-5 py-2">
          <span className="flex gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className="w-4 h-4 fill-[#F5A524] text-[#F5A524] animate-[landingStarPop_500ms_cubic-bezier(0.16,1,0.3,1)_both]"
                style={{ animationDelay: `${i * 90}ms` }}
              />
            ))}
          </span>
          <span className="text-[13.5px] font-bold text-navy">{RATING.score}</span>
          <span className="text-[13px] text-[#8A93A0]">{RATING.count}</span>
        </div>
      </div>
    </div>

    <div className="mt-12">
      <Row items={TESTIMONIALS} duration={52} />
      <Row items={[...TESTIMONIALS].reverse()} reverse duration={62} />
    </div>
  </section>
);
