# Manga Viewer

로컬 만화 라이브러리 뷰어. 크롬풍 탭 UI, 폴더 자동 정리, 태그/즐겨찾기/랭크, hitomi.la 코드 인식.
Electron + React + TypeScript.

## 실행

```bash
npm install
npm run dev      # 개발 모드 (창 띄움)
npm run build    # 프로덕션 번들 (out/)
npm run dist     # Windows 설치 파일(.exe) 빌드 → dist/
```

> 처음 `npm install` 후 electron 바이너리 다운로드가 막히면
> `node node_modules/electron/install.js` 를 다시 실행.

## 첫 사용

1. 우상단 **⚙ 설정** → **라이브러리 폴더**에 만화 루트 추가 (예: `F:\망가 방주`).
2. (선택) **즐겨찾기 폴더** 지정 — 즐겨찾기 시 작품 폴더가 이 위치로 이동.
3. 저장 → 홈에서 **라이브러리 스캔**.

## 폴더 이름 규칙

각 하위 폴더 = 한 작품. 이미지가 직접 들어 있는 폴더를 작품으로 인식 (재귀).

| 폴더명 | 작가 | 코드 | 제목 |
|---|---|---|---|
| `kino [2421331] Ecchi na ... 야한 소꿉친구` | kino | 2421331 | Ecchi na ... 야한 소꿉친구 |
| `[667427] GG` | – | 667427 | GG |
| `외부에서 받은 코드없는 만화` | – | – | 외부에서 받은 코드없는 만화 |

## 기능

**로컬 뷰어**
- 작가별 / 태그별 필터 (작가명·태그 클릭)
- 수동 태그 추가·삭제, 즐겨찾는 태그 강조
- 즐겨찾기(폴더 이동) + 별 1~5 랭크
- 정렬: 무작위 / 최신순 / 랭크순 / 감상횟수순 / 이름순
- 제목·작가·코드·태그 검색 (`artist:`, `tag:` 접두어 지원)
- 크롬풍 탭 + 종료 후 탭/스크롤 복원
- 감상 횟수 자동 집계
- 장르 규칙(폴더 키워드 → 자동 태그), 앞쪽 워닝짤 페이지 제외

**온라인 둘러보기** (상단 🌐 탭)
- hitomi.la 최신 목록 자동 로드 (언어별), 썸네일·제목·태그 표시, 페이지네이션
- 태그 검색: `tag:`, `artist:`, `female:`, `male:`, `series:`, `character:`, `group:`
- 작품 클릭 → **온라인 스트리밍 감상** (로컬과 동일한 뷰어), ⬇ 버튼으로 다운로드

**hitomi.la 다운로드** (상단 ⬇ 탭)
- 코드/주소 붙여넣기 → 메타 미리보기 → 통째 다운로드 (`작가 [코드] 제목` 폴더)
- `meta.hitomi.json` 사이드카 기록 → 재스캔해도 태그·언어 유지
- **메타 채우기**: 홈의 일괄 버튼(코드 있는 전체) 또는 스캔 후 자동(설정 토글). 작품 카드 개별 버튼도 있음.
- 네트워크는 Electron `net.fetch`(Chromium 스택+시스템 인증서) 사용 → 브라우저서 되면 앱서도 됨
- 이미지 URL은 `gg.js` 알고리즘 해석 (node-hitomi 방식). 포맷 바뀌면 `src/main/lib/hitomi.ts`의 `parseGG`만 갱신.

**뷰어/성능**
- 리더 좌측에 항상 목록 패널, 경계 드래그로 폭 조절 (noa6 레이아웃)
- 썸네일은 스캔 시 일괄 생성 후 디스크 캐시 → 탭 이동 렉 없음
- 제외 이미지: 설정에서 샘플 등록 → 유사 페이지(perceptual hash) 자동 제외 (옵트인)

## 다음 단계 (예정)

- 언어별 자동 폴더 이동 (현재는 메타 언어 기록까지)
- 탭 그룹, 라이브러리 홈 대시보드 보강
- 온라인 무한 스크롤/즐겨찾는 작가 피드

## 구조

```
src/
  shared/      타입 + IPC 계약 (main ↔ renderer 공용)
  main/        Electron 메인: 윈도우, IPC, mangaimg:// 프로토콜
    lib/       parser · scanner · store(JSON) · favorites
  preload/     contextBridge로 window.api 노출
  renderer/    React UI (zustand 상태)
    src/components/  TabBar · Home · Reader · Settings · WorkCard · Stars · Thumb
```

데이터는 `%APPDATA%/manga-viewer/` 의 `works.json` · `settings.json` · `session.json` 에 저장.
원본 이미지는 이동/삭제하지 않음 (즐겨찾기 폴더 이동 제외).
