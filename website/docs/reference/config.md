---
sidebar_position: 2
title: 입력 형식
---

SpecToPR 요청은 복잡한 설정 파일 대신 다음 필드로 시작합니다.

```yaml
case: brief | feature | figma | legacy
projectRoot: /absolute/path/to/project
request: 구현할 사용자 기능
source: 선택한 케이스의 자료
targetBranch: main
test: on | off
```

## 필드 설명

| 필드           | 필수          | 설명                                         |
| -------------- | ------------- | -------------------------------------------- |
| `case`         | 예            | 네 가지 케이스 중 하나                       |
| `projectRoot`  | 예            | 수정할 대상 프로젝트의 절대 경로             |
| `request`      | 예            | 구현할 사용자 기능과 기대 동작               |
| `source`       | 케이스에 따라 | 기획서 경로, Figma URL, 레거시 프로젝트 경로 |
| `targetBranch` | 아니요        | PR 대상 브랜치, 없으면 기본 브랜치           |
| `test`         | brief·feature | `on`이면 OpenSpec 기반 TDD, `off`면 미실행   |

`brief`에는 `briefPath`, `figma`에는 `figmaUrl`, `legacy`에는 `legacyProjectRoot`처럼 명확한 이름을 사용해도 됩니다. 중요한 것은 케이스에 맞는 자료가 분명하게 전달되는 것입니다. `test`는 `brief`와 `feature`에서만 사용하며, 생략하면 `off`입니다. Figma·레거시에는 OpenSpec·TDD 모드를 적용하지 않습니다.

`brief`에는 아래처럼 보조 자료를 함께 줄 수 있습니다.

```yaml
briefPath: docs/payment-method.md
apiDocsPaths:
  - docs/payment-api.yaml
figmaUrl: https://www.figma.com/design/FILE/payment
test: on
```

`brief`와 `feature`는 이 자료 또는 기능 요청을 바탕으로 대상 프로젝트의 `openspec/changes/<변경명>/` 문서를 만들거나 갱신하고, 구현 전에 자료와 문서를 대조합니다. `test: on`이면 확정된 수용 시나리오를 테스트로 먼저 만들어 TDD로 구현합니다.
