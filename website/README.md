# SpecToPR 문서 사이트

Docusaurus 기반의 유지 문서입니다.

- 본문: `website/docs/`
- Sidebar: `website/sidebars.ts`
- Site/search/navigation 설정: `website/docusaurus.config.ts`
- 공용 가이드 UI: `website/src/components/guide/`
- 실제 visual comparison 예시: `website/static/img/guide/visual-proof/`
- 배포: `.github/workflows/deploy-docs.yml`

문서 표면은 소개, 사전 준비, 설치, 퀵스타트, 네 가지 mode chooser/상세 가이드, interactive Run pipeline, reviewer ownership, visual verification, skill/config reference, troubleshooting으로 제한합니다. 과거 task graph나 v1 microtool 문서는 사이트 source로 사용하지 않습니다. 설계 메모나 작업 계획 Markdown은 유지 문서 tree에 넣지 않습니다.

## 로컬 확인

```bash
pnpm install --frozen-lockfile
pnpm guide:assets
pnpm --dir website typecheck
pnpm --dir website build
pnpm --dir website serve
```

검색 index는 production build에서 생성됩니다. Broken link는 build를 실패시킵니다.

## 배포

`main` branch에서 `website/**` 또는 deploy workflow가 바뀌면 GitHub Pages workflow가 실행됩니다. Node 22에서 frozen install과 build를 수행하고 `website/build/`를 Pages artifact로 배포합니다. 수동 실행은 GitHub Actions의 `workflow_dispatch`를 사용합니다.

`pnpm deploy`는 이 저장소의 표준 절차가 아닙니다.
