# 우리 약속 노트

같이 하기로 한 것, 해주기로 한 것을 카테고리별로 적어두는 개인용 PWA.
https://ournote.github.io

- `index.html` — 앱 전체 (CSS/JS 인라인, 빌드 없음)
- `manifest.webmanifest`, `sw.js`, `icons/` — 홈 화면 설치·오프라인용
- 데이터는 브라우저 localStorage `ournote:items`에만 저장됩니다. 기기를 바꾸거나 사파리 데이터를 지우기 전에 앱 하단 **백업 저장**으로 JSON을 받아두세요.

## 배포

GitHub Pages: Settings → Pages → Branch `main` / `(root)`.
`index.html`이나 다른 파일을 고쳐 배포할 때는 `sw.js`의 `VERSION`을 올려야 설치된 앱이 새 캐시를 받습니다.
