import { runOnchainBackfill } from "../src/services/onchain";

function readFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readIntFlag(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number.parseInt(process.argv[index + 1] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const dryRun = readFlag("--dry-run");
const batchSize = readIntFlag("--batch-size", 2_000);
const maxBatches = readIntFlag("--max-batches", 1);

const result = await runOnchainBackfill({
  dryRun,
  batchSize,
  maxBatches,
});

console.log(JSON.stringify(result, null, 2));
