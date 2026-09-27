import type { JSX, ReactNode } from 'react'

// One settings line: bold title + gray description on the left, the control on the
// right. Matches the redesigned settings look.
export default function SettingRow({
  title,
  desc,
  children
}: {
  title: ReactNode
  desc?: ReactNode
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="set-row">
      <div className="set-main">
        <div className="set-title">{title}</div>
        {desc && <div className="set-desc">{desc}</div>}
      </div>
      {children != null && <div className="set-ctl">{children}</div>}
    </div>
  )
}
