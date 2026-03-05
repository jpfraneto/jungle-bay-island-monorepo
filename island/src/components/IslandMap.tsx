import { useMemo, useRef, useState, type WheelEvent } from "react";
import type { HomeTeamBungalow } from "../hooks/useHomeTeam";
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

interface MapView {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export default function IslandMap({ bungalows, isLoading, error }: IslandMapProps) {
  const mapRef = useRef<HTMLElement | null>(null);
  const [view, setView] = useState<MapView>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });

  const nodes = useMemo(() => {
    const positions = resolveAllPositions(bungalows);
    return bungalows.map((bungalow, index) => ({
      index,
      bungalow,
      x: positions[index].x,
      y: positions[index].y,
    }));
  }, [bungalows]);

  const getZoomedView = (
    current: MapView,
    targetScale: number,
    clientX: number,
    clientY: number,
  ): MapView => {
    const clampedScale = clampScale(targetScale);
    if (clampedScale === current.scale) {
      return current;
    }

    const mapElement = mapRef.current;
    if (!mapElement) {
      return { ...current, scale: clampedScale };
    }

    const bounds = mapElement.getBoundingClientRect();
    const focalX = clientX - bounds.left;
    const focalY = clientY - bounds.top;

    const worldX = (focalX - current.offsetX) / current.scale;
    const worldY = (focalY - current.offsetY) / current.scale;

    return {
      scale: clampedScale,
      offsetX: focalX - worldX * clampedScale,
      offsetY: focalY - worldY * clampedScale,
    };
  };

  const handleWheel = (event: WheelEvent<HTMLElement>) => {
    event.preventDefault();
    const zoomDirection = event.deltaY < 0 ? 1 : -1;
    setView((current) =>
      getZoomedView(current, current.scale + zoomDirection * 0.1, event.clientX, event.clientY),
    );
  };

  const handleButtonZoom = (zoomDirection: 1 | -1) => {
    const mapElement = mapRef.current;
    if (!mapElement) {
      return;
    }
    const bounds = mapElement.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    setView((current) => getZoomedView(current, current.scale + zoomDirection * 0.2, centerX, centerY));
  };

  return (
    <section ref={mapRef} className={styles.map} onWheel={handleWheel}>
      <div className={styles.noise} />

      {isLoading ? (
        <div className={styles.loadingCenter}>
          <div className={styles.loadingLabel}>Loading Island</div>
          <div className={styles.progressBar}>
            <span className={styles.progressFill} />
          </div>
        </div>
      ) : null}
      {error ? <div className={styles.status}>Failed to load community bungalows: {error}</div> : null}
      {!isLoading && nodes.length === 0 ? (
        <div className={styles.status}>No community bungalows are open yet. Check back soon.</div>
      ) : null}

      <div
        className={styles.viewport}
        style={{
          transform: `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.scale})`,
        }}
      >
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
        scale={view.scale}
        onZoomIn={() => handleButtonZoom(1)}
        onZoomOut={() => handleButtonZoom(-1)}
      />
    </section>
  );
}
