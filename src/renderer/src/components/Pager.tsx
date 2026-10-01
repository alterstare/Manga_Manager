import { useEffect, useState } from 'react'
import type { JSX } from 'react'

interface Props {
  page: number // 0-based
  lastPage: number // 0-based; -1 when unknown
  onPage: (p: number) => void
  small?: boolean
  // When the total is unknown (lastPage = -1): whether a next page exists.
  hasNext?: boolean
}

// Prev / [editable current] / total / Next. Type a page and press Enter to jump.
export default function Pager({ page, lastPage, onPage, small, hasNext }: Props): JSX.Element {
  const [val, setVal] = useState(String(page + 1))
  useEffect(() => setVal(String(page + 1)), [page])

  const go = (): void => {
    let n = parseInt(val, 10)
    if (isNaN(n)) return setVal(String(page + 1))
    n = Math.max(1, lastPage >= 0 ? Math.min(lastPage + 1, n) : n)
    onPage(n - 1)
  }

  return (
    <div className={`pager ${small ? 'sm' : ''}`}>
      <button className={small ? 'mini' : 'btn'} disabled={page <= 0} onClick={() => onPage(page - 1)}>
        ←
      </button>
      <span className="pager-pos">
        <input
          className="page-input"
          value={val}
          onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          onBlur={go}
        />
        {lastPage >= 0 && <span> / {lastPage + 1}</span>}
      </span>
      <button
        className={small ? 'mini' : 'btn'}
        disabled={lastPage >= 0 ? page >= lastPage : hasNext === false}
        onClick={() => onPage(page + 1)}
      >
        →
      </button>
    </div>
  )
}
