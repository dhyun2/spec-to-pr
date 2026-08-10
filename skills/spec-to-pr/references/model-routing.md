# 모델 라우팅

core는 공급자 이름이 아니라 `fast`, `build`, `expert` 역할만 판단합니다. 한 Run에서 Codex와 Claude를 자동으로 섞지 않습니다.

| provider | fast  | build  | expert |
| -------- | ----- | ------ | ------ |
| Codex    | Luna  | Terra  | Sol    |
| Claude   | Haiku | Sonnet | Opus   |

기본값은 `adaptive-verified`입니다. 구현에는 `build`, 복잡한 설계·독립 기능 검토·디자인 검토에는 `expert`를 선택할 수 있습니다.

```yaml
modelRouting:
  mode: adaptive-verified # adaptive-verified | pinned | custom
  provider: codex # codex | claude
```

- `pinned`: 사용자가 “이 모델로 끝까지”를 지정하면 자동 승격하지 않고 그 모델로 구현과 별도 검토를 모두 수행합니다. 별도 검토는 같은 모델이어도 새 컨텍스트에서 독립적으로 합니다.
- `custom`: `fast`, `build`, `expert`별 모델을 직접 지정합니다. provider 밖의 모델을 섞을 수 없습니다.
- 상위 모델을 쓸 수 없으면 구현은 계속합니다. 독립 검토·화면 비교·테스트는 생략하지 않으며, 기대한 검토 품질을 확보하지 못한 사실을 Gap에 씁니다.
- 어떤 라우팅도 화면 비교, 테스트, 독립 검토, Gap 규칙을 약화하지 않습니다.
