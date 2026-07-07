# パフォーマンス簡易負荷試験

## 目的

- `3-4: パフォーマンス最適化（P95<500ms）` の事前計測をローカル/検証環境で再現可能にする
- 実運用前に対象 API の P50 / P95 / P99 / エラー率を記録する

## 実行コマンド

```bash
corepack pnpm perf:smoke --base-url http://127.0.0.1:3000 --path /api/health --requests 80 --concurrency 8 --target-ms 500 --p99-target-ms 1000
```

認証付きルートを測る場合:

```bash
corepack pnpm perf:smoke \
  --base-url https://staging.example.com \
  --path /api/admin/performance-metrics \
  --requests 60 \
  --concurrency 6 \
  --header "cookie: next-auth.session-token=..." \
  --header "x-org-id: org_1"
```

critical route の payload budget matrix を測る場合:

```bash
corepack pnpm perf:smoke:payload-matrix \
  --base-url https://staging.example.com \
  --requests 20 \
  --concurrency 2 \
  --header "cookie: next-auth.session-token=..." \
  --header "x-org-id: org_1"
```

`--payload-budget-matrix` は、設定済みの GET payload budget route を route family ごとに
独立して測る。患者IDを必要とする route は既定で synthetic な `patient_1` を使うため、
検証環境で実在する非本番患者IDへ変える場合は `PERF_PATIENT_ID=patient_test_001` を指定する。
個別 route だけを測る場合は通常どおり `--path` を複数指定できる。

POST API を測る場合:

```bash
corepack pnpm perf:smoke \
  --base-url http://127.0.0.1:3012 \
  --method POST \
  --path /api/visit-schedule-proposals/billing-preview-batch \
  --header "x-org-id: org_1" \
  --body-file artifacts/perf/billing-preview-batch.json \
  --requests 40 \
  --concurrency 4 \
  --target-ms 500 \
  --p99-target-ms 1000
```

`--body` で直接 JSON 文字列を渡すこともできます。body を指定し、`content-type` header が未指定の場合は `application/json` が自動設定されます。

## 出力

- JSON で `average_ms`, `p50_ms`, `p95_ms`, `p99_ms`, `max_ms`, `error_count`, `body_bytes`,
  `p95_target_met`, `p99_target_met`, `response_payload_sample_count`,
  `response_payload_measurement_status`, `p95_response_payload_bytes`,
  `response_payload_budget_status`, `response_payload_budget_bytes`, `target_met` を出力
- `body_bytes` は request body size。応答 payload は `Content-Length` があればそれを使い、
  なければ response body の byte length を測る。本文は出力しない
- `response_payload_budget_status=over_budget`、`target_met=false`、または `error_count>0` の場合は終了コード 1。
  budget 未設定 route は `unconfigured` と出し、payload budget だけでは失敗扱いにしない
- matrix mode では `entries[]` に route family ごとの結果を出す。budget 設定済み route が
  `Content-Length` なしで body fallback 計測になった場合、CLI上は payload bytes を測れても
  runtime `withRoutePerformance` では `unmeasured` になるため `PAYLOAD_UNMEASURED` warning として失敗させる
- 出力する `paths` / `entries[].path` は pathname のみ。検索語、patientId query、hash、
  cookie/header、response body は出力しない

## 記録ルール

- pilot 前は主要 API を 3 回以上計測し、最悪値を `Plans.md` または運用記録へ転記する
- `p95_ms > 500` のルートはボトルネック調査対象とする
- `p99_ms > 1000` のルートは tail latency 調査対象とする。環境別に変える場合は
  `PERF_P99_TARGET_MS` または `--p99-target-ms` を使う
- critical BFF は `Plans.md` の route payload budget registry と同じ normalized route/family で記録する。
  query string、hash、患者ID、org ID、検索語は budget key に含めない
- critical route を横断確認する場合は、aggregate smoke ではなく matrix mode を使う。
  aggregate mode は複数 `--path` を round-robin できるが、route family ごとの
  `over_budget` / `unmeasured` を特定する用途には使わない
