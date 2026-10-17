# Bedrock Pricing Compare — Scope & Design

목표: AWS Bedrock의 **모델 × 리전 × 엔드포인트 타입 × 과금 차원**별 토큰 비용을
다각적으로 쉽게 비교. 1단계는 AWS만, 이후 글로벌 CSP + 1P 확장.

## 1. 왜 단순 "모델 × 리전" 매트릭스가 안 되는가 (실측 근거)

라이브 조사(2026-09, offer version `20260915152020`)에서 확인:

- **CRIS 과금은 라우팅된 리전이 아니라 *요청 소스 리전* 단가**로 매겨진다. 라우팅 추가비용 없음.
- **Global CRIS는 모델별 할인**이 붙는다 (예: Claude Sonnet 4.5 약 10% ↓, 보편 아님).
- 따라서 "리전별 단가" 개념은 in-region과 CRIS에서 의미가 다르다.

→ **엔드포인트 타입을 1급 축으로 승격**한다:
`in-region` | `regional-cris` (us./eu./apac.) | `global-cris` (global.)

## 2. 데이터 소스 & Source-of-Truth 규칙

| 소스 | 역할 | 특성 |
|------|------|------|
| **Bulk offer file** (공개, 무인증) | baseline 자동 수집 | `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/region_index.json` → 리전별 `index.json`. us-east-1 1032 SKU. |
| **Price List Query API** (SSO) | 라이브 교차검증(선택) | `aws pricing get-products --service-code AmazonBedrock`. offer file과 같은 데이터. |
| **pricing 웹페이지** (스크레이핑) | **override SOT** | `https://aws.amazon.com/bedrock/pricing/`. 신규 모델·cache·tier가 API보다 먼저 반영. |

**SOT 우선순위**: 웹페이지 > API/offer. 값 충돌 시 웹 채택, `source` 필드로 출처 기록.

### 알려진 갭 (실측 확인)
- **Anthropic 최신 모델이 API/offer에 없음**: us-east-1에서 Anthropic은 5개(구 Claude만). Claude 3.5/3.7/4/4.5의 tier·cache·CRIS 단가는 offer에 0건 → **Anthropic은 웹 스크레이핑 필수**.
- `provider` 필드가 비어있는(undefined) 레거시 SKU 다수(us-east-1 389개) → `model` 문자열/usagetype에서 provider 추론 필요.
- 단위 혼재: Model Pricing은 per-1M, 일부(Model Evaluation 등)는 per-1K → 정규화 시 per-1M로 통일.
- `model` 네이밍 2종 공존: 레거시 표시명("Claude 3 Haiku") vs provider-prefixed id("xai.grok-4.6").

## 3. 정규화 스키마 (price_point)

```
{
  provider, model_id, model_family,
  endpoint_type: in-region | regional-cris | global-cris,
  source_region,
  service_tier: standard | flex | priority | batch,
  dimension: input | output | cache_write | cache_read | image | video | audio,
  price_per_1m,          // 모든 토큰 단가를 per-1M로 정규화
  raw_unit,              // 원본 단위(1K tokens 등) 보존
  source: offer | api | web,
  effective_date,
  offer_version
}
```

diff 결과는 별도 `diff` 레코드: `status: web_only | value_mismatch | api_only`.

## 4. 스택 & 단계

- **repo**: 로컬 `bedrock-pricing-compare` (git init 완료).
- **collector**: Node 스크립트. offer file fetch → 정규화 → `data/snapshots/<version>.json`.
- **web**: 정적 프론트(Vite + React + Cloudscape, `aws-whats-new-korean` 계열). PropertyFilter 다축 필터 + 비교 매트릭스.
- **배포**: 나중 (Amplify 계열). PoC는 로컬 `127.0.0.1`.

### PoC 범위 (현재 단계)
- offer file baseline만 사용(무인증). 대표 3계열(Claude·Nova/Amazon·Llama/Meta) + 대표 리전.
- 축: endpoint_type × source_region × service_tier, 차원 input/output(+ cache 있으면).
- 목표: 비교 UX 감 검증 + 정규화 파이프라인 실증.

### 이후
- 웹 스크레이퍼 + diff 엔진(진짜 차별점, whats-new식 갱신 피드의 근거).
- 전 리전(36) × 전 provider 수집, AWS 배포.
- 글로벌 CSP(OpenAI/Google/Azure) + 1P 비교 사이트로 확장.
