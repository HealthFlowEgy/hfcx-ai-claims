'use client';

import { useMemo, useRef, useState, useCallback } from 'react';

import type { NetworkGraphData } from '@/lib/types';

/**
 * SRS §6.2.2 FR-SIU-NET-001 — provider-patient-pharmacy network graph.
 * Pure SVG implementation (no external graph library dependency).
 * Nodes are color-coded by type:
 *   provider  → blue (#2563eb)
 *   patient   → slate (#64748b)
 *   pharmacy  → green (#16a34a)
 */

export interface NetworkGraphProps {
  data: NetworkGraphData;
  onNodeClick?: (id: string) => void;
  className?: string;
}

const TYPE_COLORS: Record<string, string> = {
  provider: '#2563eb',
  patient: '#64748b',
  pharmacy: '#16a34a',
};

const TYPE_LABELS: Record<string, string> = {
  provider: 'مقدم خدمة',
  patient: 'مريض',
  pharmacy: 'صيدلية',
};

interface NodePos {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
}

export function NetworkGraph({ data, onNodeClick, className }: NetworkGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const { nodePositions, edgeLines } = useMemo(() => {
    const W = 800;
    const H = 500;
    const PAD = 60;

    const providers = data.nodes.filter((n) => n.type === 'provider');
    const patients = data.nodes.filter((n) => n.type === 'patient');
    const pharmacies = data.nodes.filter((n) => n.type === 'pharmacy');

    const colX = [PAD + 40, W / 2, W - PAD - 40];

    // ISSUE-022: Improved distribution with jitter to prevent overlap on large datasets
    function distribute(items: typeof data.nodes, col: number): NodePos[] {
      const count = items.length || 1;
      // Use multiple sub-columns if too many nodes
      const maxPerCol = Math.floor((H - 2 * PAD) / 40);
      const subCols = Math.ceil(count / maxPerCol);
      const colWidth = 60;
      return items.map((n, i) => {
        const subCol = Math.floor(i / maxPerCol);
        const posInCol = i % maxPerCol;
        const effectiveCount = Math.min(count - subCol * maxPerCol, maxPerCol);
        const spacing = (H - 2 * PAD) / effectiveCount;
        return {
          id: n.id,
          label: n.label,
          type: n.type,
          x: colX[col] + (subCol - (subCols - 1) / 2) * colWidth,
          y: PAD + spacing * posInCol + spacing / 2,
        };
      });
    }

    const positions: NodePos[] = [
      ...distribute(providers, 0),
      ...distribute(patients, 1),
      ...distribute(pharmacies, 2),
    ];

    const posMap = new Map(positions.map((p) => [p.id, p]));

    const lines = data.edges
      .map((e) => {
        const src = posMap.get(e.source);
        const tgt = posMap.get(e.target);
        if (!src || !tgt) return null;
        return {
          x1: src.x,
          y1: src.y,
          x2: tgt.x,
          y2: tgt.y,
          weight: e.weight,
          source: e.source,
          target: e.target,
        };
      })
      .filter(Boolean) as {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      weight: number;
      source: string;
      target: string;
    }[];

    return { nodePositions: positions, edgeLines: lines };
  }, [data]);

  const handleNodeClick = useCallback(
    (id: string) => {
      setSelectedNode((prev) => (prev === id ? null : id));
      onNodeClick?.(id);
    },
    [onNodeClick],
  );

  return (
    <div className={className} style={{ position: 'relative' }}>
      {/* Legend */}
      <div className="mb-3 flex items-center gap-4 text-xs">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: color }}
            />
            <span className="text-hcx-text-muted">{TYPE_LABELS[type] || type}</span>
          </div>
        ))}
        <span className="ms-auto text-hcx-text-muted">
          {data.nodes.length} nodes · {data.edges.length} edges
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 800 500"
        className="w-full rounded-lg border border-border bg-white"
        style={{ maxHeight: 500 }}
      >
        {/* Defs for arrow markers */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
          </marker>
        </defs>

        {/* Edges */}
        {edgeLines.map((e, i) => {
          const isHighlighted =
            selectedNode != null &&
            (e.source === selectedNode || e.target === selectedNode);
          return (
            <line
              key={`e-${i}`}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke={isHighlighted ? '#f59e0b' : '#cbd5e1'}
              strokeWidth={Math.min(1 + e.weight * 0.6, 5)}
              strokeOpacity={selectedNode ? (isHighlighted ? 1 : 0.2) : 0.6}
              markerEnd="url(#arrowhead)"
            />
          );
        })}

        {/* Nodes */}
        {nodePositions.map((n) => {
          const isSelected = selectedNode === n.id;
          const isConnected =
            selectedNode != null &&
            edgeLines.some(
              (e) =>
                (e.source === selectedNode && e.target === n.id) ||
                (e.target === selectedNode && e.source === n.id),
            );
          const dimmed = selectedNode != null && !isSelected && !isConnected;
          // ISSUE-021: Highlight cluster membership
          const inCluster = data.clusters?.some(
            (c) => c.nodes.includes(n.id) && c.cluster_score >= 0.5,
          );

          return (
            <g
              key={n.id}
              style={{ cursor: 'pointer' }}
              onClick={() => handleNodeClick(n.id)}
              onMouseEnter={(ev) => {
                const rect = svgRef.current?.getBoundingClientRect();
                if (rect) {
                  setTooltip({
                    x: ev.clientX - rect.left,
                    y: ev.clientY - rect.top - 10,
                    text: `${n.label} (${TYPE_LABELS[n.type] || n.type})`,
                  });
                }
              }}
              onMouseLeave={() => setTooltip(null)}
            >
              <circle
                cx={n.x}
                cy={n.y}
                r={isSelected ? 22 : 18}
                fill={TYPE_COLORS[n.type] || '#64748b'}
                fillOpacity={dimmed ? 0.25 : 1}
                stroke={isSelected ? '#f59e0b' : inCluster ? '#ef4444' : 'white'}
                strokeWidth={isSelected ? 3 : 2}
              />
              <text
                x={n.x}
                y={n.y + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize={9}
                fontWeight={600}
                pointerEvents="none"
              >
                {n.label.length > 8 ? n.label.slice(0, 7) + '…' : n.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute rounded bg-slate-800 px-2 py-1 text-xs text-white shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
