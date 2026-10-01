// DNS-over-HTTPS lookups that bypass the system resolver entirely: the query
// goes to Cloudflare's resolver by IP (1.1.1.1), so ISP DNS blocking or
// tampering can't interfere.
import https from 'https'

export interface DohAnswer {
  type: number // 1 = A, 5 = CNAME, 65 = HTTPS …
  data: string
}

// Answers for `name` / record `type` ('A', 'CNAME', …); [] on any failure.
export function dohAnswers(name: string, type: string): Promise<DohAnswer[]> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: '1.1.1.1', // connect by IP — no DNS needed to reach the resolver
        servername: 'cloudflare-dns.com',
        path: `/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
        headers: { accept: 'application/dns-json' },
        port: 443,
        method: 'GET'
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')).Answer ?? [])
          } catch {
            resolve([])
          }
        })
      }
    )
    req.on('error', () => resolve([]))
    req.setTimeout(8000, () => req.destroy())
    req.end()
  })
}
