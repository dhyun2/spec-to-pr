---
sidebar_position: 1
title: 사전 준비물
---

# 사전 준비물

## 항상 필요

| 항목        | 요구사항               | 확인                                   |
| ----------- | ---------------------- | -------------------------------------- |
| Node.js     | `>=22`                 | `node --version`                       |
| Git 저장소  | 구현 대상 저장소       | `git -C <repo> status`                 |
| 실행 호스트 | Claude Code 또는 Codex | `claude --version` / `codex --version` |

소스에서 플러그인을 빌드할 때만 `pnpm`과 Corepack이 필요합니다.

## 기능별 준비

| 기능             | 준비                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| GitHub draft PR  | `GITHUB_TOKEN`, `GH_TOKEN`, 또는 로그인된 `gh`                           |
| GitLab draft MR  | `GITLAB_TOKEN`, `GITLAB_PRIVATE_TOKEN`, 또는 로그인된 `glab`             |
| Figma 모드       | 호스트에서 사용할 수 있는 Figma 연결과 파일 열람 권한                    |
| 사용자 기능 영상 | 변경 기능만 선택하고 영상 녹화를 지원하는 Playwright 등 browser E2E 환경 |

## Figma 연결 원칙

SpecToPR은 자체 Figma provider를 실행하거나 polling하지 않습니다. Claude Code/Codex에 이미 연결된 Figma 기능을 사용합니다. 연결 방법은 사용 중인 호스트와 Figma provider 문서를 따르세요.

실행 시에는 다음 순서를 지킵니다.

1. 호스트 기능으로 URL의 실제 node/frame context를 읽습니다.
2. 가능한 screenshot, variable, asset, component context를 프로젝트 안의 evidence 파일로 저장합니다.
3. `provider: host-connected-figma`, ISO `capturedAt`, profile과 같은 `fileUrl`, 비어 있지 않은 `nodeIds`, JSON `manifestPath`를 기록합니다.
4. Strict manifest에 같은 출처 값과 PNG `visualPaths`를 기록하고, manifest와 실제 PNG 한 개 이상을 `artifactPaths`에 포함해 typed `figma-bundle`을 정확히 한 번 제출합니다.
5. 같은 Run에 bundle을 반복 제출하지 않습니다.
6. URL만 읽었다는 주장으로 계약 단계를 통과시키지 않습니다.

특정 frame만 구현하려면 그 frame을 선택한 상태에서 복사한 `node-id` 포함 URL을 사용하세요.

## Feature 영상 원칙

영상은 user-facing `feature` 모드에만 필요합니다.

- 테스트 path/tag/project로 변경된 기능만 선택
- selector를 실제 인자로 쓰는 단일 unchained Playwright command 기록
- `status: passed`, 정확한 selector, 같은 `implementationContextId`, 양수 `testCount`만 담은 strict project-local JSON 결과 기록
- 재생 시간이 0보다 큰 구조적으로 유효한 WebM/MP4 컨테이너 정확히 한 개, 최대 25 MB

전체 프로젝트 E2E를 기본으로 실행하거나 여러 영상을 PR에 올리는 방식은 지원 정책이 아닙니다.

준비가 끝났다면 [설치](/getting-started/installation)로 이동하세요.
