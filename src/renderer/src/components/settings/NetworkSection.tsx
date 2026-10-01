// 네트워크·다운로드: connection test, proxy, the online site address of the
// current mode, and download options.
import { useState } from 'react'
import type { JSX } from 'react'
import Dropdown from '../Dropdown'
import SettingRow from '../SettingRow'
import Toggle from '../Toggle'
import { useSettings } from './context'
import { DownloadDirRow } from './FolderSection'

export default function NetworkSection(): JSX.Element {
  const { draft, patch, isHitomi } = useSettings()
  const [pinging, setPinging] = useState(false)
  const [ping, setPing] = useState<{ dohIp: string | null; ltnOk: boolean; error: string | null } | null>(null)

  const runPing = async (): Promise<void> => {
    setPinging(true)
    try {
      setPing(await window.api.hitomiPing())
    } finally {
      setPinging(false)
    }
  }

  return (
    <>
      <section data-cat="network">
        <h2>네트워크</h2>
        <SettingRow
          title="네트워크 연결 테스트"
          desc="DNS/SNI 차단 여부를 확인합니다. 앱은 자체 DoH(1.1.1.1)로 IP를 직접 구해 우회합니다."
        >
          <button className="btn" onClick={runPing} disabled={pinging}>
            {pinging ? '테스트 중…' : '연결 테스트'}
          </button>
        </SettingRow>
        {ping && (
          <p className="hint">
            DoH IP: <b>{ping.dohIp ?? '실패(DoH 차단)'}</b> · ltn.hitomi.la:{' '}
            <b style={{ color: ping.ltnOk ? 'var(--accent)' : 'var(--danger)' }}>{ping.ltnOk ? 'OK' : '실패'}</b>
            {ping.error && ` (${ping.error})`}
          </p>
        )}
        <SettingRow
          title="보안 DNS (DNS over HTTPS)"
          desc="크롬의 '보안 DNS'와 같은 기능입니다. 통신사 DNS 대신 암호화된 DNS(Cloudflare·Google)를 써서 DNS 차단을 우회합니다. 주소(SNI) 단위 차단은 사이트가 ECH를 지원할 때만 우회됩니다."
        >
          <Toggle checked={draft.secureDns === true} onChange={(v) => patch({ secureDns: v })} />
        </SettingRow>
        <div className="set-block">
          <SettingRow title="프록시" desc="로컬 프록시/VPN 포트를 쓰면 입력. 비우면 시스템 설정을 사용합니다." />
          <input
            type="text"
            className="field-input"
            value={draft.proxyServer}
            placeholder="예: socks5://127.0.0.1:1080  또는  http://127.0.0.1:8080"
            onChange={(e) => patch({ proxyServer: e.target.value.trim() })}
          />
        </div>
        <div className="set-block">
          {isHitomi ? (
            <>
              <SettingRow
                title="온라인 주소 입력"
                desc="히토미 사이트 주소. 이 주소를 입력해야 온라인 접속(둘러보기·검색·다운로드)이 됩니다."
              />
              <input
                type="text"
                className="field-input"
                value={draft.hitomiBaseUrl}
                onChange={(e) => patch({ hitomiBaseUrl: e.target.value.trim() })}
                placeholder="온라인 주소를 입력하세요"
              />
            </>
          ) : (
            <>
              <SettingRow
                title="온라인 주소 입력"
                desc="만화 사이트 온라인 주소. 도메인이 자주 바뀌므로 접속이 안 되면 최신 주소로 바꾸세요."
              />
              <input
                type="text"
                className="field-input"
                value={draft.tokiBaseUrl}
                onChange={(e) => patch({ tokiBaseUrl: e.target.value })}
                placeholder="온라인 주소를 입력하세요"
              />
            </>
          )}
        </div>
      </section>

      <section data-cat="network">
        <h2>다운로드</h2>
        <DownloadDirRow />
        {isHitomi && (
          <>
            <SettingRow title="스캔 후 메타 자동 채우기" desc="라이브러리 스캔 후 코드가 있는 작품의 작가·태그·언어를 자동으로 채웁니다.">
              <Toggle checked={draft.autoEnrichOnScan} onChange={(v) => patch({ autoEnrichOnScan: v })} />
            </SettingRow>
            <SettingRow
              title="이미지 형식"
              desc="AVIF는 용량이 작고, WebP는 호환성이 높습니다. 없는 형식은 자동으로 다른 형식으로 받습니다."
            >
              <Dropdown<'avif' | 'webp'>
                className="field dl-opt"
                value={draft.downloadImageFormat}
                onChange={(v) => patch({ downloadImageFormat: v })}
                options={[
                  ['avif', 'AVIF (용량 작음)'],
                  ['webp', 'WebP (호환성 높음)']
                ]}
              />
            </SettingRow>
          </>
        )}
        <SettingRow title="동시 다운로드" desc="온라인에서 한 번에 받을 수 있는 최대 작품 수. 초과분은 차례로 대기합니다.">
          <Dropdown<string>
            className="field dl-opt"
            value={String(draft.maxConcurrentDownloads ?? 2)}
            onChange={(v) => patch({ maxConcurrentDownloads: Number(v) })}
            options={[
              ['1', '1'],
              ['2', '2'],
              ['3', '3'],
              ['4', '4'],
              ['5', '5'],
              ['0', '무제한']
            ]}
          />
        </SettingRow>
      </section>
    </>
  )
}
