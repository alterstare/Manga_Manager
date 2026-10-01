//
// hitomi's DNS blocking is bypassed inside lib/hitomi.ts itself (DoH +
// direct-IP connect), so here we only honor an optional user proxy — otherwise 'system', which respects any system-wide
// VPN/proxy — and point the hitomi client at the configured content host.
import { app, session } from 'electron'
import type { Settings } from '../../shared/types'
import { setHitomiContentHost } from './hitomi'

export async function applyNetwork(s: Settings): Promise<void> {
  const rules = s.proxyServer.trim()
  await session.defaultSession.setProxy(rules ? { proxyRules: rules } : { mode: 'system' })
  setHitomiContentHost(s.hitomiBaseUrl ?? '')

  // Secure DNS for all Chromium networking (pages, scraper windows, image
  // fetches). 'secure' = DoH only (Cloudflare, Google); off = Chrome's default
  // 'automatic' (upgrade to DoH only when the system resolver supports it).
  // Additional query types (HTTPS records) let Chromium use ECH where offered.
  app.configureHostResolver({
    enableBuiltInResolver: true,
    secureDnsMode: s.secureDns ? 'secure' : 'automatic',
    secureDnsServers: s.secureDns
      ? ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query']
      : [],
    enableAdditionalDnsQueryTypes: true
  })
}
