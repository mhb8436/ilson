# 일손 (ILSON)

크래프틱 업무비서. 공공기관 담당자가 내부 자료로 처리하는 반복 업무를 맡기는 폐쇄망 설치형 AI 비서다.
1차 업무는 주간보고 취합이다.

## 구성

| 경로 | 내용 | 상태 |
| --- | --- | --- |
| `engine/` | OpenClaw 실행 엔진 버전 고정 정보 (`openclaw.pin.json`). 포크하지 않고 공개 릴리스를 그대로 쓴다. | 2026.11.1 고정 |
| `plugins/ilson-collate/` | 주간보고 대조 엔진. 제출 명단, 지난주 확정본, 이번 주 파일을 결정적 코드로 대조하고 부서별 보완 요청 초안을 만든다. | 0.1.0 |
| `fixtures/weekly-report/` | 가상 시험 자료와 사람이 작성한 정답표 (`expected.json`) | 2026-W45 |
| `app/` | 업무 화면, 검토함, 업무대장 | 예정 |
| `store/` | 원본, AI 초안, 수정본, 승인 상태, 근거 추적 | 예정 |
| `security/` | 차단망 설치, 프롬프트 주입, 권한 회수 시험 | 예정 |
| `docs/` | 설계 결정 기록 | |

## 개발

Node 22 이상, pnpm 10.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

시험 자료를 다시 만들 때:

```bash
pnpm fixtures
```

대조 실행 예:

```bash
node plugins/ilson-collate/dist/cli.js \
  --config fixtures/weekly-report/template.json \
  --roster fixtures/weekly-report/roster.csv \
  --inbox fixtures/weekly-report/inbox/2026-W45 \
  --week 2026-W45 \
  --previous fixtures/weekly-report/confirmed/2026-W44_주간보고_확정본.xlsx \
  --previous-week 2026-W44 \
  --out out/2026-W45
```

결과: `report.json` (전체 결과와 원본 위치), `report.md` (검토함 요약), `requests/<부서>.txt` (보완 요청 초안).

## 라이선스 고지

실행 엔진 OpenClaw는 MIT 라이선스다. 설치본에 포함할 때 저작권과 허가 고지를 보존한다.
모델 가중치, 플러그인, 문서 변환기와 의존성은 반입 전에 각각의 배포 조건과 SBOM을 확인한다.
