import React from 'react';

/**
 * The brand mark from the charte graphique: an open ring (a clock face with
 * its gap standing in for "time"), a checkmark ("tâches" done), three
 * ascending bars ("croissance"), and a turquoise dot marking the gap.
 *
 * `variant="color"` is the mark on a light surface (favicon, a light card):
 * navy ring and check, turquoise bars and dot. `variant="white"` is for the
 * navy sidebar and the navy login badge — ring and check turn white, but the
 * turquoise stays turquoise, the same rule the charte's own dark lockup uses
 * (the wordmark's "&" and the bars keep their colour against navy; only the
 * ink flips).
 */
interface LogoProps {
  size?: number;
  variant?: 'color' | 'white';
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ size = 24, variant = 'color', className }) => {
  const ink = variant === 'white' ? '#FFFFFF' : '#0D1B2A';
  const accent = '#00B3A6';
  // The growth bars read as texture, not shape, under ~32px — a sidebar or
  // login badge is smaller than that, so they drop out rather than render as
  // an illegible smudge. Ring, check and dot stay legible at any size.
  const showBars = size >= 32;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Ring with a gap at the upper right, where the dot sits. */}
      <circle
        cx="12" cy="12" r="9"
        stroke={ink}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeDasharray="47.5 8.5"
        transform="rotate(-58 12 12)"
      />
      {showBars && (
        <>
          {/* Growth bars, ascending left to right. */}
          <rect x="7.4"  y="14.8" width="1.9" height="3.6" rx="0.6" fill={accent} />
          <rect x="11"   y="12.4" width="1.9" height="6"   rx="0.6" fill={accent} />
          <rect x="14.6" y="10"   width="1.9" height="8.4" rx="0.6" fill={accent} />
        </>
      )}
      {/* Checkmark. */}
      <path
        d="M7.6 10.6l2.3 2.3 4.6-5"
        stroke={ink}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The dot marking the gap. */}
      <circle cx="18.4" cy="6.7" r="1.5" fill={accent} />
    </svg>
  );
};
