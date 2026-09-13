/**
 * Gemini Flash — analyse en langage naturel du tableau de bord Direction.
 *
 * Optionnel, exactement comme SMTP (`email.ts`) et Web Push (`push.ts`) :
 * sans `GEMINI_API_KEY`, `aiEnabled()` rend `false` et `summarizeDashboard()`
 * ne fait rien plutôt que lever — un appelant n'a jamais à se demander si
 * l'IA est configurée avant d'appeler, il lit juste `available` dans la
 * réponse. Un palier gratuit (Gemini Flash) n'offre aucune garantie de
 * disponibilité ni de débit : c'est pour ça que cette fonctionnalité reste
 * un bouton qu'on clique, jamais quelque chose dont une page dépend pour
 * s'afficher.
 */

/**
 * `gemini-flash-latest` est un alias maintenu par Google, pas un modèle figé
 * — `gemini-2.0-flash` (le choix initial ici) a été retiré du catalogue en
 * quelques mois à peine, avec un message d'erreur renvoyant vers la version
 * suivante. Épingler un nom de modèle précis referait exactement ce piège ;
 * l'alias, lui, suit le modèle Flash recommandé du moment sans qu'il faille
 * revenir toucher ce fichier. `GEMINI_MODEL` reste le repli si l'alias
 * lui-même venait à disparaître ou à mal convenir.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

export function aiEnabled(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * Envoie un contexte déjà agrégé (jamais les lignes brutes — voir l'appelant
 * server.ts) à Gemini Flash et en tire un résumé en français. `context` doit
 * rester compact : c'est ce que l'écran affiche déjà à ce rôle, pas une
 * exportation de la base.
 */
export async function summarizeDashboard(context: Record<string, unknown>): Promise<{ available: boolean; text: string | null; error?: string }> {
  if (!aiEnabled()) return { available: false, text: null };

  const prompt = [
    "Tu es l'assistant financier d'un cabinet d'expertise comptable tunisien. ",
    "On te donne les agrégats déjà calculés de son tableau de bord Direction pour une période donnée — jamais de données brutes de clients ou de collaborateurs. ",
    "Rédige une analyse en français, en 4 à 8 phrases courtes, organisées en un ou deux paragraphes : ",
    "ce qui va bien, ce qui demande une décision (alertes), et une ou deux priorités concrètes pour les prochains jours. ",
    "N'invente aucun chiffre qui ne figure pas dans les données fournies. Si un champ est absent ou vaut null, ne le mentionne pas plutôt que de deviner. ",
    "Pas de titre, pas de liste à puces, pas de formule de politesse — uniquement l'analyse.\n\n",
    'Données :\n', JSON.stringify(context),
  ].join('');

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // Les modèles Flash récents raisonnent avant de répondre
          // (« thinking »), et ce raisonnement consomme le même budget que
          // `maxOutputTokens` — mesuré à ~1 800-1 900 jetons de réflexion
          // pour une analyse de ce format, avant même le texte final. Un
          // plafond à 500 tronquait la réponse en plein milieu d'une phrase
          // (`finishReason: 'MAX_TOKENS'`, texte coupé) ; 8192 laisse une
          // marge large des deux côtés sans risque réel de dérive de coût,
          // ce bouton n'étant jamais appelé qu'à la demande.
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[ai] Gemini request failed:', res.status, body.slice(0, 500));
      return { available: true, text: null, error: `Gemini a répondu ${res.status}` };
    }
    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('').trim() || null;
    return { available: true, text };
  } catch (error) {
    console.error('[ai] Gemini call failed:', error);
    return { available: true, text: null, error: 'Appel IA impossible' };
  }
}
