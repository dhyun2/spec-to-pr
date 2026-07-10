---
sidebar_position: 9
title: 트러블슈팅
---

# 트러블슈팅

자주 겪는 문제와 해결 순서입니다. 어떤 문제든 첫 진단은 `/spec-to-pr:doctor`입니다.

## 설치·기동

### "MCP server failed to start" / kernel이 안 뜬다

1. `node --version` — **22 미만이면** kernel이 즉시 종료됩니다. `nvm install 22` 후 호스트 재시작.
2. 로컬 설치라면 빌드 산출물 확인: `pnpm build` 후 `dist/mcp/server.js` 존재 확인.
3. `/spec-to-pr:doctor`로 어느 단계(인식/기동/tool 호출)에서 끊기는지 확인.

### 스킬이 목록에 안 보인다

- Claude Code: `/plugin install spec-to-pr@spec-to-pr`까지 했는지 확인 (marketplace add만으로는 설치 안 됨).
- Codex: 설치 후 **재시작 필수**. `/plugins`에서 SpecToPR 마켓플레이스 확인.

## Figma

### "Figma URL parse failed" 또는 디자인 컨텍스트가 비어 있다

- URL 형식 확인: `https://www.figma.com/file/{fileId}/...?node-id={nodeId}` — 브라우저 주소창에서 그대로 복사하세요.
- `/spec-to-pr:figma-doctor`로 provider가 잡혀 있는지, 어떤 capability가 가능한지 확인.
- Figma MCP 서버가 호스트에 연결 안 된 상태가 가장 흔한 원인입니다.

### 특정 프레임만 분석하고 싶은데 파일 전체가 잡힌다

URL에 `?node-id=`가 빠진 경우입니다. Figma에서 해당 프레임을 선택한 상태로 URL을 복사하세요.

## 발행

### "GitHub publish rejected" / 발행이 조용히 건너뛰어졌다

토큰 해석 순서대로 점검: `GITHUB_TOKEN` → `GH_TOKEN` → `gh auth token`. 셋 다 없으면 publisher는 gap을 남기고 건너뜁니다.

```bash
gh auth status        # 로그인·스코프 확인
```

- 토큰 스코프: GitHub `repo`, GitLab `api` 필요.
- 셀프호스트라면 `SPEC_TO_PR_GIT_HOST` 등 [환경변수](/reference/config) 설정 확인.

### PR이 생성 안 됐는데 리포트는 blocked라고 한다

정상 동작입니다 — 스코어카드가 `blocked`이면 **의도적으로 발행하지 않습니다.** 리포트의 `nextRepairTarget`과 gap 목록을 보고 원인을 해소한 뒤 재실행하세요.

## 점수·루프

### "visual score 0.94인데 왜 통과가 안 되나요?"

기본 임계값이 **0.98**로 꽤 엄격합니다 (픽셀 수준 비교). 선택지:

1. repair loop가 3회 안에 못 올렸다면 diff 이미지를 직접 확인 — 폰트 렌더링·애니메이션 타이밍 같은 노이즈일 수 있습니다.
2. 의도된 디자인 차이라면 임계값을 낮추세요: "visual 최소 점수 0.95로 해줘".
3. 특정 컴포넌트만 문제라면 해당 component contract의 임계값만 조정할 수도 있습니다.

### 같은 스테이지에서 계속 실패한다

- 스테이지 재시도는 기본 3회 후 멈춥니다. 실패 로그의 마지막 에러를 보고 원인(누락 토큰, 테스트 실패 등)을 해소한 뒤 재실행하면 그 스테이지부터 재개됩니다.
- "5분째 아무 진행이 없다" — 죽은 워커의 lease가 만료되기를 기다리는 중일 수 있습니다(TTL 5분). 만료 후 자동으로 인수됩니다.

## 마이그레이션

### 레거시 기능이 인벤토리에 안 잡힌다

인벤토리는 15개 카테고리의 **정적 시그널 스캔**입니다. 도메인 특화 패턴은 프롬프트에 명시하세요: "XX 유틸 호출도 기능으로 취급해줘". 런타임에서만 드러나는 동작은 잡히지 않으므로 제약으로 적어주는 것이 안전합니다.

### legacy-coverage blocker가 계속 남는다

Coverage Matrix의 빈 칸(기능 ↔ 시나리오/테스트 미연결)이 원인입니다. PR 리포트의 coverage 섹션에서 어느 기능이 비었는지 확인하고, 해당 기능을 스코프에서 제외할 거라면 waive 사유를 명시해 gap을 `waived`로 처리하세요.

## 데이터·상태

### Run을 처음부터 다시 돌리고 싶다

같은 요청을 보내면 기본적으로 **재개**됩니다. 완전히 새로 시작하려면 "새 run으로 처음부터 다시 시작해줘"라고 명시하세요.

### 디스크가 부풀었다

- `SPEC_TO_PR_DATA_DIR`의 오래된 Run 데이터와 `<프로젝트>/.spec-to-pr/worktrees/` 정리: `git worktree prune`.
- `.spec-to-pr/`는 `.gitignore`에 추가 권장.

---

여기 없는 문제는 [GitHub Issues](https://github.com/dhyun2/spec-to-pr/issues)로 — `/spec-to-pr:doctor` 출력을 함께 첨부하면 빠릅니다.
