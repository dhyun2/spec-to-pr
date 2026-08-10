---
sidebar_position: 1
title: 스킬 구조
---

플러그인은 `spec-to-pr` 스킬 하나만 제공합니다.

```text
skills/spec-to-pr/
├── SKILL.md                 # 네 케이스와 공통 규칙
├── references/cases.md      # 케이스별 참고 기준
├── references/openspec.md   # brief·feature OpenSpec·TDD 규칙
├── assets/pr-template.md    # 한국어 Draft PR 형식
└── scripts/
    ├── compare-images.cjs   # PNG 비교와 Diff 생성
    └── check-gitlab-mr.cjs  # GitLab Draft MR 읽기 전용 사전 진단
```

스킬은 모델에게 구현 순서와 PR 작성 규칙을 알려줍니다. 자체 서버, 데이터베이스, 실행 ID, 작업 재개 기능은 포함하지 않습니다.

`brief`와 `feature`에만 OpenSpec 문서 준비·대조 규칙이 적용됩니다. 두 케이스의 `test: on`은 OpenSpec 수용 시나리오 기반 TDD이고, 생략하거나 `test: off`이면 TDD 테스트를 만들거나 실행하지 않습니다. Figma와 레거시는 OpenSpec·TDD 모드를 쓰지 않습니다. 자료가 넓거나 충돌할 때는 호스트가 지원하는 읽기 전용 서브에이전트로 대조를 보조할 수 있지만, 필수 역할이나 고정된 모델 라우팅은 아닙니다.

## 이미지 비교 도구

`compare-images.cjs`는 같은 크기의 PNG 두 장을 비교합니다.

```bash
node /absolute/path/to/compare-images.cjs \
  --baseline baseline.png \
  --actual actual.png \
  --diff diff.png
```

출력 JSON의 `matchPercent`와 `status`를 PR에 사용합니다. 이미지 크기가 다르면 오류를 내고 점수를 만들지 않습니다.

## GitLab MR 사전 진단 도구

`check-gitlab-mr.cjs`는 GitLab remote에서만 구현 전에 실행합니다. Git remote, `glab` 설치·인증, 프로젝트·MR API GET 접근, 가능한 경우 Developer 이상 권한을 차례로 확인합니다. `ready-to-attempt`는 실제 생성 전의 준비 상태일 뿐 생성 성공을 보장하지 않습니다. [설정과 실패 해결](../getting-started/gitlab)을 참고하세요.
