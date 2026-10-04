import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props { children: React.ReactNode }
interface State { hasError: boolean; message: string | null }

/**
 * Filet de sécurité unique, posé une fois à la racine — cette app n'en avait
 * aucun, donc n'importe quelle exception de rendu, où qu'elle survienne dans
 * l'arbre, blanchissait tout l'écran sans le moindre message (le symptôme
 * remonté : « importer relevé bancaire twali white screen »). Attrape une
 * erreur de rendu et affiche un écran récupérable plutôt qu'une page
 * blanche ; un rechargement repart d'un état propre, la seule garantie
 * possible une fois qu'un composant a jeté en plein rendu.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  // Ce projet n'a pas de paquet `@types/react` — `allowJs` fait alors
  // inférer TypeScript à même la source JS réelle de React, qui n'expose
  // pas `this.props`/`this.state` à cette inférence (React.Component en
  // ressort sans ces deux membres). `declare` les redéclare côté type sans
  // rien émettre côté exécution — la vraie valeur vient du constructeur de
  // la classe de base comme toujours. C'est le seul composant classe de
  // l'app (les limites d'erreur n'ont pas d'équivalent à base de hooks),
  // donc le seul endroit où ce trou se voit.
  declare props: Props;
  declare state: State;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: null };
  }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
          <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-sm text-center shadow-sm">
            <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
            <p className="text-[14px] text-gray-800 font-medium mb-1">Une erreur est survenue</p>
            <p className="text-[13px] text-gray-600 mb-4">
              Quelque chose s'est mal passé. Rechargez la page pour continuer.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-[13px] font-medium bg-navy text-white rounded-lg hover:bg-navy-hover"
            >
              Recharger la page
            </button>
            {/* Repliée par défaut — ce n'est pas pour un utilisateur ordinaire,
                mais sans elle le seul détail de ce qui a cassé reste coincé
                dans la console du navigateur, hors d'atteinte de qui signale
                le problème par message plutôt qu'en partageant un écran. */}
            {this.state.message && (
              <details className="mt-4 text-left">
                <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-gray-600">Détails techniques</summary>
                <p className="mt-1.5 text-[11px] text-gray-500 font-mono break-words bg-gray-50 border border-gray-200 rounded-lg p-2">
                  {this.state.message}
                </p>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
