---
sidebar_position: 2
title: GitLab MR 사전 진단
description: 코드 변경 전 GitLab Draft Merge Request 준비 상태를 읽기 전용으로 확인합니다.
---

GitLab remote를 쓰면 SpecToPR는 구현 전에 Draft Merge Request(MR)를 만들 수 있을지 **읽기 전용**으로 진단합니다. 권한 문제를 구현·검증이 끝난 뒤 발견하지 않도록 하기 위한 단계입니다.

## 진단 범위

아래 순서로 확인합니다. 모든 GitLab API 요청은 `GET`이며, 브랜치·커밋·MR을 만들거나 수정하지 않습니다.

1. `origin` remote에서 GitLab 호스트와 프로젝트 경로를 읽습니다.
2. `glab` CLI가 설치되어 있는지 확인합니다.
3. 해당 GitLab 호스트의 `glab` 인증 상태를 확인합니다.
4. 인증된 API로 프로젝트를 읽고 MR 기능이 켜져 있는지 확인합니다.
5. GitLab이 역할 값을 보내면 Developer(30) 이상인지 확인합니다.
6. 인증된 API로 열린 MR 목록을 읽습니다.

```bash
node /absolute/path/to/check-gitlab-mr.cjs \
  --project-root /absolute/path/to/project \
  --remote origin
```

`status`가 `ready-to-attempt`이면 실제 Draft MR 생성을 시도할 준비가 됐다는 뜻입니다. `blocked`이면 결과 JSON의 `checks`와 `nextSteps`를 먼저 해결합니다. 알려진 GitHub remote는 `not-applicable`로 끝나며 GitHub PR 흐름을 사용합니다.

:::caution[사전 진단은 생성 보장이 아닙니다]
GitLab은 Draft MR 생성의 dry-run을 제공하지 않습니다. 따라서 사전 진단은 읽기 권한과 알려진 역할만 확인합니다. 소스 브랜치 push 권한과 보호 브랜치 정책은 브랜치별로 달라질 수 있습니다. 마지막에 실제 `glab mr create --draft` 또는 기존 Draft 갱신이 성공하고 MR URL을 확인해야 완료입니다.
:::

## 막혔을 때 해결 순서

### 1. remote가 맞지 않아요

대상 프로젝트에서 아래 명령으로 remote 이름과 URL을 확인합니다.

```bash
git remote -v
git remote get-url origin
```

`origin`이 아니라 다른 remote를 쓴다면 `--remote <이름>`으로 지정합니다. 이 도구는 GitLab remote에서만 사용합니다.

### 2. glab가 없거나 인증되지 않았어요

`glab`를 설치한 뒤 GitLab 호스트에 로그인합니다. GitLab.com이면 호스트를 생략해도 되지만, 사내 GitLab은 호스트를 꼭 지정합니다.

```bash
glab auth login --hostname gitlab.example.com
glab auth status --hostname gitlab.example.com
```

브라우저 로그인이 어려운 환경이라면 `glab auth login --device --hostname gitlab.example.com`을 사용할 수 있습니다. 토큰이나 로그인 출력은 PR 본문·로그에 붙이지 않습니다.

### 3. 프로젝트 또는 MR API를 읽지 못해요

인증한 계정이 프로젝트에 접근할 수 있는지 GitLab에서 확인합니다. 개인 액세스 토큰(PAT)을 직접 쓴다면 GitLab API 요청에 필요한 `api` scope를 부여합니다. `GITLAB_TOKEN` 같은 환경 변수는 저장된 `glab` 인증보다 우선할 수 있으므로, 예상과 다른 계정으로 진단될 때도 확인합니다.

### 4. Developer 권한이 아니에요

프로젝트 관리자에게 해당 프로젝트의 **Developer 이상** 멤버 권한을 요청합니다. 일반적인 보호 브랜치 흐름에서는 Developer가 기능 브랜치를 push하고 MR을 만들며, Maintainer가 보호된 기본 브랜치에 병합합니다.

HTTPS remote로 새 브랜치를 push할 때 PAT를 쓴다면 Git push용 `write_repository` scope도 추가합니다. `api` scope는 GitLab API용이고, `write_repository`는 HTTPS Git 작업용입니다.

### 5. 실제 Draft MR 생성이 실패해요

사전 진단을 통과했어도 아래 항목을 프로젝트별로 확인합니다.

- 소스 브랜치를 push할 권한이 있는지
- 대상 브랜치가 보호되어 있을 때 MR 병합 정책이 팀의 역할과 맞는지
- 같은 소스 브랜치의 열린 Draft MR이 있으면 새로 만들지 않고 갱신할 수 있는지

실제 생성 또는 갱신이 성공한 MR URL이 있어야 SpecToPR 작업이 완료됩니다. 실패했다면 오류 전문·토큰을 공유하지 말고, 실패한 단계와 GitLab의 상태 코드만 확인해 권한 관리자에게 전달합니다.

## 왜 실제 생성까지 확인하나요?

`glab auth status`는 인증 상태를, `glab api`는 프로젝트와 MR API의 읽기 접근을 확인합니다. GitLab CLI의 `glab mr create --draft`는 실제 생성 명령이며 dry-run 옵션이 없습니다. 그래서 SpecToPR는 사전 진단으로 막힌 설정을 먼저 찾고, 마지막에 실제 Draft MR을 만들어 URL을 확인합니다.

GitLab 공식 문서: [glab 인증 상태](https://docs.gitlab.com/cli/auth/status/), [glab API](https://docs.gitlab.com/cli/api/), [Draft MR 생성](https://docs.gitlab.com/cli/mr/create/), [Merge Request 권한 흐름](https://docs.gitlab.com/user/project/merge_requests/authorization_for_merge_requests/), [보호 브랜치](https://docs.gitlab.com/user/project/repository/branches/protected/), [토큰 scope](https://docs.gitlab.com/security/tokens/access_token_scopes/).
