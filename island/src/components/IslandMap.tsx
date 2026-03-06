import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  BufferGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { useNavigate } from "react-router-dom";
import type { HomeTeamBungalow } from "../hooks/useHomeTeam";
import { resolveAllPositions } from "../utils/positions";
import CanvasErrorBoundary from "./CanvasErrorBoundary";
import { GLOW_COLORS } from "../utils/constants";
import { getFallbackTokenImage, getTokenImageUrl } from "../utils/tokenImage";

interface IslandMapProps {
  bungalows: HomeTeamBungalow[];
  isLoading: boolean;
  error: string | null;
  onOpenConstruction: () => void;
}

export interface RingPosition {
  x: number;
  z: number;
  ring: number;
  index: number;
}

export function computeRingPositions(count: number): RingPosition[] {
  const RING_CAPACITY = (ring: number) => 8 * (ring + 1);
  const RING_RADIUS = (ring: number) => 7 + ring * 6.5;

  const positions: RingPosition[] = [];
  let remaining = count;
  let ring = 0;

  while (remaining > 0) {
    const capacity = RING_CAPACITY(ring);
    const inThisRing = Math.min(remaining, capacity);
    const radius = RING_RADIUS(ring);

    for (let i = 0; i < inThisRing; i += 1) {
      const angleOffset = ring * (Math.PI / (capacity * 0.5));
      const angle = (i / inThisRing) * Math.PI * 2 + angleOffset;
      positions.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        ring,
        index: i,
      });
    }

    remaining -= inThisRing;
    ring += 1;
  }

  return positions;
}

export function computeIslandRadius(bungalowCount: number): number {
  if (bungalowCount === 0) return 12;

  let remaining = bungalowCount;
  let ring = 0;

  while (remaining > 0) {
    remaining -= 8 * (ring + 1);
    ring += 1;
  }

  const outerRing = ring - 1;
  return 7 + outerRing * 6.5 + 5.5;
}

interface PositionedBungalow {
  bungalow: HomeTeamBungalow;
  index: number;
  worldX: number;
  worldZ: number;
}

interface CameraMotion {
  id: string;
  camera: Vector3;
  focus: Vector3;
}

function useMediaWidth(maxWidth: number) {
  const [matches, setMatches] = useState(() => window.innerWidth < maxWidth);

  useEffect(() => {
    const update = () => setMatches(window.innerWidth < maxWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [maxWidth]);

  return matches;
}

function hashToUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function formatCount(value: number | null | undefined): string {
  if (!value || value <= 0) return "New";
  return new Intl.NumberFormat().format(value);
}

function TokenAvatar({
  bungalow,
  size,
  radius,
}: {
  bungalow: HomeTeamBungalow;
  size: number;
  radius: number;
}) {
  const fallback = getFallbackTokenImage(
    `${bungalow.chain}:${bungalow.token_address}`,
  );
  const [src, setSrc] = useState(() =>
    getTokenImageUrl(
      bungalow.image_url,
      bungalow.token_address,
      bungalow.symbol ?? bungalow.name,
    ),
  );

  useEffect(() => {
    setSrc(
      getTokenImageUrl(
        bungalow.image_url,
        bungalow.token_address,
        bungalow.symbol ?? bungalow.name,
      ),
    );
  }, [
    bungalow.image_url,
    bungalow.name,
    bungalow.symbol,
    bungalow.token_address,
  ]);

  return (
    <img
      src={src}
      alt={bungalow.name ?? bungalow.symbol ?? "Bungalow"}
      onError={() => {
        if (src !== fallback) {
          setSrc(fallback);
        }
      }}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        objectFit: "cover",
        display: "block",
        flex: "0 0 auto",
        boxShadow: "0 12px 24px rgba(0, 0, 0, 0.35)",
      }}
    />
  );
}

function SceneStatus({ label }: { label: string }) {
  return (
    <Html center>
      <div
        style={{
          padding: "12px 16px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(8, 18, 24, 0.84)",
          color: "#eef6e9",
          fontSize: 13,
        }}
      >
        {label}
      </div>
    </Html>
  );
}

function TerrainLayers({ islandRadius }: { islandRadius: number }) {
  const oceanMaterialRef = useRef<MeshStandardMaterial | null>(null);
  const lagoonRef = useRef<Mesh<BufferGeometry> | null>(null);
  const beachOuter = islandRadius + 1.5;
  const beachInner = islandRadius;
  const grassOuter = islandRadius - 0.8;
  const grassInner = islandRadius - 1.8;
  const plateauOuter = islandRadius * 0.52;
  const plateauInner = islandRadius * 0.44;
  const lagoonShoreOuter = 5.5;
  const lagoonShoreInner = 4.8;
  const lagoonOuter = 4.4;
  const lagoonInner = 4.2;

  useFrame(({ clock }) => {
    if (oceanMaterialRef.current) {
      oceanMaterialRef.current.opacity =
        0.78 + Math.sin(clock.elapsedTime * 0.5) * 0.04;
    }
    if (lagoonRef.current) {
      lagoonRef.current.rotation.y += 0.003;
    }
  });

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -1.2, 0]}
        receiveShadow
      >
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#0a3a4a" roughness={0.8} />
      </mesh>

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.8, 0]}
        receiveShadow
      >
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial
          ref={oceanMaterialRef}
          color="#0d5c6e"
          transparent
          opacity={0.82}
          roughness={0.1}
          metalness={0.4}
        />
      </mesh>

      <mesh position={[0, -0.6, 0]} receiveShadow>
        <cylinderGeometry args={[beachInner, beachOuter, 1.0, 128]} />
        <meshLambertMaterial color="#c8a040" />
      </mesh>

      <mesh position={[0, -0.3, 0]} receiveShadow>
        <cylinderGeometry args={[grassInner, grassOuter, 1.2, 128]} />
        <meshLambertMaterial color="#3a6a1a" />
      </mesh>

      <mesh position={[0, 0.0, 0]} receiveShadow>
        <cylinderGeometry args={[plateauInner, plateauOuter, 1.0, 128]} />
        <meshLambertMaterial color="#4a7a22" />
      </mesh>

      <mesh position={[0, 0.3, 0]} receiveShadow>
        <cylinderGeometry
          args={[lagoonShoreInner, lagoonShoreOuter, 0.8, 128]}
        />
        <meshLambertMaterial color="#2a5a14" />
      </mesh>

      <mesh ref={lagoonRef} position={[0, 0.8, 0]} receiveShadow>
        <cylinderGeometry args={[lagoonInner, lagoonOuter, 1.4, 128]} />
        <meshStandardMaterial
          color="#00c9b0"
          emissive="#004433"
          emissiveIntensity={0.6}
          transparent
          opacity={0.92}
          roughness={0.05}
          metalness={0.5}
        />
      </mesh>
      <pointLight
        position={[0, 2.5, 0]}
        color="#00ffcc"
        intensity={3}
        distance={16}
      />

      <Html position={[0, 2.5, 0]} center>
        <div
          style={{
            color: "#00ffee",
            fontSize: "11px",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            background: "rgba(0,20,20,0.6)",
            padding: "3px 8px",
            borderRadius: "4px",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          DMT Lagoon
        </div>
      </Html>
    </>
  );
}

function PalmTree({
  position,
  scale,
  rotation,
}: {
  position: [number, number, number];
  scale: number;
  rotation: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.11, 1.1, 6]} />
        <meshLambertMaterial color="#7d5730" />
      </mesh>

      {Array.from({ length: 5 }).map((_, index) => (
        <mesh
          key={`leaf-${index}`}
          position={[0, 1.18, 0]}
          rotation={[0.28, (index / 5) * Math.PI * 2, -0.32]}
          castShadow
        >
          <coneGeometry args={[0.18, 0.86, 5]} />
          <meshLambertMaterial color="#4d8f45" />
        </mesh>
      ))}
    </group>
  );
}

function ParcelGreens({ node }: { node: PositionedBungalow }) {
  const palms = useMemo(
    () =>
      Array.from({ length: 3 }, (_, index) => {
        const seed = `${node.bungalow.token_address}:${index}`;
        const angle = hashToUnit(`${seed}:angle`) * Math.PI * 2;
        const radius = 1.45 + hashToUnit(`${seed}:radius`) * 1.1;
        const scale = 0.8 + hashToUnit(`${seed}:scale`) * 0.35;
        return {
          position: [
            Math.cos(angle) * radius,
            0.22,
            Math.sin(angle) * radius,
          ] as [number, number, number],
          scale,
          rotation: angle,
        };
      }),
    [node.bungalow.token_address],
  );

  return (
    <>
      {palms.map((palm, index) => (
        <PalmTree
          key={`${node.bungalow.token_address}-palm-${index}`}
          position={palm.position}
          scale={palm.scale}
          rotation={palm.rotation}
        />
      ))}
    </>
  );
}

function BungalowMarker({
  node,
  compact,
  selected,
  onSelect,
}: {
  node: PositionedBungalow;
  compact: boolean;
  selected: boolean;
  onSelect: (node: PositionedBungalow) => void;
}) {
  return (
    <Html position={[0, 3.35, 0]} center style={{ pointerEvents: "auto" }}>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect(node);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: compact ? 0 : 10,
          minHeight: 44,
          padding: compact ? 4 : "7px 10px 7px 7px",
          borderRadius: 999,
          border: selected
            ? "1px solid rgba(255, 211, 122, 0.82)"
            : "1px solid rgba(255,255,255,0.14)",
          background: selected
            ? "rgba(18, 28, 18, 0.94)"
            : "rgba(10, 18, 14, 0.82)",
          color: "#f6eed7",
          cursor: "pointer",
          boxShadow: selected
            ? "0 12px 26px rgba(0,0,0,0.42)"
            : "0 8px 18px rgba(0,0,0,0.28)",
          backdropFilter: "blur(10px)",
        }}
      >
        <TokenAvatar
          bungalow={node.bungalow}
          size={compact ? 38 : 46}
          radius={999}
        />
        {!compact ? (
          <span
            style={{
              display: "grid",
              justifyItems: "start",
              gap: 2,
              minWidth: 0,
              textAlign: "left",
            }}
          >
            <strong
              style={{
                fontSize: 12,
                lineHeight: 1.15,
                whiteSpace: "nowrap",
              }}
            >
              {node.bungalow.symbol ?? node.bungalow.name ?? "Bungalow"}
            </strong>
          </span>
        ) : null}
      </button>
    </Html>
  );
}

function BungalowHut({
  node,
  compactMarker,
  selected,
  onSelect,
}: {
  node: PositionedBungalow;
  compactMarker: boolean;
  selected: boolean;
  onSelect: (node: PositionedBungalow) => void;
}) {
  const glowColor = GLOW_COLORS[node.index % GLOW_COLORS.length];

  return (
    <group position={[node.worldX, 0, node.worldZ]}>
      <mesh position={[0, 0.5, 0]} receiveShadow>
        <cylinderGeometry args={[4.05, 4.86, 0.62, 8]} />
        <meshLambertMaterial color="#c6ab70" />
      </mesh>

      <mesh position={[0, 0.67, 0]} receiveShadow>
        <cylinderGeometry args={[3.38, 3.94, 0.34, 8]} />
        <meshLambertMaterial color="#3a7436" />
      </mesh>

      <group position={[0, 1.2, 0]}>
        <group position={[0, -0.78, 0]}>
          <ParcelGreens node={node} />
        </group>

        <mesh position={[0, 0.06, 0]} castShadow>
          <cylinderGeometry args={[1.74, 1.96, 1.92, 8]} />
          <meshLambertMaterial color="#7a5c3a" />
        </mesh>

        <mesh position={[0, 1.2, 0]} castShadow>
          <coneGeometry args={[2.58, 2.92, 8]} />
          <meshLambertMaterial color="#4a3520" />
        </mesh>

        <mesh position={[0, 0.36, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[2.76, 0.11, 8, 32]} />
          <meshLambertMaterial color="#6b4c28" />
        </mesh>

        <mesh position={[0, -0.16, 1.16]}>
          <boxGeometry args={[0.5, 0.72, 0.06]} />
          <meshLambertMaterial color="#261709" />
        </mesh>

        {selected ? (
          <mesh position={[0, -0.66, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.92, 2.34, 48]} />
            <meshBasicMaterial color="#ffd37a" transparent opacity={0.92} />
          </mesh>
        ) : null}

        <pointLight
          position={[0, 0.02, 0]}
          intensity={1.05}
          color={new Color(glowColor)}
          distance={6}
        />

        <mesh
          onClick={(event) => {
            event.stopPropagation();
            onSelect(node);
          }}
        >
          <sphereGeometry args={[3.3, 24, 24]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>

        <BungalowMarker
          node={node}
          compact={compactMarker}
          selected={selected}
          onSelect={onSelect}
        />
      </group>
    </group>
  );
}

function CameraRig({
  controlsRef,
  motion,
  onSettled,
}: {
  controlsRef: RefObject<OrbitControlsImpl | null>;
  motion: CameraMotion | null;
  onSettled: () => void;
}) {
  const settledRef = useRef(false);

  useEffect(() => {
    settledRef.current = false;
  }, [motion?.id]);

  useFrame(({ camera }) => {
    if (!motion || !controlsRef.current) {
      return;
    }

    camera.position.lerp(motion.camera, 0.065);
    controlsRef.current.target.lerp(motion.focus, 0.065);
    controlsRef.current.update();

    const cameraDone = camera.position.distanceTo(motion.camera) < 0.22;
    const focusDone =
      controlsRef.current.target.distanceTo(motion.focus) < 0.18;

    if (cameraDone && focusDone && !settledRef.current) {
      settledRef.current = true;
      onSettled();
    }
  });

  return null;
}

function IslandScene({
  nodes,
  islandRadius,
  isLoading,
  error,
  compactMarker,
  selectedKey,
  onSelect,
  motion,
  onMotionSettled,
}: {
  nodes: PositionedBungalow[];
  islandRadius: number;
  isLoading: boolean;
  error: string | null;
  compactMarker: boolean;
  selectedKey: string | null;
  onSelect: (node: PositionedBungalow) => void;
  motion: CameraMotion | null;
  onMotionSettled: () => void;
}) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  return (
    <>
      <ambientLight intensity={0.45} color="#a8d5a2" />
      <directionalLight
        position={[10, 20, 5]}
        intensity={1.26}
        color="#ffe8a0"
        castShadow
      />
      <directionalLight
        position={[-5, 2, -5]}
        intensity={0.24}
        color="#0e5c34"
      />

      <TerrainLayers islandRadius={islandRadius} />

      {isLoading ? <SceneStatus label="Loading island..." /> : null}
      {error ? (
        <SceneStatus label={`Failed to load community bungalows: ${error}`} />
      ) : null}
      {!isLoading && !error && nodes.length === 0 ? (
        <SceneStatus label="No community bungalows are open yet." />
      ) : null}

      {!isLoading && !error
        ? nodes.map((node) => {
            const nodeKey = `${node.bungalow.chain}:${node.bungalow.token_address}`;
            return (
              <BungalowHut
                key={nodeKey}
                node={node}
                compactMarker={compactMarker}
                selected={selectedKey === nodeKey}
                onSelect={onSelect}
              />
            );
          })
        : null}

      <CameraRig
        controlsRef={controlsRef}
        motion={motion}
        onSettled={onMotionSettled}
      />

      <OrbitControls
        ref={controlsRef}
        minPolarAngle={Math.PI / 7}
        maxPolarAngle={Math.PI / 2.4}
        minDistance={islandRadius * 0.8}
        maxDistance={islandRadius * 4.2}
        enablePan
        dampingFactor={0.08}
        enableDamping
      />
    </>
  );
}

function WorldHud({
  bungalowCount: _bungalowCount,
  onOpenConstruction,
  loading: _loading,
}: {
  bungalowCount: number;
  onOpenConstruction: () => void;
  loading: boolean;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onOpenConstruction}
        style={{
          position: "absolute",
          top: 18,
          right: 18,
          zIndex: 4,
          minHeight: 48,
          border: 0,
          borderRadius: 999,
          padding: "0 18px",
          background: "linear-gradient(135deg, #ffd37a, #f8bf57)",
          color: "#241b08",
          font: "inherit",
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 16px 34px rgba(0,0,0,0.26)",
        }}
      >
        Add a Bungalow
      </button>
    </>
  );
}

function SelectionHud({
  bungalow,
  onEnter,
  onClose,
}: {
  bungalow: HomeTeamBungalow;
  onEnter: () => void;
  onClose: () => void;
}) {
  const isMobile = useMediaWidth(768);

  return (
    <div
      style={{
        position: "absolute",
        left: isMobile ? 12 : 18,
        right: isMobile ? 12 : "auto",
        bottom: isMobile ? 12 : 18,
        zIndex: 4,
        width: isMobile ? "auto" : 360,
        padding: isMobile ? 14 : 16,
        borderRadius: 20,
        border: "1px solid rgba(255,255,255,0.12)",
        background:
          "linear-gradient(180deg, rgba(9, 17, 14, 0.95), rgba(11, 23, 18, 0.88))",
        boxShadow: "0 22px 42px rgba(0,0,0,0.32)",
        backdropFilter: "blur(16px)",
        display: "grid",
        gap: 14,
      }}
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
      >
        <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
          <TokenAvatar
            bungalow={bungalow}
            size={isMobile ? 54 : 60}
            radius={18}
          />
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#96d4bf",
              }}
            >
              Community Bungalow
            </p>
            <h2
              style={{
                margin: "4px 0 2px",
                fontSize: 22,
                lineHeight: 1.1,
                color: "#f7efd6",
              }}
            >
              {bungalow.name ?? bungalow.symbol ?? "Bungalow"}
            </h2>
            <p
              style={{
                margin: 0,
                color: "rgba(247,239,214,0.66)",
                fontSize: 13,
              }}
            >
              {bungalow.symbol ?? "No ticker yet"} ·{" "}
              {formatCount(bungalow.holder_count)} holders
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            color: "#f7efd6",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          ×
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onEnter}
          style={{
            minHeight: 46,
            padding: "0 18px",
            border: 0,
            borderRadius: 12,
            background: "linear-gradient(135deg, #ffd37a, #f8bf57)",
            color: "#241b08",
            font: "inherit",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Enter Bungalow
        </button>
      </div>
    </div>
  );
}

function ControlsHint() {
  const isCompact = useMediaWidth(720);

  return (
    <div
      style={{
        position: "absolute",
        right: 18,
        bottom: 18,
        zIndex: 3,
        padding: isCompact ? "9px 12px" : "10px 14px",
        borderRadius: 999,
        background: "rgba(8, 17, 18, 0.68)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "rgba(247,239,214,0.7)",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        backdropFilter: "blur(14px)",
      }}
    >
      Tap homes • Drag world • Pinch to zoom
    </div>
  );
}

function getOverviewMotion(islandRadius: number): CameraMotion {
  const cameraDistance = islandRadius * 2.4;
  const cameraHeight = islandRadius * 1.8;

  return {
    id: `overview-${Date.now()}`,
    camera: new Vector3(0, cameraHeight, cameraDistance),
    focus: new Vector3(0, 0, 0),
  };
}

function createSelectionMotion(
  node: PositionedBungalow,
  isCompact: boolean,
  islandRadius: number,
): CameraMotion {
  const selectionDistance = Math.max(
    isCompact ? 8.8 : 7.8,
    islandRadius * 0.75,
  );
  const selectionHeight = Math.max(
    isCompact ? 7.3 : 6.6,
    islandRadius * 0.48,
  );

  return {
    id: `${node.bungalow.chain}:${node.bungalow.token_address}:${Date.now()}`,
    camera: new Vector3(
      node.worldX + (isCompact ? 0.25 : 0.1),
      selectionHeight,
      node.worldZ + selectionDistance,
    ),
    focus: new Vector3(node.worldX, 0.45, node.worldZ),
  };
}

function IslandMap3D({
  bungalows,
  isLoading,
  error,
  onOpenConstruction,
}: IslandMapProps) {
  const navigate = useNavigate();
  const compactMarker = useMediaWidth(480);
  const isCompact = useMediaWidth(900);
  const islandRadius = useMemo(
    () => computeIslandRadius(bungalows.length),
    [bungalows.length],
  );
  const cameraDistance = islandRadius * 2.4;
  const cameraHeight = islandRadius * 1.8;
  const nodes = useMemo(() => {
    const ringPositions = computeRingPositions(bungalows.length);

    return bungalows.map((bungalow, index) => {
      const ringPosition = ringPositions[index];

      return {
        bungalow,
        index,
        worldX: ringPosition.x,
        worldZ: ringPosition.z,
      };
    });
  }, [bungalows]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [motion, setMotion] = useState<CameraMotion | null>(null);

  const selectedNode =
    nodes.find(
      (node) =>
        `${node.bungalow.chain}:${node.bungalow.token_address}` === selectedKey,
    ) ?? null;

  const handleSelect = (node: PositionedBungalow) => {
    const nextKey = `${node.bungalow.chain}:${node.bungalow.token_address}`;
    setSelectedKey(nextKey);
    setMotion(createSelectionMotion(node, isCompact, islandRadius));
  };

  const resetView = () => {
    setSelectedKey(null);
    setMotion(getOverviewMotion(islandRadius));
  };

  return (
    <div
      style={{
        position: "relative",
        height: "calc(100vh - 52px)",
        minHeight: "calc(100vh - 52px)",
        overflow: "hidden",
        borderRadius: 24,
        background:
          "radial-gradient(circle at 48% 38%, rgba(88, 190, 195, 0.24), transparent 28%), radial-gradient(circle at 50% 44%, rgba(59, 120, 72, 0.44), rgba(8, 18, 14, 0.96) 62%), linear-gradient(180deg, #0c2b2d 0%, #08140d 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <Canvas
        shadows
        style={{
          width: "100%",
          height: "100%",
          position: "absolute",
          inset: 0,
        }}
        camera={{ position: [0, cameraHeight, cameraDistance], fov: 48 }}
        gl={{ antialias: true, alpha: false }}
        onPointerMissed={() => {
          resetView();
        }}
      >
        <color attach="background" args={["#0c2222"]} />
        <fog
          attach="fog"
          args={["#0c2222", islandRadius * 1.1, islandRadius * 5]}
        />
        <Suspense fallback={null}>
          <IslandScene
            nodes={nodes}
            islandRadius={islandRadius}
            isLoading={isLoading}
            error={error}
            compactMarker={compactMarker}
            selectedKey={selectedKey}
            onSelect={handleSelect}
            motion={motion}
            onMotionSettled={() => setMotion(null)}
          />
        </Suspense>
      </Canvas>

      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.12) 0.8px, transparent 0.8px)",
          backgroundSize: "18px 18px",
          opacity: 0.06,
        }}
      />

      <WorldHud
        bungalowCount={bungalows.length}
        onOpenConstruction={onOpenConstruction}
        loading={isLoading}
      />

      {selectedNode ? (
        <SelectionHud
          bungalow={selectedNode.bungalow}
          onClose={resetView}
          onEnter={() =>
            navigate(
              `/bungalow/${selectedNode.bungalow.canonical_slug ?? selectedNode.bungalow.token_address}`,
            )
          }
        />
      ) : null}

      <ControlsHint />
    </div>
  );
}

function IslandMapFallback({
  bungalows,
  isLoading,
  error,
  onOpenConstruction,
}: IslandMapProps) {
  const navigate = useNavigate();
  const isCompact = useMediaWidth(768);
  const nodes = useMemo(() => {
    const positions = resolveAllPositions(bungalows);
    return bungalows.map((bungalow, index) => ({
      bungalow,
      index,
      x: positions[index].x,
      y: positions[index].y,
    }));
  }, [bungalows]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedNode =
    nodes.find(
      (node) =>
        `${node.bungalow.chain}:${node.bungalow.token_address}` === selectedKey,
    ) ?? null;

  return (
    <section
      onClick={() => setSelectedKey(null)}
      style={{
        position: "relative",
        height: "calc(100vh - 52px)",
        minHeight: "calc(100vh - 52px)",
        borderRadius: 24,
        overflow: "hidden",
        background:
          "radial-gradient(circle at 50% 42%, rgba(76, 133, 87, 0.36), transparent 24%), radial-gradient(circle at 50% 44%, rgba(74, 185, 214, 0.18), transparent 16%), linear-gradient(180deg, #0c2b2d 0%, #08140d 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "8% 8% 12%",
          borderRadius: "46% 54% 52% 48% / 44% 48% 52% 56%",
          background:
            "radial-gradient(circle at 50% 42%, rgba(63, 139, 74, 0.9), rgba(28, 69, 35, 0.98) 72%)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.32)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "36%",
          top: "30%",
          width: "28%",
          height: "24%",
          borderRadius: "50%",
          background: "rgba(74, 185, 214, 0.8)",
          boxShadow: "0 0 0 8px rgba(215,194,138,0.18)",
        }}
      />

      <WorldHud
        bungalowCount={bungalows.length}
        onOpenConstruction={onOpenConstruction}
        loading={isLoading}
      />

      {nodes.map((node) => {
        const key = `${node.bungalow.chain}:${node.bungalow.token_address}`;
        return (
          <button
            key={key}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedKey(key);
            }}
            style={{
              position: "absolute",
              left: `${node.x}%`,
              top: `${node.y}%`,
              transform: "translate(-50%, -50%)",
              minWidth: 44,
              minHeight: 44,
              borderRadius: 999,
              border:
                selectedKey === key
                  ? "1px solid rgba(255, 211, 122, 0.82)"
                  : "1px solid rgba(255,255,255,0.14)",
              background:
                selectedKey === key
                  ? "rgba(18, 28, 18, 0.94)"
                  : "rgba(10, 18, 14, 0.84)",
              padding: isCompact ? 4 : "7px 10px 7px 7px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "#f6eed7",
              cursor: "pointer",
              boxShadow: "0 12px 24px rgba(0,0,0,0.25)",
            }}
          >
            <TokenAvatar
              bungalow={node.bungalow}
              size={isCompact ? 34 : 40}
              radius={999}
            />
          </button>
        );
      })}

      {isLoading ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            padding: "12px 16px",
            borderRadius: 12,
            background: "rgba(8,18,24,0.84)",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "#eef6e9",
            zIndex: 4,
          }}
        >
          Loading island...
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            padding: "12px 16px",
            borderRadius: 12,
            background: "rgba(8,18,24,0.84)",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "#eef6e9",
            zIndex: 4,
          }}
        >
          Failed to load community bungalows: {error}
        </div>
      ) : null}

      {selectedNode ? (
        <SelectionHud
          bungalow={selectedNode.bungalow}
          onClose={() => setSelectedKey(null)}
          onEnter={() =>
            navigate(
              `/bungalow/${selectedNode.bungalow.canonical_slug ?? selectedNode.bungalow.token_address}`,
            )
          }
        />
      ) : null}

      <ControlsHint />
    </section>
  );
}

export default function IslandMap(props: IslandMapProps) {
  return (
    <CanvasErrorBoundary fallback={<IslandMapFallback {...props} />}>
      <IslandMap3D {...props} />
    </CanvasErrorBoundary>
  );
}
