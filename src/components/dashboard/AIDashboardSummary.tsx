import React, { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface AIDashboardSummaryProps {
  /** La réponse déjà reçue de `/api/dashboard/executive` — jamais recalculée ici. */
  exec: any;
}

/**
 * Bouton « Analyser avec l'IA » sur le tableau de bord Direction — voir
 * CLAUDE.md « Analyse IA du tableau de bord ». N'envoie au serveur qu'un
 * extrait compact de `exec`, déjà reçu et déjà filtré pour ce rôle (un
 * SUPERVISEUR ne porte aucun montant dans `exec` pour commencer, donc il n'y
 * en a aucun à envoyer non plus). L'IA elle-même (Gemini Flash, palier
 * gratuit) est optionnelle : sans clé côté serveur, `available` revient à
 * `false` et le bouton le dit plutôt que d'échouer silencieusement.
 */
export const AIDashboardSummary: React.FC<AIDashboardSummaryProps> = ({ exec }) => {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState('');

  const buildContext = () => {
    const ex = exec?.executive || {};
    const topAlerts = (exec?.alerts || []).slice(0, 8).map((a: any) => ({
      niveau: a.level, titre: a.title, detail: a.detail, action: a.action,
    }));
    const clientsLesPlusFragiles = (exec?.clients || [])
      .slice(0, 5)
      .map((c: any) => ({ nom: c.name, honoraires: c.honoraires, cout: c.cout, marge: c.marge, tauxMarge: c.tauxMarge }));
    const missionsPrincipales = [...(exec?.missions || [])]
      .sort((a: any, b: any) => b.heures - a.heures)
      .slice(0, 5)
      .map((m: any) => ({ mission: m.pole, heures: m.heures, taches: m.taches }));
    return {
      periode: exec?.periode,
      filtreCollaborateurApplique: exec?.financialsFiltered || false,
      indicateurs: ex,
      alertes: topAlerts,
      alertesTotal: exec?.alertsTotal ?? 0,
      clientsLesPlusFragiles,
      concentration: exec?.concentration ? { top1: exec.concentration.top1, top5Part: exec.concentration.top5Part } : null,
      missionsPrincipales,
      operationnel: exec?.operationnel,
    };
  };

  const analyze = async () => {
    setLoading(true);
    setError('');
    setText(null);
    try {
      const res = await fetch('/api/dashboard/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ context: buildContext() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Analyse impossible.');
      if (!data.available) {
        setUnavailable(true);
      } else if (data.text) {
        setText(data.text);
      } else {
        setError(data.error || "L'IA n'a pas pu produire d'analyse cette fois-ci.");
      }
    } catch (e: any) {
      setError(e.message || 'Analyse impossible.');
    } finally {
      setLoading(false);
    }
  };

  if (unavailable) {
    return (
      <p className="text-[11.5px] text-gray-400 flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5" /> Analyse IA non configurée sur ce serveur.
      </p>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      {!text && !loading && (
        <button
          onClick={analyze}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12.5px] font-semibold bg-navy text-white hover:bg-navy-hover"
        >
          <Sparkles className="w-4 h-4" /> Analyser avec l'IA
        </button>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-[12.5px] text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Analyse en cours…
        </div>
      )}
      {error && !loading && (
        <p className="text-[12px] text-red-600 font-medium">{error}</p>
      )}
      {text && !loading && (
        <div>
          <div className="flex items-center gap-1.5 mb-2 text-[11px] font-extrabold uppercase tracking-wider text-turquoise">
            <Sparkles className="w-3.5 h-3.5" /> Analyse IA
          </div>
          <p className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-line">{text}</p>
          <button
            onClick={analyze}
            className="mt-3 text-[11.5px] font-semibold text-navy hover:underline"
          >
            Régénérer
          </button>
        </div>
      )}
    </div>
  );
};
