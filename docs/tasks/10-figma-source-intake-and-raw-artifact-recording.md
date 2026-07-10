---
sidebar_position: 10
title: "T10 · Figma Source 인테이크와 Raw Artifact 기록"
sidebar_label: "T10 Figma 인테이크"
---

# T10 · Figma Source 인테이크와 Raw Artifact 기록

> **한 줄 요약** — Figma 노드 URL을 [SourceRef](/reference/glossary#sourceref)로 등록하고, Figma MCP의 원시 출력(메타데이터·디자인 컨텍스트·스크린샷·변수·Code Connect 맵)을 내구성 있는 [Evidence](/reference/glossary#evidence)와 [Artifact](/reference/glossary#artifact) 레코드로 저장한다.

| 항목              | 내용                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 나중의 UI 구현과 시각 리뷰가 "그 시점의 그 디자인"을 증거로 인용할 수 있도록, 원시 URL이 아니라 fileKey·nodeId·프로바이더 출력까지 [Run](/reference/glossary#run) 원장에 보존한다. |
| **입력**          | Run ID · Figma 노드 URL · T09의 provider policy에 따라 호출자가 얻어온 Figma MCP 원시 출력(텍스트/이미지)                                                                          |
| **출력**          | Figma SourceRef(kind `figma`), 원시 출력 5종의 ArtifactRef(각각 Figma-node EvidenceRef 연결) → T11 디자인 시스템 인벤토리와 T17 디자인 계약, T26 시각 회귀가 소비                  |
| **선행 태스크**   | T09 (T07의 Source 모델 위에서 동작)                                                                                                                                                |
| **병렬 가능**     | T08 (brief), T12 (openapi)                                                                                                                                                         |
| **관련 스킬**     | `/spec-to-pr:figma-intake`                                                                                                                                                         |
| **담당 에이전트** | -                                                                                                                                                                                  |

## 왜 필요한가

Figma는 핵심 디자인 증거 [Source](/reference/glossary#source)다. 하지만 URL 문자열만으로는 이후의 UI 구현과 시각 리뷰에 충분하지 않다. Run 원장은 fileKey, nodeId, canonical Figma URL, 사용된 프로바이더, 그리고 메타데이터·디자인 컨텍스트·스크린샷 베이스라인·변수/스타일 정의·Code Connect 맵 출력을 보존해야 한다. 디자인이 이후에 바뀌어도, 구현이 참조한 버전이 무엇이었는지 증명할 수 있어야 한다.

## 동작 흐름

1. `register_figma_source`가 URL을 파싱한다 — `parseFigmaUrl()`(`src/figma/figma-url.ts`)이 `design` / `file` / `proto` URL에서 fileKey를 추출하고, `node-id` 파라미터를 정규화(`238-941` → `238:941`)하며 canonical URL을 만든다. `node-id`가 없으면 거부한다.
2. `{fileKey, nodeId, canonicalUrl}`의 SHA-256 locator digest로 중복 등록을 판정하고, 신규면 kind `figma`의 SourceRef를 Run.sources에 추가한다 (`src/application/figma-intake-service.ts`).
3. 호출자(스킬)가 T09 정책이 가리키는 프로바이더의 Figma MCP 도구를 호출해 원시 출력을 얻는다 — spec-to-pr 서버가 직접 Figma를 호출하지 않는다.
4. `record_figma_metadata` / `record_figma_design_context` / `record_figma_screenshot`(base64 이미지) / `record_figma_variable_defs` / `record_figma_code_connect_map`이 원시 출력을 콘텐츠 주소 blob으로 저장하고 ArtifactRef를 만든다.
5. 각 Artifact에는 해당 Figma 노드를 가리키는 EvidenceRef가 연결되고, 동일 digest의 원시 출력 재기록은 중복 제거된다.

## 입력 상세

- `register_figma_source`: `runId`, `url`(figma.com URL, `node-id` 필수), 선택 `label`.
- `record_figma_*`(텍스트): `runId`, `sourceId`, `content`, `mediaType`(기본 `text/plain`), 선택 `providerId`.
- `record_figma_screenshot`: `runId`, `sourceId`, `imageBase64`, `mediaType`(기본 `image/png`), 선택 `providerId`.

## 출력 상세

- Figma SourceRef — locator `{ type: "figma", url, fileKey, nodeId }`, digest는 locator digest, metadata에 rawUrl/canonicalUrl/figmaKind/label.
- 원시 Artifact 5종 (`figmaKindToArtifactKind()`, `src/figma/figma-intake-contracts.ts`):

| 기록 도구                       | Artifact kind            |
| ------------------------------- | ------------------------ |
| `record_figma_metadata`         | `figma-metadata`         |
| `record_figma_design_context`   | `figma-design-context`   |
| `record_figma_screenshot`       | `figma-screenshot`       |
| `record_figma_variable_defs`    | `figma-variable-defs`    |
| `record_figma_code_connect_map` | `figma-code-connect-map` |

- 각 Artifact의 metadata에는 `adapter: "figma-intake-v1"`, `sourceId`, `providerId`가 기록되어 T11이 소스별·프로바이더별로 원시 출력을 회수할 수 있다.
- 결과 계약: `FigmaIntakeResult` — `duplicate`, `sourceId`, `evidenceId`, `artifactId`, `artifactDigest`, `kind`.

## 완료 조건 (Definition of Done)

- [ ] Figma URL 파서가 fileKey와 nodeId를 정규화한다.
- [ ] Figma SourceRef를 Run.sources에 attach할 수 있다.
- [ ] Figma MCP 원시 출력을 ArtifactRef 레코드로 기록할 수 있다.
- [ ] 각 Figma Artifact가 Figma-node EvidenceRef를 가진다.
- [ ] 중복 원시 Artifact가 digest 기준으로 중복 제거된다.
- [ ] MCP stdio 통합 테스트가 Source 등록과 원시 Artifact 기록을 커버한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
```

Claude Code에서 `/spec-to-pr:figma-intake [run-id] [figma-url]`을 실행해 실제 Figma MCP 출력이 Run에 기록되는지 확인한다.

## 알려진 한계

- spec-to-pr가 Figma MCP나 Figma REST API를 직접 호출하지 않는다 — 원시 출력의 수집은 호출자(스킬/에이전트)의 몫이다.
- 디자인 시스템 인벤토리 파싱 없음 (T11).
- 시각 diff 없음 (T26), UI 코드 생성 없음 (T21).
- `node-id`가 없는 Figma URL(파일 전체)은 디자인 증거로 받지 않는다.
