# Manga Manager

로컬 만화 라이브러리 관리자. 크롬풍 탭 UI, 폴더 자동 정리, 태그/즐겨찾기/랭크, hitomi.la 코드 인식
Electron + React + TypeScript

## 실행

```bash
npm install
npm run dev      # 개발 모드 (창 띄움)
npm run build    # 프로덕션 번들 (out/)
npm run dist     # Windows 설치 파일(.exe) 빌드 → dist/
```

> 처음 `npm install` 후 electron 바이너리 다운로드가 막히면
> `node node_modules/electron/install.js` 를 다시 실행

## 첫 사용

1. 우상단 **⚙ 설정** → **라이브러리 폴더**에 만화 루트 추가
2. (선택) **즐겨찾기 폴더** 지정 — 즐겨찾기 시 작품 폴더가 이 위치로 이동
3. 저장 → 홈에서 **라이브러리 스캔**

## ⌨ 단축키

│ Ctrl+1 / Ctrl+2           │ 로컬 라이브러리 / 온라인            
│ Ctrl+3~9                        │ N번째 탭으로 이동 (9=마지막)        
│ Ctrl+W                            │ 현재 탭 닫기 (애니메이션)           
│ Ctrl+Shift+T                │ 닫은 탭 복원                        
│ Ctrl+Tab / Ctrl+Shift+Tab │ 탭 순환                             
│ F5                                       │ 새로고침                            
│ Alt+←/→                       │ 뒤로/앞으로                         
│ Ctrl+Shift+Q              │ 강제 종료 (검은 화면 대비)          
│ 마우스 휠클릭             │ 새 탭(백그라운드)으로 열기          
│ 마우스 뒤로/앞으로 버튼   │ 네비 back/forward                   
│ Alt+클릭                        │ Glance(미리보기 창)                

## 📁 폴더 구조

- 동인지 라이브러리: [코드] 폴더 인식, 사이드카 메타
- 일반만화 라이브러리: 시리즈폴더/화폴더 2층 구조 → 시리즈 자동 그룹핑
- 데이터: %APPDATA%\manga-manager\ (settings/works/session/online/thumbs/쿠키)
- 라이브러리/다운로드/즐겨찾기 폴더 각각 지정, 폴더=folder as truth (favorite/group 추론)

## ⬇ 다운로드

- 동인지: 코드/URL 입력 → 다운로드, avif→webp 변환
- 일반만화: 시리즈 전체 / 선택 화 / 자동 이어서 받기
- 동시 다운로드 수 설정, 하단 작업바에서 일시정지/재개/취소/재시도, 이어받기(중단점부터)
- Cloudflare 자동/수동(캡차 창 + 안내 배너) 통과

## ♥ 즐겨찾기 / ⭐ 평점 / 📂 그룹

- 즐겨찾기: 로컬/온라인 각각, 즐겨찾기 폴더로 이동, 파일 import/export/병합, 명명된 목록별 보기
- 평점: 별 1~5 (로컬+온라인)
- 그룹: 사용자 컬렉션(폴더 기반), 탭 그룹(드래그·색상·접기)
- 즐겨찾는 태그: 노란색 강조, 자동완성, 검색 제외 태그(-tag:)

## 🖱 뷰어 동작

- 모드: 스크롤 / 클릭넘김 / 두 쪽(spread) — 라이브러리별 기억
- 핏: 폭/길이/화면맞춤/화면채움, 줌
- 휠로 페이지 넘김, 가상화 리더(대량 페이지 성능)
- 분할 뷰(2작품 동시), Glance(hover/Alt+클릭 미리보기)
- 탭: 크롬식 드래그 재정렬, 생성/삭제 애니메이션
- 좌측 목록 접기/펼치기 애니메이션, 리사이즈

## 🛠 작품 관리 (Manage)

- 중복 찾기: 커버 dHash로 유사/중복 그룹, keeper 자동 선정
- 번역본 짝 찾기: 같은 작품의 다른 언어판 매칭
- 병합(컬렉션): 여러 폴더를 한 작품으로
- 언어별/장르별 자동 정리, 화 폴더 일괄 이름변경(N화 부제)
- 한국어판 찾기: 동인지 사이트에서 같은 작품 한국어 에디션 검색
- 메타 채우기: 동인지 사이트 메타 자동 보강
- 완전 초기화: 2단계 확인 + 작품 폴더 삭제 옵션

## 🌐 번역

- 뷰어 내 말풍선 번역(원문 지우고 한국어 덧씌움, 캔버스 렌더)
- 엔진: Vision LLM(Groq/OpenRouter/Mistral), Gemini, Papago, 무료(Tesseract+Google/DeepL)
- 페이지별 캐시, 수동 편집(블록 위치/색/텍스트)
- 텍스트(.txt)/이미지로 내보내기

## 🔎 온라인 (동인지 + 일반만화)

- 둘러보기/검색(태그·작가·코드), 정렬(최신/인기), 오름/내림차순(전체 대상)
- 자동완성(86k 토큰: 작가/캐릭터/시리즈/태그 + 온라인서 본 태그 자동 추가)
- 격자형/목록형, 즐겨찾기·평점·다운로드 카드에서 바로
- 우클릭: 로컬↔온라인 교차 검색, 즐겨찾는 태그 추가

## 🎨 기타

- 라이트/다크 테마(타이틀바·리더 헤더 동기화)
- Material Symbols 아이콘 통일, 버튼 클릭 밝기 피드백

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

데이터는 `%APPDATA%/MangaManager/` 의 `works.json` · `settings.json` · `session.json` 에 저장.
원본 이미지는 이동/삭제하지 않음 (즐겨찾기 폴더 이동 제외).
