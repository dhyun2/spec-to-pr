---
sidebar_position: 4
title: 태스크 의존 그래프
---

# 태스크 의존 그래프 (T01–T33)

33개 태스크의 선후 관계 전체 지도입니다. 각 노드를 클릭할 수는 없지만, 번호로 [태스크 문서](/tasks/01-executable-plugin-shell)를 찾아가면 됩니다.

```mermaid
flowchart TB
    subgraph F["Phase 1 · Foundation (선형)"]
      T01["T01 Plugin Shell"] --> T02["T02 Runtime Contracts"] --> T03["T03 Run + SQLite"] --> T04["T04 State Machine"] --> T05["T05 Security Baseline"]
    end
    T05 --> T06["T06 Intake + Profiler"] --> T07["T07 Source Registry"]

    subgraph I["Phase 2 · Intake (병렬)"]
      T08["T08 Brief Adapter"]
      T09["T09 Figma Discovery"] --> T10["T10 Figma Intake"] --> T11["T11 DS Inventory"]
      T12["T12 OpenAPI Adapter"]
    end
    T07 --> T08 & T09 & T12

    T08 & T11 & T12 --> T13["T13 Evidence Graph"]

    subgraph C["Phase 3 · 계약 (T14 이후 병렬)"]
      T13 --> T14["T14 OpenSpec"] --> T15["T15 Gherkin"]
      T14 --> T16["T16 API Pipeline"]
      T14 --> T17["T17 Design Contract"]
    end

    T15 & T16 & T17 --> T18["T18 Agent Runtime"]

    subgraph L["Phase 4 · 구현 lane (병렬)"]
      T18 --> T19["T19 Spec/BDD"] & T20["T20 API Contract"] & T21["T21 Design/UI"]
    end

    T19 & T20 & T21 --> T22["T22 Review Council"] --> T23["T23 Integration"]

    subgraph G["Phase 5 · 게이트 (병렬)"]
      T23 --> T24["T24 FSD Guard"] & T25["T25 Quality Gates"] & T26["T26 Visual"] & T27["T27 A11y"] & T28["T28 Performance"] & T29["T29 Observability"]
    end

    T24 & T25 & T26 & T27 & T28 & T29 --> T30["T30 PR Report"] --> T31["T31 Publisher"] --> T32["T32 Archive"] --> T33["T33 Release"]
```

## 읽는 법

- **Phase 1 (T01~T07)** — 전부 선형. 커널·계약·저장소·상태기계·보안이 차례로 쌓입니다.
- **Phase 2 (T08~T12)** — 기획서·Figma·OpenAPI 세 갈래가 **병렬**. Figma 갈래만 내부적으로 T09→T10→T11 순서가 있습니다.
- **T13이 합류점** — 세 갈래의 증거가 여기서 하나의 그래프로 합쳐집니다.
- **Phase 3 (T14~T17)** — OpenSpec이 먼저, 그 위에서 Gherkin·API 파이프라인·Design Contract가 병렬.
- **Phase 4 (T18~T23)** — lane 3개 병렬 → Council → 통합.
- **Phase 5 (T24~T29)** — 게이트 6종은 서로 **모두 병렬**입니다.
- **마무리 (T30~T33)** — 다시 선형.

## 크리티컬 패스

가장 긴 경로는 다음과 같습니다 (Figma를 쓰는 경우):

```text
T01→…→T07 → T09→T10→T11 → T13 → T14 → T17 → T18 → lane → T22 → T23 → 게이트 → T30 → T31
```

Figma를 쓰지 않으면 T09~T11·T17·T26이 빠져 경로가 짧아집니다.
