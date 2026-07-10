---
sidebar_position: 29
title: "T29 · OpenTelemetry와 로그 상관관계"
sidebar_label: "T29 관측성"
---

# T29 · OpenTelemetry와 로그 상관관계

> **한 줄 요약** — 플러그인 워크플로와 대상 앱 통합 지점을 위한 관측성 계획, 텔레메트리 설정, trace/log 상관관계, [Redaction](/reference/glossary#redaction) 규칙을 추가한다.

| 항목              | 내용                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 장시간·다단계로 도는 spec-to-pr 워크플로의 실패를 Run→Stage→Agent→Tool→명령 단위로 추적 가능하게 만든다                                                   |
| **입력**          | Run ID, 프로젝트 프로파일(T06), API wrapper 아티팩트(T16), 품질/시각/접근성/성능 리포트(T25~T28), 관측성 선호 설정, 선택적 OTLP 엔드포인트                |
| **출력**          | 텔레메트리 리소스 계약, span 네이밍 정책, redaction 정책, 상관 로그 포맷, 관측성 플랜·설정 템플릿, 리포트 아티팩트, observability Gap — T30 리포트가 소비 |
| **선행 태스크**   | T23 (리포트 입력은 T25~T28)                                                                                                                               |
| **병렬 가능**     | T24, T25, T26, T27, T28 (T26~T29는 서로 완전 병렬)                                                                                                        |
| **관련 스킬**     | `/spec-to-pr:setup-observability`                                                                                                                         |
| **담당 에이전트** | `agents/observability-reviewer.md`                                                                                                                        |

## 왜 필요한가

spec-to-pr 워크플로는 장시간 실행되는 다단계 파이프라인이다. 실패는 다음 축을 가로질러 추적 가능해야 한다:

- [Run](/reference/glossary#run) / Stage / Agent
- MCP Tool / 명령 실행
- [품질 게이트](/reference/glossary#quality-gate) / 시각 비교 / 접근성 검사 / 성능 게이트
- 아티팩트 생성

이 계층이 없으면 "어느 단계의 어떤 도구 호출이 실패했는가"를 로그에서 재구성할 수 없다.

## 동작 흐름

1. `plan_observability` — Run에 대한 관측성 플랜(어떤 신호를 어디로 보낼지)을 생성한다.
2. 텔레메트리 리소스 계약을 확정한다 (`src/observability/telemetry-resource.ts`) — `service.name`, `service.version`, `service.namespace`(기본 `spec-to-pr`), `deployment.environment.name`(기본 `development`).
3. span 네이밍 정책을 적용한다 (`src/observability/telemetry-contract.ts`) — 허용 span은 `spec_to_pr.run`, `spec_to_pr.stage`, `spec_to_pr.mcp_tool`, `spec_to_pr.agent`, `spec_to_pr.command`, `spec_to_pr.quality_gate`, `spec_to_pr.visual_compare`, `spec_to_pr.accessibility_gate`, `spec_to_pr.performance_gate`, `spec_to_pr.report` 열 가지다.
4. 구조화 로그의 상관 필드를 정의한다 — `traceId`, `spanId`, `runId`, `stageName`, `agentRole`, `toolName`, `artifactId` (CorrelationFields).
5. **Redaction 계층**이 모든 텔레메트리 속성을 통과시키기 전에 비밀 값을 차단한다 (`src/observability/telemetry-redaction.ts`). 두 종류 규칙이 있고, 매치되면 값이 `"[REDACTED]"`로 치환된다:
   - **키 패턴** (키 이름이 매치되면 값 전체 마스킹): `authorization`, `cookie`, `set-cookie`, `token`, `api-key`/`api_key`, `secret`, `password`, `passwd`, `private-key`, `client-secret` (대소문자 무시 정규식)
   - **값 패턴** (문자열 값이 매치되면 마스킹): `bearer <token>`, `sk-` 20자 이상 키, `ghp_` GitHub 토큰, `xox[baprs]-` Slack 토큰, `-----BEGIN ... PRIVATE KEY-----` PEM 블록
6. `generate_observability_config` — OpenTelemetry 설정 템플릿과 API wrapper 계측(span) 템플릿을 렌더링한다.
7. 관측성 리포트를 [ArtifactRef](/reference/glossary#artifactref)로 Run에 기록하고 미비점은 observability [Gap](/reference/glossary#gap)으로 남긴다.
8. `record_observability_review` — `observability-reviewer` 에이전트가 결과를 검토·기록한다.

## 입력 상세

- **Run ID** — 대상 Run.
- **프로젝트 프로파일** — 대상 앱의 스택·정책.
- **API wrapper 아티팩트** — 계측 템플릿을 붙일 지점.
- **품질/시각/접근성/성능 리포트** — 상관관계에 포함할 게이트 증거.
- **대상 관측성 선호 설정 + 선택적 OTLP 엔드포인트 설정**

## 출력 상세

redaction 적용 예시:

```json
{
  "input": {
    "http.request.header.authorization": "Bearer eyJhbGciOi…",
    "spec_to_pr.run.id": "run_01hzy3k9"
  },
  "output": {
    "http.request.header.authorization": "[REDACTED]",
    "spec_to_pr.run.id": "run_01hzy3k9"
  }
}
```

- **텔레메트리 리소스 계약** — OTel 리소스 속성 매핑.
- **span 네이밍 정책 + 시맨틱 속성 키** — `spec_to_pr.run.id`, `spec_to_pr.stage.name`, `spec_to_pr.agent.role` 등 소문자 `[a-z0-9_.-]` 키만 허용.
- **플러그인 상관 로그 포맷** — CorrelationFields를 포함하는 구조화 로그.
- **대상 앱 관측성 플랜 + 선택적 OpenTelemetry 설정 파일 + API wrapper 계측 템플릿**
- **observability report 아티팩트 / observability Gap**

## 완료 조건 (Definition of Done)

- [ ] 텔레메트리 리소스 계약이 존재한다.
- [ ] Redaction 계층이 비밀류(secret-like) 속성을 차단한다.
- [ ] Run에 대한 관측성 플랜을 생성할 수 있다.
- [ ] OpenTelemetry 설정 템플릿을 렌더링할 수 있다.
- [ ] API wrapper span 템플릿을 렌더링할 수 있다.
- [ ] 구조화 로그 상관 필드가 정의되어 있다.
- [ ] 관측성 리포트가 아티팩트로 저장된다.
- [ ] MCP 툴이 stdio 통합 테스트로 동작한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

기대 결과:

- telemetry redaction 테스트 통과
- telemetry resource 테스트 통과
- observability plan 테스트 통과
- config renderer 테스트 통과
- ObservabilityService 테스트 통과
- MCP stdio 통합 테스트에서 `plan_observability`, `generate_observability_config`, `get_observability_report`, `record_observability_review` 호출 가능

## 알려진 한계

- Collector는 배포하지 않는다.
- 벤더 특화 통합은 생성하지 않는다 (락인 방지).
- Node.js OTel 로그는 선택 사항이며 기본이 아니다 — 전체 OTel Log SDK 의존성을 주장하지 않는다.
- 대상 앱 코드는 기본적으로 수정하지 않는다 — 프로젝트 정책 없이 앱 전역 자동 계측을 하지 않는다.
- API wrapper 계측은 템플릿으로만 생성된다.
- 프로덕션 필드 텔레메트리(RUM 수집)는 주장하지 않는다.
