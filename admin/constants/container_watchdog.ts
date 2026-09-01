export const MANAGED_LABEL = 'io.project-nomad.managed'

export const WATCHDOG_TICK_INTERVAL_MS = 30_000
export const WATCHDOG_MEM_PRESSURE_THRESHOLD = 0.95
export const WATCHDOG_SUSTAINED_TICKS = 4
export const WATCHDOG_HOST_MEM_KILL_PERCENT = 90
export const WATCHDOG_KILL_COOLDOWN_MS = 60_000
export const WATCHDOG_LOOP_BREAK_KILLS = 3
export const WATCHDOG_LOOP_BREAK_WINDOW_MS = 600_000

export const DEFAULT_MEMORY_LIMITS_MB: Record<string, number> = {
  nomad_comfyui: 24576,
}

export const GLOBAL_DEFAULT_MEMORY_LIMIT_MB = 0

export const MB_BYTES = 1024 * 1024

export type KVGetter = (key: string) => Promise<string | null | undefined>

export async function resolveMemoryLimitMB(
  serviceName: string,
  getValue: KVGetter
): Promise<number> {
  const perServiceRaw = await getValue(`oom.${serviceName}.memoryLimitMB`)
  if (perServiceRaw != null && perServiceRaw !== '') {
    const v = Number.parseInt(perServiceRaw, 10)
    if (Number.isFinite(v)) return v
  }
  const hardcoded = DEFAULT_MEMORY_LIMITS_MB[serviceName]
  if (hardcoded != null && hardcoded > 0) return hardcoded
  const globalRaw = await getValue('oom.defaultMemoryLimitMB')
  if (globalRaw != null && globalRaw !== '') {
    const v = Number.parseInt(globalRaw, 10)
    if (Number.isFinite(v)) return v
  }
  return GLOBAL_DEFAULT_MEMORY_LIMIT_MB
}

export async function resolveMemoryLimitBytes(
  serviceName: string,
  getValue: KVGetter
): Promise<number> {
  const mb = await resolveMemoryLimitMB(serviceName, getValue)
  return mb > 0 ? mb * MB_BYTES : 0
}
