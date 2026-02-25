export interface ConnectionNode {
  x: number;
  y: number;
  index: number;
}

export function calculateConnections(
  nodes: ConnectionNode[],
  threshold = 30,
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= threshold) {
        pairs.push([i, j]);
      }
    }
  }

  return pairs;
}
