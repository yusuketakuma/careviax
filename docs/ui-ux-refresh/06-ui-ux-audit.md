# UI/UX Audit — 画面横断監査（Phase 5 統合）

更新: 2026-07-11
状態: **DONE（静的コード・台帳監査）**。実画面での確認、支援技術、レスポンシブ、オフライン状態の検証は Phase 9 で実施するまで `NOT_EXECUTED` である。

## 1. 監査範囲・判断方法

- 対象は Phase 3 の count-verified 128 route、主要状態、17 の実在ジャーニー、および Phase 4 の状態所有権監査である。
- 根拠はソース、既存テスト、SSOT、ルート台帳を照合した静的調査である。スクリーンショット、実患者データ、外部ログイン済み競合製品、実稼働データは使っていない。
- issue の必須項目（ID、対象、再現、現状/期待、利用者・患者安全影響、根本原因、影響画面、制御、レイヤー、優先度、検証、証拠）は、詳細台帳の各節に記録する。詳細台帳で `Proposed control` にレイヤーを併記していたものは、本書の索引で正規化した。
- P0 は患者取り違え、データ損失、重大な誤認、操作不能、重大なアクセシビリティ阻害に限る。本監査では、静的根拠だけで直ちに P0 と断定できる issue はない。P1 は Phase 6 の設計ゲート、P2/P3 は共通基盤または画面展開の優先順位に用いる。

## 2. 監査結果サマリ

| 優先度 | 件数 | IDs                                             | 判断                                                      |
| ------ | ---: | ----------------------------------------------- | --------------------------------------------------------- |
| P0     |    0 | —                                               | 重大事象の有無は Phase 9 の実シナリオで再検証する         |
| P1     |    4 | DV-02, DV-07, NF-01, NF-02                      | 判読性、患者識別、false-empty/false-zero を先に是正対象へ |
| P2     |   11 | DV-01, DV-03, DV-04, DV-06, DV-08, NF-03〜NF-08 | 共通契約・状態表現の分裂を収束                            |
| P3     |    3 | DV-05, NF-09, NF-10                             | 基盤の整備時に回収                                        |

患者安全上の最重要の横断テーマは、患者コンテキスト、判読可能な薬剤・数値表示、取得失敗と空/正常の区別、保存・同期・鮮度の意味分離、権限と復旧行動の可視化である。具体的な危害シナリオと対策は [07-use-error-risk-register.md](07-use-error-risk-register.md) を正とする。

## 3. 要求分類の被覆

| 監査分類                                                                         | 結果                                               | 主な根拠                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Product UX / IA / navigation / page hierarchy                                    | finding                                            | NF-03, NF-05, NF-09                                                                |
| Patient context / prescription comparison / clinical alerts                      | finding                                            | DV-07, DV-08, R-A-01〜R-A-09                                                       |
| Visual hierarchy / density / typography / spacing / color / iconography / tokens | finding                                            | DV-01〜DV-06                                                                       |
| Responsive / accessibility / keyboard / focus                                    | Phase 9 へ検証を繰越                               | DV-02, DV-07, DV-08 は静的な a11y/狭幅リスク。実操作・forced-colors・zoom は未実施 |
| Forms / validation                                                               | risk register                                      | R-A-04, R-A-05, R-A-10                                                             |
| Data tables / search / filters / sorting / pagination                            | finding                                            | DV-01, NF-03                                                                       |
| Feedback / notifications / loading / empty / error recovery                      | finding                                            | NF-01, NF-02, NF-04, NF-06〜NF-09                                                  |
| Authentication / authorization / record lifecycle                                | risk register                                      | RB-04, RB-09, RB-10, R-A-10〜R-A-13                                                |
| Offline / sync / conflict / file handling / rate limiting                        | risk register                                      | RB-01〜RB-08                                                                       |
| Performance / content / screen-specific issues                                   | assessed; no separate performance regression claim | NF-04, DV-02, DV-05 と各 route-specific issue。性能計測は Phase 9                  |

## 4. Issue index

| ID    | 問題                                                | 主レイヤー                 | 優先度 | 詳細証拠                                                                                                                                                               |
| ----- | --------------------------------------------------- | -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DV-01 | DataTable の数値列契約がない                        | primitive / table contract | P2     | [density/visual](phase5/audit-density-visual.md#dv-01-datatable-に数値列契約整列tabular-nums単位が無く画面ごとに三様)                                                  |
| DV-02 | 12px 未満の文字が残る                               | tokens / typography        | P1     | [density/visual](phase5/audit-density-visual.md#dv-02-sub-12px-タイポグラフィ残存-81-箇所--服薬カレンダーの薬剤名-10px印刷-9px-を含む)                                 |
| DV-03 | アイコンの意味が画面間で分裂                        | icon registry              | P2     | [density/visual](phase5/audit-density-visual.md#dv-03-アイコンの意味分裂--同一グリフの別名-2-組eye-3-義clock-2-義play-が開始と完了を兼務)                              |
| DV-04 | 状態色を広い面・mutation button に使う              | tokens / primitives        | P2     | [density/visual](phase5/audit-density-visual.md#dv-04-全彩度-bg-state-bg-tag-62-行--うち-mutation-ボタンの緑青ベタ塗り-7-箇所は-51-明文違反)                           |
| DV-05 | Metric/KPI card が4重複                             | shared component           | P3     | [density/visual](phase5/audit-density-visual.md#dv-05-ローカル-metriccardkpicard-4-重複--72-の新規禁止統合対象が残存し視覚仕様も乖離)                                  |
| DV-06 | 状態ラベルの散在と表記揺れ                          | status registry            | P2     | [density/visual](phase5/audit-density-visual.md#dv-06-状態ラベルの散在constants-外-124-ファイルと同一状態の表記揺れ--同一工程が画面により訪問完了訪問済監査済監査済み) |
| DV-07 | 患者識別子が復元不能に切り詰められる                | patient context primitive  | P1     | [density/visual](phase5/audit-density-visual.md#dv-07-患者識別要素氏名カナの復元手段なし-truncate--識別-ssot-ヘッダ自身が切り詰める)                                   |
| DV-08 | 処方受付トリアージで重要文字列が切り詰められる      | intake list / responsive   | P2     | [density/visual](phase5/audit-density-visual.md#dv-08-処方受付トリアージ一覧の切り詰め--発行元は復元不能処方内容は-hover-専用-title-のみ)                              |
| NF-01 | 患者編集の取得失敗を not-found と誤認させる         | route query state          | P1     | [navigation/feedback](phase5/audit-nav-feedback.md#nf-01-患者編集画面が取得失敗を患者情報が見つかりませんに畳み込むretry-なし誤認誘発)                                 |
| NF-02 | performance の false-zero が all-clear を誤認させる | data-state contract        | P1     | [navigation/feedback](phase5/audit-nav-feedback.md#nf-02-adminperformance今すぐ見る要対応シグナル帯の-false-zero偽-all-clear残存)                                      |
| NF-03 | URL 共有可能状態が画面ローカルに残る                | URL-state contract         | P2     | [navigation/feedback](phase5/audit-nav-feedback.md#nf-03-タブフィルタページングの-url-非同期化残存ブラウザバック共有リロードで状態喪失)                                |
| NF-04 | loading 被覆・形状が不統一                          | route loading primitive    | P2     | [navigation/feedback](phase5/audit-nav-feedback.md#nf-04-loadingtsx-被覆-6012868-ルート欠落と形状不一致スケルトン)                                                     |
| NF-05 | platform の境界復旧先が文脈に合わない               | route error boundary       | P2     | [navigation/feedback](phase5/audit-nav-feedback.md#nf-05-platform-に-error-boundary-なし--root-境界の復帰-cta-がダッシュボードへ戻る固定)                              |
| NF-06 | 画面内取得エラーに retry/共通表示がない             | query/error primitive      | P2     | [navigation/feedback](phase5/audit-nav-feedback.md#nf-06-取得エラーの-retry-なし素テキスト逸脱と手組みエラー表示の残存)                                                |
| NF-07 | 401/403/offline を一律 server error にする          | client fetch contract      | P2     | [navigation/feedback](phase5/audit-nav-feedback.md#nf-07-fetch-層がステータス非分別で権限認証オフライン失敗が全てサーバーエラーに化けるerrorstate-variant-偏りの根因)  |
| NF-08 | mutation 失敗を toast だけで伝える                  | feedback/action primitive  | P2     | [navigation/feedback](phase5/audit-nav-feedback.md#nf-08-mutation-失敗の通知が-toast-のみssot-42失敗の唯一の通知手段禁止に違反する残存群)                              |
| NF-09 | empty state が3方式に分裂                           | empty-state primitive      | P3     | [navigation/feedback](phase5/audit-nav-feedback.md#nf-09-空状態の-3-流派emptystatedatatable-emptymessage素テキストが併存)                                              |
| NF-10 | redirect-only route に不要な loading がある         | route hygiene              | P3     | [navigation/feedback](phase5/audit-nav-feedback.md#nf-10-リダイレクト専用ルートに-loadingtsx-が残存ssot-明文違反の死にファイル)                                        |

## 5. Phase 6 への設計入力

1. `StateBadge` / `StatusDot` の既存 role contract を拡張する前に、状態語彙・icon registry・local label の正規化表を規範 SSOT に定める（DV-03/04/06）。
2. 患者コンテキスト、薬剤/数値表示、処方差分、critical alert は狭幅時にも情報を隠さない component contract にする（DV-01/02/07/08、R-A-01〜R-A-07）。
3. local / server / syncing / conflict、fresh / stale、authorization / authentication / offline / retry を別々の状態として Visual Status Matrix に置く（NF-01/02/07/08、RB-01〜RB-09）。
4. P1 の実装順は、患者安全 reviewer と設計レビューで use scenario・受入基準を確定後に決める。医療・権限・同期・監査に触れる実装は、必要な高リスク gate を通してから着手する。

## 6. 未実施・残存の検証

この文書は実装完了やコンプライアンス準拠を主張しない。Phase 9 で、主要導線の keyboard/focus、screen reader、200% zoom、forced-colors、reduced-motion、mobile/tablet/desktop、offline/restore/conflict/upload/429、認証・権限拒否、実シナリオを検証し、issue の再現と解消を証跡化する。
