# 실행 엔진 (OpenClaw)

`openclaw.pin.json`에 고정한 공개 릴리스를 그대로 사용한다. 이 저장소에는 OpenClaw 소스를 넣지 않는다.
설치본에는 `apps/desktop/engine-runtime`의 lockfile대로 설치한 패키지가 들어간다(`pnpm --filter @ilson/desktop engine:install`).
일손이 실행하는 방식과 설정은 `docs/architecture.md`의 "OpenClaw 내장" 절을 따른다.

- npm: `openclaw@2026.11.1` (2026-11-08 기준 npm `latest`)
- git: `openclaw/openclaw` 태그 `v2026.11.1`, 커밋 `4ffdd2047d192dd65554de3c8c46c0e0197c6e2a`
- GitHub 태그 `v2026.11.2`가 있으나 npm에는 배포되지 않아 채택하지 않았다.

## 일손에서 쓸 기능 (v2026.11.1 문서 기준, 연동 시 재확인)

| 일손 요구 | OpenClaw 기능 | 문서 |
| --- | --- | --- |
| 시제품은 읽기 도구만 허용 | 세션 권한 모드 `read-only` | `docs/gateway/permission-modes.md` |
| 업무별 전용 작업 폴더 | 세션 `sessionRoot` 경계, 샌드박스 | `docs/gateway/sandboxing.md` |
| 실행 이력 | 메타데이터 감사 원장 | `docs/gateway/audit.md` |
| 기관망 모델 | `ollama`, `vllm` provider 플러그인 | `docs/gateway/local-models.md` |
| 예약 실행 | cron | `src/cron` |

OpenClaw 감사 원장은 프롬프트, 도구 인자, 결과, 파일명을 저장하지 않는다.
"어떤 자료에서 어떤 값과 문장을 가져왔는지"의 근거 추적은 일손 `store/`에서 따로 구현한다.
