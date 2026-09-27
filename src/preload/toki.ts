// Preload for the hidden/visible toki scraping window ONLY (contextIsolation
// off → runs in the page's main world, before the site's scripts). Two jobs:
//  1. Neutralize WebRTC so the page can't probe STUN (stun.l.google.com), which
//     on the user's network fails DNS (-105) and spams errors / feeds the site's
//     anti-bot fingerprint. We're scraping, never need WebRTC.
//  2. Hide the obvious automation tells so Cloudflare / the site's block.js stop
//     looping the "are you human" challenge.
// This file has no imports on purpose (loads as a tiny main-world script).
try {
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
} catch {
  /* ignore */
}
try {
  const w = window as unknown as Record<string, unknown>
  // Stub RTCPeerConnection so `new RTCPeerConnection()` no-ops instead of firing
  // STUN. Methods are present (so feature-detection doesn't throw) but inert.
  class FakeRTC {
    createDataChannel(): null {
      return null
    }
    createOffer(): Promise<never> {
      return Promise.reject(new Error('disabled'))
    }
    setLocalDescription(): Promise<void> {
      return Promise.resolve()
    }
    addEventListener(): void {}
    close(): void {}
  }
  w.RTCPeerConnection = FakeRTC
  w.webkitRTCPeerConnection = FakeRTC
  w.mozRTCPeerConnection = FakeRTC
} catch {
  /* ignore */
}
