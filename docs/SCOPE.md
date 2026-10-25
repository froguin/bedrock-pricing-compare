# Bedrock Pricing Compare — Scope & Design

목표: AWS Bedrock의 **모델 × 리전 × 엔드포인트 타입 × 과금 차원**별 토큰 비용을
다각적으로 쉽게 비교. 1단계는 AWS만, 이후 글로벌 CSP + 1P 확장.

## 1. 왜 단순 "모델 × 리전" 매트릭스가 안 되는가 (실측 근거)

라이브 조사에서 확인:

- **CRIS 과금은 라우팅된 리전이 아니라 *요청 소스 리전* 단가**로 매겨진다. 라우팅 추가비용 없음.
- **Global CRIS는 모델별 할인**이 붙는다 (최신 Claude 계열에서 blend3 기준 약 9.1% ↓, 보편 아님 — Claude Sonnet 4는 0%).
- 따라서 "리전별 단가" 개념은 in-region과 CRIS에서 의미가 다르다.

→ **엔드포인트 타입을 1급 축으로 승격**한다:
`in-region` | `regional-cris` (us./eu./apac.) | `global-cris` (global.)

> 실데이터상 on-demand 토큰 단가는 `in-region`과 `global-cris`에만 존재한다. Geo/regional CRIS
> SKU(`_Geo`)는 Reserved TPM(시간당)만 있어, on-demand geo 라우팅은 소스 리전의 in-region 단가로 과금된다.

## 2. 데이터 소스 & Source-of-Truth 규칙

가격은 공식 소스를 우선순위대로 **병합**한다. 상위 소스가 하위를 덮고, 하위는 상위에 없는 키만 채운다.

| 순위 | 소스 | 역할 | 특성 |
|------|------|------|------|
| 1 | **영문 Pricing 페이지** (`aws.amazon.com/bedrock/pricing`) | 리터럴 단가 override SOT | 신규 모델·cache·tier가 offer file보다 먼저 반영. CRIS(geo) on-demand 단가, 날짜 명시 변경 고지 포함. |
| 2 | **영문 Documentation** | 출시·리전/라우팅 가용성 | |
| 2b | **모델 카드 Pricing 섹션** | 요금 페이지·offer 어디에도 없는 단가(예: GPT 계열)를 채움(fill-only) | |
| 3 | **Price List Bulk offer file** (공개, 무인증) | SKU 차원과 나머지 갭 (baseline) | 두 offer code 필요: `AmazonBedrock` + `AmazonBedrockFoundationModels`(Marketplace/mantle, 최신 Claude 경로). `Access-Control-Allow-Origin: *`. |

**SOT 우선순위**: Pricing 페이지 > Documentation/모델 카드 > offer file. 값 충돌 시 상위 채택,
`source` 필드로 출처 기록. 한글 AWS 페이지는 갱신 지연이 있어 기준으로 쓰지 않는다.

> Price List Query API(GetProducts, SigV4)는 offer file과 동일 데이터라 상시 수집에는 쓰지 않는다(선택적 교차검증).

### 알려진 갭 (실측 확인)
- **최신 Anthropic/OpenAI 모델이 offer file에 늦게 반영**: offer file만으로는 신규 모델 단가가 비어
  Pricing 페이지·모델 카드 수집으로 채운다.
- `provider` 필드가 비어있는(undefined) 레거시 SKU 다수 → `model` 문자열/usagetype에서 provider 추론 필요.
- 단위 혼재: Model Pricing은 per-1M, 일부는 per-1K → 정규화 시 per-1M로 통일.
- `model` 네이밍 2종 공존: 레거시 표시명("Claude 3 Haiku") vs provider-prefixed id("xai.grok-4.6").
- 같은 natural key에 서로 다른 단가가 붙는 경우가 있다(컨텍스트 밴드·모달리티 단위가 SKU 안에만 인코딩됨).
  UI는 낮은 값을 ⚠ 마커로 표시하고 Δ 비교에서 제외한다. 상세는 [`../DATA_QUALITY_AUDIT.md`](../DATA_QUALITY_AUDIT.md).

## 3. 정규화 스키마 (price_point)

```
{
  provider, model_id, model_family,
  endpoint_type: in-region | regional-cris | global-cris,
  source_region,
  service_tier: standard | flex | priority | latency-optimized,
  execution_mode: online | batch,          // batch는 online과 같은 셀에 섞지 않음
  status: ga | legacy | preview | internal, // preview/internal은 기본 숨김
  dimension: input | output | cache_read | cache_write_5m | cache_write_1h | image | video | audio,
  price_per_1m,          // 모든 토큰 단가를 per-1M로 정규화
  raw_unit,              // 원본 단위(1K tokens 등) 보존
  source: web | docs | model_card | offer,
  effective_date,        // 과금 발효일 (모델 출시일 아님)
  offer_version
}
```

## 4. 스택 & 단계

- **collector**: 의존성 없는 Node 빌트인 스크립트. 소스 수집 → 정규화 → 우선순위 병합 → `web/pricing.json`.
  gate(회귀 차단)·audit(모델 카탈로그 diff)·build-standalone(단일 HTML 인라인) 포함.
- **web / app**: Vite + React + Cloudscape를 **단일 HTML 파일**로 빌드(`dist/bedrock-pricing.html`).
  월 비용 순위(리더보드)를 첫 화면으로, 다축 필터 + 비교 매트릭스 제공.
  (이전 PoC는 바닐라 HTML/CSS/JS `web/index.html`였고, Cloudscape 포팅은 완료된 상태.)
- **배포**: 단일 정적 HTML을 호스팅. 코드/UI 변경은 `main` push로 자동 배포되고,
  데이터는 공개 소스에서 주기적으로 자동 갱신된다(상세 운영 절차는 리포에 포함하지 않음).

### 현재 데이터 규모 (스냅샷 예시)
- 약 18K price points · 35 리전 · 단위 USD per 1M tokens.
- offer 기준: `AmazonBedrock` + `AmazonBedrockFoundationModels` 두 버전 병합.
- 실제 수치는 `web/pricing.json`의 `count` / `regions` / `offer_version`을 SOT로 본다(여기 숫자는 설명용).

### 이후
- 전 리전 × 전 provider 커버리지 확대, 성능 측정 축(TTFT/TPS) 추가 검토.
- 글로벌 CSP(OpenAI/Google/Azure) + 1P 비교로 확장.
