import React, { useEffect, useRef, useState } from 'react';

/**
 * La marque en mouvement — la version animée de [Logo.tsx](../Logo.tsx), pour
 * la page publique uniquement. Mêmes coordonnées, mêmes couleurs : c'est le
 * même dessin, pas une seconde marque qui finirait par diverger de la charte.
 *
 * Trois gestes, dans cet ordre :
 *  1. l'anneau se dessine, du haut vers la droite ;
 *  2. le trait de validation se trace ;
 *  3. les trois barres de croissance montent, l'une après l'autre.
 *
 * Ensuite seulement la boucle démarre : l'anneau et son point tournent
 * lentement (le point marque le trou de l'anneau — ils doivent tourner
 * ensemble, sinon le point se détache du dessin) et le point bat.
 *
 * `prefers-reduced-motion` rend la marque **finie et immobile**, jamais figée
 * à l'état de départ — un anneau non dessiné n'est pas un logo.
 */
const RING_LEN = 56.5; // 2πr à r = 9, moins le trou de la charte

interface AnimatedLogoProps {
  size?: number;
  variant?: 'color' | 'white';
  className?: string;
  /** Rejoue le tracé à chaque survol du conteneur (l'en-tête s'en sert). */
  replayOnHover?: boolean;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const AnimatedLogo: React.FC<AnimatedLogoProps> = ({
  size = 24,
  variant = 'color',
  className = '',
  replayOnHover = false,
}) => {
  const ink = variant === 'white' ? '#FFFFFF' : '#0D1B2A';
  const accent = '#00B3A6';
  const showBars = size >= 32;

  const ref = useRef<HTMLSpanElement | null>(null);
  const reduced = prefersReducedMotion();
  const [play, setPlay] = useState(reduced);
  // Une clé qui change relance les animations CSS : elles ne se rejouent pas
  // toutes seules sur un nœud déjà monté.
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (play || typeof IntersectionObserver === 'undefined') {
      setPlay(true);
      return;
    }
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setPlay(true);
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [play]);

  // Sous réglage réduit : le dessin est complet, rien ne bouge.
  const draw = (delay: number, duration: number, len: number) =>
    reduced || !play
      ? { strokeDasharray: 'none' as const, strokeDashoffset: 0 }
      : {
          strokeDasharray: len,
          ['--draw' as string]: len,
          animation: `landingDraw ${duration}ms cubic-bezier(0.65,0,0.35,1) ${delay}ms both`,
        };

  return (
    <span
      ref={ref}
      className={`inline-flex ${className}`}
      onMouseEnter={replayOnHover && !reduced ? () => setRun(r => r + 1) : undefined}
    >
      <svg key={run} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* Anneau + point : un seul groupe, donc une seule rotation. */}
        <g
          style={
            reduced || !play
              ? undefined
              : { animation: 'landingRingSpin 14s linear 1200ms infinite', transformOrigin: '12px 12px' }
          }
        >
          <circle
            cx="12" cy="12" r="9"
            stroke={ink}
            strokeWidth="2.1"
            strokeLinecap="round"
            transform="rotate(-58 12 12)"
            style={
              reduced || !play
                ? { strokeDasharray: '47.5 8.5' }
                : {
                    strokeDasharray: '47.5 8.5',
                    ['--draw' as string]: RING_LEN,
                    strokeDashoffset: 0,
                    animation: `landingDraw 900ms cubic-bezier(0.65,0,0.35,1) both`,
                  }
            }
          />
          <circle
            cx="18.4" cy="6.7" r="1.5"
            fill={accent}
            style={
              reduced || !play
                ? undefined
                : { animation: 'landingDotBeat 2.4s ease-in-out 1400ms infinite', transformOrigin: '18.4px 6.7px' }
            }
          />
        </g>

        {showBars && (
          <>
            {[
              { x: 7.4, y: 14.8, h: 3.6, d: 1000 },
              { x: 11, y: 12.4, h: 6, d: 1120 },
              { x: 14.6, y: 10, h: 8.4, d: 1240 },
            ].map(b => (
              <rect
                key={b.x}
                x={b.x} y={b.y} width="1.9" height={b.h} rx="0.6" fill={accent}
                style={
                  reduced || !play
                    ? undefined
                    : {
                        // Origine en bas de la barre : elle pousse depuis le
                        // sol au lieu de se déplier depuis son milieu.
                        transformOrigin: `${b.x + 0.95}px 18.4px`,
                        animation: `landingBarRise 520ms cubic-bezier(0.16,1,0.3,1) ${b.d}ms both`,
                      }
                }
              />
            ))}
          </>
        )}

        <path
          d="M7.6 10.6l2.3 2.3 4.6-5"
          stroke={ink}
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={draw(700, 520, 11)}
        />
      </svg>
    </span>
  );
};
