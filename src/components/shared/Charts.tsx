import React from 'react';
import type { SpaceRaceIcon, Team } from '../../types.ts';

export interface BarChartItem {
  id: string;
  label: string;
  count: number;
  highlight?: boolean;
  color?: string;
}

export const HorizontalBarChart: React.FC<{
  items: BarChartItem[];
  total?: number;
  large?: boolean;
}> = ({ items, total, large = false }) => {
  const sum = total ?? items.reduce((acc, i) => acc + i.count, 0);
  const maxVal = Math.max(1, ...items.map((i) => i.count));

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
        Әзірге жауаптар жоқ
      </p>
    );
  }

  return (
    <div className={large ? 'space-y-4' : 'space-y-2.5'}>
      {items.map((item) => {
        const pct = sum > 0 ? Math.round((item.count / sum) * 100) : 0;
        const widthPct = Math.round((item.count / maxVal) * 100);
        return (
          <div key={item.id} className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span
                className={`${
                  large ? 'text-base font-medium' : 'text-sm'
                } text-slate-800 dark:text-slate-200 truncate`}
              >
                {item.label}
              </span>
              <span
                className={`${
                  large ? 'text-base' : 'text-xs'
                } font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0`}
              >
                {item.count} ({pct}%)
              </span>
            </div>
            <div
              className={`w-full ${
                large ? 'h-5' : 'h-2.5'
              } bg-slate-100 dark:bg-slate-800 rounded-md overflow-hidden`}
            >
              <div
                className="h-full rounded-md transition-all duration-300"
                style={{
                  width: `${Math.max(item.count > 0 ? 4 : 0, widthPct)}%`,
                  backgroundColor:
                    item.color || (item.highlight ? '#059669' : '#64748B'),
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const ProgressLineChart: React.FC<{
  points: { label: string; value: number }[];
  height?: number;
}> = ({ points, height = 200 }) => {
  if (points.length === 0) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
        График үшін деректер жоқ
      </div>
    );
  }

  const width = 640;
  const padL = 42;
  const padR = 20;
  const padT = 18;
  const padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const coords = points.map((p, idx) => {
    const x =
      points.length === 1
        ? padL + innerW / 2
        : padL + (idx / (points.length - 1)) * innerW;
    const clamped = Math.max(0, Math.min(100, p.value));
    const y = padT + innerH - (clamped / 100) * innerH;
    return { x, y, ...p };
  });

  const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const areaD = `${pathD} L ${coords[coords.length - 1].x} ${padT + innerH} L ${coords[0].x} ${padT + innerH} Z`;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto min-w-[420px]"
        role="img"
        aria-label="Оқушы прогресінің графигі"
      >
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = padT + innerH - (tick / 100) * innerH;
          return (
            <g key={tick}>
              <line
                x1={padL}
                x2={width - padR}
                y1={y}
                y2={y}
                stroke="currentColor"
                className="text-slate-200 dark:text-slate-800"
                strokeDasharray="3 3"
              />
              <text
                x={padL - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
              >
                {tick}%
              </text>
            </g>
          );
        })}

        {points.length > 1 && (
          <path d={areaD} fill="#059669" fillOpacity="0.12" />
        )}
        {points.length > 1 && (
          <path
            d={pathD}
            fill="none"
            stroke="#059669"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {coords.map((c, idx) => (
          <g key={idx}>
            <circle cx={c.x} cy={c.y} r="5" fill="#059669" stroke="#ffffff" strokeWidth="2" />
            <text
              x={c.x}
              y={c.y - 10}
              textAnchor="middle"
              className="fill-slate-800 dark:fill-slate-200 text-[11px] font-mono font-semibold"
            >
              {c.value}%
            </text>
            <text
              x={c.x}
              y={height - 10}
              textAnchor="middle"
              className="fill-slate-500 dark:fill-slate-400 text-[10px]"
            >
              {c.label.length > 12 ? `${c.label.slice(0, 11)}…` : c.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

// Space Race SVG Vehicles (Rocket, Bicycle, Bee)
export const VehicleSvg: React.FC<{ icon: SpaceRaceIcon; color: string; size?: number }> = ({
  icon,
  color,
  size = 42,
}) => {
  if (icon === 'bicycle') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <circle cx="13" cy="33" r="8" stroke={color} strokeWidth="3.2" fill="#ffffff" />
        <circle cx="35" cy="33" r="8" stroke={color} strokeWidth="3.2" fill="#ffffff" />
        <path
          d="M13 33 L22 18 L34 18 L25 33 Z M22 18 L18 13 M34 18 L35 33 M32 13 L38 13"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="13" cy="33" r="2.2" fill={color} />
        <circle cx="35" cy="33" r="2.2" fill={color} />
      </svg>
    );
  }
  if (icon === 'bee') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <ellipse cx="22" cy="14" rx="7" ry="5" fill="#E0F2FE" stroke="#0284C7" strokeWidth="2" />
        <ellipse cx="30" cy="15" rx="6" ry="4.5" fill="#E0F2FE" stroke="#0284C7" strokeWidth="2" />
        <ellipse cx="25" cy="27" rx="14" ry="10" fill={color} stroke="#0F172A" strokeWidth="2.2" />
        <path d="M19 18 V36 M25 17 V37 M31 19 V35" stroke="#0F172A" strokeWidth="2.8" />
        <circle cx="34" cy="25" r="2" fill="#ffffff" />
        <path d="M11 27 L6 27" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  // Rocket
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M6 24 L14 19 L14 29 Z" fill="#F59E0B" />
      <path
        d="M14 16 C22 14 32 16 42 24 C32 32 22 34 14 32 Z"
        fill={color}
        stroke="#0F172A"
        strokeWidth="2"
      />
      <path d="M15 16 L10 10 L21 15 Z" fill={color} stroke="#0F172A" strokeWidth="1.6" />
      <path d="M15 32 L10 38 L21 33 Z" fill={color} stroke="#0F172A" strokeWidth="1.6" />
      <circle cx="28" cy="24" r="4" fill="#F8FAFC" stroke="#0F172A" strokeWidth="1.8" />
    </svg>
  );
};

export const SpaceRaceTrack: React.FC<{
  teams: Team[];
  icon: SpaceRaceIcon;
  projector?: boolean;
  myTeamId?: string;
}> = ({ teams, icon, projector = false, myTeamId }) => {
  const sorted = [...teams];
  return (
    <div className={projector ? 'space-y-4' : 'space-y-3'}>
      {sorted.map((team) => {
        const clamped = Math.max(0, Math.min(100, team.progress));
        const isMine = myTeamId && myTeamId === team.id;
        return (
          <div
            key={team.id}
            className={`rounded-xl border ${
              isMine
                ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
            } ${projector ? 'p-4' : 'p-3'}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2.5">
                <span
                  className="w-3.5 h-3.5 rounded-sm shrink-0"
                  style={{ backgroundColor: team.color }}
                />
                <span
                  className={`${
                    projector ? 'text-xl font-bold' : 'text-sm font-semibold'
                  } text-slate-900 dark:text-slate-100`}
                >
                  {team.name}
                  {isMine ? ' (Сіздің команда)' : ''}
                </span>
              </div>
              <span
                className={`${
                  projector ? 'text-xl' : 'text-sm'
                } font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-300`}
              >
                {team.score} · {clamped}%
              </span>
            </div>

            <div
              className={`relative w-full ${
                projector ? 'h-14' : 'h-11'
              } rounded-lg bg-slate-100 dark:bg-slate-800/80 overflow-hidden`}
            >
              {/* Finish checkered line */}
              <div
                className="absolute right-0 top-0 bottom-0 w-3 opacity-35"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(0deg, #0f172a 0 6px, transparent 6px 12px)',
                }}
              />
              {/* Progress trail */}
              <div
                className="absolute left-0 top-0 bottom-0 transition-all duration-500 opacity-20"
                style={{ width: `${clamped}%`, backgroundColor: team.color }}
              />
              {/* Moving vehicle */}
              <div
                className="absolute top-1/2 -translate-y-1/2 transition-all duration-500 ease-out"
                style={{
                  left: `calc(${clamped}% - ${clamped > 85 ? '44px' : clamped > 10 ? '22px' : '0px'})`,
                }}
              >
                <VehicleSvg icon={icon} color={team.color} size={projector ? 48 : 38} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
