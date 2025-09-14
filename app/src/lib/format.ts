// Byte and speed formatting utilities (IEC units, base 1024)
export function formatBytesIEC(n: number): string {
  if (!isFinite(n) || n < 0) n = 0
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  const decimals = i > 0 && v < 10 ? 1 : 0
  return `${v.toFixed(decimals)} ${units[i]}`
}

export function clamp01(n: number): number {
  if (!isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

// Exponential moving average smoothing
// alpha derived from time constant (~2s by default)
export function ema(prev: number | undefined, next: number, alpha: number): number {
  if (prev === undefined || !isFinite(prev)) return next
  return alpha * next + (1 - alpha) * prev
}

export function calcAlpha(dtMs: number, halfLifeMs = 2000): number {
  // Convert half-life to exponential decay factor per dt
  const lambda = Math.log(2) / Math.max(1, halfLifeMs)
  return 1 - Math.exp(-lambda * Math.max(1, dtMs))
}
