---
sidebar_position: 1
title: 사용 레시피 — 케이스별 프롬프트
---

# 사용 레시피 — 케이스별 프롬프트

SpecToPR은 자연어 요청에서 URL · 파일경로 · 브랜치 · 정책을 자동으로 파싱합니다. 아래에서 내 상황과 가장 가까운 케이스를 찾아 복사한 뒤 경로와 URL만 바꿔 쓰세요.

:::tip 프롬프트 작성 원칙

1. **입력 소스를 명시** — 기획서 경로, Figma URL, OpenAPI 경로/URL을 그대로 붙여넣기
2. **브랜치 정책을 명시** — 생략하면 target은 `main`
3. **제약은 자연어로** — "디자인 시스템 컴포넌트만 사용", "기존 API 래퍼 패턴 유지" 같은 제약도 파싱되어 에이전트에 전달됩니다
   :::

## 케이스 1 — 기획서 + Figma + OpenAPI (풀 세트)

명세가 모두 준비된 신규 기능. 증거의 폭이 가장 넓고 시각 회귀까지 자동 검증됩니다.

```text
/spec-to-pr ./apps/web docs/checkout-brief.md
Figma: https://www.figma.com/file/AbCdEf123/checkout?node-id=12-345
OpenAPI: docs/openapi.yaml
target 브랜치는 main, source는 feature/checkout 기준으로 시작해줘.
```

실행하면 이런 순서로 진행됩니다:

```text
① 프롬프트 파싱 → 기획서/Figma/OpenAPI 3개 소스 등록, 스냅샷 고정
② 세 소스에서 증거 추출 → 요구사항 ↔ API ↔ 디자인 연결 (빈 곳은 gap)
③ OpenSpec·Gherkin·Design Contract 계약 확정
④ 3개 에이전트가 격리 worktree에서 병렬 구현 → 교차 검토 → 통합
⑤ 품질·시각·접근성·성능 게이트 → 스코어카드 판정
⑥ 통과 시: 증거 첨부된 draft PR 생성 (여기서부터는 사람 몫)
```

→ 각 단계의 상세는 [모드 A 문서](/usage/mode-brief-figma-openapi), 프롬프트가 어떻게 구조화되는지는 [옵션과 정책의 파싱 예시](/usage/options-and-policies#prompt-parsing) 참고

## 케이스 2 — PDF 기획서만 있는 경우

Figma·OpenAPI 없이도 동작합니다. 기획서에서 요구사항을 추출하고, API·디자인 근거가 없는 부분은 **gap으로 기록**되어 PR 본문에 "사람이 확인할 것"으로 표시됩니다.

```text
/spec-to-pr ./my-service 기획서는 docs/주문개편_기획안_v2.pdf 야.
API 명세랑 디자인은 아직 없어. 근거가 부족한 부분은 gap으로 남겨줘.
```

## 케이스 3 — 기획서를 레거시 프로젝트로 대체 (마이그레이션)

신규 개발의 `기획서 + Figma + OpenAPI` 조합에서 **기획서만 레거시 프로젝트로 교체**하는 경우입니다. 레거시 저장소에서 기능 인벤토리(15개 카테고리)를 추출한 뒤, Figma·OpenAPI·계약 생성·구현·gate는 같은 흐름으로 진행합니다.

```text
/spec-to-pr ./new-app
레거시 프로젝트 ../legacy-app 을 기획서로 삼아서 주문 플로우를 이관해줘.
Figma: https://www.figma.com/file/XyZ789/order-renewal
OpenAPI: docs/openapi.yaml
동작은 레거시 기준, UI는 Figma 기준으로 검증해줘.
```

→ 상세 동작·검증 방식은 [모드 B 문서](/usage/mode-legacy-migration) 참고

## 케이스 4 — 레거시 + 새 디자인 (하이브리드)

동작은 레거시에서, 화면은 새 Figma 디자인에서 가져오는 리뉴얼 케이스.

```text
/spec-to-pr ./new-app
기능 명세는 레거시 ../legacy-app 의 예약 관련 화면들을 기준으로 하고,
UI는 이 Figma를 따라줘: https://www.figma.com/file/XyZ789/reservation-renewal
레거시의 native bridge 호출과 analytics 이벤트는 빠짐없이 커버돼야 해.
```

## 케이스 5 — 발행 없이 로컬 브랜치까지만

PR을 만들지 않고 통합 브랜치와 리포트만 받는 경우 (보안망 내부, 토큰 없음 등).

```text
/spec-to-pr ./apps/web docs/brief.md
PR은 발행하지 말고 통합 브랜치랑 리포트까지만 만들어줘.
```

## 케이스 6 — 게이트·검증 커맨드 커스터마이즈

```text
/spec-to-pr ./apps/web docs/brief.md
접근성이랑 성능 게이트는 이번엔 스킵해줘.
테스트는 pnpm test:unit 과 pnpm test:e2e 로 돌려줘.
```

게이트별 온/오프와 임계값 조정은 [옵션과 정책](/usage/options-and-policies)에 전체 목록이 있습니다.

## 케이스 7 — 특정 단계만 따로 실행

전체 파이프라인 대신 개별 스킬을 직접 호출할 수 있습니다. 예를 들어 Figma 분석만 미리 해보고 싶다면:

```text
/spec-to-pr:figma-intake https://www.figma.com/file/AbCdEf123/checkout?node-id=12-345
```

OpenAPI 분석만:

```text
/spec-to-pr:analyze-openapi docs/openapi.yaml
```

스킬 27개 전체 목록과 역할은 [스킬 레퍼런스](/reference/skills)에 있습니다.

## 케이스 8 — 실패한 Run 재개

Run은 SQLite에 체크포인트로 저장되므로, 실패하거나 중단돼도 처음부터 다시 하지 않습니다.

```text
/spec-to-pr ./apps/web 아까 돌리던 run 이어서 진행해줘.
```

실패한 스테이지부터 재시도합니다(스테이지당 기본 최대 3회). 자세한 내용은 [상태 저장 구조](/concepts/storage-and-mcp) 참고.

## 케이스 9 — 머지 후 아카이브

PR을 머지한 다음, 사람이 명시적으로 확인해 줄 때만 OpenSpec을 아카이브합니다.

```text
/spec-to-pr:archive-openspec 방금 PR #123 머지했어. 아카이브 진행해줘.
```

---

## 프롬프트에서 파싱되는 것들 (정리)

| 항목             | 인식 방식                     | 예                                        |
| ---------------- | ----------------------------- | ----------------------------------------- |
| Figma URL        | `figma.com` URL 자동 인식     | `https://www.figma.com/file/...`          |
| 기획서/문서 경로 | 파일 경로                     | `docs/brief.md`, `docs/기획안.pdf`        |
| OpenAPI          | 경로 · URL · 인라인 YAML 블록 | `docs/openapi.yaml`                       |
| 티켓 URL         | Linear · GitHub Issue 등      | `https://linear.app/...`                  |
| 브랜치 정책      | "source는 X, target은 Y"      | 기본 target: `main`                       |
| 발행 정책        | "PR 발행하지 마" / "draft로"  | 기본: draft 발행                          |
| 게이트 정책      | "성능 게이트 스킵" 등         | openspec·security·a11y·perf·observability |
| 검증 커맨드      | "테스트는 X로 돌려줘"         | `pnpm test:unit`                          |
| 자유 제약        | 그 외 자연어 제약             | "디자인 시스템 컴포넌트만 사용"           |
