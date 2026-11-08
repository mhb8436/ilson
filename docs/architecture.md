# 설계 결정 기록

## 2026-11-08 기반 방식: OpenClaw 버전 고정, 포크하지 않음

- 기존 포크 `mhb8436/clawdbot`은 Moltbot 2026.1.27 기준이고 자체 커밋이 없어 보관만 한다.
- `openclaw@2026.11.1`을 고정 의존성으로 쓰고, 일손 기능은 이 저장소의 플러그인과 앱으로 구현한다.
- 장기 포크는 설정, 플러그인, 외부 접근 통제로 충족할 수 없는 보안 요구가 확인될 때만 검토한다.
  그때도 별도 패치 목록으로 관리하고 업스트림 보안 업데이트 반영 비용을 함께 산정한다.

## 2026-11-08 주간보고 대조는 결정적 코드로

- 명단 대조, 필수 항목, 중복, 전주 대비 변경은 `plugins/ilson-collate`가 계산한다. 모델은 관여하지 않는다.
- 결과 항목은 `audience`로 나눈다.
  - `department`: 부서에 보완을 요청할 항목(미제출, 필수 항목 누락, 숫자 오류, 중복, 부서 값 오기, 양식 불일치)
  - `reviewer`: 담당자가 확인할 항목(전주 대비 변경, 신규/빠진 과제, 복수 파일, 명단 외 파일)
- 지정 폴더에 자료가 없으면 단정하지 않고 '자료 확인 필요'로 표시한다(다른 경로 접수 가능성).
- 같은 과제ID가 두 번 나오면 첫 행만 전주 비교에 쓰고 나머지는 중복으로 표시한다.
- 이번 주 값이 비었거나 숫자로 읽을 수 없으면 전주 대비 변경으로 세지 않는다(이미 보완 대상).
- 미제출이거나 판독할 수 없는 부서의 과제는 '빠진 과제'로 세지 않는다.

## 2026-11-08 보완 요청문과 모델의 역할

- 기본 문안은 프로그램이 만든다(`buildRequestDrafts`). 모델이 없어도 업무가 끝난다.
- 소형 모델에는 사실 목록만 주고 문장 다듬기를 맡긴다(`buildRewritePrompt`). 첨부 문서 본문은 넣지 않는다.
- 모델 문안에서 파일명, 행 번호, 과제ID가 빠지면 `checkRewrite`가 실패하고 기본 문안을 쓴다.
- 문안은 검토함에서 담당자가 수정하고 확정한다. 발송은 1차 범위가 아니다.

## 입력 처리 기준

- XLSX: 지정 시트, 지정 머리글 행. 수식 셀은 계산 결과 값을 쓴다.
- CSV: UTF-8(BOM 포함)을 먼저 시도하고 실패하면 CP949로 읽는다.
- 파일명과 셀 값은 NFC로 정규화한다(macOS NFD 파일명 대응).
- 엑셀 잠금 파일(`~$`), 숨김 파일, XLSX/CSV 외 형식은 접수 파일로 보지 않는다.
- HWPX는 별도 플러그인으로 다룬다(예정).

## 2026-11-08 1차 배포 형태: 담당자 PC 단독 실행 파일

- 담당자는 GUI만 쓴다. 명령줄은 개발, 시험용으로만 남긴다.
- Windows 설치 파일 하나(NSIS, 사용자 단위 설치, 관리자 권한 불필요)와 무설치 실행 파일(portable)을 함께 만든다.
- 앱은 Electron. 메인 프로세스와 서비스, 대조 엔진, ExcelJS를 esbuild로 한 파일에 묶어 설치본에 node_modules를 넣지 않는다.
- 모델은 기관 GPU 서버의 OpenAI 호환 API(Ollama, vLLM 공통)에 연결한다. 외부 대체 호출은 없다.
  모델 서버가 없어도 대조와 기본 문안, 확정까지 된다.
- 화면(렌더러)은 로컬 파일만 읽는다. http(s) 요청은 막고, 모델 호출은 메인 프로세스에서만 한다.
  화면이 쓸 수 있는 기능은 preload의 목록(`apps/desktop/src/shared/api.ts`)으로 한정한다.
- API 키는 Windows DPAPI(Electron safeStorage)로 암호화해 저장하고 화면에는 저장 여부만 보여 준다.
- 데이터는 `%APPDATA%\Ilson\data`에 둔다. 업무마다 폴더(job.json, report.json, drafts.json)를 만들고,
  업무대장은 덧붙이기만 하는 JSONL에 해시 사슬을 건다. 1차 규모에서는 SQLite 같은 네이티브 모듈 없이 충분하고
  설치본 빌드가 단순해진다.
- 자동 업데이트는 끈다(망분리). 업데이트는 검증한 설치 파일을 반입해 덮어 설치한다.
## 2026-11-08 OpenClaw 내장 (보류 결정 철회)

- 설치 파일 하나에 OpenClaw 2026.11.1(`engine/openclaw.pin.json`)을 함께 넣는다. 담당자는 따로 설치하지 않는다.
- 실행: 일손이 시작될 때 Electron 실행 파일을 Node로 써서(`ELECTRON_RUN_AS_NODE=1`, Electron 44 내장 Node 24.22)
  `openclaw gateway run`을 하위 프로세스로 띄우고, 종료할 때 프로세스 묶음째 끈다(Windows `taskkill /T`).
- 연결: 127.0.0.1의 빈 포트, 실행마다 새로 만드는 토큰. 일손은 게이트웨이의 OpenAI 호환 `/v1/chat/completions`
  (`model: openclaw/default`)를 부르고, 게이트웨이가 기관 GPU 서버(`models.providers.agency`)를 부른다.
- 엔진 설정(`packages/service/src/engine.ts`의 `buildEngineConfig`):
  `tools.profile=minimal` + `gateway` 도구 차단(도구 없음), `models.mode=replace`, `models.catalogRefresh.enabled=false`,
  `plugins.slots.memory=none`, `agents.defaults.skipBootstrap=true`. 환경변수로 `OPENCLAW_OFFLINE`, `OPENCLAW_NO_AUTO_UPDATE`,
  `OPENCLAW_DISABLE_BONJOUR`, `OPENCLAW_SKIP_CHANNELS`를 켜고, 상태 폴더를 `%APPDATA%\Ilson\engine`으로 분리한다.
- API 키는 설정 파일에 쓰지 않고 `${ILSON_MODEL_API_KEY}` 참조만 둔 뒤 하위 프로세스 환경변수로만 넘긴다.
- 엔진이 준비되지 않으면 AI 다듬기는 실패로 알리고, 기관 서버로 직접 우회하지 않는다(경로를 하나로 유지).
- 패키지는 `apps/desktop/engine-runtime`의 lockfile로 고정하고 `npm ci --omit=dev --ignore-scripts`로 설치한다.
  설치본에는 asar 밖 `resources/engine/node_modules`로 들어간다. 포함 패키지와 라이선스 목록은
  `resources/engine/ENGINE_LICENSES.txt`로 함께 넣는다.
- 크기: 설치 후 약 820MB(Linux 기준, 엔진 약 550MB). 이 때문에 무설치 실행 파일(portable)은 뺐다.
  실행할 때마다 임시 폴더에 전부 풀어야 해서 느리다.

### 폐쇄망 시험 결과 (Linux, 루프백만 있는 네트워크 네임스페이스)

- 엔진 기동, 토큰 없는 요청 거부(401), 모델 서버 호출, 종료 후 프로세스 정리 모두 정상.
- 외부 접속 시도는 DNS 조회 하나만 남았다: `clawhub.ai`(OpenClaw 공식 플러그인 목록 확인). 실패하면 설치본에 들어 있는
  목록으로 대신하므로 기능에는 영향이 없다. `OPENCLAW_CLAWHUB_URL`로는 막히지 않는 경로라 기관 DNS 기록에 남을 수 있다.
  보안성 검토 자료에 적고, 다음 버전에서 막는 설정이나 플러그인 목록 경로를 찾는다.
- 엔진 메모리는 약 1.1GB(RSS)다. 업무 PC 사양(8GB 이상 권장)을 첫 고객과 확인한다.

## 다음 작업

1. 실제 Windows PC와 기관 GPU 서버(또는 그 대역)에서 설치, 연결, 샘플 업무 확인. 코드 서명 인증서 준비.
2. 같은 업무를 다음 주(W46) 자료로 재실행: 저장한 비교 기준 재사용, 확정본 자동 생성, 동일 예약 중복 실행 방지.
3. 예약 업무 화면과 트레이 상주(놓친 예약 처리 포함).
4. 실제 소형 모델(Qwen3 4B)로 문안 다듬기 품질과 근거 표기 검사 통과율 측정.
5. 회의 후속 조치표, 회신 초안. 내장 OpenClaw에 읽기 전용 도구를 업무별 작업 폴더로 열어 쓴다.
6. 엔진 크기 줄이기: 1차 업무에 쓰지 않는 의존성(브라우저 자동화, 채널 등) 제외 가능 여부 시험.
