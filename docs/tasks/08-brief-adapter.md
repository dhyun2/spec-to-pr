---
sidebar_position: 8
title: "T08 · Brief 인테이크 어댑터와 텍스트 정규화"
sidebar_label: "T08 Brief 어댑터"
---

# T08 · Brief 인테이크 어댑터와 텍스트 정규화

> **한 줄 요약** — 등록된 brief [Source](/reference/glossary#source)를 분석해 공통 문서 모델(NormalizedBriefDocument)로 정규화하고, 요구사항 [Evidence](/reference/glossary#evidence)와 모호성·보안·미지원 형식 [Gap](/reference/glossary#gap)을 추출한다.

| 항목              | 내용                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **목적**          | T07이 스냅샷한 brief의 "내용"을 시스템이 이해하게 만든다 — 요구사항 후보는 Evidence로, 불확실성은 명시적 Gap으로 바꾼다.                                                                         |
| **입력**          | Run ID · brief Source ID · 콘텐츠 주소 저장소의 Source 스냅샷 콘텐츠 · Source locator와 media type 메타데이터 (T07 산출물)                                                                       |
| **출력**          | NormalizedBriefDocument, 요구사항 후보 EvidenceRef, 모호성·프롬프트 인젝션·미지원 형식 Gap, 갱신된 [Run](/reference/glossary#run), MCP 분석 요약 → T13 evidence graph와 T14 OpenSpec 생성이 소비 |
| **선행 태스크**   | T07                                                                                                                                                                                              |
| **병렬 가능**     | T09~T11 (figma), T12 (openapi)                                                                                                                                                                   |
| **관련 스킬**     | -                                                                                                                                                                                                |
| **담당 에이전트** | -                                                                                                                                                                                                |

## 왜 필요한가

T07은 파일을 스냅샷할 뿐, 시스템은 여전히 brief의 내용을 이해하지 못한다. T08은 분류(classification) 전에 brief 입력을 NormalizedBriefDocument로 변환한다 — Markdown은 지원 파서 중 하나일 뿐, 어댑터 전체가 아니다.

실제 프로젝트 brief는 Markdown, 일반 텍스트, PDF, 내보낸 HTML, 티켓/이슈 레코드 등 다양한 형태로 도착한다. 미지원 형식은 추측하는 대신 명시적 Gap이 되어야 한다. 그리고 brief 콘텐츠는 **비신뢰 데이터**다 — 어댑터는 brief 안의 텍스트를 플러그인·모델·도구에 대한 지시로 절대 취급하지 않는다.

## 동작 흐름

1. `analyze_brief_source`가 Run에서 brief Source와 스냅샷 콘텐츠를 읽는다 (`src/application/brief-adapter-service.ts`).
2. 파싱 전에 소스 타입을 감지한다 — `detectBriefSourceType()`(`src/brief/brief-source-type.ts`)이 locator 타입·확장자·media type으로 `markdown` / `plaintext` / `pdf` / `html` / `ticket` / `unknown`을 판정한다.
3. 지원 형식은 파서가 NormalizedBriefDocument 블록으로 변환한다.
   - Markdown: 헤딩·리스트·문단을 라인 범위와 함께 블록화 (`markdown-brief-parser.ts`). 펜스 코드 블록은 기본적으로 스킵.
   - Plain text: 문단 블록화 (`plaintext-brief-parser.ts`).
   - PDF / HTML / ticket / URL / unknown: `unsupported-brief-parser.ts`가 미지원 Gap을 생성.
4. 분류기(`brief-classifier.ts`)가 블록을 결정적으로 분류한다 — 요구사항 후보는 Source 위치를 보존한 EvidenceRef로, 모호한 진술은 requirement Gap으로, 프롬프트 인젝션 의심 콘텐츠는 security Gap으로.
5. Evidence와 Gap을 Run에 원자적으로 append한다. 동일 Source digest에 대한 재분석은 멱등이다.

## 입력 상세

- Run ID와 brief Source ID — T07에서 `register_file_source`로 등록된 것.
- Source 스냅샷 콘텐츠 — 콘텐츠 주소 저장소에서 digest로 읽는다.
- locator / media type 메타데이터 — 형식 감지의 근거.

## 출력 상세

- **NormalizedBriefDocument** (`src/brief/normalized-brief.ts`) — `format`(`markdown` / `plaintext` / `pdf` / `ticket` / `html` / `unknown`), 제목, 라인 범위를 가진 블록 배열, 메타데이터.
- 요구사항 후보 EvidenceRef — 모든 후보는 Source 내 위치(라인 범위)를 보존한다.
- Gap 3종:
  - 모호한 요구사항 → `requirement` Gap (open)
  - 프롬프트 인젝션 의심 콘텐츠 → `security` Gap (open)
  - 미지원 형식(PDF, HTML, ticket, URL, unknown) → `requirement` Gap (open)
- MCP를 통한 brief 분석 요약.

## 완료 조건 (Definition of Done)

- [ ] Markdown 헤딩·리스트·문단이 라인 범위를 가진 정규화 블록으로 파싱된다.
- [ ] Plain text가 정규화된 문단 블록으로 파싱된다.
- [ ] PDF·ticket 계약이 존재한다 — 추출이 아직 미지원이더라도.
- [ ] 미지원 형식이 명시적 Gap을 생성한다.
- [ ] 펜스 코드 블록이 무시된다.
- [ ] 요구사항 후보가 결정적으로 분류된다.
- [ ] 모호한 콘텐츠가 requirement Gap을 생성한다.
- [ ] 프롬프트 인젝션 의심 콘텐츠가 security Gap을 생성한다.
- [ ] Evidence와 Gap이 Run에 원자적으로 append된다.
- [ ] 기존 T01~T07 테스트가 계속 통과한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

기대 결과: Markdown 파서 · plain-text 파서 · 분류기 · `BriefAdapterService` 테스트 통과. MCP stdio 통합 테스트가 `create_run` → `register_file_source` → `analyze_brief_source`를 호출한다.

## 알려진 한계

- 어댑터는 규칙 기반이며 보수적이다 — LLM 해석을 사용하지 않는다.
- OpenSpec / Gherkin을 생성하지 않고, 누락된 요구사항을 추론하지 않는다.
- 펜스 코드 블록은 기본적으로 스킵한다.
- 실제 추출은 Markdown과 plain-text 파일 Source만 지원한다 — PDF, HTML, ticket, URL, unknown Source는 전용 어댑터/커넥터가 생길 때까지 미지원 Gap으로 기록된다.
- 멀리 떨어진 섹션 간 모순은 아직 해소하지 않는다.
- 모호성을 표시할 뿐, 후속 질문을 자동으로 하지는 않는다.
