import type { JSX } from 'react'

// Compact number stepper: [ − | value | + ]. Replaces the raw number spinner so
// the page-count pickers look consistent (Settings auto-merge + per-artist merge).
export default function Stepper({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  width,
  title
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  width?: number // px width of the value field (wider for big numbers)
  title?: string
}): JSX.Element {
  const clamp = (v: number): number => Math.max(min, max != null ? Math.min(max, v) : v)
  return (
    <span className="stepper" title={title}>
      <button
        type="button"
        className="stepper-btn"
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
      >
        −
      </button>
      <input
        className="stepper-val"
        type="number"
        min={min}
        step={step}
        value={value}
        style={width ? { width } : undefined}
        onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
      />
      <button
        type="button"
        className="stepper-btn"
        disabled={max != null && value >= max}
        onClick={() => onChange(clamp(value + step))}
      >
        +
      </button>
    </span>
  )
}
