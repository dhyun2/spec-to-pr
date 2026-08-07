---
sidebar_position: 3
title: 빠른 시작 — 첫 PR 초안까지
hide_title: true
---

import GuideHero from "@site/src/components/guide/GuideHero";
import RunPipeline from "@site/src/components/guide/RunPipeline";
import NextStep from "@site/src/components/guide/NextStep";

<GuideHero
eyebrow="검증 자료를 갖춘 첫 PR 초안"
title="빠른 시작 — 첫 PR 초안까지"
summary="설치를 확인하고 요건을 갖춘 요청 하나를 복사한 뒤, 무엇을 검증하고 PR 초안에 담는지 5분 안에 살펴봅니다."
primary={{ label: "완전한 사용법 보기", href: "/usage/brief" }}
secondary={{ label: "내 케이스 먼저 고르기", href: "/usage/" }}
/>

## 1. 설치 확인

```text
/spec-to-pr:doctor
```

결과에는 계약 `2.0.0`, 도구 7개, 단계 8개, 독립 검토자 2개가 보여야 합니다.

## 2. 요청

대상 저장소 안에 기획서를 둡니다.

```text
my-app/
├── docs/checkout.md
├── docs/openapi.yaml
├── package.json
└── src/...
```

Claude Code/Codex에 다음처럼 요청합니다.

```text
/spec-to-pr /absolute/path/to/my-app
mode는 brief이고 briefPath는 docs/checkout.md야.
figmaUrl: https://www.figma.com/design/FILE/checkout?node-id=12-345
openApiPaths: [docs/openapi.yaml]
API/UI를 구현하고 Figma 일치율, API 누락, Web Vitals까지 검증한 뒤 초안 PR을 만들어줘.
```

## 3. 진행 흐름

<RunPipeline locale="ko" mode="brief" />

호스트는 `workflow_advance`로 다음 외부 작업까지 이동하고 실제 산출물은 `workflow_submit`으로 제출합니다. 상태 전이와 재개 정보는 실행 환경이 관리합니다.

요청을 접수한 직후 `workflow_status`에서 `XS`~`XL`, 예상 토큰 범위와 신뢰도를 확인할 수 있습니다. SDK 실행 도구는 작업 묶음마다 사용량을 집계하고 상한의 80%에서 맥락을 압축한 새 작업으로 이어갑니다. 상한에 도달하면 필수 검증을 생략하지 않고 `split-required` 상태로 멈춥니다.

API 작업이 포함됐다면 같은 구현 맥락에서 다음 순서를 지킵니다.

1. 타입·스키마·클라이언트 또는 래퍼 작성
2. 모의 응답과 계약 테스트 검증 자료 생성
3. 경로 별칭이나 심볼릭 링크·하드 링크가 아닌, 물리적으로 서로 다른 비어 있지 않은 파일과 통과한 계약 테스트 JSON, `implementationContextId`를 담은 `kind: api-ready` 제출
4. UI 구현과 UI 검증 자료

API 담당 에이전트와 UI 담당 에이전트를 따로 두지 않습니다.

초안 발행을 요청했다면 구현 전에 대상 브랜치가 아닌 `codex/*` 소스 브랜치를 사용합니다. 발행 전에는 의도한 파일만 커밋하고 작업 트리를 깨끗하게 만든 뒤, 소스 브랜치가 대상 브랜치보다 커밋 하나 이상 앞섰는지 확인합니다.

## 4. 검토와 결과

코드 변경은 독립 `functional-reviewer`가 계약, 변경 내역, 관련 테스트, 필수 검증을 검토합니다. UI 변경이면 독립 `design-reviewer`가 시각적 일치도, 상호작용, 디자인 시스템 사용, 접근성을 별도로 검토합니다. 오케스트레이터가 먼저 `workflow_status` 상태와 계약·변경 내역·검증 자료 경로를 고정해 전달하고, 검토자는 워크플로 도구를 직접 호출하지 않고 판정 결과만 반환합니다.

필수 검증 자료가 승인되면 보고서를 만들고 초안 PR/MR을 생성하거나 갱신합니다. 병합·승인·검토 준비 상태 전환은 사람이 합니다.

## 다른 모드로 시작하기

- 레거시 이관: `mode: legacy`와 구체적인 변경 요청
- 사용자 기능: `mode: feature`, 변경 기능 E2E 하나와 영상 정확히 하나
- Figma 구현: `mode: figma`, `figmaUrl`, 호스트에 연결된 Figma 기능

복사 가능한 예시와 예상 PR은 [기획서 → 초안 PR 사용법](/usage/brief)에서 시작해 케이스별 페이지에서 확인할 수 있습니다.

<NextStep
eyebrow="이제 실제 입력으로"
title="기획서로 만든 전체 PR 예시를 확인하세요"
description="필수·선택 입력, Gap 처리, 시각·API·성능 검증 자료, 리뷰어 우선 PR 본문을 이어서 볼 수 있습니다."
href="/usage/brief"
label="기획서 사용법 열기"
secondary={{ label: "네 가지 케이스 비교", href: "/usage/" }}
/>
