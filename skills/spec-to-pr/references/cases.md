# 네 가지 케이스

공통 입력은 `case`, 대상 프로젝트 절대 경로, 구현 요청입니다. 화면이 바뀌는 모든 케이스는 화면 비교를 시도하고, 비교하지 못한 상태를 통과로 표시하지 않습니다.

## brief

- 기획서와 제공된 API 문서·Figma를 구현 기준으로 읽습니다.
- OpenSpec은 사용자 입력 전제 조건이 아닙니다. 저장소 규칙이 있거나 요구사항·수용 시나리오를 정리할 가치가 있으면 에이전트가 준비하며, 부재·충돌은 Gap으로 남기고 구현을 진행합니다.
- 요구사항마다 구현 결과와 증빙을 PR의 `요구사항 충족` 표에 기록합니다. 명시적으로 하지 않은 것은 `제외 범위`에만 기록합니다.
- UI는 대상 디자인 시스템과 기존 컴포넌트를 우선 사용합니다.

## feature

- 요청한 한 가지 사용자 기능과 직접 필요한 파일을 구현합니다.
- UI는 대상 디자인 시스템과 기존 컴포넌트를 우선 사용합니다.
- 변경 전후 동작, 관련 회귀 검증, 화면 비교를 PR에 씁니다.
- 변경 기능만 고르는 E2E를 한 번 실행하고, 버튼 동작부터 결과 확인까지 보이는 WebM 또는 MP4 영상 한 개를 `spec-to-pr-evidence/<change>/`에 커밋합니다. 실행 실패는 Gap이지만 영상 섹션을 삭제하거나 통과라고 쓰지 않습니다.

## figma

- 제공한 Figma URL의 화면과 상태를 기준으로 구현합니다.
- Figma state/node와 구현 경로·상태를 1:1로 매핑합니다.
- 대상 디자인 시스템의 컴포넌트·토큰을 우선 사용합니다. 대응 컴포넌트가 없으면 프로젝트 규칙에 따라 직접 구현합니다.
- 상태별 일치율, 디자인 검증, 접근성 검증을 PR에 기록합니다.

## legacy

### 입력과 범위 고정

```yaml
case: legacy
projectRoot: /absolute/path/to/new-project
legacyProjectRoot: /absolute/path/to/legacy-project
targetPaths:
  - apps/gzApp/src/pages/mapfinder
request: Mapfinder를 Vue 3 MPA entry로 이관해줘
```

- `legacyProjectRoot`와 `targetPaths`는 이름 유사성으로 추론하지 않습니다. 받은 경로와 불일치하면 구현 전에 보고합니다.
- 레거시 프로젝트는 절대 수정하지 않습니다.
- 이관은 **재디자인이 아닙니다.** 사용자가 명시적으로 승인하지 않은 한 레거시 template/DOM class, CSS, sprite·이미지 자산, 지도·검색·필터·하단 컨트롤, 사용자 동작을 보존합니다. 반면 script·state·router·utility는 대상 저장소의 Vue 3 규격으로 변환합니다. UI 보존을 이유로 Options API·mixin·Vuex 호환층을 그대로 남기지 않습니다.
- 레거시 이관에는 대상 디자인 시스템을 적용하지 않습니다. 기존 프로젝트 셸과 빌드 연결은 사용해도 되지만, `@frontend/ui` 같은 새 Chip·Icon·컴포넌트로 화면을 대체하지 않습니다.
- Unicode glyph/emoji, 문자·CSS로 그린 로고·지도 핀·아이콘, 회색 지도 박스, mock/placeholder carousel·bridge는 보존 이관에서 금지합니다.

### source inventory는 필수

화면을 선언하기 전에 아래 읽기 전용 도구를 실행합니다.

```bash
node /absolute/path/to/legacy-source-inventory.cjs \
  --legacy-root /absolute/path/to/legacy-project \
  --source-paths src/modules/mapfinder \
  --output /absolute/path/to/project/spec-to-pr-evidence/mapfinder/legacy-source-inventory.json
```

이 도구는 지정한 source path를 이관 범위로 고정하고 상대 경로·`@/` local import를 읽기 전용으로 따라가 supporting dependency를 별도로 기록합니다. route 선언과 `router.push`, `viewOpen`, `location.href`, router-link, template literal 경로, `url(...)`/image asset, CSS selector, media breakpoint, Kakao Map·Swiper·native bridge 표식을 수집합니다. 해석하지 못한 import는 `warnings`에 남기며 중단하지 않습니다. supporting dependency는 조사 범위일 뿐 이관 `targetPaths`를 자동 확장하지 않습니다.

- asset: 원본 asset → 대상 파일 또는 canonical URL
- selector/breakpoint: 원본 selector·반응형 조건 → 실제 대상 CSS
- runtime: 원본 지도·carousel·bridge → 실제 대상 코드의 증거 문자열

누락·승인 없는 대체·대상 파일 부재는 `NOT VERIFIED` Gap입니다. 원본 asset을 디자인 시스템 아이콘으로 자동 대체하지 않습니다.

### 캡처 provider는 Computer Use 우선

레거시 화면은 호스트에 Computer Use가 있으면 이를 먼저 사용합니다. 이미 로그인된 실제 앱에서 모든 route·state를 순회하고, 같은 앱 컨텍스트에서 기준·이관 결과 PNG를 얻습니다. 화면 비교만을 위해 독립 Browser/Playwright 창을 먼저 띄우지 않습니다.

Computer Use가 현재 호스트에 노출되지 않았거나 동일 조건의 PNG를 만들 수 없을 때만 Browser 또는 Playwright를 fallback으로 사용합니다. provider, 인증 상태, 캡처 시각, 사유를 manifest에 기록하고 PR 좌우 이미지 비교 위에 중복 없이 공개합니다. 같은 조건의 PNG와 기능 검증을 확보했다면 fallback 자체는 Gap이 아닙니다. provider 기록·사유가 없거나 캡처 조건을 확인할 수 없을 때만 Gap입니다. 인증 쿠키·토큰 값은 어떤 증빙에도 기록하지 않습니다.

### 화면 매트릭스는 필수

라우터 선언만이 아니라 라우터에서 도달 가능한 사용자 상태를 인벤토리로 만듭니다. 예를 들어 Mapfinder라면 `/map`, `/map/:rgnNo`, `/map/filter/:optFilter`, `/map/:lat/:lng`, `/404`와 목록 전환·검색어 자동완성·카테고리/옵션 필터·매장 액션·현재 위치·로딩/빈 결과/오류처럼 실제로 보이는 상태를 확인합니다.

각 인벤토리 항목은 다음 중 하나여야 합니다.

1. 같은 fixture, viewport, DPR, 로그인 상태에서 기준·이관·Diff 이미지를 가진 `visualTarget`
2. 실행할 수 없는 이유, 영향, 리뷰어가 결정할 사항을 가진 `exclusion`

기본 지도 한 장을 `1/1 통과`로 기록해 전체 이관을 통과 처리할 수 없습니다. 전체 PR에는 `통과/전체`, `미달`, `비교 불가`, `명시적 제외`를 함께 보여 줍니다.

### 라우트 동작 확인은 가볍게 필수

전체 E2E suite나 영상은 만들지 않습니다. 대신 각 비교 화면에 실제 fixture 출처, 최종 URL, 핵심 selector/text, 필요한 API·인증 결과, 관련 console/network 오류를 기록합니다. 여러 화면이 연결되면 홈→카드 클릭→상세처럼 대표 클릭·선택 전환을 한 건 이상 수행합니다. 위험한 POST/PATCH/DELETE 확정은 실행하지 않고 그 직전까지 확인해도 됩니다.

동적 파라미터는 레거시 화면 또는 read API에서 확인한 실제 값을 사용합니다. `0`, `test`, `today` 같은 임의 값, 예상 밖 빈 화면·loading·오류, authenticated 문자열만 있고 인증 성공 증거가 없는 상태, 필수 API 비-2xx/CORS, 관련 console/network 오류는 픽셀 일치율이 높아도 Gap입니다.

### UI 보존과 Vue 3 규격을 별도로 확인

`AGENTS.md`, package 설정, 인접 표준 페이지를 근거로 `targetCodeProfile`을 작성합니다. 대상 규격이 `<script setup lang="ts">`, Pinia, Vue Router 4라면 Options API, mixin, Vuex adapter, Vue 2 Event Bus, 신규 JavaScript 파일이 남은 수를 확인합니다. 미달은 구현을 중단하지 않지만 `NOT VERIFIED` Gap입니다.

### 증빙 manifest

`spec-to-pr-evidence/<change>/legacy-visual-manifest.json`에 아래 형식으로 기록합니다. 파일 경로는 manifest가 있는 evidence 디렉터리 기준 상대 경로입니다.

```json
{
  "schemaVersion": 4,
  "case": "legacy",
  "change": "mapfinder",
  "legacyProjectRoot": "/absolute/path/to/legacy-project",
  "sourceInventoryPath": "legacy-source-inventory.json",
  "targetPaths": ["apps/gzApp/src/pages/mapfinder"],
  "capturePolicy": {
    "preferredProvider": "computer-use",
    "fallback": "browser-or-playwright-when-unavailable"
  },
  "migration": {
    "strategy": "preserve-legacy",
    "preservation": {
      "template": "preserved",
      "styles": "preserved",
      "assets": "preserved",
      "controls": "preserved"
    },
    "forbiddenImports": ["@frontend/ui"]
  },
  "routeInventory": [
    {
      "id": "map-default",
      "route": "/map",
      "state": "default-map",
      "sourceFiles": ["src/views/Mapfinder.vue"],
      "targetFiles": ["apps/gzApp/src/pages/mapfinder/views/MapfinderPage.vue"]
    }
  ],
  "visualTargets": [
    {
      "id": "map-default",
      "inventoryId": "map-default",
      "fixture": "qa:authenticated-current-location",
      "viewport": { "width": 390, "height": 844, "dpr": 1 },
      "baselinePath": "baseline/map-default.png",
      "baselineCapture": {
        "provider": "computer-use",
        "authState": "authenticated",
        "capturedAt": "2026-08-10T00:00:00.000Z"
      },
      "attempts": [
        {
          "actualPath": "actual/map-default-attempt-1.png",
          "diffPath": "diff/map-default-attempt-1.png",
          "capture": {
            "provider": "computer-use",
            "authState": "authenticated",
            "capturedAt": "2026-08-10T00:00:01.000Z"
          }
        }
      ],
      "criticalRegions": [
        { "id": "bottom-controls", "x": 0, "y": 650, "width": 390, "height": 194 }
      ]
    }
  ],
  "exclusions": [],
  "assetMappings": [
    {
      "sourceAssetId": "asset-001",
      "target": "apps/gzApp/src/pages/mapfinder/assets/logo.png",
      "status": "preserved"
    }
  ],
  "selectorMappings": [
    {
      "sourceSelectorId": "selector-001",
      "targetSelector": ".mapfinder .shop-logo",
      "status": "preserved"
    }
  ],
  "breakpointMappings": [],
  "runtimeMappings": [
    {
      "sourceRuntimeId": "runtime-001",
      "targetFiles": ["apps/gzApp/src/pages/mapfinder/components/ShopMap.vue"],
      "targetEvidence": "kakao.maps.Map",
      "status": "preserved"
    }
  ],
  "routeChecks": [
    {
      "id": "map-default",
      "inventoryId": "map-default",
      "entry": { "type": "direct", "action": "기본 지도 진입" },
      "expectedUrlPattern": "/map",
      "expectedScreen": "content",
      "apiExpectation": { "requirement": "required" },
      "fixture": {
        "summary": "QA 로그인·현재 위치",
        "parameters": []
      },
      "baseline": {
        "finalUrl": "/map",
        "screenState": "content",
        "assertions": [
          {
            "label": "검색·필터·지도 하단 컨트롤",
            "kind": "selector",
            "expected": ".map-controls",
            "status": "passed"
          }
        ],
        "auth": { "status": "passed", "kind": "api-2xx", "evidence": "사용자 상태 API" },
        "apiChecks": [
          { "request": "GET /user/status", "purpose": "auth", "status": 200, "result": "passed" },
          { "request": "GET /shops", "purpose": "data", "status": 200, "result": "passed" }
        ],
        "diagnosticsChecked": true,
        "relevantConsoleErrors": [],
        "relevantNetworkErrors": []
      },
      "target": {
        "finalUrl": "/map",
        "screenState": "content",
        "assertions": [
          {
            "label": "검색·필터·지도 하단 컨트롤",
            "kind": "selector",
            "expected": ".map-controls",
            "status": "passed"
          }
        ],
        "auth": { "status": "passed", "kind": "api-2xx", "evidence": "사용자 상태 API" },
        "apiChecks": [
          { "request": "GET /user/status", "purpose": "auth", "status": 200, "result": "passed" },
          { "request": "GET /shops", "purpose": "data", "status": 200, "result": "passed" }
        ],
        "diagnosticsChecked": true,
        "relevantConsoleErrors": [],
        "relevantNetworkErrors": []
      }
    }
  ],
  "targetCodeProfile": {
    "framework": "vue3",
    "evidenceSources": ["AGENTS.md", "apps/gzApp/package.json"],
    "componentStyle": "script-setup",
    "language": "typescript",
    "stateManagement": "pinia",
    "router": "vue-router-4",
    "legacyCompatibility": "forbidden"
  },
  "publishing": {
    "plugin": {
      "status": "failed",
      "summary": "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    },
    "draft": {
      "status": "published",
      "method": "glab",
      "url": "https://gitlab.example.com/group/app/-/merge_requests/123",
      "summary": "plugin TLS failure after glab fallback"
    }
  }
}
```

`legacy-visual-evidence.cjs`는 전체 이미지와 `criticalRegions`, routeChecks, targetCodeProfile을 함께 검증합니다. Computer Use 우선 capture policy·fallback 공개, route/asset/CSS/runtime mapping, glyph/placeholder 대체, 발행 실패도 확인합니다. PR section은 상단 Gap, 간결한 라우트 동작 표, 경로·상태별 레거시와 Vue 3 좌우 이미지와 Diff, Vue 3 규격 결과를 생성합니다. 큰 빈 지도 영역이나 동일한 오류 화면은 픽셀이 같아도 통과가 아닙니다.

### 이미지 전달

`baseline`, `actual`, `diff`, manifest, 생성된 PR 섹션을 모두 stage·commit·push합니다. 도구가 출력하는 PR Markdown은 GitHub/GitLab branch의 raw 이미지 URL을 사용하므로 리뷰어는 PR에서 기준·이관 결과를 바로 봅니다. 로컬 절대 경로, 내부 artifact ID, Diff 하나만으로 증빙을 대신하지 않습니다.

플러그인 발행 API가 TLS·인증·권한 오류로 실패하고 `glab`/`gh` fallback이 Draft를 만들었다면, fallback만 성공이라고 말하면 안 됩니다. `publishing.plugin`에 실패 원인, `publishing.draft`에 fallback method·MR URL·결과를 넣고 생성된 PR section으로 본문을 갱신합니다.

### API와 Gap

레거시에서 확인한 실제 호출만 대상 API client에 연결합니다. 요청 body·권한·write 동작이 확정되지 않으면 추측하지 않고 API Gap으로 남깁니다. 이 사실은 화면·읽기 GET·상태 이관을 막지 않습니다.
