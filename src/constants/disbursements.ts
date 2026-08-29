/**
 * Remboursement de débours — ligne (8) de la cascade de facturation.
 *
 * Une facture peut en porter plusieurs : des frais de greffe et des timbres
 * avancés pour le même dossier sont deux dépenses distinctes, et les fondre
 * dans un seul montant oblige le client à demander le détail par téléphone.
 *
 * Lu par les deux côtés, comme `roles.ts` et `paymentModes.ts` : le serveur
 * fait la somme qui entre dans la cascade, l'éditeur et les deux rendus
 * (aperçu, PDF) dessinent les mêmes lignes. Une seule normalisation, sinon
 * l'aperçu et le document imprimé finiraient par ne pas dire la même chose.
 */

export interface DisbursementLine {
  /** Ce qui a été avancé. Facultatif — le montant seul suffit à la cascade. */
  label: string;
  amount: number;
}

/** Longueur du libellé, alignée sur ce que la colonne du PDF peut afficher. */
export const DISBURSEMENT_LABEL_MAX = 120;

/** Nombre de lignes acceptées — au-delà, c'est une facture, pas des débours. */
export const DISBURSEMENT_LINES_MAX = 20;

const round3 = (v: number) => Math.round(v * 1000) / 1000;

const toAmount = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? round3(n) : 0;
};

/**
 * Ramène un document à sa liste de lignes de débours, quelle que soit la forme
 * dans laquelle il a été enregistré.
 *
 * Les documents antérieurs à cette version portent un montant unique
 * (`disbursements`) et un libellé unique (`disbursementsLabel`) : ils sont
 * relus comme une ligne unique plutôt que réécrits en base — même idée que
 * `normalizeBalance()` pour les soldes de congés. Un document déjà émis ne se
 * modifie pas pour faire plaisir à un nouveau champ.
 */
export function normalizeDisbursementLines(invoice: any): DisbursementLine[] {
  if (Array.isArray(invoice?.disbursementsLines)) {
    return invoice.disbursementsLines
      .map((l: any) => ({
        label: String(l?.label ?? '').trim().slice(0, DISBURSEMENT_LABEL_MAX),
        amount: toAmount(l?.amount),
      }))
      // Une ligne sans montant ni libellé n'est pas une dépense : c'est une
      // ligne que l'utilisateur a ajoutée puis laissée vide.
      .filter((l: DisbursementLine) => l.amount !== 0 || l.label !== '')
      .slice(0, DISBURSEMENT_LINES_MAX);
  }

  const legacy = toAmount(invoice?.disbursements);
  if (legacy === 0) return [];
  return [{
    label: String(invoice?.disbursementsLabel ?? '').trim().slice(0, DISBURSEMENT_LABEL_MAX),
    amount: legacy,
  }];
}

/** Le montant qui entre en (8) : la somme des lignes, jamais un champ à part. */
export function sumDisbursements(lines: DisbursementLine[]): number {
  return round3(lines.reduce((s, l) => s + l.amount, 0));
}
