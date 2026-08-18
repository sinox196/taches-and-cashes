/**
 * French amount-in-words for the invoice footer required by the cahier des
 * charges, e.g. 1379.100 →
 *   "Mille Trois Cent Soixante-Dix-Neuf Dinars Et Cent Millimes"
 *
 * Tunisian dinars carry three decimals (millimes), so the fractional part is
 * read as a whole number of millimes rather than as cents.
 */

const UNITS = [
  '', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
  'dix-sept', 'dix-huit', 'dix-neuf',
];

const TENS: Record<number, string> = {
  2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante',
  7: 'soixante', 8: 'quatre-vingt', 9: 'quatre-vingt',
};

/** 0–99 in French, including the 70/80/90 irregularities. */
function underHundred(n: number): string {
  if (n < 20) return UNITS[n];
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  // 70–79 and 90–99 are built on soixante / quatre-vingt + 10..19
  if (tens === 7 || tens === 9) {
    const base = TENS[tens];
    const rest = UNITS[10 + unit];
    return unit === 1 && tens === 7 ? `${base}-et-onze` : `${base}-${rest}`;
  }
  if (unit === 0) return tens === 8 ? 'quatre-vingts' : TENS[tens];
  if (unit === 1 && tens !== 8) return `${TENS[tens]}-et-un`;
  return `${TENS[tens]}-${UNITS[unit]}`;
}

/** 0–999. */
function underThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return underHundred(rest);
  // "cent" is plural only when it ends the group: 200 → deux cents, 201 → deux cent un
  const head = hundreds === 1 ? 'cent' : `${UNITS[hundreds]} cent${rest === 0 ? 's' : ''}`;
  return rest === 0 ? head : `${head} ${underHundred(rest)}`;
}

const SCALES: { value: number; one: string; many: string }[] = [
  { value: 1_000_000_000, one: 'un milliard', many: 'milliards' },
  { value: 1_000_000, one: 'un million', many: 'millions' },
  { value: 1_000, one: 'mille', many: 'mille' }, // "mille" is invariable
];

/** Whole number in French words. */
export function integerToFrenchWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'zéro';

  const parts: string[] = [];
  for (const scale of SCALES) {
    if (n < scale.value) continue;
    const count = Math.floor(n / scale.value);
    n %= scale.value;
    if (scale.value === 1_000) {
      parts.push(count === 1 ? 'mille' : `${underThousand(count)} mille`);
    } else {
      parts.push(count === 1 ? scale.one : `${underThousand(count)} ${scale.many}`);
    }
  }
  if (n > 0) parts.push(underThousand(n));
  return parts.join(' ');
}

/** "mille trois cent" → "Mille Trois Cent" (the cahier des charges uses title case). */
function titleCase(s: string): string {
  return s.replace(/(^|[\s-])([a-zà-ÿ])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

/**
 * Full amount in words: dinars and, when non-zero, millimes.
 * `1379.1` → "Mille Trois Cent Soixante-Dix-Neuf Dinars Et Cent Millimes".
 */
export function amountToFrenchWords(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.abs(amount) : 0;
  // Work in millimes to avoid float drift (1379.1 * 1000 = 1379099.9999)
  const totalMillimes = Math.round(safe * 1000);
  const dinars = Math.floor(totalMillimes / 1000);
  const millimes = totalMillimes % 1000;

  // French: singular after zero and one; "de dinars" after a bare million/milliard.
  const plural = dinars > 1 ? 'Dinars' : 'Dinar';
  const needsDe = dinars >= 1_000_000 && dinars % 1_000_000 === 0;
  const dinarPart = `${integerToFrenchWords(dinars)} ${needsDe ? 'de ' : ''}${plural}`;
  if (millimes === 0) return titleCase(dinarPart);

  const millimePart = `${integerToFrenchWords(millimes)} ${millimes === 1 ? 'Millime' : 'Millimes'}`;
  return titleCase(`${dinarPart} et ${millimePart}`);
}
