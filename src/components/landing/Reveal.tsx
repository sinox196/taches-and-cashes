import React, { useEffect, useRef, useState } from 'react';

/**
 * Fait entrer un bloc quand il arrive à l'écran — la seule animation de la
 * page d'accueil qui se déclenche au défilement.
 *
 * Trois précautions, parce qu'une animation d'apparition rate toujours de la
 * même façon : en laissant du contenu invisible.
 *
 * - `prefers-reduced-motion` rend le bloc **visible immédiatement**, sans
 *   transition. Même règle que les toasts : on respecte le réglage, on ne
 *   cache pas le contenu pour autant.
 * - Sans `IntersectionObserver` (navigateur ancien, environnement de test),
 *   l'état initial est « visible ». Le défaut est de montrer, jamais de
 *   masquer.
 * - L'observation s'arrête à la première apparition : rejouer l'animation à
 *   chaque passage transforme un défilement normal en clignotement.
 */
type Direction = 'up' | 'left' | 'right' | 'scale';

const OFFSETS: Record<Direction, string> = {
  up: 'translateY(26px)',
  left: 'translateX(-28px)',
  right: 'translateX(28px)',
  scale: 'scale(0.94)',
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface RevealProps {
  children: React.ReactNode;
  /** Décalage en ms : c'est lui qui fait monter une grille en cascade
   *  plutôt que d'un seul bloc. */
  delay?: number;
  direction?: Direction;
  className?: string;
  style?: React.CSSProperties;
}

export const Reveal: React.FC<RevealProps> = ({
  children,
  delay = 0,
  direction = 'up',
  className = '',
  style,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(
    () => prefersReducedMotion() || typeof IntersectionObserver === 'undefined',
  );

  useEffect(() => {
    if (shown) return;
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      // Se déclenche un peu avant le bord bas : le bloc est déjà en place
      // quand le regard y arrive, au lieu de s'animer sous les yeux.
      { threshold: 0.12, rootMargin: '0px 0px -60px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...style,
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : OFFSETS[direction],
        transition: prefersReducedMotion()
          ? 'none'
          : `opacity 700ms cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 700ms cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
        willChange: shown ? undefined : 'opacity, transform',
      }}
    >
      {children}
    </div>
  );
};

/**
 * Un nombre qui compte jusqu'à sa valeur la première fois qu'on le voit.
 *
 * `toLocaleString('fr-FR')` comme partout ailleurs dans l'application, et la
 * valeur finale est écrite telle quelle sous `prefers-reduced-motion` — un
 * chiffre qui défile n'apporte rien à qui a demandé moins de mouvement.
 */
export const CountUp: React.FC<{
  to: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  durationMs?: number;
  className?: string;
}> = ({ to, suffix = '', prefix = '', decimals = 0, durationMs = 1600, className }) => {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(() => (prefersReducedMotion() ? to : 0));

  useEffect(() => {
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      setValue(to);
      return;
    }
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(e => e.isIntersecting)) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / durationMs);
          // Sortie en douceur : la fin d'un compteur doit ralentir, sinon il
          // s'arrête net sur un chiffre qui avait l'air de continuer.
          setValue(to * (1 - Math.pow(1 - t, 3)));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [to, durationMs]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {value.toLocaleString('fr-FR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
};
