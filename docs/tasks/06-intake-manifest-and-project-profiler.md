---
sidebar_position: 6
title: "T06 · Intake Manifest와 프로젝트 프로파일러"
sidebar_label: "T06 인테이크·프로파일러"
---

# T06 · Intake Manifest와 프로젝트 프로파일러

> **한 줄 요약** — 사용자 입력을 IntakeManifest로 정규화하고, 대상 저장소를 검사해 ProjectProfile로 만든다.

| 항목              | 내용                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 구현 에이전트가 대상 저장소의 기존 컨벤션(패키지 매니저, 프레임워크, FSD 구조, 디자인 시스템, API 생성기 등)을 따를 수 있도록, 코드 생성 전에 저장소를 프로파일링한다. |
| **입력**          | 사용자 요청(projectRoot, 요청 범위, [Source](/reference/glossary#source) 후보 목록)과 T04의 [Run](/reference/glossary#run) 원장, T05의 안전한 파일 접근 정책           |
| **출력**          | `IntakeManifest` · `ProjectProfile` · `ProfileFinding` 계약과 MCP 도구 4종 → T07(Source 등록 대상 결정)과 이후 모든 생성 태스크(OpenSpec, API, UI)가 소비              |
| **선행 태스크**   | T05                                                                                                                                                                    |
| **병렬 가능**     | 없음                                                                                                                                                                   |
| **관련 스킬**     | -                                                                                                                                                                      |
| **담당 에이전트** | -                                                                                                                                                                      |

## 왜 필요한가

구현 에이전트는 대상 저장소의 기존 컨벤션을 따라야 한다. OpenSpec, API 래퍼, Figma UI, 테스트를 생성하기 전에 플러그인은 다음을 알아야 한다.

- Git 루트, 패키지 매니저, 워크스페이스 레이아웃
- 프레임워크, 빌드 도구, 테스트 러너, TypeScript 설정
- FSD 구조 여부
- 디자인 시스템 후보, API 생성기 후보, 생성 클라이언트 위치
- 사용 가능한 스크립트

이 정보가 없으면 에이전트는 저장소와 어긋나는 코드를 생성하고, 이후 게이트에서 대량의 [Gap](/reference/glossary#gap)이 쏟아진다.

## 동작 흐름

1. `create_intake_manifest` / `parse_intake_request`가 사용자 입력을 `IntakeManifest`로 정규화해 Run에 연결한다.
2. `inspect_project`가 안전한 `ProjectProbe`(T05 경로 정책 준수, 읽기 전용)로 저장소를 검사한다.
3. 검출기(detector)들이 순서대로 실행된다 — Git → 패키지 매니저 → 워크스페이스 → 프레임워크/툴링 → FSD → 디자인 시스템 → API 생성기.
4. 각 검출 결과는 confidence(`high` / `medium` / `low` / `unknown`)와 함께 `ProjectProfile`로 합쳐지고, 특이사항은 `ProfileFinding`으로 남는다.
5. `get_project_profile` / `list_project_profiles`로 프로파일을 조회한다.

## 입력 상세

`IntakeManifest` (`src/profile/contracts.ts`):

```json
{
  "runId": "run_...",
  "projectRoot": "/path/to/target-repo",
  "baseCommit": "abc123...",
  "language": "ko",
  "requestedScope": "보유 주식 탭 실시간 갱신 구현",
  "sources": [
    { "kind": "brief", "locator": { "type": "file", "path": "docs/brief.md" }, "required": true },
    { "kind": "figma", "locator": { "type": "figma", "url": "https://www.figma.com/design/..." } },
    { "kind": "openapi", "locator": { "type": "file", "path": "openapi/api.yaml" } }
  ],
  "createdAt": "2026-07-10T00:00:00.000Z"
}
```

- `sources[].kind`는 `brief` / `figma` / `openapi`, locator는 `file` / `url` / `figma` 판별 유니온이다.
- 실제 콘텐츠 스냅샷은 아직 만들지 않는다 — 그것은 T07의 일이다.

## 출력 상세

- `ProjectProfile` — Git 프로파일(루트, HEAD 커밋, 브랜치, dirty/shallow 여부), 패키지 매니저(`pnpm` / `npm` / `yarn` / `bun` / `unknown`), 워크스페이스 레이아웃, 프레임워크/툴링, FSD 구조, 디자인 시스템 후보, API 생성 후보, 스크립트 목록.
- `ProfileFinding` — `severity`(`info` / `warning` / `risk` / `gap`) + `code` + `message` + evidence 문자열.
- MCP 도구: `create_intake_manifest`, `parse_intake_request`, `inspect_project`, `get_project_profile`, `list_project_profiles`.

## 완료 조건 (Definition of Done)

- [ ] IntakeManifest 계약이 존재한다.
- [ ] ProjectProfile 계약이 존재한다.
- [ ] 안전한 ProjectProbe가 존재한다 (읽기 전용, 경로 정책 준수).
- [ ] Git / 패키지 매니저 / 워크스페이스 / 프레임워크·툴링 / FSD / 디자인 시스템 / API 생성 검출기가 존재한다.
- [ ] `ProjectProfileService`가 존재한다.
- [ ] `create_intake_manifest` / `inspect_project` / `get_project_profile` / `list_project_profiles` MCP 도구가 존재한다.
- [ ] fixture 기반 프로파일러 테스트가 통과한다.
- [ ] MCP stdio 통합 테스트가 통과한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

## 알려진 한계

- Source 콘텐츠 스냅샷과 SHA-256 다이제스트 계산 없음 (T07).
- brief 요구사항 추출 없음 (T08), Figma 노드 분석 없음 (T09~T11), OpenAPI 파싱 없음 (T12).
- 패키지 설치, 테스트/빌드 명령 실행 없음 — 프로파일링은 정적 검사만 수행한다.
- OpenSpec / Gherkin 생성, API 래퍼·UI 구현, 에이전트 실행, PR 발행 없음.
