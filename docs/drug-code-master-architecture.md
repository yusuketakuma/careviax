# 医薬品管理コード設計メモ

作成日: 2026-06-28

## 前提

CareViaX では、処方登録以降の薬剤同一性判定を医薬品名ではなく医薬品コードで行う。医薬品名は表示、検索、監査説明、未解決時の候補提示には使ってよいが、コード解決済みの処方行を薬品名だけで結合・比較・照合してはならない。

ユーザー表現の「GSIコード」は、医療用医薬品バーコード文脈では通常 `GS1` / `GTIN` を指すものとして扱う。

## 2026-06-29 学習結果

- 厚生労働省系の基礎データは、診療報酬情報提供サービス / 社会保険診療報酬支払基金の基本マスターが起点になる。支払基金の基本マスター説明では、全件ファイルは診療報酬情報提供サービスと同一ファイルとされている。
- 2026-06-29 時点で確認した支払基金の医薬品マスターは、最終更新日 2026-06-19、全件マスター 18,496 件、改定分マスター 1 件だった。実装時は「現在確認した最新」を固定値として埋めず、取込ジョブが公開日・件数・ファイル種別・ハッシュを保存する。
- 医療用医薬品の現物バーコードは `GS1` 標準の `GTIN` を商品コードとして扱う。厚労省通知では調剤包装単位に GTIN-13、販売包装単位・元梱包装単位に GTIN-14 を用い、バーコード利用時は 14 桁フォーマットとして扱う前提が示されている。
- GS1 Application Identifier は、商品コード `01`、有効期限 `17` または `7003`、数量 `30`、製造番号 / 製造記号 `10` または `21` を扱う。CareViaX ではスキャン値を単なる `jan_code` 文字列として捨てず、GTIN、期限、ロット、シリアル、数量を evidence として分けて保存する。
- YJ コードは薬価基準収載単位 / 個別医薬品コードとして、処方行・CDS・PMDA 関連情報リンクの canonical code に近い。PMDA は YJ コードから関連情報一覧へ遷移する URL 仕様を公開している。
- レセプト電算処理システム用コードは保険請求・電子点数表・基本マスター側のコードであり、電子お薬手帳 QR / JAHIS 等の取込元コードとして来ることがある。処方行では直接主キーにせず、DrugMaster へ解決して YJ へ正規化する。
- HOT コードは MEDIS-DC の標準医薬品コード体系として、YJ、レセ電、JAN/GTIN などの対応関係を扱う横断キーに近い。利用許諾・更新元・更新日を分けて管理する。

## 公式・準公式ソースの役割

| コード                              | 主な用途                                                                                   | CareViaXでの扱い                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| レセプト電算処理システム用コード    | 診療報酬請求、医薬品マスター検索、基本マスターファイル                                     | 支払基金/診療報酬情報提供サービス由来の請求・マスター基礎コード。QR/JAHIS 取込では `receipt_code` として保存・照合する。                      |
| 薬価基準収載医薬品コード / YJコード | 処方・調剤・添付文書リンク等での医薬品同一性                                               | 処方行の canonical code として最優先に扱う。現行 `PrescriptionLine.drug_code` は YJ コード想定。                                              |
| HOTコード                           | 複数コード体系の対応表、標準マスター横断                                                   | `yj_code` / `receipt_code` / `jan_code` 変換の横断キーとして扱う。処方行の主キーそのものにはしない。                                          |
| JANコード / GS1 GTIN                | 調剤包装単位、販売包装単位、元梱包装単位のバーコード、期限・ロット・シリアルを含む現物確認 | 処方行の同一性ではなく包装・実物照合レイヤー。GTIN/JAN から DrugMaster/包装行へ解決し、解決先の canonical YJ が処方行と一致するかを検証する。 |

## 実装上の責務分離

- `DrugMaster`: 医薬品概念の canonical record。`yj_code` を一意キー、`receipt_code` / `hot_code` を対応コードとして保持する。現行の単一 `jan_code` は互換 fallback とし、包装単位の正規化は `DrugPackage` へ移す。
- `DrugPackage`: GTIN/JAN、包装単位、包装階層、入数、販売会社、ロット/期限/シリアル evidence を扱う。処方同一性ではなく現物照合・リコール・棚卸・監査の責務。
- `PrescriptionLine`: 処方登録以降の業務同一性。`drug_master_id` があれば最優先、次に canonical `drug_code`、未解決時のみ namespaced `name:<drug_name>` fallback を使う。`source_drug_code` / `source_drug_code_type` は取込元コードの監査証跡であり、canonical identity には昇格しない。
- `Intake source code`: QR/JAHIS/外部連携から来た元コード。`source_drug_code` と `source_drug_code_type` を保持し、YJ へ正規化できない場合は `review_required` にする。
- `Display name`: 表示、検索、候補提示、監査説明のための属性。コード解決済みレコードを結合・差分・重複判定するキーにしない。

## 判定ルール

1. YJ / DrugMaster 解決済みの処方行同士は、薬品名が同じでもコードが違えば別薬剤として扱う。
2. YJ / DrugMaster 解決済みの処方行同士は、薬品名表記が違ってもコードが同じなら同一薬剤として扱う。
3. GS1/GTIN スキャンは、まず包装単位から DrugMaster/YJ へ解決し、処方行 YJ と照合する。GTIN そのものを処方行の canonical code にしない。
4. レセ電コード / HOT コードで入ってきた処方は、DrugMaster で YJ に正規化してから downstream に流す。正規化不能なら `review_required` として止める。
5. 名称一致は候補提示に限定し、`resolved` として保存しない。手動確定時は確定者、確定日時、元コード、候補 ID、理由を監査できるようにする。
6. マスター更新では、廃止日、経過措置年月日、商品名医薬品コード使用期間、更新元ファイル、公開日を保持する。過去処方の監査再現性のため、削除ではなく有効期間管理に寄せる。

## 現行実装の確認

- `DrugMaster` は `yj_code` を unique、`receipt_code` / `hot_code` / `jan_code` を任意コードとして保持している。`DrugPackage` は package-level GTIN/JAN と DrugMaster の対応を保持し、`DrugMaster.jan_code` は移行期間の fallback とする。取込状態 API / 管理画面の鮮度カードは `DrugPackage` 件数と active package を持つ `DrugMaster` の coverage を表示し、包装単位マスターの欠損を早期に把握できるようにする。日次の `drug_master_freshness_check` も package-linked coverage が閾値を下回った場合に管理者へ PHI なしで通知する。
- `PrescriptionLine` は 2026-06-29 の expand-only migration で nullable `drug_master_id`、`source_drug_code`、`source_drug_code_type`、`drug_resolution_status` を持つ。`drug_master_id` は `DrugMaster(id)` への FK で、resolved のときだけ dual-write する。`drug_code` は引き続き canonical YJ コードとして扱う。
- JAHIS QR 取込は `drugCodeType` に応じて `receipt_code` / `yj_code` / `hot_code` を優先探索する。2026-06-29 の backend slice で、薬品名 `contains` は候補提示専用に変更した。名前一致候補は `candidate_drug_*` / `suggestedDrug*` に残すが、`line.drug_code` を YJ へ昇格せず、`drug_code_resolution_status: review_required` として確定前に薬剤師レビューを要求する。
- 調剤バーコード検証は GS1 AI `01` の GTIN/JAN から active `DrugPackage` を先に探し、解決先 DrugMaster の `yj_code` と処方行 `drug_code` を比較する。package 行がない場合だけ、互換 fallback として `DrugMaster.jan_code` を使う。package lookup が複数 DrugMaster に割れる場合や別 YJ に解決される場合は fallback せず mismatch として止める。
- 既存 `DrugMaster.jan_code` から `DrugPackage` への移行は `tools/scripts/backfill-drug-packages-from-drug-master-jan.ts` で dry-run 解析できる。これは SELECT + 分類のみで、`--apply` は未実装。`--json-output` / `--markdown-output` で運用レビュー成果物を生成できる。安全候補は単一 DrugMaster の有効 JAN/GTIN で既存 package conflict がない行だけで、重複 JAN、不正 JAN、既存 package が別 master を指す行は自動 backfill しない。
- 処方比較の共有ロジックは `master:<drug_master_id>` / `code:<drug_code>` / `name:<drug_name>` の namespaced identity key を使う。2026-06-28 の backend slice で、ワークベンチBFF側に残っていた薬品名 queue を廃止し、code-first で対応づいた current/previous 行ペアから `change_type` を直接導出するようにした。`comparison` レスポンスには `current_drug_code` / `previous_drug_code` も返す。2026-06-29 の follow-up で、処方日付継続性、処方登録重複検出、登録画面の前回処方差分、患者ワークスペース薬剤変更表示、MedicationProfile 同期、CDS 重複投薬チェックも同じ code-first 方針へ寄せ、未解決薬品名が実コード文字列と衝突しないようにした。2026-06-29 の追加 follow-up で、`PrescriptionLine.drug_master_id` が取れる差分・継続性・CDS・訪問準備・調剤プリフィル経路は master-first identity を読むようにした。
- `ResidualMedication` は訪問記録時点の残薬スナップショットであり、2026-06-30 の expand-only migration で nullable `drug_master_id` を持つ。訪問記録作成/更新、単独残薬API、競合スナップショット、オフラインSOAPドラフトは `drug_master_id` を保存・復元し、残薬調整の tracing follow-up / operational task dedupe は `master:<drug_master_id>`、次に `code:<drug_code>`、最後に `name:<drug_name>` を使う。存在しない `drug_master_id` は保存前に validation error とし、名称だけの残薬記録は引き続き未解決 fallback として許容する。
- `DrugMasterImportLog` は nullable `source_url` / `source_file_hash` / `source_published_at` / `import_mode` / `change_summary` を持つ。SSK/MHLW/PMDA/HOT 公式取込は取得した ZIP/Excel/CSV の SHA-256 と、解決できる場合は公開日・full/delta・件数 summary を保存し、管理画面の取込履歴で source、hash prefix、published、mode、summary を確認できる。各 `POST /api/drug-master-imports/*` 成功レスポンスも `sourceFileHash` / `sourcePublishedAt` / `importMode` / `changeSummary` を返すため、取込直後の画面更新や運用ログでも同じ provenance を確認できる。取込状態 API と鮮度カードも最新成功ログの hash/published/mode/summary を表示し、状態確認と履歴確認で同じ evidence を見られる。SSK 自動更新は ZIP URL だけでなく `ssk:<source_file_hash>` を job dedupe key にするため、同一 URL でファイル内容が差し替わっても更新をスキップしない。SSK 取込 API は `dryRun: true` で import log / upsert を行わず、create/update/unchanged 件数と差分サンプルを返す。PMDA 添付文書取込 API も `dryRun: true` と `previewLimit` を受け取り、package insert の create/update/unchanged/skip と matched interaction pair 件数を read-only に返すため、臨床安全情報の広域更新前に差分を確認できる。HOT 取込 API は `dryRun: true` で import log / `DrugMaster` / `DrugPackage` を書かず、実 import と同じ upsert 単位で `drug_master_upsert_count` / `package_upsert_count` / YJ欠損 / invalid YJ / GTIN conflict / 包装コード不正件数とサンプルを返す。MHLW 薬価リスト取込 API は `dryRun: true` で import log / `DrugMaster` / change event を書かず、薬価リスト workbook 数、DrugMaster upsert 件数、invalid YJ skip、薬価・経過措置期限 change event 件数とサンプルを返す。MHLW 一般名/後発フラグ取込 API も `dryRun: true` で import log / `DrugMaster` / `GenericDrugMapping` を書かず、後発フラグ upsert 件数・変更予定件数・invalid YJ skip、一般名 mapping rebuild 件数・brand candidate 件数・例外YJ invalid skip とサンプルを返す。
- 調剤結果の差異理由判定は、実薬剤コードまたは処方薬剤コードが存在する場合はコード比較だけで薬剤差分を決める。コード一致時の表示名ゆれでは理由を要求せず、コード欠落またはコード不一致は差分として理由を要求する。両側とも未解決コードなしの場合だけ薬品名フォールバックを使う。
- 管理者向け在庫予測は、処方行 `drug_code` と在庫側 `DrugMaster.yj_code` を `code:<YJ>` identity として需要/在庫を突合する。薬剤ベース名は表示・未解決 fallback に限定し、同じ表示名でも別コードの薬剤を必要量・在庫・影響患者で混合しない。
- MedicationProfile 同期は `master:<drug_master_id>`、`code:<drug_code>`、`name:<unresolved drug_name>` を分離する。旧データで `drug_master_id` に薬剤コードが入っている可能性だけは `legacy-code:<drug_code>` として解決済み incoming code からの昇格に限定し、未解決コードや同名フォールバックでは master-linked profile を current のまま残さない。
- 医薬品コード解決は `src/lib/pharmacy/drug-identity-resolution.ts` の共有 resolver に集約する。YJ は最優先の canonical identity として扱い、receipt/HOT は DrugMaster 候補が一意の時だけ YJ へ正規化する。receipt/HOT が複数 DrugMaster に該当する場合は DB 取得順で先勝ちせず、`ambiguous_code` として未解決にする。JAN/GTIN は包装単位 identity なので、処方行 identity resolver では明示的に許可しない限り解決対象にしない。
- 既存 `PrescriptionLine` の `drug_master_id` backfill は `tools/scripts/backfill-prescription-line-drug-master-ids.ts` で dry-run 解析できる。これは SELECT + 共有 resolver 分類のみで、`--apply` は未実装。`--json-output` / `--markdown-output` で運用レビュー成果物を生成できる。安全候補は resolved かつ conflict なしの行だけで、曖昧コード、未発見コード、欠損コード、既存 master/code 不整合、JAN/GTIN、名称一致のみは自動 backfill しない。
- `PATCH /api/prescription-lines/[id]` は `drug_master_id` を受け取り、薬剤師が未解決 `PrescriptionLine` を医薬品マスターへ確定できる。確定リクエストでは処方内容フィールドとの同時更新を拒否し、client からの `drug_code` / `source_drug_code` / `source_drug_code_type` / `drug_resolution_status` は受け取らない。サーバーが `DrugMaster.yj_code` を canonical `drug_code` として書き、`source_*` は監査証跡として保持する。既存 `drug_master_id` が別 master の場合、または `source_drug_code` / `drug_code` のいずれかが決定的に別 master へ解決される場合は 409 で止める。

## 設計方針

1. 処方登録以降の行同一性は `drug_master_id`、なければ canonical `drug_code`、最後に未解決名の順で扱う。
2. コード解決済み行では `drug_name` だけを key にした Map、queue、dedupe、join を作らない。
3. 名称一致フォールバックは「解決済み」と同格に扱わず、`unmatched` / `needs_review` / `manual_resolution` の状態を残す。
4. GS1/JAN/GTIN は包装単位コードなので、`DrugMaster` 直下の単一 `jan_code` ではなく `DrugPackage` で保持する。既存 `DrugMaster.jan_code` は移行期間の fallback に限定する。
5. マスター取込は source、公開年月、適用開始/廃止/経過措置を保存し、コードの有効期間を監査できる形にする。
6. `drug_master_id` への dual-write は共有 resolver の `resolved` 結果だけを使う。`ambiguous_code` / `code_not_found` / `missing_code` / `review_required` candidate は master-linked profile、在庫自動突合、CDS、carry key に自動採用しない。

## 次の実装候補

1. QR/JAHIS 取込で `review_required` の行を薬剤師が確定コードへ解決する UI を実装し、既存 `PATCH /api/prescription-lines/[id]` の `drug_master_id` 確定契約へ接続する。
2. 既存 `PrescriptionLine` の `drug_master_id` dry-run 結果を運用レビューし、conflict / ambiguous / code_not_found / missing_code を手動解消する。apply モード追加は別承認・maxRows・小バッチ・runbook が揃ってから行う。
3. `DrugPackage` への GTIN/JAN 取込ジョブを追加し、包装単位、入数、公開日/source hash、ロット/期限 evidence の関係を運用データで埋める。
4. `rg "drug_name"` で検出される downstream keying を順次 `drug_code` / `drug_master_id` 優先へ置換する。残薬系は `ResidualMedication.drug_master_id` が入る経路から順に、表示名 fallback を「未解決時だけ」に狭める。
5. 広域更新は入力確認付きダイアログで誤クリック実行を防ぐ。SSK 公式取込、PMDA 添付文書取込、HOT 包装マスター取込、MHLW 薬価リスト取込、MHLW 一般名/後発フラグ取込は API レベルの dry-run preview が入り、管理画面の取込確認ダイアログから差分 summary とサンプル行を確認できる。次は source 別に preview row の表示項目をさらに業務向けに整え、更新後 diff / 履歴との比較を追加する。

## 参照元

- 社会保険診療報酬支払基金「基本マスター」: https://www.ssk.or.jp/seikyushiharai/tensuhyo/kihonmasta/
- 社会保険診療報酬支払基金「医薬品マスター」: https://www.ssk.or.jp/seikyushiharai/tensuhyo/kihonmasta/kihonmasta_04.html
- 厚生労働省「医療用医薬品へのバーコード表示の実施要項」: https://www.mhlw.go.jp/file/05-Shingikai-10801000-Iseikyoku-Soumuka/0000165470.pdf
- 厚生労働省「医療用医薬品を特定するための符号の容器への表示等について」: https://www.mhlw.go.jp/content/11120000/001018191.pdf
- 厚生労働省 診療報酬情報提供サービス「ファイルダウンロード」: https://shinryohoshu.mhlw.go.jp/shinryohoshu/downloadMenu/
- PMDA「添付文書の電子化について」: https://www.pmda.go.jp/safety/info-services/0003.html
- PMDA「YJコードから関連情報へのリンクに関する技術的情報」: https://www.pmda.go.jp/files/000268393.pdf
- GS1 Japan「医療製品のための GS1 識別コード（GTIN）使用指針」: https://www.gs1jp.org/assets/img/pdf/GTIN_shiyoshishin.pdf
- MEDIS-DC「MEDIS 標準マスター総合サイト」: https://www.medis.or.jp/4_hyojyun/medis-master/index.html
