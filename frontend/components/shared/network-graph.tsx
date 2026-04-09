'use client';

import { useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  type Node,
} from 'reactflow';
import 'reactflow/dist/style.css';

import type { NetworkGraphData } from '@/lib/types';

/**
 * SRS §6.2.2 FR-SIU-NET-001 — provider-patient-pharmacy network graph
 * using React Flow. Nodes are color-coded by type:
 *   provider  → hcx-primary
 *   patient   → hcx-muted
 *   pharmacy  → hcx-success
 */

export interface NetworkGraphProps {
  data: NetworkGraphData;
  onNodeClick?: (id: string) => void;
  className?: string;
}

function typeColor(type: 'provider' | 'patient' | 'pharmacy'): string {
  switch (type) {
    case 'provider':
      return 'hsl(var(--hcx-primary))';
    case 'patient':
      return 'hsl(var(--hcx-muted))';
    case 'pharmacy':
      return 'hsl(var(--hcx-success))';
  }
}

export function NetworkGraph({ data, onNodeClick, className }: NetworkGraphProps) {
  const { nodes, edges } = useMemo(() => {
    // Simple radial layout: providers on left, patients center, pharmacies right.
    const providers = data.nodes.filter((n) => n.type === 'provider');
    const patients = data.nodes.filter((n) => n.type === 'patient');
    const pharmacies = data.nodes.filter((n) => n.type === 'pharmacy');

    const position = (
      column: number,
      index: number,
      total: number,
      height = 600,
    ) => ({
      x: column,
      y: (height / Math.max(total, 1)) * index + 20,
    });

    const mappedNodes: Node[] = [
      ...providers.map((n, i) => ({
        id: n.id,
        position: position(40, i, providers.length),
        data: { label: n.label },
        style: {
          background: typeColor('provider'),
          color: 'white',
          border: 'none',
          borderRadius: 8,
          padding: 8,
          fontSize: 12,
        },
      })),
      ...patients.map((n, i) => ({
        id: n.id,
        position: position(320, i, patients.length),
        data: { label: n.label },
        style: {
          background: typeColor('patient'),
          color: 'white',
          border: 'none',
          borderRadius: 8,
          padding: 8,
          fontSize: 12,
        },
      })),
      ...pharmacies.map((n, i) => ({
        id: n.id,
        position: position(600, i, pharmacies.length),
        data: { label: n.label },
        style: {
          background: typeColor('pharmacy'),
          color: 'white',
          border: 'none',
          borderRadius: 8,
          padding: 8,
          fontSize: 12,
        },
      })),
    ];

    const mappedEdges: Edge[] = data.edges.map((e, i) => ({
      id: `e-${i}`,
      source: e.source,
      target: e.target,
      animated: e.weight > 3,
      style: { strokeWidth: Math.min(1 + e.weight * 0.4, 4) },
    }));

    return { nodes: mappedNodes, edges: mappedEdges };
  }, [data]);

  return (
    <div className={className} style={{ width: '100%', height: 600 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => onNodeClick?.(node.id)}
      >
        <Background />
        <Controls position="top-right" />
      </ReactFlow>
    </div>
  );
}
