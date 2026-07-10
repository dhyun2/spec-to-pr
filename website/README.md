# SpecToPR 문서 사이트

Docusaurus 기반 문서 사이트입니다.

- 가이드 본문: `website/docs/` (소개·시작하기·사용법·개념·레퍼런스·트러블슈팅)
- 태스크 문서(T01~T33): 저장소 루트의 `docs/tasks/`를 그대로 소스로 사용 (`/tasks` 라우트)
  - 새 태스크 문서는 `docs/tasks/_TEMPLATE.md` 템플릿을 따라 작성
  - `.md`는 CommonMark로 처리되므로 `<runId>`·`{...}` 표기를 그대로 쓸 수 있음 (JSX가 필요하면 `.mdx`)

## 명령어

```bash
pnpm install        # 의존성 설치
pnpm start          # 개발 서버 (검색은 프로덕션 빌드에서만 동작)
pnpm build          # 프로덕션 빌드 → build/
pnpm serve          # 빌드 결과물 로컬 서빙
```

## 배포

배포의 기준은 [`.github/workflows/deploy-docs.yml`](../.github/workflows/deploy-docs.yml)입니다.

- `main` 브랜치에 `website/**`, `docs/tasks/**`, 또는 해당 workflow 파일의 변경이 push되면 실행됩니다.
- workflow는 Node 22에서 `pnpm install --frozen-lockfile`, `pnpm build`를 실행한 뒤 `website/build/`를 GitHub Pages artifact로 올리고 배포합니다.
- 수동 실행이 필요하면 GitHub Actions의 `workflow_dispatch`를 사용합니다.

로컬에서 배포 전 결과를 확인할 때만 다음을 사용하세요.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm serve
```

`pnpm deploy`는 이 저장소의 표준 배포 절차가 아닙니다. Pages URL·권한·artifact 흐름을 CI와 다르게 만들 수 있으므로 사용하지 않습니다.
