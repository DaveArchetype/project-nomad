import { useEffect, useState } from 'react'

interface PollIntervalControlProps {
  intervalMs: number
  onChange: (ms: number) => void
}

const UNIT_TO_MS: Record<string, number> = {
  seconds: 1000,
  minutes: 60_000,
  hours: 3_600_000,
}

const MS_TO_UNIT: Array<{ unit: string; ms: number }> = [
  { unit: 'hours', ms: 3_600_000 },
  { unit: 'minutes', ms: 60_000 },
  { unit: 'seconds', ms: 1000 },
]

function decompose(ms: number): { value: number; unit: string } {
  for (const { unit, ms: unitMs } of MS_TO_UNIT) {
    if (ms >= unitMs && ms % unitMs === 0) {
      return { value: ms / unitMs, unit }
    }
  }
  return { value: Math.round(ms / 1000), unit: 'seconds' }
}

export default function PollIntervalControl({ intervalMs, onChange }: PollIntervalControlProps) {
  const initial = decompose(intervalMs)
  const [value, setValue] = useState(String(initial.value))
  const [unit, setUnit] = useState(initial.unit)

  useEffect(() => {
    const decomposed = decompose(intervalMs)
    setValue(String(decomposed.value))
    setUnit(decomposed.unit)
  }, [intervalMs])

  const commit = (newValue: string, newUnit: string) => {
    const parsed = Number.parseInt(newValue, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      onChange(parsed * UNIT_TO_MS[newUnit])
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-text-muted whitespace-nowrap">Refresh every</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => commit(value, unit)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(value, unit)
        }}
        className="w-14 px-2 py-1 text-xs rounded border border-border-subtle bg-surface-primary text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
      />
      <select
        value={unit}
        onChange={(e) => {
          setUnit(e.target.value)
          commit(value, e.target.value)
        }}
        className="px-2 py-1 text-xs rounded border border-border-subtle bg-surface-primary text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
      >
        <option value="seconds">sec</option>
        <option value="minutes">min</option>
        <option value="hours">hr</option>
      </select>
    </div>
  )
}
