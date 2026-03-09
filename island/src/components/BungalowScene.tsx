import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, Text, useCursor } from "@react-three/drei";
import { useNavigate } from "react-router-dom";
import {
  CanvasTexture,
  DoubleSide,
  EdgesGeometry,
  Group,
  PlaneGeometry,
  Texture,
} from "three";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useBungalowScene } from "../hooks/useBungalowScene";
import type { SlotConfig } from "../types/scene";
import AddToSlotModal from "./AddToSlotModal";
import BodegaModal from "./BodegaModal";
import BodegaPlacementModal from "./BodegaPlacementModal";
import CanvasErrorBoundary from "./CanvasErrorBoundary";
import { formatAddress, formatTimeAgo } from "../utils/formatters";
import type { BodegaCatalogItem } from "../utils/bodega";
import { getFallbackTokenImage, getTokenImageUrl } from "../utils/tokenImage";

interface BungalowSceneProps {
  chain: string;
  ca: string;
  ownerAddress: string | null;
  adminAddress: string | null;
  title: string;
  symbol: string | null;
  imageUrl: string | null;
  description: string | null;
  visibleChains: string[];
  onOpenBodega: () => void;
  initialBodegaItem?: BodegaCatalogItem | null;
  onInitialBodegaItemConsumed?: () => void;
}

type SelectableSlotType = SlotConfig["slotType"];
type WallFeedKind = "post" | "visit" | "add_art" | "add_build" | "add_item";

interface WallFeedItem {
  id: string;
  kind: WallFeedKind;
  wallet: string | null;
  username: string | null;
  pfp_url: string | null;
  content: string | null;
  image_url: string | null;
  detail: string | null;
  island_heat: number;
  token_heat: number;
  created_at: string;
}

function useIsMobile(maxWidth: number) {
  const [matches, setMatches] = useState(() => window.innerWidth < maxWidth);

  useEffect(() => {
    const update = () => setMatches(window.innerWidth < maxWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [maxWidth]);

  return matches;
}

function formatPlacementAttribution(
  decoration: SlotConfig["decoration"] | undefined,
): string | null {
  if (!decoration) return null;

  const username = decoration.placedByHandle?.trim();
  const actor = username
    ? `@${username.replace(/^@+/, "")}`
    : decoration.placedBy
      ? formatAddress(decoration.placedBy)
      : null;
  const placedAt = decoration.placedAt
    ? formatTimeAgo(decoration.placedAt)
    : null;

  if (!actor && !placedAt) {
    return null;
  }

  if (actor && placedAt) {
    return `added by ${actor} · ${placedAt}`;
  }

  if (actor) {
    return `added by ${actor}`;
  }

  return placedAt;
}

function getCompatibleSlotTypes(
  item: BodegaCatalogItem | null,
): SelectableSlotType[] | null {
  if (!item) return null;

  if (item.asset_type === "portal") {
    return ["portal"];
  }

  if (
    item.asset_type === "link" ||
    item.asset_type === "game" ||
    item.asset_type === "miniapp"
  ) {
    return ["wall-frame", "link"];
  }

  if (item.asset_type === "image" || item.asset_type === "frame") {
    return ["wall-frame"];
  }

  if (item.asset_type === "decoration") {
    const format =
      typeof item.content.format === "string"
        ? item.content.format.trim().toLowerCase()
        : "";

    return format === "image" ? ["wall-frame"] : ["shelf", "floor"];
  }

  return ["wall-frame"];
}

function describePlacementSpots(
  slotTypes: SelectableSlotType[] | null,
): string {
  if (!slotTypes || slotTypes.length === 0) {
    return "placement spot";
  }

  if (slotTypes.length === 1) {
    if (slotTypes[0] === "wall-frame") return "wall spot";
    if (slotTypes[0] === "floor") return "floor spot";
    if (slotTypes[0] === "shelf") return "shelf spot";
    if (slotTypes[0] === "portal") return "portal spot";
    if (slotTypes[0] === "link") return "link spot";
  }

  if (slotTypes.includes("shelf") && slotTypes.includes("floor")) {
    return "floor or shelf spot";
  }

  return "placement spot";
}

function formatPlacementSpotCount(
  count: number,
  slotTypes: SelectableSlotType[] | null,
): string {
  if (!slotTypes || slotTypes.length === 0) {
    return `${count} open room spot${count === 1 ? "" : "s"} total`;
  }

  const label = describePlacementSpots(slotTypes);
  return `${count} open ${label}${count === 1 ? "" : "s"}`;
}

async function readResponseMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const cloned = response.clone();

  try {
    const payload = (await cloned.json()) as {
      error?: string;
      message?: string;
    };
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    try {
      const text = await response.text();
      if (text.trim()) {
        return text.trim();
      }
    } catch {
      return fallback || "Request failed";
    }
  }

  return fallback || "Request failed";
}

function useFloorTexture() {
  const [texture, setTexture] = useState<Texture | null>(null);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.fillStyle = "#8B6914";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(73, 43, 10, 0.48)";
    context.lineWidth = 6;

    for (let index = 0; index < 8; index += 1) {
      const y = ((index + 1) / 9) * canvas.height;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }

    const nextTexture = new CanvasTexture(canvas);
    nextTexture.needsUpdate = true;
    setTexture(nextTexture);

    return () => {
      nextTexture.dispose();
    };
  }, []);

  return texture;
}

function SceneOverlay({ label }: { label: string }) {
  return (
    <Html center zIndexRange={[4, 0]}>
      <div
        style={{
          padding: "12px 16px",
          borderRadius: 10,
          background: "rgba(10, 20, 10, 0.9)",
          color: "#f8f1d8",
          border: "1px solid rgba(255,255,255,0.12)",
          fontSize: 13,
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </div>
    </Html>
  );
}

function WallBeam({
  position,
  args,
  rotation,
  color = "#6b4c1a",
}: {
  position: [number, number, number];
  args: [number, number, number];
  rotation?: [number, number, number];
  color?: string;
}) {
  return (
    <mesh position={position} rotation={rotation}>
      <boxGeometry args={args} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

function RoomShell({ floorTexture }: { floorTexture: Texture | null }) {
  const wallSegments: Array<{
    key: string;
    position: [number, number, number];
    rotation: [number, number, number];
    width: number;
    color: string;
  }> = [
    {
      key: "back",
      position: [0, 3, -5.7],
      rotation: [0, 0, 0],
      width: 7.2,
      color: "#eadcc6",
    },
    {
      key: "back-left",
      position: [-4.7, 3, -4.7],
      rotation: [0, Math.PI / 4, 0],
      width: 4.2,
      color: "#e3d5bc",
    },
    {
      key: "left",
      position: [-6.65, 3, 0],
      rotation: [0, Math.PI / 2, 0],
      width: 7.1,
      color: "#dccdb1",
    },
    {
      key: "front-left",
      position: [-4.7, 3, 4.7],
      rotation: [0, (3 * Math.PI) / 4, 0],
      width: 4.2,
      color: "#d7c7a8",
    },
    {
      key: "back-right",
      position: [4.7, 3, -4.7],
      rotation: [0, -Math.PI / 4, 0],
      width: 4.2,
      color: "#e3d5bc",
    },
    {
      key: "right",
      position: [6.65, 3, 0],
      rotation: [0, -Math.PI / 2, 0],
      width: 7.1,
      color: "#dccdb1",
    },
    {
      key: "front-right",
      position: [4.7, 3, 4.7],
      rotation: [0, (-3 * Math.PI) / 4, 0],
      width: 4.2,
      color: "#d7c7a8",
    },
  ];

  return (
    <>
      {wallSegments.map((segment) => (
        <mesh
          key={segment.key}
          position={segment.position}
          rotation={segment.rotation}
        >
          <planeGeometry args={[segment.width, 6]} />
          <meshLambertMaterial color={segment.color} side={DoubleSide} />
        </mesh>
      ))}

      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[8.6, 8]} />
        <meshLambertMaterial
          color="#8B6914"
          map={floorTexture ?? undefined}
          side={DoubleSide}
        />
      </mesh>

      <mesh position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[8.6, 8]} />
        <meshLambertMaterial color="#6b4c1a" side={DoubleSide} />
      </mesh>

      {[
        [-3.55, 3, -8.15],
        [3.55, 3, -8.15],
        [-8.15, 3, -3.55],
        [-8.15, 3, 3.55],
        [8.15, 3, -3.55],
        [8.15, 3, 3.55],
        [-3.55, 3, 8.15],
        [3.55, 3, 8.15],
      ].map((position, index) => (
        <WallBeam
          key={`corner-post-${index}`}
          position={position as [number, number, number]}
          args={[0.16, 6.04, 0.16]}
        />
      ))}

      <WallBeam position={[0, 5.92, -5.94]} args={[7.32, 0.16, 0.16]} />
      <WallBeam position={[0, 0.08, -5.94]} args={[7.32, 0.16, 0.16]} />

      {[
        { key: "beam-left-back", position: [-4.7, 5.92, -4.7] as [number, number, number], rotation: [0, Math.PI / 4, 0] as [number, number, number] },
        { key: "beam-left-side", position: [-6.65, 5.92, 0] as [number, number, number], rotation: [0, Math.PI / 2, 0] as [number, number, number] },
        { key: "beam-left-front", position: [-4.7, 5.92, 4.7] as [number, number, number], rotation: [0, (3 * Math.PI) / 4, 0] as [number, number, number] },
        { key: "beam-right-back", position: [4.7, 5.92, -4.7] as [number, number, number], rotation: [0, -Math.PI / 4, 0] as [number, number, number] },
        { key: "beam-right-side", position: [6.65, 5.92, 0] as [number, number, number], rotation: [0, -Math.PI / 2, 0] as [number, number, number] },
        { key: "beam-right-front", position: [4.7, 5.92, 4.7] as [number, number, number], rotation: [0, (-3 * Math.PI) / 4, 0] as [number, number, number] },
      ].map((beam) => (
        <WallBeam
          key={beam.key}
          position={beam.position}
          args={[4.34, 0.12, 0.18]}
          rotation={beam.rotation}
        />
      ))}
    </>
  );
}

function TokenImage({
  src,
  alt,
  fallbackSeed,
  style,
}: {
  src: string | null | undefined;
  alt: string;
  fallbackSeed: string;
  style: CSSProperties;
}) {
  const fallback = getFallbackTokenImage(fallbackSeed);
  const [imageSrc, setImageSrc] = useState(() => src || fallback);

  useEffect(() => {
    setImageSrc(src || fallback);
  }, [fallback, src]);

  return (
    <img
      src={imageSrc}
      alt={alt}
      onError={() => {
        if (imageSrc !== fallback) {
          setImageSrc(fallback);
        }
      }}
      style={style}
    />
  );
}

function PlaceholderImage({
  title,
  width,
  height,
}: {
  title: string;
  width: number;
  height: number;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 10,
        display: "grid",
        placeItems: "center",
        background:
          "linear-gradient(135deg, rgba(73, 124, 88, 0.8), rgba(49, 73, 55, 0.95))",
        color: "#f4ead2",
        textAlign: "center",
        padding: 12,
        boxSizing: "border-box",
        fontSize: 12,
        lineHeight: 1.3,
      }}
    >
      {title}
    </div>
  );
}

function FloorIdentityRug({
  title,
  imageUrl,
  isMobile,
}: {
  title: string;
  imageUrl: string | null;
  isMobile: boolean;
}) {
  return (
    <group position={[0, 0.06, 2.55]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh receiveShadow>
        <planeGeometry args={[4.5, 3.4]} />
        <meshLambertMaterial color="#d6b874" />
      </mesh>
      <mesh position={[0, 0, 0.02]} receiveShadow>
        <planeGeometry args={[4.18, 3.08]} />
        <meshLambertMaterial color="#2c190a" />
      </mesh>
      <Html transform position={[0, 0.08, 0.03]} style={{ pointerEvents: "none" }}>
        <div
          style={{
            width: isMobile ? 220 : 280,
            height: isMobile ? 158 : 196,
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: "0 18px 36px rgba(0,0,0,0.28)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <TokenImage
            src={imageUrl}
            alt={title}
            fallbackSeed={title}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
      </Html>
      <Text
        position={[0, -1.95, 0.04]}
        fontSize={0.34}
        color="#f8efd7"
        anchorX="center"
        anchorY="middle"
        maxWidth={4.2}
      >
        {title}
      </Text>
    </group>
  );
}

function CommunityWallDisplay({
  title,
  onOpen,
}: {
  title: string;
  onOpen: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered, "pointer", "auto");

  return (
    <group position={[0, 2.95, -5.76]}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <planeGeometry args={[4.1, 3.2]} />
        <meshLambertMaterial color={hovered ? "#6d4d1a" : "#573a14"} />
      </mesh>
      <mesh position={[0, 0, 0.02]}>
        <planeGeometry args={[3.7, 2.82]} />
        <meshLambertMaterial color="#1f1811" opacity={0.88} transparent />
      </mesh>
      <Text
        position={[0, 0.86, 0.04]}
        fontSize={0.24}
        color="#f4e3bb"
        anchorX="center"
        anchorY="middle"
        maxWidth={3.2}
      >
        Community Wall
      </Text>
      <Text
        position={[0, 0.2, 0.04]}
        fontSize={0.15}
        color="#d8c79f"
        anchorX="center"
        anchorY="middle"
        maxWidth={3.1}
      >
        Click to zoom in, write, and read what people are doing in {title}
      </Text>
      <Text
        position={[0, -0.92, 0.04]}
        fontSize={0.18}
        color={hovered ? "#ffe3a3" : "#d7b36a"}
        anchorX="center"
        anchorY="middle"
      >
        Open wall
      </Text>
    </group>
  );
}

function Planter({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.4, 0.6, 8]} />
        <meshLambertMaterial color="#6b4c28" />
      </mesh>
      <mesh position={[0, 0.9, 0]} castShadow>
        <sphereGeometry args={[0.5, 8, 8]} />
        <meshLambertMaterial color="#2d7a2d" />
      </mesh>
    </group>
  );
}

function Bench({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.36, 0]} castShadow>
        <boxGeometry args={[1.6, 0.12, 0.56]} />
        <meshLambertMaterial color="#704922" />
      </mesh>
      {[-0.6, 0.6].map((x) => (
        <mesh key={`leg-${x}`} position={[x, 0.18, 0.18]} castShadow>
          <boxGeometry args={[0.12, 0.36, 0.12]} />
          <meshLambertMaterial color="#55341a" />
        </mesh>
      ))}
      {[-0.6, 0.6].map((x) => (
        <mesh key={`back-leg-${x}`} position={[x, 0.18, -0.18]} castShadow>
          <boxGeometry args={[0.12, 0.36, 0.12]} />
          <meshLambertMaterial color="#55341a" />
        </mesh>
      ))}
    </group>
  );
}

function EmptyOwnerSlot({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const planeGeometry = useMemo(() => new PlaneGeometry(1.2, 1.2), []);
  const edgesGeometry = useMemo(
    () => new EdgesGeometry(planeGeometry),
    [planeGeometry],
  );

  useCursor(hovered, "pointer", "auto");

  useEffect(
    () => () => {
      planeGeometry.dispose();
      edgesGeometry.dispose();
    },
    [edgesGeometry, planeGeometry],
  );

  return (
    <group>
      <mesh
        geometry={planeGeometry}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <meshBasicMaterial
          color="#fff2c4"
          opacity={hovered ? 0.2 : 0.08}
          transparent
        />
      </mesh>
      <lineSegments geometry={edgesGeometry}>
        <lineBasicMaterial
          color="#ffe1a3"
          opacity={hovered ? 0.46 : 0.26}
          transparent
        />
      </lineSegments>
    </group>
  );
}

function ImageDecoration({ slot }: { slot: SlotConfig }) {
  const imageUrl = slot.decoration?.imageUrl;
  const title = slot.decoration?.name ?? "Image";
  const placementMeta = formatPlacementAttribution(slot.decoration);

  return (
    <group>
      <mesh position={[0, 0, -0.05]}>
        <boxGeometry args={[1.52, 1.52, 0.08]} />
        <meshLambertMaterial color="#5c3d1e" />
      </mesh>
      <Html transform occlude zIndexRange={[6, 0]} position={[0, 0, 0.05]}>
        <div
          style={{
            width: 118,
            borderRadius: 10,
            overflow: "hidden",
            background: "rgba(10,20,10,0.92)",
            border: "1px solid rgba(255,255,255,0.14)",
            boxShadow: "0 18px 32px rgba(0,0,0,0.24)",
          }}
        >
          {imageUrl ? (
            <TokenImage
              src={imageUrl}
              alt={title}
              fallbackSeed={title}
              style={{
                width: "100%",
                height: 118,
                objectFit: "cover",
                display: "block",
              }}
            />
          ) : (
            <PlaceholderImage title={title} width={118} height={118} />
          )}
          {placementMeta ? (
            <div
              style={{
                padding: "8px 10px 10px",
                borderTop: "1px solid rgba(255,255,255,0.08)",
                fontSize: 10,
                lineHeight: 1.4,
                color: "rgba(255,255,255,0.62)",
              }}
            >
              {placementMeta}
            </div>
          ) : null}
        </div>
      </Html>
    </group>
  );
}

function LinkCard({
  linkUrl,
  name,
  isMobile,
}: {
  linkUrl: string;
  name: string;
  isMobile: boolean;
}) {
  const [preview, setPreview] = useState<{
    title?: string;
    image?: string;
    description?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      try {
        const response = await fetch(
          `/api/og?url=${encodeURIComponent(linkUrl)}`,
        );
        const data = (await response.json()) as {
          title?: string;
          image?: string;
          description?: string;
        };

        if (!cancelled) {
          setPreview(data);
        }
      } catch {
        if (!cancelled) {
          setPreview(null);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [linkUrl]);

  return (
    <div
      style={{
        background: "rgba(10,20,10,0.92)",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 8,
        padding: 8,
        width: isMobile ? 130 : 160,
        color: "#f7f1dd",
        display: "grid",
        gap: 8,
      }}
    >
      {preview?.image ? (
        <img
          src={preview.image}
          alt={preview.title ?? name}
          style={{
            width: "100%",
            maxHeight: 80,
            objectFit: "cover",
            borderRadius: 6,
            display: "block",
          }}
        />
      ) : null}

      <div style={{ display: "grid", gap: 4 }}>
        <strong style={{ fontSize: 12, lineHeight: 1.3 }}>
          {preview?.title ?? name}
        </strong>
        {preview?.description ? (
          <span
            style={{
              fontSize: 10,
              lineHeight: 1.4,
              color: "rgba(247,241,221,0.72)",
            }}
          >
            {preview.description}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          window.open(linkUrl, "_blank", "noopener,noreferrer");
        }}
        style={{
          minHeight: 32,
          border: "1px solid rgba(255,255,255,0.16)",
          borderRadius: 6,
          background: "rgba(255,255,255,0.06)",
          color: "#f7f1dd",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        ↗ open
      </button>
    </div>
  );
}

function LinkDecoration({
  slot,
  isMobile,
}: {
  slot: SlotConfig;
  isMobile: boolean;
}) {
  const linkUrl = slot.decoration?.linkUrl;
  if (!linkUrl || !slot.decoration) {
    return null;
  }

  return (
    <group>
      <mesh position={[0, 0, -0.05]}>
        <boxGeometry args={[1.72, 1.22, 0.08]} />
        <meshLambertMaterial color="#5c3d1e" />
      </mesh>
      <mesh>
        <planeGeometry args={[1.55, 1.05]} />
        <meshBasicMaterial color="#2a1a0c" opacity={0.86} transparent />
      </mesh>
      <Html transform occlude zIndexRange={[6, 0]} position={[0, 0, 0.06]}>
        <LinkCard
          linkUrl={linkUrl}
          name={slot.decoration.name}
          isMobile={isMobile}
        />
      </Html>
    </group>
  );
}

function extractDomain(url?: string) {
  if (!url) return "portal";

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function PortalDecoration({ slot }: { slot: SlotConfig }) {
  const groupRef = useRef<Group>(null);
  const linkUrl = slot.decoration?.linkUrl;

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.008;
    }
  });

  return (
    <group
      ref={groupRef}
      onClick={(event) => {
        event.stopPropagation();
        if (linkUrl) {
          window.open(linkUrl, "_blank", "noopener,noreferrer");
        }
      }}
    >
      <mesh position={[0, 0, -0.05]}>
        <boxGeometry args={[1.18, 1.18, 0.08]} />
        <meshLambertMaterial color="#4a3218" />
      </mesh>
      <mesh>
        <torusGeometry args={[0.5, 0.08, 16, 32]} />
        <meshStandardMaterial
          color="#00ffcc"
          emissive="#00ffcc"
          emissiveIntensity={1.5}
        />
      </mesh>
      <pointLight color="#00ffcc" intensity={1.5} distance={3} />
      <Text
        position={[0, -0.86, 0]}
        fontSize={0.12}
        color="#00ffcc"
        anchorX="center"
        anchorY="middle"
      >
        {extractDomain(linkUrl)}
      </Text>
    </group>
  );
}

function DecorationCube({ slot }: { slot: SlotConfig }) {
  const groupRef = useRef<Group>(null);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.y =
        Math.sin(state.clock.elapsedTime * 1.2) * 0.03;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.42, 0.52, 0.08, 16]} />
        <meshLambertMaterial color="#684421" />
      </mesh>
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[0.62, 0.62, 0.62]} />
        <meshLambertMaterial color="#c8a96e" />
      </mesh>
      <Text
        position={[0, -0.56, 0]}
        fontSize={0.14}
        color="#ffe8a0"
        anchorX="center"
        anchorY="middle"
        maxWidth={1.2}
      >
        {slot.decoration?.name ?? "Decoration"}
      </Text>
    </group>
  );
}

function SlotObject({
  slot,
  isOwner,
  isMobile,
  onClickEmpty,
  compatibleSlotTypes,
}: {
  slot: SlotConfig;
  isOwner: boolean;
  isMobile: boolean;
  onClickEmpty: (slotId: string) => void;
  compatibleSlotTypes: SelectableSlotType[] | null;
}) {
  const decorationType = slot.decoration?.type;
  const canShowEmptySlot =
    !slot.filled &&
    (compatibleSlotTypes
      ? compatibleSlotTypes.includes(slot.slotType)
      : isOwner);
  const scaledPosition: [number, number, number] = [
    slot.position[0] * 1.9,
    slot.position[1],
    slot.position[2] * 1.9,
  ];

  return (
    <group position={scaledPosition} rotation={slot.rotation}>
      {canShowEmptySlot ? (
        <EmptyOwnerSlot onClick={() => onClickEmpty(slot.slotId)} />
      ) : null}

      {slot.filled && decorationType === "image" ? (
        <ImageDecoration slot={slot} />
      ) : null}
      {slot.filled &&
      (decorationType === "website-link" ||
        decorationType === "social-link") ? (
        <LinkDecoration slot={slot} isMobile={isMobile} />
      ) : null}
      {slot.filled && decorationType === "portal" ? (
        <PortalDecoration slot={slot} />
      ) : null}
      {slot.filled &&
      (decorationType === "decoration" || decorationType === "furniture") ? (
        <DecorationCube slot={slot} />
      ) : null}
    </group>
  );
}

function formatWallHeat(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function getWallActorLabel(item: WallFeedItem): string {
  if (item.username?.trim()) {
    return `@${item.username.replace(/^@+/, "")}`;
  }

  if (item.wallet) {
    return formatAddress(item.wallet);
  }

  return "ANON";
}

function getWallItemHeadline(item: WallFeedItem): string {
  const actor = getWallActorLabel(item);

  if (item.kind === "post") {
    return actor;
  }

  if (item.kind === "visit") {
    return `${actor} visited`;
  }

  if (item.kind === "add_art") {
    return `${actor} added a piece of art`;
  }

  if (item.kind === "add_build") {
    return `${actor} added a build`;
  }

  return `${actor} added ${item.detail?.trim() || "something"}`;
}

function WallActivityOverlay({
  open,
  isMobile,
  title,
  symbol,
  items,
  loading,
  error,
  draft,
  onDraftChange,
  onClose,
  onPost,
  posting,
  authenticated,
  onLogin,
}: {
  open: boolean;
  isMobile: boolean;
  title: string;
  symbol: string | null;
  items: WallFeedItem[];
  loading: boolean;
  error: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onClose: () => void;
  onPost: () => void;
  posting: boolean;
  authenticated: boolean;
  onLogin: () => void;
}) {
  if (!open) {
    return null;
  }

  const bungalowHeatLabel = symbol?.trim() || title;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 12,
        display: "grid",
        placeItems: "center",
        padding: isMobile ? 14 : 24,
        background: "rgba(9, 10, 7, 0.62)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 860,
          maxHeight: "100%",
          display: "grid",
          gridTemplateRows: "auto auto minmax(0, 1fr)",
          gap: 14,
          padding: isMobile ? 16 : 22,
          borderRadius: 24,
          border: "1px solid rgba(233, 206, 141, 0.22)",
          background:
            "linear-gradient(180deg, rgba(67, 42, 16, 0.96), rgba(28, 20, 11, 0.98))",
          boxShadow: "0 28px 80px rgba(0,0,0,0.4)",
          color: "#f6ead1",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <span
              style={{
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "rgba(246,234,209,0.6)",
              }}
            >
              Zoomed Wall
            </span>
            <h3 style={{ margin: 0, fontSize: isMobile ? 24 : 30 }}>
              {title} community wall
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                lineHeight: 1.5,
                color: "rgba(246,234,209,0.72)",
              }}
            >
              People can leave a note here and the wall also tracks visits,
              art, and builds tied to this bungalow.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              minWidth: 40,
              height: 40,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "#f6ead1",
              cursor: "pointer",
              font: "inherit",
              fontSize: 20,
            }}
            aria-label="Close wall"
          >
            ×
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gap: 10,
            padding: isMobile ? 12 : 14,
            borderRadius: 18,
            background: "rgba(12, 13, 10, 0.4)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            rows={isMobile ? 3 : 4}
            maxLength={280}
            placeholder={`Write something on the ${title} wall...`}
            style={{
              width: "100%",
              resize: "vertical",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(0,0,0,0.18)",
              color: "#f6ead1",
              padding: "12px 14px",
              font: "inherit",
              lineHeight: 1.5,
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: "rgba(246,234,209,0.66)",
              }}
            >
              Need 10+ {bungalowHeatLabel} heat to write. Visits and installs
              appear automatically.
            </span>
            {authenticated ? (
              <button
                type="button"
                onClick={onPost}
                disabled={posting || draft.trim().length === 0}
                style={{
                  minHeight: 40,
                  padding: "0 16px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background:
                    posting || draft.trim().length === 0
                      ? "rgba(255,255,255,0.08)"
                      : "rgba(216, 179, 106, 0.92)",
                  color:
                    posting || draft.trim().length === 0 ? "#c4b597" : "#201508",
                  cursor:
                    posting || draft.trim().length === 0 ? "default" : "pointer",
                  font: "inherit",
                  fontWeight: 700,
                }}
              >
                {posting ? "Posting..." : "Write on wall"}
              </button>
            ) : (
              <button
                type="button"
                onClick={onLogin}
                style={{
                  minHeight: 40,
                  padding: "0 16px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(216, 179, 106, 0.92)",
                  color: "#201508",
                  cursor: "pointer",
                  font: "inherit",
                  fontWeight: 700,
                }}
              >
                Connect wallet to write
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            minHeight: 0,
            overflowY: "auto",
            display: "grid",
            gap: 10,
            paddingRight: 4,
          }}
        >
          {loading ? (
            <div
              style={{
                padding: 16,
                borderRadius: 18,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              Loading wall...
            </div>
          ) : null}

          {error ? (
            <div
              style={{
                padding: 16,
                borderRadius: 18,
                background: "rgba(92, 24, 24, 0.32)",
                border: "1px solid rgba(255,120,120,0.2)",
                color: "#ffd7d7",
              }}
            >
              {error}
            </div>
          ) : null}

          {!loading && !error && items.length === 0 ? (
            <div
              style={{
                padding: 16,
                borderRadius: 18,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "rgba(246,234,209,0.72)",
              }}
            >
              Nothing on this wall yet.
            </div>
          ) : null}

          {!loading && !error
            ? items.map((item) => {
                const bungalowHeat = formatWallHeat(item.token_heat);
                const islandHeat = formatWallHeat(item.island_heat);

                return (
                  <article
                    key={item.id}
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: isMobile ? 12 : 14,
                      borderRadius: 18,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <strong style={{ fontSize: 14, lineHeight: 1.4 }}>
                        {getWallItemHeadline(item)}
                      </strong>
                      <span
                        style={{
                          fontSize: 11,
                          color: "rgba(246,234,209,0.56)",
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                        }}
                      >
                        {formatTimeAgo(item.created_at)}
                      </span>
                    </div>

                    {item.kind === "post" && item.content ? (
                      <p
                        style={{
                          margin: 0,
                          fontSize: 14,
                          lineHeight: 1.6,
                          color: "#f6ead1",
                        }}
                      >
                        {item.content}
                      </p>
                    ) : item.detail ? (
                      <p
                        style={{
                          margin: 0,
                          fontSize: 13,
                          lineHeight: 1.5,
                          color: "rgba(246,234,209,0.72)",
                        }}
                      >
                        {item.detail}
                      </p>
                    ) : null}

                    {item.kind === "post" && item.image_url ? (
                      <img
                        src={item.image_url}
                        alt=""
                        style={{
                          width: "100%",
                          maxHeight: 200,
                          objectFit: "cover",
                          borderRadius: 14,
                          display: "block",
                        }}
                      />
                    ) : null}

                    {bungalowHeat || islandHeat ? (
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        {bungalowHeat ? (
                          <span
                            style={{
                              padding: "5px 10px",
                              borderRadius: 999,
                              background: "rgba(216, 179, 106, 0.14)",
                              border: "1px solid rgba(216, 179, 106, 0.16)",
                              fontSize: 11,
                              color: "#f2ddb0",
                            }}
                          >
                            {bungalowHeatLabel} heat {bungalowHeat}
                          </span>
                        ) : null}
                        {islandHeat ? (
                          <span
                            style={{
                              padding: "5px 10px",
                              borderRadius: 999,
                              background: "rgba(255,255,255,0.05)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              fontSize: 11,
                              color: "#efe3c1",
                            }}
                          >
                            Island heat {islandHeat}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })
            : null}
        </div>
      </div>
    </div>
  );
}

function RoomScene({
  scene,
  loading,
  error,
  isOwner,
  isMobile,
  title,
  imageUrl,
  onClickEmpty,
  onOpenWall,
  compatibleSlotTypes,
}: {
  scene: { slots: SlotConfig[] } | null;
  loading: boolean;
  error: string | null;
  isOwner: boolean;
  isMobile: boolean;
  title: string;
  imageUrl: string | null;
  onClickEmpty: (slotId: string) => void;
  onOpenWall: () => void;
  compatibleSlotTypes: SelectableSlotType[] | null;
}) {
  const floorTexture = useFloorTexture();

  return (
    <>
      <ambientLight intensity={0.35} color="#ffe4b5" />
      <pointLight
        position={[0, 5.5, -2]}
        intensity={1.8}
        color="#ffd580"
        distance={18}
      />
      <pointLight
        position={[-7, 3.5, -2]}
        intensity={0.9}
        color="#ffaa44"
        distance={10}
      />
      <pointLight
        position={[7, 3.5, -2]}
        intensity={0.9}
        color="#ffaa44"
        distance={10}
      />
      <pointLight
        position={[0, 3, -5.5]}
        intensity={0.7}
        color="#ffe8c0"
        distance={8}
      />
      <pointLight
        position={[0, 0.5, 4]}
        intensity={0.4}
        color="#88ffaa"
        distance={12}
      />

      <RoomShell floorTexture={floorTexture} />
      <FloorIdentityRug title={title} imageUrl={imageUrl} isMobile={isMobile} />
      <CommunityWallDisplay title={title} onOpen={onOpenWall} />
      <Bench position={[-4.7, 0, 4.2]} />
      <Bench position={[4.7, 0, 4.2]} />
      <mesh position={[-3.2, 3, 5.3]}>
        <cylinderGeometry args={[0.15, 0.2, 6, 8]} />
        <meshLambertMaterial color="#5c3d1e" />
      </mesh>
      <mesh position={[3.2, 3, 5.3]}>
        <cylinderGeometry args={[0.15, 0.2, 6, 8]} />
        <meshLambertMaterial color="#5c3d1e" />
      </mesh>
      <Planter position={[-6.1, 0, 2.8]} />
      <Planter position={[6.1, 0, 2.8]} />

      {loading ? <SceneOverlay label="Loading room..." /> : null}
      {error ? <SceneOverlay label={`Room failed to load: ${error}`} /> : null}
      {!loading && !error && !scene ? (
        <SceneOverlay label="Room unavailable" />
      ) : null}

      {!loading && !error && scene
        ? scene.slots.map((slot) => (
            <SlotObject
              key={slot.slotId}
              slot={slot}
              isOwner={isOwner}
              isMobile={isMobile}
              onClickEmpty={onClickEmpty}
              compatibleSlotTypes={compatibleSlotTypes}
            />
          ))
        : null}

      <OrbitControls
        target={[0, 2.55, -0.2]}
        minDistance={4}
        maxDistance={13}
        minPolarAngle={Math.PI / 8}
        maxPolarAngle={Math.PI / 1.85}
        enablePan
        panSpeed={0.6}
        enableDamping
        dampingFactor={0.1}
      />
    </>
  );
}

function BungalowSceneFallback({
  isMobile,
  ownerAddress,
  adminAddress,
  title,
}: {
  isMobile: boolean;
  ownerAddress: string | null;
  adminAddress: string | null;
  title: string;
}) {
  return (
    <div
      style={{
        height: isMobile ? 400 : 580,
        borderRadius: 12,
        background:
          "linear-gradient(180deg, rgba(36,20,8,0.96), rgba(16,10,4,0.98))",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: 18,
        color: "#f4ead1",
        display: "grid",
        alignContent: "space-between",
      }}
    >
      <div>
        <p
          style={{
            margin: 0,
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "rgba(244,234,209,0.6)",
          }}
        >
          Project Home
        </p>
        <h3 style={{ margin: "8px 0 0", fontSize: 22 }}>{title}</h3>
        <p style={{ margin: "10px 0 0", maxWidth: 420, lineHeight: 1.5 }}>
          WebGL failed on this device. The bungalow scene is still mounted and
          can be revisited on a browser with 3D acceleration enabled.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        }}
      >
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            fontSize: 12,
          }}
        >
          <strong style={{ display: "block", marginBottom: 6 }}>Owner</strong>
          {ownerAddress ?? "Unclaimed"}
        </div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            fontSize: 12,
          }}
        >
          <strong style={{ display: "block", marginBottom: 6 }}>Admin</strong>
          {adminAddress ?? "None"}
        </div>
      </div>
    </div>
  );
}

export default function BungalowScene({
  chain,
  ca,
  ownerAddress,
  adminAddress,
  title,
  symbol,
  imageUrl,
  initialBodegaItem = null,
  onInitialBodegaItemConsumed,
}: BungalowSceneProps) {
  const isMobile = useIsMobile(768);
  const navigate = useNavigate();
  const initialBodegaItemAppliedRef = useRef(false);
  const { authenticated, getAccessToken, login } = usePrivy();
  const { walletAddress } = usePrivyBaseWallet();
  const { scene, loading, error, updateSlot, refetch } = useBungalowScene(
    chain,
    ca,
  );
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [showBodegaModal, setShowBodegaModal] = useState(false);
  const [selectedBodegaItem, setSelectedBodegaItem] =
    useState<BodegaCatalogItem | null>(null);
  const [selectedBodegaSlotId, setSelectedBodegaSlotId] = useState<
    string | null
  >(null);
  const [wallOpen, setWallOpen] = useState(false);
  const [wallItems, setWallItems] = useState<WallFeedItem[]>([]);
  const [wallLoading, setWallLoading] = useState(false);
  const [wallError, setWallError] = useState<string | null>(null);
  const [wallDraft, setWallDraft] = useState("");
  const [wallPosting, setWallPosting] = useState(false);
  const isOwner =
    ownerAddress?.toLowerCase() === walletAddress?.toLowerCase() ||
    adminAddress?.toLowerCase() === walletAddress?.toLowerCase();
  const canPlaceBodegaItems = true;
  const compatibleSlotTypes = getCompatibleSlotTypes(selectedBodegaItem);
  const openPlacementSpotCount =
    scene?.slots.filter(
      (slot) =>
        !slot.filled &&
        (!compatibleSlotTypes || compatibleSlotTypes.includes(slot.slotType)),
    ).length ?? 0;
  const roomImageUrl = imageUrl || getTokenImageUrl(null, ca, symbol ?? title);

  const loadWallFeed = useCallback(async () => {
    setWallLoading(true);
    setWallError(null);

    try {
      const response = await fetch(`/api/bungalow/${chain}/${ca}/wall?limit=40`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await readResponseMessage(response));
      }

      const data = (await response.json()) as { items?: WallFeedItem[] };
      setWallItems(Array.isArray(data.items) ? data.items : []);
    } catch (fetchError: unknown) {
      setWallError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to load the bungalow wall",
      );
    } finally {
      setWallLoading(false);
    }
  }, [ca, chain]);

  useEffect(() => {
    if (!initialBodegaItem || initialBodegaItemAppliedRef.current) {
      return;
    }

    initialBodegaItemAppliedRef.current = true;
    setShowBodegaModal(false);
    setSelectedBodegaSlotId(null);
    setSelectedBodegaItem(initialBodegaItem);
    onInitialBodegaItemConsumed?.();
  }, [initialBodegaItem, onInitialBodegaItemConsumed]);

  useEffect(() => {
    if (!wallOpen) {
      return;
    }

    void loadWallFeed();
  }, [loadWallFeed, wallOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    async function logVisit() {
      const actorKey = walletAddress?.toLowerCase() ?? "anon";
      const visitKey = `jbi:bungalow:visit:${chain}:${ca}:${actorKey}`;
      if (window.sessionStorage.getItem(visitKey)) {
        return;
      }

      const headers: Record<string, string> = {};
      if (authenticated) {
        try {
          const token = await getAccessToken();
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          }
        } catch {
          // Public visit logging should not block room load.
        }
      }

      try {
        const response = await fetch(`/api/bungalow/${chain}/${ca}/visit`, {
          method: "POST",
          headers,
          cache: "no-store",
        });

        if (response.ok && !cancelled) {
          window.sessionStorage.setItem(visitKey, new Date().toISOString());
        }
      } catch {
        // Ignore non-blocking visit logging failures.
      }
    }

    void logVisit();

    return () => {
      cancelled = true;
    };
  }, [authenticated, ca, chain, getAccessToken, walletAddress]);

  const handleWallPost = useCallback(async () => {
    const content = wallDraft.trim();
    if (!content) {
      return;
    }

    if (!authenticated) {
      login();
      return;
    }

    setWallPosting(true);
    setWallError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        throw new Error("Authentication token unavailable");
      }

      const response = await fetch(`/api/bungalow/${chain}/${ca}/bulletin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        throw new Error(await readResponseMessage(response));
      }

      setWallDraft("");
      await loadWallFeed();
    } catch (postError: unknown) {
      setWallError(
        postError instanceof Error
          ? postError.message
          : "Failed to write on the wall",
      );
    } finally {
      setWallPosting(false);
    }
  }, [authenticated, ca, chain, getAccessToken, loadWallFeed, login, wallDraft]);

  return (
    <CanvasErrorBoundary
      fallback={
        <BungalowSceneFallback
          isMobile={isMobile}
          ownerAddress={ownerAddress}
          adminAddress={adminAddress}
          title={title}
        />
      }
    >
      <div
        style={{
          width: "100%",
          height: isMobile ? 400 : 580,
          borderRadius: 12,
          overflow: "hidden",
          position: "relative",
          background:
            "radial-gradient(circle at 50% 24%, rgba(255, 190, 110, 0.14), transparent 30%), #1a0f05",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <button
          type="button"
          onClick={() => {
            const canGoBack =
              typeof window !== "undefined" && window.history.length > 1;
            if (canGoBack) {
              navigate(-1);
              return;
            }
            navigate("/");
          }}
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            background: "rgba(0,0,0,0.6)",
            color: "white",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 20,
            padding: "6px 14px",
            fontSize: 13,
            cursor: "pointer",
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          ← Island
        </button>

        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            top: 56,
            zIndex: 2,
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            justifyContent: "space-between",
            alignItems: isMobile ? "stretch" : "flex-start",
            gap: 10,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              pointerEvents: "auto",
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(10,16,10,0.6)",
              backdropFilter: "blur(12px)",
              color: "#f7efd6",
              maxWidth: isMobile ? "100%" : 320,
            }}
          >
            <strong
              style={{
                display: "block",
                marginTop: 5,
                fontSize: 18,
                lineHeight: 1.2,
              }}
            >
              {title}
            </strong>
          </div>

          <div
            style={{
              display: "grid",
              gap: 8,
              pointerEvents: "auto",
              justifyItems: isMobile ? "stretch" : "end",
            }}
          >
            <button
              type="button"
              onClick={() => {
                setSelectedBodegaSlotId(null);
                setShowBodegaModal(true);
              }}
              style={{
                minHeight: 42,
                padding: "0 14px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(16, 31, 19, 0.86)",
                color: "#f7efd6",
                cursor: "pointer",
                font: "inherit",
                fontWeight: 600,
              }}
            >
              Shop Bodega
            </button>
          </div>
        </div>

        <Canvas
          shadows
          style={{
            width: "100%",
            height: "100%",
          }}
          camera={{ position: [0, 4, 10], fov: 62 }}
        >
          <color attach="background" args={["#1a0f05"]} />
          <Suspense fallback={<SceneOverlay label="Loading room..." />}>
            <RoomScene
              scene={scene}
              loading={loading}
              error={error}
              isOwner={Boolean(isOwner || selectedBodegaItem)}
              isMobile={isMobile}
              title={title}
              imageUrl={roomImageUrl}
              compatibleSlotTypes={compatibleSlotTypes}
              onOpenWall={() => setWallOpen(true)}
              onClickEmpty={(slotId) => {
                if (selectedBodegaItem) {
                  setSelectedBodegaSlotId(slotId);
                  return;
                }
                if (isOwner) {
                  setActiveSlotId(slotId);
                }
              }}
            />
          </Suspense>
        </Canvas>

        <WallActivityOverlay
          open={wallOpen}
          isMobile={isMobile}
          title={title}
          symbol={symbol}
          items={wallItems}
          loading={wallLoading}
          error={wallError}
          draft={wallDraft}
          onDraftChange={setWallDraft}
          onClose={() => setWallOpen(false)}
          onPost={() => {
            void handleWallPost();
          }}
          posting={wallPosting}
          authenticated={authenticated}
          onLogin={() => login()}
        />

        <div
          style={{
            position: "absolute",
            left: 12,
            bottom: 12,
            zIndex: 2,
            padding: "8px 10px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(10,16,10,0.56)",
            backdropFilter: "blur(12px)",
            color: "rgba(247,239,214,0.74)",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            pointerEvents: "none",
          }}
        >
          {loading
            ? "Syncing room..."
            : formatPlacementSpotCount(
                openPlacementSpotCount,
                compatibleSlotTypes,
              )}
        </div>

        {selectedBodegaItem && !selectedBodegaSlotId ? (
          <div
            style={{
              position: "absolute",
              left: 12,
              right: 12,
              bottom: 52,
              zIndex: 3,
              display: "flex",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                pointerEvents: "auto",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(10,16,10,0.78)",
                backdropFilter: "blur(12px)",
                color: "#f7efd6",
                fontSize: 12,
                lineHeight: 1.4,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <span>
                Placing <strong>{selectedBodegaItem.title}</strong>. Click an
                open{" "}
                <strong>{describePlacementSpots(compatibleSlotTypes)}</strong>{" "}
                in this room.
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedBodegaItem(null);
                  setSelectedBodegaSlotId(null);
                }}
                style={{
                  minHeight: 30,
                  padding: "0 12px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.05)",
                  color: "white",
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                Cancel placement
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {activeSlotId ? (
        <AddToSlotModal
          slotId={activeSlotId}
          chain={chain}
          ca={ca}
          bungalowName={title}
          onClose={() => setActiveSlotId(null)}
          onSuccess={() => {
            setActiveSlotId(null);
            void refetch();
          }}
        />
      ) : null}

      {showBodegaModal ? (
        <BodegaModal
          bungalowName={title}
          chain={chain}
          ca={ca}
          canSelectItems={canPlaceBodegaItems}
          onSelectItem={(item) => {
            setSelectedBodegaItem(item);
            setSelectedBodegaSlotId(null);
            setShowBodegaModal(false);
          }}
          onClose={() => setShowBodegaModal(false)}
        />
      ) : null}

      {selectedBodegaItem && selectedBodegaSlotId ? (
        <BodegaPlacementModal
          item={selectedBodegaItem}
          slotId={selectedBodegaSlotId}
          bungalowName={title}
          chain={chain}
          ca={ca}
          onClose={() => setSelectedBodegaSlotId(null)}
          onPlace={updateSlot}
          onPlaced={() => {
            setSelectedBodegaSlotId(null);
            setSelectedBodegaItem(null);
            void refetch();
          }}
        />
      ) : null}
    </CanvasErrorBoundary>
  );
}
