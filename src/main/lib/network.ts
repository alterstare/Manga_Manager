//
// hitomi's DNS blocking is bypassed inside lib/hitomi.ts itself (DoH +
// direct-IP connect), so here we only honor an optional user proxy — otherwise 'system', which respects any system-wide
// VPN/proxy — and point the hitomi client at the configured content host.
import { session } from 'electron'
import type { Settings } from '../../shared/types'
import { setHitomiContentHost } from './hitomi'

export async function applyNetwork(s: Settings): Promise<void> {
  const rules = s.proxyServer.trim()
  await session.defaultSession.setProxy(rules ? { proxyRules: rules } : { mode: 'system' })
  setHitomiContentHost(s.hitomiBaseUrl ?? '')
}
