/**
 * Catalogue de missions et de types de tâches livré d'office à chaque
 * entreprise d'un secteur.
 *
 * Ce n'est pas du contenu d'exemple : c'est le tableau de bord réel du
 * cabinet (« Missions et tâches »), repris tel quel — même règle que les
 * modèles de documents et les colonnes d'échéances de Ressources métier, dont
 * le contenu de départ est celui du cabinet et non un remplissage. Une
 * entreprise du secteur le trouve donc déjà en place à sa première connexion,
 * et reste libre d'y ajouter les siennes, de les renommer ou de les
 * supprimer : ce qu'elle en fait ensuite lui appartient (`seedSectorMissions`
 * ne pose le catalogue qu'une fois, voir CLAUDE.md).
 *
 * Une seule correction par rapport au fichier d'origine : « Contrat de
 * trvail » y est écrit ainsi, et l'intitulé apparaîtrait tel quel dans le
 * formulaire de pointage de chaque cabinet.
 *
 * Les intitulés datés (« Mois 1/2026 », « Trimestre 1/2026 », « états
 * financiers 2025 ») viennent du fichier et sont **volontairement** laissés
 * en dur : le cabinet raisonne par exercice et renomme sa liste chaque année.
 * Rien ici ne génère d'occurrence ni ne calcule d'échéance — c'est un
 * catalogue d'intitulés, pas un moteur de récurrence, exactement comme la
 * grille des échéances de Ressources métier.
 */
export interface SectorMissionSeed {
  name: string;
  taskTypes: string[];
}

/**
 * Par secteur (voir [secteurs.ts](./secteurs.ts)). `CABINET` seul est servi
 * aujourd'hui — c'est du contenu de cabinet comptable, il n'aurait aucun sens
 * ailleurs. Ajouter un secteur, c'est ajouter une clé ici, rien d'autre.
 */
export const SECTOR_MISSIONS: Record<string, SectorMissionSeed[]> = {
  CABINET: [
    {
      name: 'Tenue de comptabilité',
      taskTypes: [
        'Collecte des documents auprès du client',
        'Relance - Collecte des documents auprès du client',
        'Classement des documents',
        'Saisie des écritures comptables',
        'Lettrage des comptes',
      ],
    },
    {
      name: 'Fiscalité',
      taskTypes: [
        'Préparation déclaration Mois 1/2026',
        'Préparation déclaration Mois 2/2026',
        'Préparation déclaration Mois 3/2026',
        'Préparation déclaration Mois 4/2026',
        'Préparation déclaration Mois 5/2026',
        'Préparation déclaration Mois 6/2026',
        'Préparation déclaration Mois 7/2026',
        'Préparation déclaration Mois 8/2026',
        'Préparation déclaration Mois 9/2026',
        'Préparation déclaration Mois 10/2026',
        'Préparation déclaration Mois 11/2026',
        'Préparation déclaration Mois 12/2026',
        'Dépôt - déclaration Mois 1/2026',
        'Dépôt - déclaration Mois 2/2026',
        'Dépôt - déclaration Mois 3/2026',
        'Dépôt - déclaration Mois 4/2026',
        'Dépôt - déclaration Mois 5/2026',
        'Dépôt - déclaration Mois 6/2026',
        'Dépôt - déclaration Mois 7/2026',
        'Dépôt - déclaration Mois 8/2026',
        'Dépôt - déclaration Mois 9/2026',
        'Dépôt - déclaration Mois 10/2026',
        'Dépôt - déclaration Mois 11/2026',
        'Dépôt - déclaration Mois 12/2026',
        'Préparation - Acompte provisionnel 1/2026',
        'Dépôt - Acompte provisionnel 1/2026',
        'Préparation - Acompte provisionnel 2/2026',
        'Dépôt - Acompte provisionnel 2/2026',
        'Préparation - Acompte provisionnel 3/2026',
        'Dépôt - Acompte provisionnel 3/2026',
        'Préparation - Déclaration employeur 2026',
        'Dépôt - Déclaration employeur 2026',
      ],
    },
    {
      name: 'Juridique',
      taskTypes: [
        'Préparation - PV AGO',
        'Préparation - PV AGE',
      ],
    },
    {
      name: 'RNE',
      taskTypes: [
        'Dépôt des états financiers 2025 au RNE',
      ],
    },
    {
      name: 'Contrat de travail',
      taskTypes: [
        'Préparation de contrat CDI',
        'Préparation de contrat CIVP',
        'Préparation de contrat Karama',
      ],
    },
    {
      name: 'CNSS',
      taskTypes: [
        'Fiches de paie Mois 1/2026',
        'Fiches de paie Mois 2/2026',
        'Fiches de paie Mois 3/2026',
        'Fiches de paie Mois 4/2026',
        'Fiches de paie Mois 5/2026',
        'Fiches de paie Mois 6/2026',
        'Fiches de paie Mois 7/2026',
        'Fiches de paie Mois 8/2026',
        'Fiches de paie Mois 9/2026',
        'Fiches de paie Mois 10/2026',
        'Fiches de paie Mois 11/2026',
        'Fiches de paie Mois 12/2026',
        'Préparation - Déclaration CNSS Trimestre 1/2026',
        'Préparation - Déclaration CNSS Trimestre 2/2026',
        'Préparation - Déclaration CNSS Trimestre 3/2026',
        'Préparation - Déclaration CNSS Trimestre 4/2026',
        'Dépôt - Déclaration CNSS Trimestre 1/2026',
        'Dépôt - Déclaration CNSS Trimestre 2/2026',
        'Dépôt - Déclaration CNSS Trimestre 3/2026',
        'Dépôt - Déclaration CNSS Trimestre 4/2026',
      ],
    },
    {
      name: 'Contrôle fiscal',
      taskTypes: [
        'Préparation du dossier de contrôle fiscal',
        'Rédaction de la réponse à l\'administration fiscale',
      ],
    },
    {
      name: 'Commissariat aux comptes',
      taskTypes: [
        'Audit des états financiers',
        'Établissement des rapports de Commissariat aux Comptes',
      ],
    },
  ],
};

/**
 * Le catalogue servi à une entreprise. Le secteur choisit la liste, mais
 * **aucun secteur ne repart les mains vides** : à défaut d'une liste à lui, il
 * reçoit celle du cabinet. C'était l'inverse au départ — seul `CABINET` était
 * servi — et une entreprise inscrite sous « Autres professions de services »
 * se retrouvait donc devant un écran Missions vide, sans que rien ne le lui
 * dise. Un catalogue qu'on n'utilise pas se supprime en trois clics ; un
 * écran vide sans explication ne se répare pas tout seul.
 */
export const missionsForSecteur = (secteur: string | null | undefined): SectorMissionSeed[] =>
  SECTOR_MISSIONS[secteur || 'CABINET'] || SECTOR_MISSIONS.CABINET;

/**
 * Signature du contenu, pas un numéro tenu à la main : elle change d'elle-même
 * dès qu'on touche au catalogue. C'est ce que porte la fiche entreprise à la
 * place d'un simple « déjà posé », pour deux raisons — un drapeau posé à tort
 * (par une version antérieure, ou une pose partielle) se répare tout seul à la
 * requête suivante, et une correction du catalogue atteint les entreprises
 * déjà servies. La pose restant additive, la rejouer ne duplique rien.
 */
export const catalogueVersion = (list: SectorMissionSeed[]): string =>
  `${list.length}m-${list.reduce((n, m) => n + m.taskTypes.length, 0)}t`;
