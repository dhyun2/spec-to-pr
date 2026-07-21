---
slug: /
sidebar_position: 1
title: SpecToPR
hide_title: true
description: 기획서, 레거시, 기능, Figma를 검증된 draft PR로 연결하는 가장 짧은 시작점
---

import GuideHero from "@site/src/components/guide/GuideHero";
import ModeChooser from "@site/src/components/guide/ModeChooser";
import RunPipeline from "@site/src/components/guide/RunPipeline";
import NextStep from "@site/src/components/guide/NextStep";

<GuideHero
eyebrow="Specification to evidence-backed PR"
title="SpecToPR"
summary="기획서·레거시·기능·Figma 중 출발점만 고르면, 구현과 독립 리뷰를 거쳐 근거가 연결된 draft PR까지 이어집니다."
primary={{ label: "5분 퀵스타트", href: "/getting-started/quickstart" }}
secondary={{ label: "내 케이스 고르기", href: "/usage/" }}
/>

:::info[지금 읽고 있는 버전]
이 사이트는 SpecToPR `0.3.0`의 릴리스 동작을 설명합니다. 공개 표면은 7 MCP tools, 8 durable stages, skill 8개, 독립 reviewer 2개로 유지합니다.
:::

## 입력을 고르면 나머지는 같은 Run입니다

네 가지 케이스는 서로 다른 파이프라인이 아닙니다. 입력과 필요한 증거만 달라지고, 계약 → 구현 → 기능·디자인 검증 → draft 발행이라는 한 흐름을 공유합니다.

<ModeChooser locale="ko" />

## 한 변경이 PR이 되기까지

아래 stage를 눌러 각 단계가 무엇을 받고 무엇을 남기는지 확인해 보세요. API와 UI는 한 명의 implementation writer가 같은 `implementationContextId`에서 구현합니다. 구현이 끝난 뒤에만 read-only functional reviewer와 UI 범위의 design reviewer가 immutable packet을 독립적으로 읽습니다.

<RunPipeline locale="ko" />

## 결과물은 “완료”보다 근거가 먼저입니다

- 기획서·Figma·OpenAPI는 `sourceProvenance`와 계약으로 고정됩니다.
- Figma 또는 실행한 레거시 화면은 같은 route·state·viewport·fixture로 캡처해 `compare-visuals`가 직접 비교합니다.
- 정상과 blocked 결과 모두 15개 섹션의 `pr-report-v2.1`을 사용하므로, 멈춘 경우에도 완료된 일·미실행 검증·정확한 재개 방법이 남습니다.
- SpecToPR은 draft만 만들거나 갱신합니다. approve, ready 전환, merge는 사람이 결정합니다.

<NextStep
eyebrow="첫 번째 Run"
title="작은 예제로 전체 흐름을 먼저 보세요"
description="설치 확인부터 복사할 프롬프트, 예상 draft PR까지 약 5분 분량으로 정리했습니다."
href="/getting-started/quickstart"
label="퀵스타트 열기"
secondary={{ label: "네 가지 케이스 비교", href: "/usage/" }}
/>
