import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface DashboardChartsProps {
  employees: any[];
}

/**
 * Categorical slots, assigned in fixed order and never cycled — series 1 is
 * always SERIES_1, series 2 always SERIES_2, in every chart. Validated as a
 * pair against a white chart surface (CVD ΔE 24.7, normal-vision ΔE 33.6,
 * both ≥ 3:1 contrast).
 */
const SERIES_1 = '#2a78d6';
const SERIES_2 = '#eb6834';

const AXIS_TICK = { fontSize: 11, fill: '#667085' };
const GRID = '#f2f4f7';

const TOOLTIP_STYLE = {
  borderRadius: '8px',
  border: '1px solid #e4e7ec',
  boxShadow: '0 4px 12px -2px rgb(16 24 40 / 0.12)',
  fontSize: '12px',
};

const LEGEND_STYLE = { fontSize: '11px', paddingTop: '4px' };

const ChartCard: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({
  title, subtitle, children,
}) => (
  <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
    <h3 className="text-[13px] font-bold text-gray-900">{title}</h3>
    {subtitle && <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>}
    <div className="h-64 mt-4">{children}</div>
  </div>
);

const EmptyChart: React.FC = () => (
  <div className="h-full flex items-center justify-center text-[12px] text-gray-400 italic">
    Aucune donnée sur la période.
  </div>
);

export const DashboardCharts: React.FC<DashboardChartsProps> = ({ employees }) => {
  const top = (key: (e: any) => number) => [...employees].sort((a, b) => key(b) - key(a)).slice(0, 10);

  const byTasks = top(e => e.tasks?.total || 0);
  const byRate = top(e => e.tasks?.completionRate || 0);
  const byLeaves = top(e => e.leaves?.daysTaken || 0);
  const byAuthHours = top(e => e.authorizations?.totalDuration || 0);

  // Leave chart is stacked: taken + remaining = the entitlement, so the bar
  // height is meaningful rather than two unrelated measures side by side.
  const leaveData = byLeaves.map(e => ({
    name: e.name,
    pris: e.leaves?.daysTaken || 0,
    restants: Math.max(0, e.leaves?.balance?.available ?? 0),
  }));

  const hasData = employees.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Volume de tâches par collaborateur" subtitle="Top 10 sur la période">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byTasks} margin={{ top: 4, right: 8, left: -18, bottom: 24 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} angle={-35} textAnchor="end" height={50} interval={0} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#f9fafb' }} />
              <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={8} />
              <Bar dataKey="tasks.total" name="Total" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="tasks.completed" name="Terminées" fill={SERIES_2} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyChart />}
      </ChartCard>

      <ChartCard title="Taux de réalisation" subtitle="Part des tâches terminées, en %">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            {/* One series → one colour. The old version recoloured each bar by
                its own value, which repainted on every filter change. */}
            <BarChart data={byRate} margin={{ top: 4, right: 8, left: -18, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} angle={-35} textAnchor="end" height={50} interval={0} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} domain={[0, 100]} unit="%" />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: '#f9fafb' }}
                formatter={(value: number) => [`${Math.round(value)} %`, 'Taux de réalisation']}
              />
              <Bar dataKey="tasks.completionRate" name="Taux de réalisation" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyChart />}
      </ChartCard>

      <ChartCard title="Congés" subtitle="Jours pris et solde restant — le total est le droit annuel">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={leaveData} margin={{ top: 4, right: 8, left: -18, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} angle={-35} textAnchor="end" height={50} interval={0} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} unit=" j" />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#f9fafb' }} formatter={(v: number) => [`${v} j`, '']} />
              <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={8} />
              {/* 2px surface gap between stacked segments */}
              <Bar dataKey="pris" stackId="conges" name="Pris" fill={SERIES_1} maxBarSize={26} stroke="#ffffff" strokeWidth={2} />
              <Bar dataKey="restants" stackId="conges" name="Restants" fill={SERIES_2} radius={[4, 4, 0, 0]} maxBarSize={26} stroke="#ffffff" strokeWidth={2} />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyChart />}
      </ChartCard>

      <ChartCard title="Autorisations d'absence" subtitle="Heures approuvées sur la période">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            {/* Previously a bar (count) and a line (hours) shared one y-axis —
                two different measures on one scale. Hours only; the count sits
                in the tooltip. */}
            <BarChart data={byAuthHours} margin={{ top: 4, right: 8, left: -18, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} angle={-35} textAnchor="end" height={50} interval={0} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} unit=" h" />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: '#f9fafb' }}
                formatter={(value: number, _n, item: any) => [
                  `${value} h · ${item?.payload?.authorizations?.total ?? 0} demande(s)`,
                  'Autorisations',
                ]}
              />
              <Bar dataKey="authorizations.totalDuration" name="Heures approuvées" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyChart />}
      </ChartCard>
    </div>
  );
};
