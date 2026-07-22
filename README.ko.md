# SpecToPR

기획서, 레거시 프로젝트, 기능 요청 또는 Figma 디자인을 검증 증거가 포함된 draft PR까지 연결합니다.

[English](README.md) · [전체 가이드](https://dhyun2.github.io/spec-to-pr/) · [내 케이스 고르기](https://dhyun2.github.io/spec-to-pr/usage/)

## 설치

Node.js 22+, Git, Claude Code 또는 Codex가 필요합니다.

### Claude Code

```text
/plugin marketplace add dhyun2/spec-to-pr
/plugin install spec-to-pr@spec-to-pr
```

### Codex

```bash
codex plugin marketplace add https://github.com/dhyun2/spec-to-pr --ref main
codex plugin add spec-to-pr@spec-to-pr
```

설치 후 호스트를 다시 열고 새 작업에서 설치 상태를 확인합니다.

```text
/spec-to-pr:doctor
```

[전체 설치 가이드 보기](https://dhyun2.github.io/spec-to-pr/getting-started/installation)

## 네 가지 사용법

| 케이스                       | 준비할 것                               | 결과                                                          | 상세 가이드                                                     |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| 모든 프로세스 개발           | 기획서/PDF/MD, Figma URL, OpenAPI       | API/UI 구현, 화면 비교, API gap, Web Vitals가 포함된 draft PR | [기획서 → PR](https://dhyun2.github.io/spec-to-pr/usage/brief)  |
| 레거시 프로젝트 마이그레이션 | 대상 저장소와 별도 레거시 프로젝트 경로 | 실행한 레거시 기준 마이그레이션, 화면 비교가 포함된 draft PR  | [레거시 → PR](https://dhyun2.github.io/spec-to-pr/usage/legacy) |
| 기능 개발                    | 한 기능의 기획서, Figma, API 자료       | 전체 검증, 해당 기능 E2E, 영상 1개가 포함된 draft PR          | [기능 → PR](https://dhyun2.github.io/spec-to-pr/usage/feature)  |
| Figma 디자인 구현            | Figma URL과 대상 저장소                 | mock 기반 UI, 수치화된 Figma 비교가 포함된 draft PR           | [Figma → PR](https://dhyun2.github.io/spec-to-pr/usage/figma)   |

모든 요청은 대상 프로젝트 경로로 시작합니다.

```text
/spec-to-pr /absolute/path/to/project
```

이후 해당 케이스 가이드의 프롬프트를 복사해 사용하세요. 필수 입력, 진행 과정, 검증 증거, blocker 처리와 예상 draft PR까지 케이스별로 설명되어 있습니다.

## 가이드

**https://dhyun2.github.io/spec-to-pr/**
