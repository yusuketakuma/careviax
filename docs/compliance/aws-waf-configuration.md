# I-01 — AWS WAF 構成

## 概要

CareViaX 本番公開面の前段に配置する AWS WAF の標準構成を定義する。ALB または CloudFront に関連付け、SQLi/XSS/既知悪性入力/レート制限/Geo 制限を一貫して適用する。

## 適用対象

- 本番 ALB: `${WAF_ASSOCIATED_ALB_ARN}`
- ステージング ALB: 本番と同一ルールを `count` で先行検証

## ルールセット

1. `AWSManagedRulesCommonRuleSet`
2. `AWSManagedRulesSQLiRuleSet`
3. `AWSManagedRulesKnownBadInputsRuleSet`
4. IP reputation list
5. `/api/*` への rate-based rule
6. 日本国外トラフィックの block

実体テンプレートは [`../../tools/infra/aws-waf-web-acl.json`](../../tools/infra/aws-waf-web-acl.json) を SSOT とする。

## ログ

- 出力先: CloudWatch Logs `/aws/waf/careviax-prod`
- アーカイブ: Firehose または subscription filter 経由で S3 へ退避
- マスク対象: `authorization`, `cookie`

## 運用

- 変更は C-02 の通常変更または重要変更として扱う
- ステージングで `count` 監視後、本番へ `block` 昇格
- 月次レビューで block 件数と誤検知を確認

## 更新履歴

| 日付 | 更新内容 |
|---|---|
| 2026-03-31 | I-01 テンプレートと運用方針を追加 |
