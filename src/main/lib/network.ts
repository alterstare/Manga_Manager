// Network settings applied to Electron sessions.
//
// Default session (app UI, hitomi): hitomi's DNS blocking is bypassed inside
// lib/hitomi.ts itself (DoH + direct-IP connect), so here we only honor an
// optional user proxy — otherwise 'system', which respects any system-wide
// VPN/proxy — and point the hitomi client at the configured content host.
//
// Toki session (general-manga online scraper + its image fetches): the same
// user proxy (it has its own partition, so it doesn't inherit the default).
import { session } from 'electron'
import type { Settings } from '../../shared/types'
import { setHitomiContentHost } from './hitomi'
import { TOKI_PARTITION } from './toki'

export async function applyNetwork(s: Settings): Promise<void> {
  const rules = s.proxyServer.trim()
  await session.defaultSession.setProxy(rules ? { proxyRules: rules } : { mode: 'system' })
  setHitomiContentHost(s.hitomiBaseUrl ?? '')

  const toki = session.fromPartition(TOKI_PARTITION)
  await toki.setProxy(rules ? { proxyRules: rules } : { mode: 'system' })
}
