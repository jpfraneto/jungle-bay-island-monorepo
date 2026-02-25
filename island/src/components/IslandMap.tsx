import { useMemo, useState } from "react";
import type { HomeTeamBungalow } from "../hooks/useHomeTeam";
import { calculateConnections } from "../utils/connections";
import { resolveAllPositions } from "../utils/positions";
import BungalowNode from "./BungalowNode";
import ZoomControls from "./ZoomControls";
import styles from "../styles/island-map.module.css";

interface IslandMapProps {
  bungalows: HomeTeamBungalow[];
  isLoading: boolean;
  error: string | null;
}

function clampScale(input: number): number {
  return Math.max(0.6, Math.min(1.8, Number(input.toFixed(1))));
}

export default function IslandMap({ bungalows, isLoading, error }: IslandMapProps) {
  const [scale, setScale] = useState(1);

  const nodes = useMemo(() => {
    const positions = resolveAllPositions(bungalows);
    return bungalows.map((bungalow, index) => ({
      index,
      bungalow,
      x: positions[index].x,
      y: positions[index].y,
    }));
  }, [bungalows]);

  const connections = useMemo(
    () => calculateConnections(nodes.map((node) => ({ x: node.x, y: node.y, index: node.index }))),
    [nodes],
  );

  return (
    <section className={styles.map}>
      <div className={styles.noise} />

      {isLoading ? <div className={styles.status}>Loading island...</div> : null}
      {error ? <div className={styles.status}>Failed to load home team: {error}</div> : null}
      {!isLoading && nodes.length === 0 ? (
        <div className={styles.status}>No bungalows available yet. Check back soon.</div>
      ) : null}

      <div className={styles.viewport} style={{ transform: `scale(${scale})` }}>
        <svg className={styles.connections} viewBox="0 0 100 100" preserveAspectRatio="none">
          {connections.map(([from, to]) => (
            <line
              key={`${from}-${to}`}
              x1={nodes[from].x}
              y1={nodes[from].y}
              x2={nodes[to].x}
              y2={nodes[to].y}
            />
          ))}
        </svg>

        {nodes.map((node) => (
          <BungalowNode
            key={`${node.bungalow.chain}:${node.bungalow.token_address}`}
            bungalow={node.bungalow}
            index={node.index}
            x={node.x}
            y={node.y}
          />
        ))}
      </div>

      <ZoomControls
        scale={scale}
        onZoomIn={() => setScale((current) => clampScale(current + 0.2))}
        onZoomOut={() => setScale((current) => clampScale(current - 0.2))}
      />
    </section>
  );
}
