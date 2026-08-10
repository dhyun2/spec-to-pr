---
sidebar_position: 1
title: 스킬 구조
---

플러그인은 `spec-to-pr` 스킬 하나만 제공합니다.

```text
skills/spec-to-pr/
├── SKILL.md                 # 네 케이스와 공통 규칙
├── references/cases.md      # 케이스별 참고 기준
├── references/model-routing.md # provider-neutral 역할과 model routing 규칙
├── references/openspec.md   # brief·feature OpenSpec·TDD 규칙
├── assets/pr-templates/     # 네 가지 case 전용 Draft PR 형식
└── scripts/
    ├── compare-images.cjs   # PNG 비교와 Diff 생성
    ├── legacy-visual-evidence.cjs # legacy route/state coverage와 PR 이미지 링크
    ├── legacy-source-inventory.cjs # legacy route·asset·CSS·runtime source inventory
    └── check-gitlab-mr.cjs  # GitLab Draft MR 읽기 전용 사전 진단
```

스킬은 모델에게 구현 순서와 PR 작성 규칙을 알려줍니다. 자체 서버, 데이터베이스, 실행 ID, 작업 재개 기능은 포함하지 않습니다.

OpenSpec은 사용자 입력 전제 조건이 아니며 core 구현을 막지 않습니다. `brief`와 `feature`의 `test: on`은 확정 수용 시나리오 기반 TDD이고, 생략하거나 `test: off`이면 TDD 테스트를 만들거나 실행하지 않습니다. Figma와 레거시는 OpenSpec·TDD 모드를 쓰지 않습니다. 모델 라우팅은 Codex/Claude 중립적인 fast/build/expert 역할로 판단하며, 한 Run에서 두 provider를 자동으로 섞지 않습니다.

## 이미지 비교 도구

`compare-images.cjs`는 같은 크기의 PNG 두 장을 비교합니다.

```bash
node /absolute/path/to/compare-images.cjs \
  --baseline baseline.png \
  --actual actual.png \
  --diff diff.png
```

출력 JSON의 `matchPercent`와 `status`를 PR에 사용합니다. 이미지 크기가 다르면 오류를 내고 점수를 만들지 않습니다.

`legacy-source-inventory.cjs`는 지정한 레거시 source path에서 route, asset URL, CSS selector·breakpoint, 지도/Swiper/native bridge 표식을 추출합니다. `legacy-visual-evidence.cjs`는 이 inventory의 모든 항목이 대상 asset·CSS·runtime code로 매핑됐는지와 모든 사용자 노출 route/state가 비교 또는 명시적 제외인지 검증합니다. 기준·이관·Diff 이미지가 Git index에 있는지도 확인하고, PR에 경로·상태별 좌우 이미지와 Diff 링크를 만듭니다. legacy 캡처는 Computer Use 우선이며, Browser/Playwright fallback은 provider·인증 상태·사유를 한 번 공개하되 같은 조건의 증빙을 확보했다면 Gap으로 만들지 않습니다. 보존 이관에서 `@frontend/ui`, Unicode glyph/emoji, mock/placeholder 대체가 발견되면 `NOT VERIFIED` Gap으로 표시합니다.

## GitLab MR 사전 진단 도구

`check-gitlab-mr.cjs`는 GitLab remote에서만 구현 전에 실행합니다. Git remote, `glab` 설치·인증, 프로젝트·MR API GET 접근, 가능한 경우 Developer 이상 권한을 차례로 확인합니다. `ready-to-attempt`는 실제 생성 전의 준비 상태일 뿐 생성 성공을 보장하지 않습니다. [설정과 실패 해결](../getting-started/gitlab)을 참고하세요.
