import { useEffect, useState } from 'react'

// Live status of the general-manga online scraper ("연결이 끊겨 다시 시도하는
// 중… (2/10)", "사이트 인증 대기 중…" …), or null when idle. Used in place of a
// bare "불러오는 중…" so slow loads / retries are visible.
export function useTokiStatus(): string | null {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => window.api.onTokiStatus(setMsg), [])
  return msg
}
