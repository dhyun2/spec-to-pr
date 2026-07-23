---
slug: /
sidebar_position: 1
title: SpecToPR
hide_title: true
description: 기획서, 레거시, 기능, Figma를 검증 자료가 담긴 초안 PR로 연결하는 가장 짧은 시작점
---

import GuideHero from "@site/src/components/guide/GuideHero";
import ModeChooser from "@site/src/components/guide/ModeChooser";
import RunPipeline from "@site/src/components/guide/RunPipeline";
import NextStep from "@site/src/components/guide/NextStep";

<GuideHero
eyebrow="요구사항부터 검증 자료가 담긴 PR까지"
title="SpecToPR"
summary="기획서·레거시·기능·Figma 중 출발점만 고르면, 구현과 독립 검토를 거쳐 근거가 연결된 초안 PR까지 이어집니다."
primary={{ label: "5분 퀵스타트", href: "/getting-started/quickstart" }}
secondary={{ label: "내 케이스 고르기", href: "/usage/" }}
/>

:::info[지금 읽고 있는 버전]
이 사이트는 현재 배포된 SpecToPR의 동작을 설명합니다. 공개 인터페이스는 MCP 도구 7개, 실행 상태를 보존하는 단계 8개, 스킬 8개, 독립 검토자 2명으로 구성됩니다.
:::

## 입력을 고르면 하나의 실행으로 이어집니다

네 가지 사용법은 서로 다른 작업 흐름이 아닙니다. 입력 자료와 필요한 검증만 달라질 뿐, 계약 → 구현 → 기능·디자인 검토 → 초안 발행이라는 한 흐름을 공유합니다.

<ModeChooser locale="ko" />

## 한 변경이 PR이 되기까지

아래 단계를 눌러 무엇을 받고 무엇을 남기는지 확인해 보세요. API와 UI는 한 명의 구현 담당자가 같은 `implementationContextId`에서 함께 구현합니다. 구현이 끝나면 읽기 전용 `functional-reviewer`와, UI 작업일 때만 참여하는 `design-reviewer`가 같은 변경 불가 검토 묶음을 독립적으로 확인합니다.

<RunPipeline locale="ko" />

## 결과물은 “완료”보다 근거가 먼저입니다

- 기획서·Figma·OpenAPI는 출처가 확인된 자료와 계약으로 고정됩니다.
- Figma 또는 실행한 레거시 화면은 같은 경로·상태·화면 크기·테스트 데이터로 캡처해 `compare-visuals`가 직접 비교합니다.
- 정상 결과와 차단된 결과 모두 15개 섹션의 `pr-report-v2.1`을 사용합니다. 중간에 멈춰도 완료한 일, 실행하지 못한 검증, 정확한 재개 방법이 남습니다.
- SpecToPR은 초안만 만들거나 갱신합니다. 승인, 검토 준비 전환, 병합은 사람이 결정합니다.

<NextStep
eyebrow="첫 번째 실행"
title="작은 예제로 전체 흐름을 먼저 보세요"
description="설치 확인부터 복사할 프롬프트, 예상 초안 PR까지 약 5분 분량으로 정리했습니다."
href="/getting-started/quickstart"
label="퀵스타트 열기"
secondary={{ label: "네 가지 케이스 비교", href: "/usage/" }}
/>
