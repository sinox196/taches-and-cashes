import React from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, Info } from 'lucide-react';

interface ExecutiveBarProps {
  data: any;
  financialsFiltered: boolean;
  onAlertsClick: () => void;
  onClientsClick: () => void;
}

const nf = (n: number, digits = 0) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const tnd = (n: number | undefined | null) =>
  n == null ? '—' : `${nf(Math.round(n))}`;

const hours = (h: number | undefined | null) => {
  if (h == null) return '—';
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return `${nf(whole)}h${String(mins).padStart(2, '0')}`;
};

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)} %`);

/**
 * Variation par rapport à la période précédente de même durée. `null` quand
 * la période précédente est vide : « +∞ % » n'informe personne.
 */
const delta = (now: number | null | undefined, before: number | null | undefined) => {
  if (now == null || before == null || before === 0) return null;
  return (now - before) / Math.abs(before);
};

const Trend: React.FC<{ value: number | null; invert?: boolean }> = ({ value, invert }) => {
  if (value == null || Math.abs(value) < 0.005) return null;
  const up = value > 0;
  const good = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 ${good ? 'text-done-fg' : 'text-late-fg'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(Math.round(value * 100))} %
    </span>
  );
};

const Card: React.FC<{
  label: string;
  value: string;
  unit?: string;
  foot?: React.ReactNode;
  title?: string;
  onClick?: () => void;
}> = ({ label, value, unit, foot, title, onClick }) => {
  const inner = (
    <>
      <div className="text-[10.5px] font-bold uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="text-[24px] font-extrabold text-gray-900 tabular-nums leading-none">{value}</span>
        {unit && <span className="text-[11px] font-semibold text-gray-400">{unit}</span>}
      </div>
      <div className="mt-1.5 text-[11px] text-gray-500 flex items-center gap-1.5 min-h-[16px]">{foot}</div>
    </>
  );
  const base = 'bg-white border border-gray-200 rounded-xl p-3.5 shadow-xs text-left';
  return onClick ? (
    <button type="button" onClick={onClick} title={title}
      className={`${base} hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-navy/20`}>
      {inner}
    </button>
  ) : (
    <div className={base} title={title}>{inner}</div>
  );
};

/**
 * Sept cartes, pas dix : au-delà, la lecture cesse d'être instantanée et
 * devient un balayage, ce qui annule l'objectif des dix secondes. Chaque carte
 * répond à une question différente et aucune n'en répète une autre.
 *
 * Une carte dont la donnée est incomplète affiche l'avertissement plutôt que
 * le chiffre : un chiffre partiel présenté comme complet est pire qu'une
 * absence de chiffre. C'est la règle que `tasksWithoutRate` applique déjà
 * ailleurs dans l'application.
 */
export const ExecutiveBar: React.FC<ExecutiveBarProps> = ({ data, financialsFiltered, onAlertsClick, onClientsClick }) => {
  const e = data || {};
  const money = !financialsFiltered && e.honoraires !== undefined;

  return (
    <div>
      {financialsFiltered && (
        <div className="mb-3 flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-100 text-[12px] text-blue-900">
          <Info className="w-4 h-4 shrink-0 mt-px" />
          <span>
            Filtre collaborateur actif : les montants facturés ne peuvent pas être répartis par
            collaborateur — une facture n'a pas d'auteur. Les indicateurs financiers sont masqués
            plutôt que calculés faux.
          </span>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
        {money ? (
          <>
            <Card
              label="Honoraires"
              value={tnd(e.honoraires)} unit="TND"
              foot={<Trend value={delta(e.honoraires, e.honorairesPrev)} />}
              title="Montant net facturé sur la période, hors documents non facturables et hors devises étrangères."
            />
            <Card
              label="Marge sur temps"
              value={pct(e.tauxMarge)}
              foot={<>
                <span>{tnd(e.marge)} TND</span>
                <Trend value={delta(e.marge, e.margePrev)} />
              </>}
              title="Honoraires moins le coût employeur du temps passé. Marge de contribution sur main-d'œuvre directe : hors loyer, logiciels et temps administratif non pointé — ce n'est pas le résultat du cabinet."
            />
            <Card
              label="Reste à encaisser"
              value={tnd(e.resteAEncaisser)} unit="TND"
              foot={e.creancesEchues > 0
                ? <span className="text-late-fg font-medium">dont {tnd(e.creancesEchues)} échus</span>
                : <span>rien d'échu</span>}
              title="Créances clients ouvertes, tous exercices. Le montant échu est un majorant : aucun règlement ne porte de lien vers une facture précise."
            />
          </>
        ) : (
          <>
            <Card label="Honoraires" value="—" foot={<span className="text-gray-400">masqué</span>} />
            <Card label="Marge sur temps" value="—" foot={<span className="text-gray-400">masqué</span>} />
            <Card label="Reste à encaisser" value="—" foot={<span className="text-gray-400">masqué</span>} />
          </>
        )}

        {/* Le non facturable vit dans le pied de « Heures produites » plutôt
            que dans une huitième carte : c'est un sous-ensemble de ces heures,
            pas une mesure de plus, et la barre tient à sept cartes pour rester
            lisible d'un coup d'œil. */}
        <Card
          label="Heures produites"
          value={hours(e.heures)}
          foot={<>
            <Trend value={delta(e.heures, e.heuresPrev)} />
            {e.heuresNonFacturables > 0 && (
              <span className="text-gray-500">
                dont {hours(e.heuresNonFacturables)} non fact.
              </span>
            )}
          </>}
          title={`Temps pointé sur la période, tous statuts confondus.${
            e.heuresNonFacturables > 0
              ? ` Dont ${e.tachesNonFacturables} tâche${e.tachesNonFacturables > 1 ? 's' : ''} chez ${e.clientsNonFacturables} client${e.clientsNonFacturables > 1 ? 's' : ''} marqué${e.clientsNonFacturables > 1 ? 's' : ''} non facturable${e.clientsNonFacturables > 1 ? 's' : ''} : ce travail coûte au cabinet sans être facturé.`
              : ''
          }`}
        />

        <Card
          label="Taux d'occupation"
          value={pct(e.occupation)}
          foot={<>
            <span>capacité {hours(e.capaciteNette)}</span>
            <Trend value={delta(e.occupation, e.occupationPrev)} />
          </>}
          title="Temps pointé rapporté à la capacité nette des congés approuvés. Les jours fériés ne sont pas encore modélisés : la capacité est légèrement surévaluée sur un mois qui en contient."
        />

        {money ? (
          <Card
            label="Honoraires / heure"
            value={e.honorairesParHeure == null ? '—' : nf(e.honorairesParHeure, 1)} unit="TND"
            foot={e.coutParHeure != null && <span>coût {nf(e.coutParHeure, 1)}</span>}
            title="Rendement réel d'une heure de cabinet, calculé a posteriori et non depuis un tarif affiché."
          />
        ) : (
          <Card label="Honoraires / heure" value="—" foot={<span className="text-gray-400">masqué</span>} />
        )}

        <Card
          label="Clients en alerte"
          value={String(e.clientsEnAlerte ?? 0)}
          foot={e.alertesCritiques > 0
            ? <span className="text-late-fg font-medium">{e.alertesCritiques} critique{e.alertesCritiques > 1 ? 's' : ''}</span>
            : <span>rien de critique</span>}
          onClick={onAlertsClick}
          title="Nombre de clients faisant l'objet d'au moins une alerte. Cliquer pour voir le détail."
        />
      </div>

      {e.tachesSansTaux > 0 && (
        <button
          type="button"
          onClick={onClientsClick}
          className="mt-3 w-full flex items-start gap-2 p-3 rounded-lg bg-orange-50 border border-orange-200 text-[12px] text-orange-900 text-left hover:border-orange-300 transition-colors"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
          <span>
            <strong>{e.tachesSansTaux} tâche{e.tachesSansTaux > 1 ? 's' : ''}</strong> sans coût employeur
            {e.collabsSansTaux > 0 && <> ({e.collabsSansTaux} collaborateur{e.collabsSansTaux > 1 ? 's' : ''} non configuré{e.collabsSansTaux > 1 ? 's' : ''})</>}.
            Ce temps est exclu du coût, donc <strong>toutes les marges affichées sont surévaluées</strong>.
          </span>
        </button>
      )}

      {/* Ce que le non facturable coûte réellement. Le montant n'apparaît que
          pour un ADMIN, comme tout coût employeur ailleurs ; les heures, elles,
          restent lisibles par un SUPERVISEUR dans le pied de carte ci-dessus. */}
      {money && e.coutNonFacturable > 0 && (
        <div className="mt-2 flex items-start gap-2 p-3 rounded-lg bg-gray-50 border border-gray-200 text-[12px] text-gray-700">
          <Info className="w-4 h-4 shrink-0 mt-px" />
          <span>
            <strong>{e.tachesNonFacturables} tâche{e.tachesNonFacturables > 1 ? 's' : ''} non facturable{e.tachesNonFacturables > 1 ? 's' : ''}</strong>
            {' '}({hours(e.heuresNonFacturables)}) chez {e.clientsNonFacturables} client{e.clientsNonFacturables > 1 ? 's' : ''} —
            {' '}<strong>{tnd(e.coutNonFacturable)} TND</strong> de coût employeur qui ne sera jamais facturé.
            Ce temps est bien compté dans la marge : il en est la charge sans en être le produit.
          </span>
        </div>
      )}

      {money && e.devisesExclues > 0 && (
        <div className="mt-2 flex items-start gap-2 p-3 rounded-lg bg-gray-50 border border-gray-200 text-[12px] text-gray-600">
          <Info className="w-4 h-4 shrink-0 mt-px" />
          <span>
            {e.devisesExclues} document{e.devisesExclues > 1 ? 's' : ''} en devise étrangère exclu{e.devisesExclues > 1 ? 's' : ''} des
            totaux — aucun taux de conversion n'est enregistré.
          </span>
        </div>
      )}
    </div>
  );
};
