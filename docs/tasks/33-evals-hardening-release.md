---
sidebar_position: 33
title: "T33 · Evals·하드닝·릴리스"
sidebar_label: "T33 릴리스"
---

# T33 · Evals·하드닝·릴리스

> **한 줄 요약** — spec-to-pr 플러그인을 평가(Eval)·보안 하드닝·패키징하여 검증 가능한 릴리스 후보를 준비한다.

| 항목              | 내용                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| **목적**          | 플러그인은 "구현됨"이 아니라 "릴리스 준비됨"이어야 한다 — eval·하드닝·결정론적 패키지·체크섬으로 증명한다 |
| **입력**          | 전체 파이프라인 구현(T01~T32), eval fixture, 악성 입력 테스트, 릴리스 버전                                |
| **출력**          | eval 리포트, 보안 하드닝 리포트, 릴리스 패키지·manifest·SHA-256 체크섬·릴리스 노트 — 배포 담당자가 소비   |
| **선행 태스크**   | T32 (실질적으로 T01~T32 전체)                                                                             |
| **병렬 가능**     | 없음                                                                                                      |
| **관련 스킬**     | `/spec-to-pr:prepare-release` (`disable-model-invocation: true`)                                          |
| **담당 에이전트** | `agents/release-reviewer.md`, `agents/eval-reviewer.md`, `agents/security-hardening-reviewer.md`          |

## 왜 필요한가

릴리스 준비 상태(release readiness)는 다음을 요구한다:

- eval fixture
- 악성 입력 테스트
- 보안 하드닝 리포트
- 결정론적 릴리스 패키지
- SHA-256 체크섬
- 릴리스 manifest·릴리스 노트
- 플러그인 검증 (plugin validate)
- verified / implemented / scaffolded / planned 기능 상태 구분

이 단계가 없으면 임의 파일이 패키지에 섞이고, 기능 상태 주장에 증거가 없으며, 배포물 무결성을 검증할 수 없다.

## 동작 흐름

1. `list_eval_suites` / `run_eval_suite` — 기본 eval 스위트를 실행한다. 실패는 blocker [Gap](/reference/glossary#gap)으로 기록된다.
2. `run_security_hardening_suite` — 악성 입력·하드닝 테스트를 실행하고 리포트를 남긴다.
3. `build_release_package` — **allowlist 기반** 릴리스 패키지를 빌드한다.
4. `verify_release_package` — 패키지 내용과 SHA-256 체크섬을 검증한다.
5. `generate_release_notes` — 릴리스 노트와 manifest를 생성한다.
6. 릴리스 리뷰어 에이전트가 릴리스 [ArtifactRef](/reference/glossary#artifactref)들을 검토한다.

## 입력 상세

- **eval fixture** — 파이프라인 단계별 평가 시나리오.
- **악성 입력 테스트** — 보안 하드닝 스위트 입력.
- **릴리스 버전** — 예: `pnpm release:build 0.1.0`.

## 출력 상세

릴리스 패키지는 allowlist 기반이며 다음만 포함한다:

- `.claude-plugin/plugin.json`
- `.mcp.json`
- `dist/mcp/server.js`
- `package.json`
- `README.md` (있을 때), `LICENSE` (있을 때)
- `skills/**`, `agents/**`, `schemas/runtime/**`

다음은 제외한다:

- `node_modules/`, `.git/`, `__MACOSX/`
- `.env` 파일
- SQLite·DB 파일
- coverage 출력, 임시 출력, 런타임 아티팩트

추가 산출물: eval 스위트 리포트, 보안 하드닝 리포트, SHA-256 체크섬, 릴리스 manifest, 릴리스 노트.

## 완료 조건 (Definition of Done)

- [ ] 기본 eval 스위트가 통과하거나 blocker를 기록한다.
- [ ] 보안 하드닝 스위트가 통과하거나 blocker를 기록한다.
- [ ] 릴리스 패키지가 허용된 파일만 포함한다.
- [ ] 릴리스 패키지가 `node_modules`, `.git`, `__MACOSX`, env 파일, DB 파일을 제외한다.
- [ ] SHA-256 체크섬이 생성된다.
- [ ] 릴리스 manifest가 생성된다.
- [ ] 릴리스 노트가 생성된다.
- [ ] 릴리스 리뷰어 에이전트가 릴리스 아티팩트를 검토할 수 있다.
- [ ] MCP stdio가 릴리스 준비 툴(`list_eval_suites`, `run_eval_suite`, `run_security_hardening_suite`, `build_release_package`, `verify_release_package`, `generate_release_notes`)을 노출한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
pnpm release:build 0.1.0 --dry-run
claude plugin validate . --strict
```

`claude` CLI를 사용할 수 없으면 다음을 기록한다:

```text
SKIPPED: claude CLI not available
```

릴리스 체크리스트:

- [ ] node_modules / .git / __MACOSX / env 파일 / sqlite·db 파일 제외
- [ ] dist/mcp/server.js, .claude-plugin/plugin.json, .mcp.json 포함
- [ ] skills / agents / runtime schemas / package.json 포함
- [ ] 릴리스 manifest·SHA-256 체크섬 생성
- [ ] eval 스위트 리포트·보안 하드닝 리포트·릴리스 노트 생성
- [ ] plugin validate 통과 또는 사유와 함께 skip

## 알려진 한계

- T33은 릴리스 후보를 준비할 뿐이다. npm publish, GitHub Release 업로드, 마켓플레이스 제출, 프로덕션 배포, 고객 롤아웃은 수행하지 않는다.
- 외부 자격 증명(credential)을 사용하지 않는다.
