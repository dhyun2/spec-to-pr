---
slug: /
sidebar_position: 1
title: SpecToPR Lite
hide_title: true
description: 네 가지 개발 요청을 구현하고 한국어 Draft PR로 정리하는 가벼운 스킬
---

import GuideHero from "@site/src/components/guide/GuideHero";
import ModeChooser from "@site/src/components/guide/ModeChooser";
import RunPipeline from "@site/src/components/guide/RunPipeline";
import NextStep from "@site/src/components/guide/NextStep";

<GuideHero
eyebrow="개발은 모델에게, PR에는 사실만"
title="SpecToPR Lite"
summary="기획서와 단일 기능은 OpenSpec 문서로 먼저 정리·대조하고, 선택하면 수용 시나리오 기반 TDD로 구현합니다. Figma·레거시는 각 기준으로 구현한 뒤 화면 일치율·사용 API·남은 Gap을 한국어 Draft PR로 정리합니다."
primary={{ label: "5분 퀵스타트", href: "/getting-started/quickstart" }}
secondary={{ label: "내 케이스 고르기", href: "/usage/" }}
/>

:::tip[무엇을 하지 않나요?]
작업 상태를 저장하거나 재개하지 않고, 모델 라우팅·별도 리뷰어·내장 발행 서버도 두지 않습니다. 중단되면 현재 `git diff`에서 다시 시작합니다. GitLab remote는 구현 전 읽기 전용 MR 사전 진단을 거치며, 실제 Draft MR 생성 성공을 마지막에 확인합니다.
:::

## 네 가지 케이스

케이스는 모델의 개발 과정을 통제하지 않습니다. **무엇을 참고해 구현할지**만 고릅니다.

`brief`와 `feature`는 각각 기획서 또는 기능 요청을 API 문서·Figma와 함께 OpenSpec 변경 문서로 정리하고 대조한 뒤 구현합니다. `test: on`이면 이 문서의 수용 시나리오를 테스트로 먼저 만들어 TDD를 합니다. `test: off` 또는 생략이면 단위·통합 테스트를 만들거나 실행하지 않습니다. Figma·레거시는 OpenSpec·TDD 모드를 적용하지 않습니다. 이는 구현 전 계약 정리이며, Run 저장이나 별도 리뷰 시스템이 아닙니다.

<ModeChooser locale="ko" />

## 한 번의 실행에서 하는 일

<RunPipeline />

## PR에 남기는 정보

- 실제로 개발한 사용자 기능
- 실제 추가·변경한 API의 method, path, 목적
- Figma 또는 레거시 기준 화면과 구현 화면의 일치율·Diff
- `feature`의 변경 기능 E2E와 사용자 흐름 영상 한 개
- 개발하지 못했거나 확인이 필요한 Gap과 다음 작업
- `brief`·`feature`의 test 모드와, `on`일 때 실행한 TDD 테스트 결과

화면 비교가 92%보다 낮으면 같은 기준으로 최대 세 번까지 수정·재캡처·재비교합니다. 세 번째도 미달하거나 자료가 없더라도 Draft PR은 만들고, 통과라고 쓰지 않은 채 Gap으로 남깁니다.

<NextStep
eyebrow="첫 번째 실행"
title="작은 기능 하나로 시작해 보세요"
description="입력 형식과 완성되는 Draft PR의 모습을 5분 안에 확인할 수 있습니다."
href="/getting-started/quickstart"
label="퀵스타트 열기"
secondary={{ label: "네 가지 케이스 비교", href: "/usage/" }}
/>
