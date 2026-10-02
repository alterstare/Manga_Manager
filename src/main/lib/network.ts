// Network setup, re-applied whenever settings are saved.
//
// hitomi's DNS blocking is bypassed inside lib/hitomi.ts itself (DoH +
// direct-IP connect), so here we only honor an optional user proxy — otherwise
// 'system', which respects any system-wide VPN/proxy — point the hitomi client
// at the configured content host, and run the optional SNI-bypass tunnel for
// the general-manga site.
import { session } from 'electron'
import { Proxy as Tunnel } from 'green-tunnel'
import type { Settings } from '../../shared/types'
import { setHitomiContentHost } from './hitomi'
import { TOKI_PARTITION } from './toki'

export async function applyNetwork(s: Settings): Promise<void> {
  const rules = s.proxyServer.trim()
  await session.defaultSession.setProxy(rules ? { proxyRules: rules } : { mode: 'system' })
  setHitomiContentHost(s.hitomiBaseUrl ?? '')
  await applyTunnel(s.bypassTunnel === true)
}

// --- SNI-bypass tunnel (green-tunnel) ----------------------------------------
// Some ISPs reset TLS connections by the domain in the ClientHello (SNI) — the
// general-manga site gets "ERR_CONNECTION_RESET". green-tunnel is a local HTTP
// CONNECT proxy that splits the ClientHello into small TLS records / TCP
// segments (the filter can't reassemble them) and resolves hosts over DoH.
// It listens on 127.0.0.1 (random port) and ONLY the toki session is pointed
// at it — never the OS proxy setting (a crash would leave every app on the PC
// pointing at a dead port). hitomi doesn't need it (DNS-only block, handled in
// hitomi.ts).
let tunnel: Tunnel | null = null

async function applyTunnel(on: boolean): Promise<void> {
  if (on === !!tunnel) return // unchanged — settings are saved often (zoom, mode…)
  const ses = session.fromPartition(TOKI_PARTITION)
  if (on) {
    const t = new Tunnel({
      host: '127.0.0.1',
      port: 0,
      fragment: { size: 40, tlsRecords: true },
      // DoH server by IP so the resolver itself can't be DNS-blocked.
      dns: { mode: 'doh', dohUrl: 'https://1.1.1.1/dns-query' }
    })
    t.on('error', (e) => console.warn('[tunnel]', e.message))
    try {
      const { port } = await t.start()
      tunnel = t
      await ses.setProxy({ proxyRules: `http://127.0.0.1:${port}`, proxyBypassRules: '<local>' })
    } catch (e) {
      console.warn('[tunnel] start failed — direct connection:', (e as Error).message)
      await t.stop().catch(() => {})
    }
  } else if (tunnel) {
    await ses.setProxy({ mode: 'system' })
    await tunnel.stop().catch(() => {})
    tunnel = null
  }
  // Drop pooled connections so the change applies to the next request.
  await ses.closeAllConnections().catch(() => {})
}
