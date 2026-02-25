// In-memory ephemeral log store for scan activity feed
// Logs are shown to the user during scan progress polling, then auto-cleaned

const scanLogs = new Map<number, string[]>()
const cleanupTimers = new Map<number, ReturnType<typeof setTimeout>>()

const MAX_LOGS_PER_SCAN = 200
const CLEANUP_DELAY_MS = 5 * 60 * 1000 // 5 minutes

export function addScanLog(scanId: number, message: string): void {
  let logs = scanLogs.get(scanId)
  if (!logs) {
    logs = []
    scanLogs.set(scanId, logs)
  }
  if (logs.length < MAX_LOGS_PER_SCAN) {
    logs.push(message)
  }
}

export function getScanLogs(scanId: number): string[] {
  return scanLogs.get(scanId) ?? []
}

export function clearScanLogs(scanId: number): void {
  scanLogs.delete(scanId)
  const timer = cleanupTimers.get(scanId)
  if (timer) {
    clearTimeout(timer)
    cleanupTimers.delete(scanId)
  }
}

export function scheduleLogCleanup(scanId: number): void {
  // Clear any existing timer
  const existing = cleanupTimers.get(scanId)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    scanLogs.delete(scanId)
    cleanupTimers.delete(scanId)
  }, CLEANUP_DELAY_MS)

  cleanupTimers.set(scanId, timer)
}
