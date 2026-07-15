# 設計判断インデックス

> このファイルは索引です。各判断の詳細な検討経緯・トレードオフはコミット履歴（該当 ID で `git log --all --grep`）と gbrain（`projects/careviax/decisions/*`、`gbrain search "D-0X"` 等）を参照してください。
> 確定案の一覧テーブル自体の SSOT は [`Plans.md` 「設計判断」節](../Plans.md#設計判断--docsdecisionsmd) です（テーブルはそちらで更新・追記され、以下は要約の写しです）。

## 確定済み設計判断（D-01〜D-15）

| ID   | 確定案（要約）                                                                |
| ---- | ----------------------------------------------------------------------------- |
| D-01 | 電子版お薬手帳QR（JAHIS 24-104 Ver.2.6）は患者持参の照合証拠として取り込む    |
| D-02 | 初日からマルチテナント（Prisma + PostgreSQL RLS）                             |
| D-03 | 多職種連携: Ph1a 連携ログ+文書送付 → Ph1b 依頼/照会WF → Ph2 外部共有          |
| D-04 | お薬手帳連携は Adapter Plane で FHIR MedicationStatement / evidence へ変換    |
| D-05 | レセプト算定は候補表示+3層バリデーション（自動算定しない）                    |
| D-06 | 旧 clinical model は deterministic one-way conversion で完全置換              |
| D-07 | 医薬品マスタは4層モデル（標準化/法人/店舗/個人）                              |
| D-08 | Prisma = メインORM + PostgreSQL RLS（工程権限はフラグ制御）                   |
| D-09 | AWS 全面採用（ISMAP準拠、3省2ガイドライン対応）                               |
| D-10 | ルート最適化は Google Routes API（住所→座標はジオコーディングAPI）            |
| D-11 | MVPは現場運用優先（訪問記録/報告/持参判定を先行、最適化と高度請求は後段）     |
| D-12 | 外部システム責任分界を先に固定（SourceOfTruthMatrix を実装前に整備）          |
| D-13 | PDF生成: React-PDF サーバーサイド実行（一括出力はキュー+ZIP+S3）              |
| D-14 | 楽観的ロック（version カラム + 409 Conflict）で同時編集競合を制御             |
| D-15 | バックグラウンドジョブ: EventBridge Scheduler（日次/夕方/翌営業日/月次の4層） |

各 ID の完全な確定案文言・状態は `Plans.md` の該当テーブル行が正本です。新しい設計判断が確定した場合は `Plans.md` 側にまず追記し、必要に応じてこの索引にも一行を反映してください。

## FHIR Native platform decision（v0.5 / 2026-07-15）

- FHIR R4 4.0.1 と `jpfhir.jp.core#1.2.0` を package/hash 付きで固定し、FHIR Resource
  自体を内部 Clinical Core とする。FHIR 風 DTO や legacy model の出力 projection を正本にしない。
- FHIR Clinical Data、Technical Control、Legacy / Official Adapter の 3 plane を分離する。
- yrese は処方・調剤 Resource の authoritative server、PH-OS は在宅・服薬管理 Resource の
  authoritative server とする。相手所有 Resource は canonical identity 付き read-only replica とし、
  same-resource multi-master を禁止する。CareTeam の owner/profile/replica direction は Phase 0 の
  明示判断まで UNRESOLVED とする。
- clinical API は FHIR REST、transaction Bundle、Subscription、history に限定し、PH-OS / yrese UI も
  同じ Data Plane を利用する。JAHIS、NSIPS、電子処方箋は Adapter Plane に隔離する。
- runtime 後方互換や並行運用は設けない。deterministic one-way conversion、read-only snapshot dry run、
  親FHIR/JP Core制約を緩和しないhistorical invalid data方針、full reconciliation、全ingressと
  outbound/export/Subscriptionのcutover epoch / source watermark fence、yrese sandbox/consumer readiness、
  human-approved single hard cutoverで完全置換する。
  最終承認後の write 再開を irreversible commit point とし、それ以前の abort は whole release と
  cutover 直前 recovery set の一体 restore、それ以後の recovery は FHIR-native recovery set +
  append-only Resource history/accepted-write/ingress journal replay または forward-fix とする。
  write再開後にacknowledgeしたclinical writeはRPO=0とし、例外は定量化RPOと患者安全の明示承認を要求する。
- Binary/object contentのownerは参照元DocumentReferenceに従う。FHIR `Attachment.hash`のSHA-1とは別に
  recovery/migration manifest用SHA-256を保持し、raw/presigned URLをResourceやControl Planeへ複製しない。
- Technical Control Plane の outbox/delivery event は opaque Resource identity、version/hash、delivery state
  だけを保持し、臨床payloadや独自 event DTO を複製しない。
- SMART on FHIR、Bulk Data、CDS Hooks は core cutover 後の ecosystem work とする。

## 関連仕様書

- FHIR Native v0.5 の 3 plane、Resource ownership、adapter、validation、hard-cutover 境界は
  [`docs/architecture/fhir-first-prescription-platform.md`](architecture/fhir-first-prescription-platform.md)
  を参照。
- ワークフロー詳細・多職種連携詳細は [`docs/visit-report-collab-spec.md`](visit-report-collab-spec.md)（在宅薬剤管理3機能: 訪問時記録/報告書自動生成/多職種共有の統合仕様）を参照。
- アーキテクチャ・技術スタック・コンプライアンス方針は `CLAUDE.md` を参照。
