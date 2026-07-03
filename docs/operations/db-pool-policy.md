# DB コネクションプール方針

## 目的

Prisma / `pg` コネクションプールの既定値・スケール時の考え方・逼迫時の診断手順・PgBouncer 導入判断基準を明文化する。実装 (`src/lib/db/client.ts`, `src/lib/db/rls.ts`) とインシデント対応 (RUN-20260622-001, W2-P1) から言えることのみを記載し、実測値は捏造しない。

---

## 1. プール既定値と根拠

`src/lib/db/client.ts`:

| 項目                   | 値                                                       | 出典                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| デフォルトプールサイズ | `20`（`DEFAULT_DATABASE_POOL_SIZE`）                     | コードコメント: 「pg default is 10. Workflow dashboard fires 25+ parallel queries, so we raise to 20 to reduce connection queuing under concurrent load.」 |
| 上限クランプ           | `100`（`MAX_DATABASE_POOL_SIZE`）                        | `resolveDatabasePoolSize()` が `Math.min(normalized, MAX_DATABASE_POOL_SIZE)` で強制                                                                       |
| 環境変数               | `DATABASE_POOL_SIZE`（optional, `docs/env-catalog.md`）  | 未設定・`NaN`・`Infinity`・0以下・非有限値は既定値 20 にフォールバック（`client.test.ts` で全パターンをテスト済み）                                        |
| スコープ               | Node.js プロセス（Next.js ランタイム）単位のシングルトン | `getPrismaClient()` は初回アクセス時に1回だけ `PrismaPg({ connectionString, max: poolMax })` を生成し、`globalForPrisma.prisma`（非production）で使い回す  |

つまり `DATABASE_POOL_SIZE`（または既定の20）は「**アプリのプロセス／インスタンス1つが RDS に対して同時に保持できる物理コネクションの上限**」であり、インスタンスが複数動けばその数だけ倍加する。

`DIRECT_URL` は `DATABASE_URL` と同一値（CLAUDE.md 環境変数一覧: 「Same (no pooler needed for RDS)」）。つまり現状 PgBouncer / RDS Proxy のような外部プーラーは介在せず、Prisma の `pg` アダプタが RDS に直接接続してプールを張っている。

---

## 2. インスタンス数 × プールサイズ と RDS `max_connections` の関係

### 2.1 RDS 側の設定（現状ドキュメント値）

`docs/compliance/rds-configuration.md`:

- パラメータグループ `ph-os-pg16-production` の `max_connections = 200`（根拠として「Amplify デプロイ環境の Node.js プロセス数に対応」と明記）
- 同ドキュメントのチェックリスト本文では「データベース接続数 > 180 → Warning アラート」と記載

一方、実装済みの CloudWatch アラーム定義 (`tools/infra/cloudwatch-alarms.ts`, `ph-os-rds-connections-high`) は `DatabaseConnections` の `Threshold: 80`（5分平均 × 3期間 = 15分継続で発報）となっており、コンプライアンス文書の「180」と実装アラームの「80」は数値が一致していない。この不一致自体は本書のスコープ外（コード変更を伴う調整が必要）だが、**診断時は実際に発報する基準（アラーム実装側の 80）を一次情報として扱うこと**。

### 2.2 接続数の見積もり式

```
総接続数（概算） ≈ 稼働中のアプリインスタンス／プロセス数 × DATABASE_POOL_SIZE
                  + 読み取りレプリカ以外への管理系接続（migrate 実行、DB 管理ツール等）
```

`DATABASE_POOL_SIZE` は「1インスタンスあたりの上限」であって「アプリ全体の上限」ではない点に注意する。インスタンス数を増やす（水平スケール）判断とプールサイズを上げる判断は独立ではなく、掛け算で効いてくる。

- 既定の 20 のまま、CloudWatch アラーム閾値 80 を基準にすると、アプリインスタンスが 4 つ同時にプールを使い切る状態になるとアラーム発報域に入る計算になる（各インスタンスが実際にプールを使い切っているかは別途確認が必要）。
- `max_connections=200` を絶対上限とすると、既定プール 20 のままではインスタンス 10 個分でハード上限に達する計算になる（管理系接続やレプリカ用の余白は別途確保する必要がある）。
- `aws-cost-minimal-deployment.md` に記載の「本番 HA フロア: アプリインスタンス2台 + LB」のような水平スケール方針を採る場合、`DATABASE_POOL_SIZE` を単体で引き上げる前に、想定インスタンス数との掛け算が RDS 側の余白（アラーム閾値・`max_connections`）に収まるかを必ず確認する。

### 2.3 プールサイズ変更時のチェックリスト

`DATABASE_POOL_SIZE` を変更する、またはアプリインスタンス数を変更する際は次を確認する。

1. 変更後の「インスタンス数 × プールサイズ」が現在の RDS `max_connections`（200）に対してどの程度の割合になるか
2. CloudWatch `ph-os-rds-connections-high`（閾値80）に対する余白
3. 読み取りレプリカ・管理ツール・ローカル開発接続など、アプリプール以外の接続用途に必要な余白
4. RDS インスタンスクラス変更（`db.t4g.medium` → `db.r7g.large` 等）は `max_connections` のデフォルト値自体を変えうるため、パラメータグループの実値を必ず確認する

---

## 3. Interactive Transaction がプールを保持する時間

### 3.1 仕組み

Prisma の interactive transaction（`prisma.$transaction(async (tx) => { ... })`）は、コールバックが `BEGIN` してから `COMMIT`/`ROLLBACK` するまでの**間、プールから借りたコネクションを1本占有し続ける**。本リポジトリの RLS 実装 (`src/lib/db/rls.ts`) はこのパターンに強く依存している。

- `withOrgContext()`: `prisma.$transaction(work, { maxWait, timeout })` で1つの tx を張り、`applyRlsContext()` が `SET LOCAL app.current_org_id` 等をこの tx の中で設定してから呼び出し元の処理 (`fn(tx)`) を実行する
- `createScopedTxRunner()`: 同様に、呼び出し側ごとに独立した短い tx を張って `tx` を払い出す（`SCOPED_TX_DEFAULT_TIMEOUT_MS = 3000`, `SCOPED_TX_MAX_WAIT_MS = 2000`）

`SET LOCAL` はトランザクションスコープの設定なので、RLS 用のセッション変数はこの interactive tx の外では成立しない。裏を返すと、**tx コールバックの中で行う処理が重い・遅いほど、その分だけプールコネクションを長く握り続ける**ことになる。

### 3.2 RUN-20260622-001 で顕在化した問題

`src/server/services/prescription-intake-service.ts` のコメント（648行目付近）が明記する通り、以前は `yj_code` / `receipt_code` / `hot_code` の3列 OR 検索（`DrugMaster` へのグローバル参照読み取り）が書き込み interactive tx の**内側**で実行されていた。3列同時 OR はプランナが seq scan に落ちやすく、直 fetch で 33.7 秒かかる実測がインシデント (RUN-20260622-001) で確認されている。

この読み取りが tx の内側にある間、その tx は Prisma の interactive tx 既定 timeout（サービスコード中のコメントで「既定の 5s」と明記）をゆうに超えて動作しようとし、`/api/prescription-intakes` の tx-expired 500 という形で表面化した。加えて、同時に複数の書き込みリクエストが来た場合、それぞれが長時間プールコネクションを握るため、後続のリクエストがコネクション取得待ち（後述の maxWait 連鎖）に陥りやすい状態だった。

### 3.3 W2-P1 で行われた改善

`0066c082` (`perf(prescriptions): move DrugMaster resolution out of the intake tx (W2-P1)`) の変更点:

1. **DrugMaster 解決を tx の外へ前倒し**: グローバル参照テーブルの読み取り（書き込み側の行ロックや整合性を必要としない）を interactive tx の**外**（モジュールレベルの `prisma` client）で事前に実行し、結果 (`PreparedIntakeReads`) を tx へ渡す
2. **3列 OR 検索を列ごとの単体 WHERE に分割**（`buildDrugMasterCodeWheres()`）: 各列に個別 index があるため、列ごとに分けることでプランナが index scan を選びやすくなる
3. **残った書き込み専用 tx に明示 timeout を設定**: `PRESCRIPTION_INTAKE_WRITE_TX_TIMEOUT_MS = 15_000` / `PRESCRIPTION_INTAKE_WRITE_TX_MAX_WAIT_MS = 5_000`（サービスコードのコメント: 「interactive tx 既定の 5s より余裕を持たせつつ上限を明示する」）。これは intake/line 作成・rx 採番・fax/inquiry・`createDispenseDraft` の状態遷移など、tx 内で完結させる必要がある書き込み群のための予算であり、無関係な読み取りにこの予算を消費させない設計になっている。

### 3.4 今後の書き込みパスに適用する一般原則

- interactive tx コールバックの中身は「本当にトランザクション境界が必要な書き込み・整合性再確認」だけに絞る
- グローバル参照テーブル（マスタ系）の読み取りや、書き込み前に完了できる検証は tx の**外**で先に済ませる（W2-P1 と同じパターン）
- 新規に `$transaction` / `withOrgContext` / `createScopedTxRunner` を使うコードは、コールバック内で件数が読めないテーブルへの seq scan を起こしうる検索を書かないこと。列ごとの indexed lookup に分割できないか確認する
- 既定 timeout（5s 相当）に頼るのではなく、tx が実際に行う作業量に応じて `timeoutMs` / `maxWaitMs` を明示指定し、予算をコメントで根拠づける

---

## 4. 逼迫時の症状と診断手順

### 4.1 想定される症状（maxWait 連鎖）

プールが逼迫すると、典型的には次の順序で症状が連鎖する。

1. 複数の interactive tx を要求するリクエストが同時に到着し、それぞれが tx のコールバック実行中プールコネクションを1本ずつ占有する
2. プールサイズ（既定20、または `DATABASE_POOL_SIZE`）分のコネクションが埋まると、次に来たリクエストの `$transaction` 呼び出しは空きコネクションを待つ（`maxWait` の間だけ待機）
3. 先行 tx が重い（RUN-20260622-001 のような tx 内の遅い読み取り等）と、コネクションがなかなか解放されない
4. 待機中のリクエストが `maxWait`（例: `createScopedTxRunner` の既定 2000ms、`withOrgContext` 呼び出し側が指定する値、`prescription-intakes` 書き込み tx なら 5000ms）を超えると、そのリクエストもプール取得エラーで失敗する
5. 失敗したリクエストがリトライされたり、新規リクエストが継続的に到着し続けたりすると、埋まったコネクションが解放されるまで同様の失敗が連鎖する（＝ maxWait 連鎖）

このとき現れるエラーは大きく2系統に分かれ、原因の切り分けに使える。

- **プール取得タイムアウト（Prisma エラーコード P2024 系: "Timed out fetching a new connection from the connection pool"）**: プールに空きコネクションがない状態。`maxWait` を超えて待たされた結果であり、根本原因は「プールが埋まっている（インスタンス数×プールサイズ、または個々の tx が長時間コネクションを握っている）」側にある
- **tx 自体のタイムアウト（"Transaction already closed" / "A query cannot be executed on an expired transaction" 等）**: コネクションは取得できたが、tx コールバックが `timeout` オプションの時間内に完了しなかった状態。根本原因は「tx コールバックの中身が遅い」側にある（RUN-20260622-001 はこちら）

### 4.2 診断手順

1. **エラー種別の切り分け**: アプリログ / Sentry で発生しているエラーが「プール取得タイムアウト」か「tx 自体のタイムアウト」かを確認する。前者は接続数・インスタンス数側、後者は特定 tx コールバックの中身側に手を入れる問題である。
2. **RDS 接続数の確認**: CloudWatch の `DatabaseConnections`（`ph-os-rds-connections-high`, 現状閾値 80）と、パラメータグループの `max_connections`（200, `docs/compliance/rds-configuration.md`）を突き合わせ、インシデント発生時間帯に接続数がどの水準だったかを確認する。
3. **RDS Performance Insights**: Top SQL / Wait Events / DB Load を確認し、インシデント時間帯に実行時間の長いクエリ（特に interactive tx のコールバック内から発行されたもの）がないか確認する。RUN-20260622-001 のような「tx 内のグローバル参照テーブル seq scan」が典型パターン。
4. **`pg_stat_activity` の確認**（本番アクセスは承認手順に従う）: `state = 'idle in transaction'` や実行時間の長い接続を洗い出し、どの tx が最も長くコネクションを保持しているかを特定する。
5. **接続数の掛け算チェック**: インシデント時に稼働していたアプリインスタンス数 × `DATABASE_POOL_SIZE` を計算し、`max_connections` に対する比率を確認する。個々の tx が正常でも、インスタンス数の増加自体が構造的な逼迫要因になっていないかを見る。
6. **コードレビュー観点**: `$transaction` / `withOrgContext` / `createScopedTxRunner` の呼び出し箇所を grep し、新しく追加されたコールバックの中に、indexed lookup になっていないテーブル読み取りや、tx 境界が本来不要な参照読み取りが紛れ込んでいないか確認する（W2-P1 と同じ再発パターンの早期発見）。

---

## 5. PgBouncer 導入判断の基準

現状（2026-06-25 時点のスタック定義および `DIRECT_URL` 設定）では PgBouncer / RDS Proxy のような外部コネクションプーラーは導入されていない。Prisma の `pg` アダプタが RDS に直接接続し、プロセス内プール（既定20、上限100）のみで運用している。

### 5.1 PgBouncer が解決する問題ではないもの

PgBouncer は「多数の短命なクライアント接続を少数の DB 接続に多重化する」ことで接続数を抑える仕組みであり、**tx コールバックの中身が遅いために接続が長時間占有される問題（RUN-20260622-001 のクラス）は解決しない**。むしろ tx が長ければ PgBouncer 配下でもその tx 用の実接続は同じだけ占有される。したがって、まず §3.4 の「tx から重い読み取りを追い出す」パターンを適用し尽くしてから、次のステップとして検討する順序にする。

### 5.2 導入を検討すべきシグナル

以下のいずれかに該当する場合、PgBouncer（またはそれに準ずる外部プーラー）導入をロードマップに載せる判断材料とする。

- **インスタンス数側が支配的なボトルネックになっている**: 個々のインスタンスのプールは健全（枯渇していない）にもかかわらず、水平スケール（`aws-cost-minimal-deployment.md` の「本番 HA フロア: アプリインスタンス2台+LB」等）によって「稼働インスタンス数 × `DATABASE_POOL_SIZE`」が `max_connections`（200）に対して無視できない割合を占めるようになった場合
- **平常運用でアラーム閾値に張り付く**: §3.4 のtx短縮パターンを適用した後も、業務時間帯の通常運用で CloudWatch `DatabaseConnections` が `ph-os-rds-connections-high` の閾値（現状80）付近に恒常的に張り付くようになった場合（一時的なインシデント時のスパイクではなく定常状態として）
- **アクセスパターンの変化**: 現在の「長寿命 Node.js プロセスがプロセス内プールを保持する」モデルから、リクエストごとに新規接続を張るようなモデル（例: 短命な Lambda/サーバーレス実行環境を多数並行稼働させる構成）へアーキテクチャが変わる場合。この種のアクセスパターンは外部プーラーによる多重化の恩恵が大きい

### 5.3 導入する場合に事前確認が必要な事項

- **RLS のトランザクションスコープ設定との整合性**: `src/lib/db/rls.ts` は `SET LOCAL app.current_org_id` 等を `$transaction` コールバック内で設定しており、これはトランザクションスコープ（COMMIT/ROLLBACK で自動リセット）である。PgBouncer のトランザクションプーリングモードは「1トランザクション = 1実接続の一時貸与」なので、この使い方自体とは整合するはずだが、`$transaction` の外側（セッションスコープ）で Postgres 側の状態に依存するコードパスが将来的に追加されていないか、移行前に必ず監査する
- **本件は DB 接続トポロジ／インフラ変更に該当する**: RDS パラメータグループやネットワーク構成に関わる変更であり、本タスクの遂行ルール上も auth 境界・RLS ポリシー・DB migration・本番デプロイ設定と同様、通常ループでの無承認変更対象ではない。導入する場合は他の DB 関連構造変更（W1-7 系）と同じ承認レーンを通すこと

---

## 更新履歴

| 日付       | 更新内容                                 |
| ---------- | ---------------------------------------- |
| 2026-07-03 | 初版作成（W2-P3: DB プール方針の明文化） |
