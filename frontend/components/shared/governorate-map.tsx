'use client';

import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Stylized SVG choropleth of Egypt's 27 governorates (SRS §5.5.2).
 *
 * Uses a simplified grid-based layout rather than a geographically
 * precise map. Each governorate is a rounded rectangle colour-coded
 * by value intensity (green = low, red = high).  Tooltip on hover.
 *
 * RTL-aware: labels render correctly in both LTR and RTL contexts.
 */

export interface GovernorateData {
  governorate: string;
  value: number;
}

export interface GovernorateMapProps {
  data: GovernorateData[];
  metric: string;
  className?: string;
}

/**
 * All 27 Egyptian governorates in the standard order, mapped onto a
 * stylised 7-column grid layout roughly corresponding to their
 * geographic position.  Each entry is [name, column, row].
 */
const GOVERNORATE_GRID: Array<[string, number, number]> = [
  // Northern coast / Delta
  ['Alexandria', 1, 0],
  ['Beheira', 2, 0],
  ['Kafr El Sheikh', 3, 0],
  ['Dakahlia', 4, 0],
  ['Damietta', 5, 0],
  ['Port Said', 6, 0],

  // Lower Egypt / Delta inner
  ['Matrouh', 0, 1],
  ['Gharbia', 2, 1],
  ['Monufia', 3, 1],
  ['Sharqia', 4, 1],
  ['Ismailia', 5, 1],

  // Cairo region
  ['Giza', 2, 2],
  ['Qalyubia', 3, 2],
  ['Cairo', 4, 2],
  ['Suez', 5, 2],

  // Upper-middle
  ['Faiyum', 2, 3],
  ['Beni Suef', 3, 3],
  ['Minya', 3, 4],
  ['North Sinai', 6, 2],
  ['South Sinai', 6, 3],

  // Upper Egypt
  ['Asyut', 3, 5],
  ['New Valley', 1, 5],
  ['Sohag', 3, 6],
  ['Qena', 3, 7],
  ['Luxor', 4, 7],
  ['Red Sea', 5, 6],
  ['Aswan', 3, 8],
];

const CELL_W = 100;
const CELL_H = 52;
const GAP = 6;
const PADDING = 12;
const COLS = 7;
const ROWS = 9;
const SVG_W = PADDING * 2 + COLS * (CELL_W + GAP);
const SVG_H = PADDING * 2 + ROWS * (CELL_H + GAP);

/**
 * Interpolate between green (low) and red (high) via amber mid-point.
 */
function intensityColor(ratio: number): string {
  const t = Math.max(0, Math.min(1, ratio));
  if (t <= 0.5) {
    // green to amber
    const s = t * 2;
    const r = Math.round(34 + s * (245 - 34));
    const g = Math.round(197 + s * (158 - 197));
    const b = Math.round(94 + s * (11 - 94));
    return `rgb(${r},${g},${b})`;
  }
  // amber to red
  const s = (t - 0.5) * 2;
  const r = Math.round(245 + s * (220 - 245));
  const g = Math.round(158 - s * 158);
  const b = Math.round(11 - s * 11);
  return `rgb(${r},${g},${b})`;
}

export function GovernorateMap({
  data,
  metric,
  className,
}: GovernorateMapProps) {
  const [tooltip, setTooltip] = useState<{
    name: string;
    value: number;
    x: number;
    y: number;
  } | null>(null);

  const valueMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data) {
      m.set(d.governorate, d.value);
    }
    return m;
  }, [data]);

  const maxVal = useMemo(() => {
    if (data.length === 0) return 1;
    return Math.max(...data.map((d) => d.value), 1);
  }, [data]);

  const onPointerEnter = useCallback(
    (name: string, x: number, y: number) => {
      setTooltip({ name, value: valueMap.get(name) ?? 0, x, y });
    },
    [valueMap],
  );

  const onPointerLeave = useCallback(() => setTooltip(null), []);

  if (data.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border border-dashed border-border p-12 text-sm text-hcx-text-muted',
          className,
        )}
      >
        No geographic data available.
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full"
        role="img"
        aria-label={`Egypt governorate map — ${metric}`}
      >
        {GOVERNORATE_GRID.map(([name, col, row]) => {
          const val = valueMap.get(name) ?? 0;
          const ratio = val / maxVal;
          const x = PADDING + col * (CELL_W + GAP);
          const y = PADDING + row * (CELL_H + GAP);
          const fill = valueMap.has(name)
            ? intensityColor(ratio)
            : 'hsl(var(--muted))';

          return (
            <g
              key={name}
              onPointerEnter={() =>
                onPointerEnter(name, x + CELL_W / 2, y + CELL_H / 2)
              }
              onPointerLeave={onPointerLeave}
              className="cursor-pointer"
            >
              <rect
                x={x}
                y={y}
                width={CELL_W}
                height={CELL_H}
                rx={6}
                fill={fill}
                stroke="white"
                strokeWidth={1.5}
                opacity={0.9}
              />
              <text
                x={x + CELL_W / 2}
                y={y + CELL_H / 2 - 4}
                textAnchor="middle"
                dominantBaseline="central"
                className="pointer-events-none select-none fill-white text-[9px] font-semibold"
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}
              >
                {name}
              </text>
              {valueMap.has(name) && (
                <text
                  x={x + CELL_W / 2}
                  y={y + CELL_H / 2 + 12}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none select-none fill-white text-[8px] font-medium"
                  style={{ textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}
                >
                  {val.toLocaleString()}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 rounded-md bg-hcx-text px-3 py-1.5 text-xs text-white shadow-lg"
          style={{
            left: `${(tooltip.x / SVG_W) * 100}%`,
            top: `${(tooltip.y / SVG_H) * 100}%`,
            transform: 'translate(-50%, -120%)',
          }}
        >
          <p className="font-semibold">{tooltip.name}</p>
          <p>
            {metric}: {tooltip.value.toLocaleString()}
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="mt-2 flex items-center justify-center gap-2 text-xs text-hcx-text-muted">
        <span>Low</span>
        <div
          className="h-2.5 w-24 rounded-full"
          style={{
            background:
              'linear-gradient(to right, rgb(34,197,94), rgb(245,158,11), rgb(220,0,0))',
          }}
        />
        <span>High</span>
      </div>
    </div>
  );
}
