import React from 'react';
import { AlertOctagon, AlertTriangle, Info, ArrowRight } from 'lucide-react';

export interface DashboardAlert {
  key: string;
  code: string;
  level: 'CRITIQUE' | 'AVERTISSEMENT' | 'INFO';
  entity: 'client' | 'user' | 'echeance' | 'task';
  entityId: number | null;
  entityName?: string;
  title: string;
  detail: string;
  action: string;
}

const LEVEL = {
  CRITIQUE: {
    label: 'Critique',
    bar: 'bg-late-fg',
    chip: 'bg-late-bg text-late-fg',
    Icon: AlertOctagon,
  },
  AVERTISSEMENT: {
    label: 'Avertissement',
    bar: 'bg-orange-400',
    chip: 'bg-orange-50 text-orange-700',
    Icon: AlertTriangle,
  },
  INFO: {
    label: 'Information',
    bar: 'bg-gray-300',
    chip: 'bg-gray-100 text-gray-600',
    Icon: Info,
  },
} as const;

interface AlertsPanelProps {
  alerts: DashboardAlert[];
  total: number;
  /** Ouvre le détail de l'entité concernée — client ou collaborateur. */
  onOpen?: (alert: DashboardAlert) => void;
}

/**
 * Le bloc le plus actionnable de l'écran : il n'affiche rien qui n'appelle une
 * décision. Chaque ligne est une alerte, pas un client — un même client peut
 * apparaître deux fois pour deux motifs différents.
 *
 * Le bloc disparaît entièrement quand il n'y a rien à signaler. C'est ce qui
 * donne du poids à sa présence : un panneau « aucune alerte » affiché en
 * permanence finit par ne plus être lu du tout, et l'alerte qui compte se perd
 * avec lui.
 */
export const AlertsPanel: React.FC<AlertsPanelProps> = ({ alerts, total, onOpen }) => {
  if (!alerts || alerts.length === 0) return null;

  const criticals = alerts.filter(a => a.level === 'CRITIQUE').length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
      <div className="px-4 sm:px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-[13px] font-extrabold text-gray-800 uppercase tracking-wide">
          Ce qui demande une décision
        </h2>
        {criticals > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-late-bg text-late-fg text-[10px] font-bold uppercase tracking-wide">
            {criticals} critique{criticals > 1 ? 's' : ''}
          </span>
        )}
        <span className="text-[11px] text-gray-400 ml-auto">
          {total > alerts.length ? `${alerts.length} sur ${total}` : `${total} au total`}
        </span>
      </div>

      <ul className="divide-y divide-gray-50">
        {alerts.map(a => {
          const meta = LEVEL[a.level] ?? LEVEL.INFO;
          const clickable = Boolean(onOpen && a.entityId != null);
          const Row = clickable ? 'button' : 'div';
          return (
            <li key={a.key} className="flex">
              <span className={`w-1 shrink-0 ${meta.bar}`} aria-hidden />
              <Row
                {...(clickable ? { type: 'button' as const, onClick: () => onOpen!(a) } : {})}
                className={`flex-1 min-w-0 text-left px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 ${
                  clickable ? 'hover:bg-gray-50 transition-colors' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <meta.Icon className={`w-3.5 h-3.5 shrink-0 ${a.level === 'CRITIQUE' ? 'text-late-fg' : a.level === 'AVERTISSEMENT' ? 'text-orange-500' : 'text-gray-400'}`} />
                    <span className="text-[13px] font-semibold text-gray-900 truncate">{a.title}</span>
                    <span className={`hidden sm:inline px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide shrink-0 ${meta.chip}`}>
                      {a.code}
                    </span>
                  </div>
                  <p className="text-[12px] text-gray-500 mt-0.5">{a.detail}</p>
                  {/* L'action recommandée fait partie de l'alerte : une alerte
                      qui n'indique pas quoi faire est un rapport, pas une alerte. */}
                  <p className="text-[11.5px] text-gray-700 mt-1 font-medium">→ {a.action}</p>
                </div>
                {clickable && <ArrowRight className="w-4 h-4 text-gray-300 shrink-0 hidden sm:block" />}
              </Row>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
