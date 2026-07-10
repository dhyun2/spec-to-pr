---
sidebar_position: 7
title: "T07 · Source 레지스트리와 콘텐츠 어드레싱"
sidebar_label: "T07 Source 레지스트리"
---

# T07 · Source 레지스트리와 콘텐츠 어드레싱

> **한 줄 요약** — 로컬 입력 파일을 스냅샷하고 안정적인 다이제스트를 계산해 콘텐츠 주소 저장소에 보관하며, [SourceRef](/reference/glossary#sourceref)를 [Run](/reference/glossary#run)에 부착한다.

| 항목              | 내용                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 생성된 요구사항·스펙·테스트·UI·리포트가 "입력의 어떤 버전"에서 나왔는지 증명할 수 있게, 입력을 불변 스냅샷으로 고정한다.                                      |
| **입력**          | Run ID · Run의 projectRoot(T06 인테이크 결과) · 프로젝트 루트 기준 상대 경로 · source kind · (선택) media type. T05 경로 정책으로 접근을 검증                 |
| **출력**          | digest를 가진 SourceRef, 스냅샷 메타데이터, canonical 콘텐츠 파일, SourceRef가 추가된 Run → T08(brief) · T09~T11(figma) · T12(openapi) 인테이크 어댑터가 소비 |
| **선행 태스크**   | T06                                                                                                                                                           |
| **병렬 가능**     | 없음                                                                                                                                                          |
| **관련 스킬**     | -                                                                                                                                                             |
| **담당 에이전트** | -                                                                                                                                                             |

## 왜 필요한가

콘텐츠 어드레싱이 없으면:

- brief가 분석 이후에 변경될 수 있다.
- OpenAPI 문서가 코드 생성 이후에 드리프트할 수 있다.
- 스크린샷과 리포트가 자기 입력 버전을 증명할 수 없다.
- PR 리포트가 [Source](/reference/glossary#source) 출처(provenance)를 신뢰성 있게 인용할 수 없다.

## 동작 흐름

1. `register_file_source`가 Run의 projectRoot 내부 파일인지 검증한다 (`src/source-registry/path-scope.ts`).
2. 원본 바이트에서 `rawDigest`를 계산한다 (`src/source-registry/content-hash.ts`, SHA-256).
3. 텍스트류 파일이면 정규화(CRLF/CR → LF, Unicode NFC) 후 `canonicalDigest`를 계산한다 (`src/source-registry/canonical-content.ts`). 바이너리류는 rawDigest = canonicalDigest.
4. canonical 콘텐츠와 메타데이터를 다이제스트 기준 경로에 저장한다 (`src/source-registry/snapshot-store.ts`).
5. `SourceRef`(digest = canonicalDigest, rawDigest는 metadata에 보존)를 Run.sources에 추가한다. 동일 다이제스트 재등록은 멱등(idempotent)이다.
6. `get_source_snapshot`으로 스냅샷을 조회한다.

## 입력 상세

- Run ID — 대상 Run.
- 파일 경로 — projectRoot 기준 상대 경로. 루트 밖 경로는 거부.
- source kind — `brief` / `figma` / `openapi` / `repository` 등 (`src/runtime/source.ts`의 `SourceKindSchema`).
- (선택) media type — 텍스트/바이너리 판정과 이후 어댑터의 형식 감지에 사용.

## 출력 상세

콘텐츠 주소 저장소 레이아웃:

```text
source-snapshots/
└── sha256/
    └── aa/
        └── aaaaaaaa...aaaa/        # canonical digest (64 hex)
            ├── content             # canonical 콘텐츠
            └── metadata.json       # rawDigest, mediaType, 원본 경로 등
```

다이제스트 정책:

| 파일 종류  | rawDigest        | canonicalDigest                 |
| ---------- | ---------------- | ------------------------------- |
| 텍스트류   | 원본 바이트 기준 | LF 정규화 + Unicode NFC 후 계산 |
| 바이너리류 | 원본 바이트 기준 | rawDigest와 동일                |

- `SourceRef.digest`는 canonicalDigest를 사용한다.
- rawDigest는 `SourceRef.metadata`와 스냅샷 metadata에 보존된다.
- MCP 도구: `register_file_source`, `get_source_snapshot`.

## 완료 조건 (Definition of Done)

- [ ] 파일 Source를 Run에 등록할 수 있다.
- [ ] 등록 파일은 projectRoot 내부여야 한다.
- [ ] SourceRef digest가 안정적(stable)이다 — 줄바꿈/유니코드 표현이 달라도 canonical digest가 같다.
- [ ] 스냅샷 콘텐츠가 digest 기준으로 저장된다.
- [ ] 중복 Source 등록이 멱등이다.
- [ ] MCP 도구로 Source 등록과 스냅샷 조회가 가능하다.
- [ ] 기존 Run · Stage 테스트가 계속 통과한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

기대 결과: 콘텐츠 해시 · 정규화 · 경로 범위 · 스냅샷 스토어 · `SourceRegistryService` 테스트 통과. MCP stdio 통합 테스트가 `create_run` → `register_file_source` → `get_source_snapshot`을 호출한다.

## 알려진 한계

- URL Source는 아직 fetch하지 않는다.
- Figma Source는 아직 fetch하지 않는다 (T09~T10에서 별도 경로로 처리).
- 저장소 트리 스냅샷은 미구현이다.
- [Evidence](/reference/glossary#evidence) 추출은 미구현이다 (T08 이후 어댑터의 몫).
- 텍스트류 파일의 `SourceRef.digest`는 canonical digest이며, raw digest는 metadata에만 보존된다.
