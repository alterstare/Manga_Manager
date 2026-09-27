import { useState } from 'react'
import type { JSX } from 'react'

// Clickable [code] that copies to clipboard and briefly shows a check.
export default function CopyCode({ code, className = '' }: { code: string; className?: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <span
      className={`code copyable ${className}`}
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(code)
        setCopied(true)
        setTimeout(() => setCopied(false), 1000)
      }}
    >
      [{code}]{copied ? ' ✓' : ''}
    </span>
  )
}
