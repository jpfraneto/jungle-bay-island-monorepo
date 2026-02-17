const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const BLUE = '\x1b[34m'
const MAGENTA = '\x1b[35m'
const CYAN = '\x1b[36m'
const GRAY = '\x1b[90m'

function ts(): string {
  return new Date().toISOString()
}

function paint(color: string, text: string): string {
  return `${color}${text}${RESET}`
}

function line(label: string, message: string, color: string): string {
  return `${paint(GRAY, ts())} ${paint(BOLD + color, `[${label}]`)} ${message}`
}

export function logInfo(label: string, message: string): void {
  console.log(line(label, message, CYAN))
}

export function logSuccess(label: string, message: string): void {
  console.log(line(label, message, GREEN))
}

export function logWarn(label: string, message: string): void {
  console.log(line(label, message, YELLOW))
}

export function logError(label: string, message: string): void {
  console.error(line(label, message, RED))
}

export function logDebug(label: string, message: string): void {
  console.log(line(label, message, BLUE))
}

export function logEvent(label: string, message: string): void {
  console.log(line(label, message, MAGENTA))
}

export function dim(text: string): string {
  return paint(DIM, text)
}

