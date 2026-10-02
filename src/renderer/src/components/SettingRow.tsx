import type { JSX, ReactNode } from 'react'

// One settings line: bold title + gray description on the left, the control on the
// right. Matches the redesigned settings look. A plain-text description is shown
// one sentence per line, so long ones don't wrap at random points.
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
        {desc && (
          <div className="set-desc">
            {typeof desc === 'string'
              ? desc.split(/(?<=\.|\.\))\s+(?=\S)/).map((line, i) => (
                  <span key={i} className="set-line">
                    {line}
                  </span>
                ))
              : desc}
          </div>
        )}
      </div>
      {children != null && <div className="set-ctl">{children}</div>}
    </div>
  )
}
