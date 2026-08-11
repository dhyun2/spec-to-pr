# [레거시 이관] {{TITLE}}

> Draft PR · **{{VERIFICATION_LABEL}}** · 좌우 비교 {{VISUAL_PASSED}}/{{VISUAL_REQUIRED}} 통과 · 명시적 제외 {{VISUAL_EXCLUDED}}개 · Gap {{GAP_COUNT}}개

## 검토자 결정

{{REVIEWER_DECISION}}

{{GAP_SECTION_IF_ANY}}

## 이관 범위

| 레거시 경로 · 상태       | 원본 파일 | 대상 파일 | 화면 증빙 |
| ------------------------ | --------- | --------- | --------- |
| {{MIGRATION_SCOPE_ROWS}} |

## 라우트 동작 확인

| 시작 · 동작          | 실제 fixture | 최종 경로 | 핵심 UI | API · 인증 | 관련 오류 | 결과 |
| -------------------- | ------------ | --------- | ------- | ---------- | --------- | ---- |
| {{ROUTE_CHECK_ROWS}} |

## 좌우 이미지 비교

{{CAPTURE_PROVIDER_DISCLOSURE_IF_FALLBACK}}

{{LEGACY_VISUAL_PAIRS_WITH_DIFF_LINKS}}

## 보존 이관 확인

| 항목                  | 상태 | 비고 |
| --------------------- | ---- | ---- |
| {{PRESERVATION_ROWS}} |

## Vue 3 규격 이관

| 항목                         | 대상 규격 | 결과 |
| ---------------------------- | --------- | ---- |
| {{TARGET_CODE_PROFILE_ROWS}} |

{{PUBLISHING_STATUS_SECTION_IF_RELEVANT}}

{{API_SECTION_IF_USED}}

{{EXCLUSION_SECTION_IF_USED}}

## 검증

{{VERIFICATION_ROWS}}
