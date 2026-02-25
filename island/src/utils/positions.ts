export const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  JBM: { x: 48, y: 35 },
  BOBO: { x: 28, y: 22 },
  BNKR: { x: 68, y: 18 },
  mfer: { x: 18, y: 45 },
  PEPE: { x: 78, y: 38 },
  RIZZ: { x: 38, y: 55 },
  TOWELI: { x: 58, y: 58 },
  ALPHA: { x: 25, y: 68 },
  QR: { x: 72, y: 65 },
  DRB: { x: 50, y: 75 },
  JBC: { x: 82, y: 50 },
};

function hashToUnit(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export function getNodePosition(symbol: string, seed: string): { x: number; y: number } {
  const direct = NODE_POSITIONS[symbol];
  if (direct) return direct;

  const upper = NODE_POSITIONS[symbol.toUpperCase()];
  if (upper) return upper;

  const x = 35 + hashToUnit(`${seed}:x`) * 30;
  const y = 30 + hashToUnit(`${seed}:y`) * 40;
  return { x, y };
}
