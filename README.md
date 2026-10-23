# Bedrock Pricing Compare

[![Live](https://img.shields.io/badge/site-bedrock--compare.awskr.net-brightgreen)](https://bedrock-compare.awskr.net)

AWS Bedrock의 **모델 × 리전 × 엔드포인트 타입 × 과금 차원**별 토큰 비용을 한곳에서 비교하는 정적 웹앱입니다. 공개 데이터만으로 매시간 자동 갱신되며, 월 비용 순위(리더보드)를 첫 화면에 보여 줍니다.

- 라이브: https://bedrock-compare.awskr.net
- 스택: Vite + React + Cloudscape → **단일 HTML 파일**로 빌드, S3 + CloudFront(정액제)로 서빙

## 무엇을 비교하나

- **엔드포인트 타입을 1급 축으로** 취급합니다: `in-region` / `regional-cris`(us·eu·apac) / `global-cris`(global). CRIS 과금은 라우팅된 리전이 아니라 요청 소스 리전 단가로 매겨지고, Global CRIS는 모델별 할인이 붙을 수 있기 때문입니다.
- 과금 차원: 입력/출력 토큰, 캐시 읽기·쓰기(per-1M로 정규화).
- 토큰이 아닌 과금 모델은 전용 섹션으로 분리합니다: **임베딩**(입력만), **음성 대화**(음성 토큰), **영상 생성**·**영상 이해**(영상 입력 초당 + 출력 토큰, 예: TwelveLabs Pegasus).
- 월 비용을 못 내는 항목(한쪽 단가만 공개 등)은 "계산 불가"로 **정직하게 분리**해 표시하고, 단가를 추정으로 채우지 않습니다.

## 데이터 소스와 우선순위(SOT)

가격은 세 공식 소스를 우선순위대로 병합합니다. 상위 소스가 하위를 덮고, 하위는 상위에 없는 키만 채웁니다.

| 순위 | 소스 | 역할 |
|------|------|------|
| 1 | **영문 Pricing 페이지** (`aws.amazon.com/bedrock/pricing`) | 리터럴 단가가 정확 일치 충돌에서 우선 |
| 2 | **영문 Documentation** | 출시·리전/라우팅 가용성 |
| 2b | **모델 카드 Pricing 섹션** | 요금 페이지·API 어디에도 없는 단가(예: GPT 계열)를 채움(fill-only) |
| 3 | **Price List Bulk offer file** (공개, 무인증) | SKU 차원과 나머지 갭 |

> 한글 AWS 페이지는 갱신 지연이 있어 기준으로 쓰지 않습니다.

## 아키텍처

```
collector/ (Node, 의존성 없는 빌트인 전용 스크립트)
  check-sources.mjs      # 조건부 GET으로 소스 변경 감지
  collect-english-pricing.mjs / collect-english-docs.mjs / collect-model-card-pricing.mjs
  collect.mjs / parse-abfm.mjs   # Price List offer file 수집·정규화
  merge.mjs              # 우선순위 병합 → web/pricing.json
  gate.mjs               # 급격한 포인트 감소 등 회귀 차단
  audit-model-catalog.mjs# 스냅샷 2개 diff로 모델 추가/제거/가용성 변화 감사
  build-standalone.mjs   # vite 셸에 사전(dictionary) 인코딩 데이터 인라인 → 단일 HTML

app/ (Vite + React + Cloudscape)  → vite build → dist/bedrock-pricing.html (단일 파일)

배포: S3(awskr-bedrock-pricing) + CloudFront(E43RB5R0916YO, 정액제)
      CloudFront Function이 Accept-Encoding으로 br/gzip/원본 선택
```

### 두 가지 갱신 경로

- **코드·UI 변경:** `main`에 push → GitHub Actions(`.github/workflows/refresh.yml`)가 vite 빌드·배포하고, 매시 Lambda가 쓸 UI 셸도 S3에 동기화합니다.
- **데이터만 변경(매시):** AWS EventBridge + Lambda(`infra/lambda-refresh/`)가 vite 없이 collector만 돌려 **데이터만 셸에 재인라인**해 배포합니다. (GitHub Actions `schedule`은 드롭이 잦아 쓰지 않습니다.)

## 로컬 개발

```bash
cd app
npm ci
npm run dev        # Vite 개발 서버
npm test           # 노드 테스트 (app/src)

# collector 단독 실행 (리포 루트에서)
node collector/collect.mjs all      # offer file 수집
node collector/merge.mjs            # 병합 → web/pricing.json
node --test collector/              # collector 테스트
```

## 배포

```bash
# 코드/UI: main push가 refresh.yml을 통해 자동 배포
git push

# 매시 갱신 Lambda에 collector/UI 변경 반영
cd infra/lambda-refresh && ./package.sh && sam deploy
```

> collector를 수정한 뒤에는 `./package.sh` 없이 `sam deploy`만 하면 옛 빌드 사본이 올라가 새 로직이 반영되지 않습니다. UI 코드를 바꿔 배포할 때는 `seed-state.sh`로 S3의 UI 셸도 갱신해야 다음 Lambda 실행이 옛 UI로 덮지 않습니다. 자세한 내용은 [`infra/lambda-refresh/README.md`](infra/lambda-refresh/README.md).

## 문서

- [`docs/SCOPE.md`](docs/SCOPE.md) — 범위·설계 근거(왜 단순 모델×리전 매트릭스가 안 되는지)
- [`DATA_QUALITY_AUDIT.md`](DATA_QUALITY_AUDIT.md) — 데이터 품질 감사

## 라이선스

MIT
