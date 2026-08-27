/**
 * Mode de règlement — how a client actually paid.
 *
 * Shared between the client (the Règlements clients tab, the Clients drawer)
 * and the server (normalizeJournalEntry), the same reason roles.ts and
 * secteurs.ts are single lists read by both sides.
 *
 * The distinction that matters beyond labelling is `isCash`: the brouillard
 * de caisse is a *cash* daybook, so only an Espèce règlement belongs in it.
 * A virement or a chèque is still the client's encaissement on the Clients
 * page — it just never passes through the till.
 */
export type PaymentMode = 'ESPECE' | 'VIREMENT' | 'CHEQUE' | 'LETTRE_DE_CHANGE' | 'AUTRE';

export const PAYMENT_MODES: { id: PaymentMode; label: string; isCash: boolean }[] = [
  { id: 'ESPECE', label: 'Espèce', isCash: true },
  { id: 'VIREMENT', label: 'Virement', isCash: false },
  { id: 'CHEQUE', label: 'Chèque', isCash: false },
  { id: 'LETTRE_DE_CHANGE', label: 'Lettre de change', isCash: false },
  { id: 'AUTRE', label: 'Autre', isCash: false },
];

const BY_ID = new Map(PAYMENT_MODES.map(m => [m.id, m]));

export const paymentModeLabel = (mode: string | null | undefined): string =>
  BY_ID.get(String(mode || '') as PaymentMode)?.label || String(mode || '');

/**
 * Whether a row is a cash movement, i.e. whether it belongs in the brouillard.
 *
 * An empty mode reads as cash on purpose. The daybook's own movements — loyer,
 * STEG, alimentation de caisse — predate this field and carry no mode at all;
 * treating "unset" as non-cash would empty the journal of every row the
 * cabinet has already entered.
 */
export const isCashMode = (mode: string | null | undefined): boolean => {
  const id = String(mode || '').trim();
  if (!id) return true;
  return BY_ID.get(id as PaymentMode)?.isCash ?? true;
};

/** Normalises whatever is stored to a known id, or '' when it is not one. */
export const toPaymentMode = (mode: string | null | undefined): PaymentMode | '' => {
  const id = String(mode || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return BY_ID.has(id as PaymentMode) ? (id as PaymentMode) : '';
};
