import { useLayoutEffect, useRef } from 'react'
import type { JSX, ReactNode } from 'react'

// Wraps one rendered page and reports its measured height to the virtualizer.
export default function PageSlot({
  index,
  onMeasure,
  children
}: {
  index: number
  onMeasure: (i: number, h: number) => void
  children: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const report = (): void => onMeasure(index, el.offsetHeight)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [index, onMeasure])
  return (
    <div ref={ref} className="page-slot">
      {children}
    </div>
  )
}
