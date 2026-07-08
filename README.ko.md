# spec-to-pr

증거 기반 spec-to-pr 자동화를 위한 Claude Code / Codex 플러그인 셸입니다.

## Codex

Codex 지원은 두 가지 표면(surface)을 제공합니다.

- `.codex-plugin/plugin.json` — 설치 가능한 Codex 플러그인을 노출합니다.
- `packages/codex-sdk` — CI 및 내부 자동화를 위한 프로그래매틱 Codex SDK 러너를 제공합니다.

로컬 마켓플레이스 등록과 SDK 러너 사용법은 `docs/codex/README.ko.md`(영문은 `docs/codex/README.md`)를 참고하세요.

End-to-end 실행은 blocker가 명확히 정리된 경우, 생성된 PR 리포트를 draft PR/MR로 발행합니다. 발행은 리뷰 요청 본문을 생성하거나 갱신할 뿐이며, merge·approve·close·ready-for-review 전환은 하지 않습니다.

시각 비교 PNG artifact가 존재하면, 발행 과정에서 이를 리뷰 호스트에 업로드하고 로컬라이즈된 시각 증거 미리보기 섹션을 주입해 리뷰어가 Figma·브라우저·diff 이미지를 PR/MR 본문에서 바로 볼 수 있게 합니다.

## 릴리즈 준비

Task 33은 로컬 릴리즈 준비 워크플로우를 추가합니다.

```bash
pnpm release:verify
```

이 워크플로우는 eval fixture, 보안 강화 점검, 결정론적 패키지 생성, 패키지 검증, checksum, 릴리즈 manifest, 릴리즈 노트 생성을 실행합니다.

npm 배포, GitHub Releases 업로드, 마켓플레이스 제출, 외부 배포는 수행하지 않습니다.

## 릴리즈 발행

먼저 dry-run으로 정확한 명령 계획을 확인하세요.

```bash
pnpm release:publish:dry-run
```

계획이 올바르면 현재 패키지 버전을 발행합니다.

```bash
pnpm release:publish
```

발행 스크립트는 `pnpm check`, `pnpm plugin:validate`, `pnpm release:build <version> --dry-run`을 실행하고, `main`을 push하고, Claude 플러그인 태그를 생성·push한 뒤, 로컬 Claude·Codex 마켓플레이스 설치를 갱신합니다. 다운스트림 PR/MR을 merge하지는 않습니다.
