export const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  "jungle bay memes": { x: 48, y: 32 },
  "$mfer": { x: 18, y: 22 },
  QR: { x: 78, y: 22 },
  DRB: { x: 48, y: 55 },
  BOBO: { x: 28, y: 42 },
  ALPHA: { x: 68, y: 42 },
  CLAWD: { x: 18, y: 62 },
  FELIX: { x: 78, y: 62 },
  JUNO: { x: 38, y: 75 },
  BRAINLET: { x: 58, y: 75 },
  Clude: { x: 48, y: 12 },
};

const MIN_DISTANCE = 12;

function hashToUnit(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function getRawPosition(symbol: string, seed: string): { x: number; y: number } {
  const direct = NODE_POSITIONS[symbol];
  if (direct) return direct;

  const upper = NODE_POSITIONS[symbol.toUpperCase()];
  if (upper) return upper;

  const x = 10 + hashToUnit(`${seed}:x`) * 80;
  const y = 10 + hashToUnit(`${seed}:y`) * 80;
  return { x, y };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function getNodePosition(symbol: string, seed: string): { x: number; y: number } {
  return getRawPosition(symbol, seed);
}

export function resolveAllPositions(
  items: Array<{ symbol: string | null; token_address: string }>,
): Array<{ x: number; y: number }> {
  const positions = items.map((item) =>
    getRawPosition(item.symbol ?? "", item.token_address),
  );

  for (let pass = 0; pass < 20; pass++) {
    let moved = false;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const d = dist(positions[i], positions[j]);
        if (d < MIN_DISTANCE) {
          const overlap = MIN_DISTANCE - d;
          const dx = positions[j].x - positions[i].x || 1;
          const dy = positions[j].y - positions[i].y || 1;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const pushX = (dx / len) * (overlap / 2 + 1);
          const pushY = (dy / len) * (overlap / 2 + 1);
          positions[i] = {
            x: Math.max(5, Math.min(95, positions[i].x - pushX)),
            y: Math.max(5, Math.min(95, positions[i].y - pushY)),
          };
          positions[j] = {
            x: Math.max(5, Math.min(95, positions[j].x + pushX)),
            y: Math.max(5, Math.min(95, positions[j].y + pushY)),
          };
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  return positions;
}
