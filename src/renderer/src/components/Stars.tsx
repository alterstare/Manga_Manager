import type { JSX } from 'react'

interface Props {
  rank: number
  onChange: (rank: number) => void
  size?: number
}

// 5 stars. Click the Nth star to set rank N; click the current rank to clear it.
export default function Stars({ rank, onChange, size = 16 }: Props): JSX.Element {
  return (
    <span className="stars" style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`star ${n <= rank ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onChange(n === rank ? 0 : n)
          }}
        >
          ★
        </span>
      ))}
    </span>
  )
}
