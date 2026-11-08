# 오픈소스 고지

일손 설치본에 포함된 주요 오픈소스 구성요소와 라이선스다.
의존성 전체의 저작권 고지는 설치 폴더의 `resources/app.asar` 안 `dist/*.LEGAL.txt`에 함께 들어 있다.
납품 형상에서는 SBOM과 함께 이 목록을 다시 생성해 확인한다.

| 구성요소 | 용도 | 라이선스 |
| --- | --- | --- |
| Electron | 데스크톱 실행 환경 (Chromium, Node.js 포함) | MIT |
| React, React DOM | 화면 | MIT |
| ExcelJS | XLSX 읽기 | MIT |
| OpenClaw 2026.11.1 | 실행 엔진. 설치본 `resources/engine`에 포함 | MIT |

Electron에 포함된 Chromium과 Node.js의 고지는 설치 폴더의 `LICENSES.chromium.html`, `LICENSE.electron.txt`에 있다.

OpenClaw와 그 의존성 전체(약 500개)의 이름, 버전, 라이선스는 설치 폴더의 `resources/engine/ENGINE_LICENSES.txt`에 있다.
대부분 MIT, ISC, Apache-2.0, BSD 계열이며, 다음은 납품 전 고지 방식을 따로 확인한다.

- MPL-2.0: `@resvg/resvg-js`, `@ubjs/*`, `web-push`, `@trycua/cua-driver`(MIT AND MPL-2.0). 수정 없이 재배포하므로 원본 고지와 소스 위치 안내를 유지한다.
- Artistic-2.0: `npm`
- CC-BY-3.0: `spdx-exceptions`
- 라이선스 표기 없음: `qrcode-terminal`
