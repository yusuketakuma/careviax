# パフォーマンス簡易負荷試験

## 目的
- `3-4: パフォーマンス最適化（P95<500ms）` の事前計測をローカル/検証環境で再現可能にする
- 実運用前に対象 API の P50 / P95 / エラー率を記録する

## 実行コマンド
```bash
corepack pnpm perf:smoke --base-url http://127.0.0.1:3000 --path /api/health --requests 80 --concurrency 8 --target-ms 500
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

## 出力
- JSON で `average_ms`, `p50_ms`, `p95_ms`, `max_ms`, `error_count`, `target_met` を出力
- `target_met=false` または `error_count>0` の場合は終了コード 1

## 記録ルール
- pilot 前は主要 API を 3 回以上計測し、最悪値を `Plans.md` または運用記録へ転記する
- `p95_ms > 500` のルートはボトルネック調査対象とする
