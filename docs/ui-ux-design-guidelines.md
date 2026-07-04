# PH-OS UI/UX Design Guidelines（SSOT）

この文書は PH-OS の画面設計における**唯一のデザイン SSOT** です（2026-07-02 集約、同日リサーチ統合改版）。
今後の UI/UX 改修では、アクティブな実装エージェント（2026-07-04 時点は Codex 単独）がこのファイルを必ず参照し、判断根拠として扱うこと。

**目次**: 1. 文書の位置づけ / 2. 設計原則 / 3. デザイントークン / 4. 情報アーキテクチャ / 5. 操作性 / 6. 状態設計 / 7. コンポーネント規範 / 8. アクセシビリティ / 9. AWS 運用起因の UX 規範 / 10. 状態色 family×value×role 確定表 / 11. 禁止事項 / 12. 変更履歴・経緯

## 1. 文書の位置づけ

### 1.1 SSOT 宣言と文書体系

- **規範（SSOT）は本書のみ**。旧 `docs/uiux-design-system.md`（実装規範）と旧 `docs/state-color-migration-map.md`（状態色 family×value×role 確定表）は 2026-07-02 に本書へ統合済みで、両ファイルは後方互換のためのリダイレクトスタブである。新しい規範は必ず本書に追記し、別ファイルへ分割しない。
- **実装の正本（コード側）**: 状態色ロールは `src/lib/constants/status-labels.ts` の `*_ROLE` 定数、トークン実体は `src/app/globals.css`。本書の確定表と食い違う場合は差分理由を明記のうえ両方を直す。
- **非規範の作業文書**（監査・計画・リサーチ。ルールの根拠・進捗管理であり、判断の正本ではない）: `docs/uiux-audit.md` / `docs/uiux-improvement-plan.md` / `docs/color-token-remediation-plan.md`（是正フェーズ台帳）/ `docs/design-fidelity-mapping.md`・`docs/design-gap-analysis*.md`（デザイン画像対応表）/ `docs/research/medical-uiux-research-2026-06-26.md`（エビデンス集）/ `.agent-loop/UI_AUDIT_MATRIX.md`・`PLACEMENT_*.md`（ループ監査台帳）。これらと本書が衝突する場合は本書が優先。

### 1.2 運用ルール

- アクティブな実装エージェントは、UI/UX に触れる変更の前に本書を確認し、ページ構成・境界・見出し階層・状態設計の根拠にすること。
- 本書と個別要件が衝突した場合は個別要件を優先し、差分理由を明記すること。ただし医療安全・PHI・監査・アクセシビリティ・44px・状態5分離の規範は、個別要件側に明示的な承認記録がない限り緩和しない。
- 改修レーンの着手順は高頻度優先: 患者詳細 → 患者一覧 → reports → billing → admin（大量画面は共通テンプレで波及）。各画面はスクショ → 改善（足し算引き算）→ 必要なら backend/API/DB/auth/authorization/PHI/billing/deploy/package dependency も含めて正しい product contract へ修正 → 再スクショで反復する（2026-06-26 ratified、2026-07-04 ユーザー明示で DB 除外を撤廃）。migration 適用・deploy・secret rotation・production data mutation・destructive operation は別途 current-task の明示許可を要する。

### 1.3 改版規律

- ratified 規則（日付つき）は削除しない。緩和する場合は差分理由と承認記録を「12. 変更履歴・経緯」に残す。数値規範は緩和禁止（強化のみ可）。
- リサーチ由来の新規則は出典 URL を併記し、「(2026-07-02 リサーチ統合)」等の由来を明示する。出典を示せない規則は追加しない。
- 実在しない共通部品を前提化しない。計画部品は「新設予定」と明示する（「7.1 実在部品と計画部品」参照）。
- 同じ規則を二箇所に書かない。重複しそうな場合は正とする章を決め、他章からは相互参照する。
- ローカル/外部の design skill は本書を上書きしない。使用する場合は、対象 skill が想定する画面種別（landing / portfolio / redesign / dashboard 等）を確認し、コードスキャンで現行スタック・共通部品・アクセシビリティ契約と照合したうえで、本書に適合する指針だけを採用する。
- React Compiler 前提のため、手動 `useMemo` / `useCallback` の**追加を要求する**メモ化規範は本書に書かない（手動メモ化の新設**禁止**の正本は「9.7」）。backend は不可侵ではないが、UI 都合だけで API 契約・DB スキーマ・サーバーロジックを変えない。仕様達成に必要な product contract 変更は backend/API/DB と UI を連動して更新する（API/UI の対の完成責任は「2.11」）。

## 2. 設計原則

### 2.1 目的

- 情報のまとまりを視覚的に判別しやすくする
- 医療業務で必要な「次に何をするか」を上から順に追えるようにする
- 画面ごとの差を減らし、ページ間の学習コストを下げる
- モバイルでも同じ情報階層を崩さず、単に縦積みで読めるようにする
- 患者情報の変更を「いつ・誰が・何を・何から何へ・どの確認元で」追跡でき、正本と過去記録を区別できるようにする

### 2.2 医療安全ファースト（SAFER-first / Use-risk design）

視覚変更の目的は「次の判断が速くなる」「誤操作が減る」「取得失敗と空状態を誤認しない」のいずれかへ必ず接続する（2026-06-26 / 2026-06-28 ratified）。

- **SAFER-first**: ONC SAFER Guides 2025 は高リスク・高頻度の EHR 安全課題を優先する。赤・警告・中断・患者識別・CDS/薬剤確認に関わる UI 変更は「美観」ではなく「誤認・誤操作・見逃しの低減」で評価する。[ONC SAFER Guides](https://healthit.gov/clinical-quality-and-safety/safer-guides/)
- **Use-risk design**: NIST Health IT UI guidance は、ユーザー調査・使用リスク管理・UI 設計・評価を一体で扱う。患者・薬剤・監査・請求の主要フローでは「発生確率が低そう」ではなく「起きた時の重大度」を優先し、警告の検出性と復旧可能性を上げる。[NIST GCR 15-996](https://nvlpubs.nist.gov/nistpubs/gcr/2015/NIST.GCR.15-996.pdf)
- **Public-health layout conventions**: 個別画面の新パターン増殖より先に `PageScaffold` / `PageSection` / `WorkflowPageHeader` / `AdminPageHeader` / `DataTable` / `StateBadge` を拡張する。見出し順と source order を崩さない。[NHS Design System](https://service-manual.nhs.uk/design-system) / [VA Page Layouts](https://design.va.gov/foundation/layout/page-layouts)
- **Safety-critical visual display**: 数値・用量・点数・期限・患者識別子は等幅数字と明確な表組みで揃え、色だけに頼らず、位置・ラベル・グルーピングで意味を重ねる。[Patient Safety Journal](https://patientsafetyj.com/article/77769-informing-visual-display-design-of-electronic-health-records-a-human-factors-cross-industry-perspective)
- **CDS の即時性と説明性の分離**: 即時中断が必要な警告、通常の要確認、記録上の状態、期限リマインドを同じ見た目で扱わない（PH-OS 独自の 4 分類。tiering の実証根拠は「7.5」で引用する [Paterno 2009, JAMIA](https://pmc.ncbi.nlm.nih.gov/articles/PMC2605599/)。実装は「7.5 アラート設計」）。参考（CDS アラート設計の一般的知見）: [JMIR Human Factors 2025](https://humanfactors.jmir.org/2025/1/e69333)
- **Next.js route accessibility**: route announcer は `document.title` → `h1` → URL の順にページ名を探す。全ページで一意な title と h1 相当の見出しを維持し、可視 h1 を置かない画面も `sr-only` h1 を欠かさない。

### 2.3 患者識別・誤認防止（2026-07-02 リサーチ統合）

- 患者コンテキストを持つ画面は最上部に患者識別（氏名・年齢・性別・要介護度・ハイリスクタグ）を常時固定表示する（Pinned zone、「4.1」参照。実装は `PatientPinnedHeader` / PatientHeader 系）。患者写真の表示は誤患者オーダーを有意に減らす非割り込み対策であり、**新設予定**の推奨拡張とする。出典: [PMC7658731](https://pmc.ncbi.nlm.nih.gov/articles/PMC7658731/) / [JAMIA Open 2024](https://academic.oup.com/jamiaopen/article/7/3/ooae042/7703226)
- 調剤確定・送付など最高リスク操作の確認は、受動的な「OK 押下」ではなく能動的確認（対象名の一部再入力・チェック+確定の二段）を必須とする（実装移行中の画面は新設予定として明示し、対象画面を `.agent-loop/FEATURE_QUEUE.md` に列挙のうえ目標期日を設定する。**新規画面は初版から能動的確認を必須とする＝例外なし**。移行完了までの間、当該画面の受動確認には対象実データの埋め込み（「5.6」）を最低条件として課す）。ID re-entry は受動確認より誤患者操作を大きく減らす（41% vs 16%）。出典: [Adelman RCT](https://pubmed.ncbi.nlm.nih.gov/22753810/)
- 誤患者操作の監視指標 Retract-and-Reorder（10 分以内取消→別患者へ再操作）は**新設予定**のダッシュボード指標として採用する。出典: [PMC4447590](https://pmc.ncbi.nlm.nih.gov/articles/PMC4447590/)
- 同時に開ける患者レコード数の一律制限は課さない（2025 年版 SAFER Guides で当該推奨は削除。誤認防止効果の根拠が弱く業務効率を損なう）。出典: [PMC12005625](https://pmc.ncbi.nlm.nih.gov/articles/PMC12005625/)

### 2.4 Clinical Workbench Language

PH-OS の共通 UI は `/dispense`、`/audit`、`/set`、`/set-audit` のメインワークベンチ（広い作業面・状態別の即時判断・操作対象に近いアクション・作業を止めない密度）を視覚・操作思想の原型とし、一般画面にも「臨床業務ワークベンチ」として展開する。

外部デザインシステムから統合する要素: Apple HIG（主要内容が画面に収まり 44pt 相当の操作面、[出典](https://developer.apple.com/design/tips/)）/ Material 3（色・サイズ・形・包含で重要操作へ注意誘導、[出典](https://design.google/library/expressive-material-design-google-research)）/ Adobe Spectrum（密度・コントラストの個人差適応、[出典](https://blog.adobe.com/en/publish/2023/12/12/adobe-unveils-spectrum-2-design-system-reimagining-user-experience-over-100-adobe-applications)）/ Zoom（時間と注意の尊重・最小セットアップ、[出典](https://developers.zoom.us/docs/zoom-apps/design/design-principles-and-guidelines/)）/ Atlassian（token / foundation / component / pattern の分離、[出典](https://atlassian.design/design-system)）/ 医療・公共系アクセシビリティ（取得失敗を空状態に見せない、[WCAG 2.2 日本語訳](https://waic.jp/translations/WCAG22/) / [NHS Design System](https://service-manual.nhs.uk/design-system)）。

**デザイン言語の 6 原則:**

1. **Workbench first** — 一般画面も読み物ではなく業務を進める作業面として設計する。ヘッダー直下に「今やる操作」「判断材料」「一覧/詳細」を近接配置する。調剤・監査・セット系のメイン画面（/dispense /audit /set /set-audit）の視覚変更は**ユーザー承認により解禁済み（2026-07-02）**。ただし本 SSOT の全規範に従い、操作体系・工程フロー・test-locked 契約を壊さず、変更は before/after スクショ + 特性テストで検証すること（高頻度臨床画面のため通常画面より高い検証水準を課す）。
2. **Action beside evidence** — 操作ボタンは対象データ・根拠・警告の近くに置く。送信・確定・出力・取消などのリスク操作は、確認情報と監査記録の発生を同じ領域で示す。無効ボタンは理由を表示し、可能なら解消導線を置く。
3. **Clear state, never false empty** — loading / error / empty / stale / partial success を見分ける。取得失敗を「データなし」に見せない。動的エラーは `aria-live` または `role="alert"` で通知する。国内業務日の基準は「2.8 Japan domestic date basis」を正本とする（`Asia/Tokyo`）。切り詰め表示は表示行数を総件数として扱わない（「2.8 Counted list contract」参照）。
4. **Dense but readable** — 一覧は検索・比較・編集・行動のために使う。列、フィルタ、CSV/印刷は状態と連動させる（「見えているもの」と「出力されるもの」をずらさない）。高密度画面でも本文 14px 以上、主要操作のタッチターゲット（数値規範は「8.2」を正本とする）、見出しと本文の 8px 以上の間隔を維持する。情報の階層は「強い外枠、弱い内枠、罫線、余白」の順に表現し、装飾カードを増やさない。
5. **Calm expressiveness** — 派手さより安全な注意誘導。色は状態意味・主要操作・現在位置に限定し、彩度の高い面は重要操作や警告に集中させる。アイコンは lucide を優先し、テキストだけでは見つけにくい操作の補助に使う。
6. **System as product** — 共通部品を先に改善し、画面個別の似た実装を増やさない。新しい UI パターンは token / common component / screen pattern のどこに属するかを明示する。既存 API・権限・DB・監査・患者安全フローは UI 都合だけで変更しない。一方で、仕様達成や安全な状態表現に必要な場合は product API / DB / auth / authorization / PHI / billing / deploy / package dependency も含めて連動修正し、該当の validation と台帳証跡を残す。

#### 2.4.1 Taste-skill 適用範囲（2026-07-04 コードスキャン反映）

2026-07-04 に追加された `design-taste-frontend` / `redesign-existing-projects` 系 skill は、主対象が landing / portfolio / redesign であり、`design-taste-frontend` 自体も dashboard / data table / multi-step product UI を対象外としている。PH-OS は医療・薬局向けの高密度業務ワークベンチなので、skill は**審美テンプレートではなく監査チェックリスト**として使う。

- **採用するもの**: 実装前スキャン、既存スタック尊重、generic card / decorative gradient / AI-purple / 意味のない影の排除、loading / empty / error の完全サイクル、ボタンコントラスト、ボタンラベルの折返し防止、フォーム contrast、motion は transform / opacity 中心かつ reduced-motion 対応、カードを elevation でなく意味グループとして扱う規律。
- **採用しないもの**: landing hero / AIDA / oversized editorial typography / GSAP scroll hijack / magnetic hover / image-first hero / logo wall / marketing copy pattern / `lucide-react` 回避 / フォントやアイコンの刷新。これらは PH-OS の医療安全・高密度比較・既存共通部品契約より優先しない。
- **コードスキャンで確認した現行正本**: `PageScaffold` / `PageSection`、`DataTable`、`Loading` / `SkeletonRows`、`ErrorState` / `EmptyState`、`StateBadge` / `StatusDot`、`Button` / `LoadingButton`、`HelpPopover`、`lucide-react`。新規 UI はこれらを拡張し、画面ローカルに別デザインシステムを持ち込まない。
- skill 由来の改善を本書へ反映する場合も、PH-OS の用途に翻訳して記述する。例: 「hero は viewport 内に収める」は PH-OS では「Primary zone は fold 内に収める」、「CTA は折り返さない」は「主要操作ボタンは desktop で 1 行に収める」として扱う。

### 2.5 認知負荷最小（足し算と引き算）

機能削除ではなく**視覚ノイズの削除**である。`dense ≠ cluttered` — 密度は size / contrast / position / weight の情報階層で制御し、毎日使う薬剤師/事務にとっての効率（クリック削減）を最優先する（2026-06-26 ratified）。

- **引き算する**: 状態意味を持たない装飾カード/影/グラデーション、重複表示（タイトルとパンくず等）、意味のない区切り線・枠線、冗長な chrome、`bg-blue-100` 等の生 Tailwind 状態色ベタ書き、低頻度機能の常時露出。
- **足し算する**: 能動的な余白（グループ化・焦点誘導）、見出し/位置/コントラストによる階層、状態の explicit 化、走査性（見出し→サマリー→詳細）、高頻度操作のショートカット。
- **引き算してはいけない**: 臨床判断に必要なデータ・状態・安全タグ・監査痕跡。高密度一覧は密度を削らず、装飾削減とグルーピングで対処する（作業記憶は約 4 チャンク。同時比較させる情報群は 4±1 チャンク以内にグルーピングする。2026-07-02 リサーチ統合。出典: [Cowan 2001](https://pubmed.ncbi.nlm.nih.gov/11515286/)）。
- 高頻度タスク（薬歴記録・訪問記録・処方確認）は **3 クリック以内**で完結させる。progressive disclosure は**最大 2 階層**（常時表示=高頻度／展開=詳細）。3 階層目は別ページへ。段階開示は二次・低頻度操作だけに使い、一次の高頻度データ・状態は隠さない。
- 短い選択肢リスト（ナビ・アクション）は項目数を厳選する（意思決定時間は選択肢数の対数で増加）。長大リストは選択肢削減ではなく検索/フィルタで解決する（2026-07-02 リサーチ統合。出典: [Hick's law](https://www.ixdf.org/literature/topics/hick-s-law)）。

### 2.6 画面構成の基本原則

1. **画面は「意味のある塊」で分ける** — 主要情報は意味単位ごとに大きなグループへ分割し、境界は余白だけに頼らず枠線・背景差・区切り線のいずれかで明示する。1 グループの役割は 1 つ。
2. **上から順に判断できる情報順** — ①ページの目的と即時アクション ②今日・今すぐ対応が必要な情報 ③主要導線または主要データ ④補助情報・設定・参考情報。
3. **ヘッダーと本文を分離する** — ヘッダーは「ページ名」「説明」「主要アクション」「ショートカット」に限定し、本文は直下の別グループにする。説明とショートカットが混ざる場合は区切り線で上下を分離する。
4. **カードは"部品"ではなく"意味グループ"に使う** — 1 件ずつの小要素を全部カード化しない。同じ役割の項目群を大きなグループで包み、必要な場合だけ内側に小カードを使う。外側を強く、内側を弱く見せる。
5. **区切り線の使い方を統一する** — 大グループ: 枠線+弱い背景+角丸 / グループ内の大項目区切り: `Separator` / 小項目: リスト罫線またはカード境界。線は階層を示すために使い、装飾で増やさない。
6. **正本（編集元）と生成ビュー（閲覧）を分離する** — 患者情報の編集・登録・現在値管理は正本画面（患者詳細）に集約する。確認専用画面は読み取り専用の生成ビューとし、編集は正本へジャンプさせる。過去の記録は作成時点のスナップショットを保持し、正本の更新で書き換えない。「現在値」「変更履歴」「過去時点のスナップショット」を別レイヤとして区別して表示する。

### 2.7 医療システムとしてのトーン

- **アラート色（赤/橙）は希少資源**。「赤を見たら必ず行動が必要」を守る。常態的に赤・橙が点灯する画面（達成時も常時橙の KPI、0 件でも赤の至急通知）は alert fatigue を生むため禁止。状態色は値×閾値で点灯/消灯を制御する。
- **偽の安全保証・偽シグナルを出さない**。実データ非連動のハードコード ✓、未接続時の全 0 表示を実測のように見せる、永続化されない「採用」操作で「直した」と誤認させる、読み込み済み window のみの件数集計で過小表示する——すべて医療安全リスクとして排除する。
- **PHI はマスクを既定**にする。電話/FAX/保険者番号/住所/患者氏名は、一覧・生成ビュー・外部共有・生 JSON ダンプで生値を露出させない。「変更あり」の事実とフィールド名のみを示し、生値は権限付き正本画面でのみ確認する。
- **破壊的・広域・準不可逆操作には確認を必須**にする（月次締め・マスタ全件取込・薬価更新・外部共有リンク発行・貸出取消・一括反映）。確認には対象・件数・金額・取消不可の旨を提示する。
- **サンプル/未接続画面は明示**する。「サンプル表示（実データ未接続）」を明示し、本番同型 UI を機能するかのように見せない。loading/empty/error の状態スタブは実データ接続時に同時導入する。

### 2.8 Backend-supported UI Safety Contracts（2026-06-30 ratified）

医療 UI の見た目は、API が安全な状態表現を返すことではじめて成立する。frontend の配置改善と同じ優先度で、backend/API は次の不変条件を守る。

- **Counted list contract.** 期限、未処理、未確定、監査待ち、キュー、候補、警告などの一覧を `limit` / `take` / `slice` で切り詰める API は、表示行数を総件数として返してはならない。必ず `total_count` / `visible_count` / `hidden_count` を返し、severity bucket がある場合は bucket ごとの `total_count` も返す。隠れた行の患者名、自由記述、詳細タスクは返さず、必要最小限の件数だけ返す。
- **State metadata contract.** 患者ヘッダー、ダッシュボード、期限、在庫、監査、連携状態など「現在の状態」を示す API は、UI が推測しなくてよいように `state: "ok" | "empty" | "error" | "stale" | "partial"`、`generated_at`、`source_updated_at`、`is_stale`、`stale_reason`、`partial_failures` を持てる形にする。互換性のために一度に全 route へ必須化しないが、新規/改修 API はこの形へ寄せる。
- **Count basis metadata.** `total_count` は何を数えたかが曖昧だと危険なので、必要な API では `count_basis`、`filters_applied`、`truncated`、`next_cursor`、`last_reconciled_at` を返す。UI は `visible_count` を総件数として文言化せず、`truncated` または `hidden_count > 0` なら「先頭N件 / 他N件」の表現にする。
- **False-empty prevention.** 取得失敗、権限不足、未接続、filter による該当なし、真正の空状態を同じ `{ data: [] }` に畳み込まない。API は machine-readable `code` と再試行可否・権限不足・filter 条件を区別できる details を返し、UI は空状態と障害状態を別表示にする。
- **Canonical identity before display labels.** 薬剤、患者、訪問、報告書、監査対象など、業務判断・重複判定・差分判定・在庫突合に使う identity は、表示名ではなく canonical id/code を返す。医薬品は `drug_master_id` / canonical YJ `drug_code` を優先し、receipt/HOT/JAN/GTIN は resolver の結果が `resolved` の時だけ自動採用する。`ambiguous_code` / `code_not_found` / `review_required` は UI に「未解決」として見せる。
- **Stale aggregate prevention.** 件数、cap、期限、在庫、請求上限、未処理数などの aggregate は、作成・確定・取消・差替の保存 transaction 内で再検証する。preflight preview は補助情報であり、保存境界の正本ではない。
- **Audit-near-action.** 印刷、送信、確定、取消、外部共有、患者情報変更、医薬品コード確定など監査が必要な操作は、UI の成功表示より前に監査 write の成否を確認する。失敗時は「実行できたが監査できなかった」状態を曖昧にせず、再試行または操作停止へ誘導する。
- **Risk-action preconditions.** 送信、確定、取消、削除、外部共有、医薬品コード確定、患者基本情報変更の API は、`precondition_token` / `record_version` / `expected_updated_at` のいずれかを受け取り（新規/改修 API は必須、既存 API は移行対象 — State metadata contract と同じ互換方針）、古い画面状態からの実行を拒否する。確認 UI は `confirm_summary` / `audit_preview` / `reversible` / `recovery_action` を API から受け取り、frontend 側で差分を再構成しない。
- **Alert contract separation.** 警告 API は `alert_level: "interrupt" | "confirm" | "record" | "reminder"`、`patient_specific`、`blocking`、`expires_at`、`dismiss_policy`、`explanation`、`next_action` を返す。UI は `blocking=true` かつ患者固有・安全上重要なものだけを中断的表示にし、通常 reminder を赤い modal にしない。fail-safe デフォルトは**発生源別**に規定する: ① CDS 禁忌・アレルギー・相互作用チャネル由来、または `patient_specific=true` のアラートで `alert_level` / `blocking` が欠落・未知の値の場合、UI は **interrupt（「7.5」段階1）として表示し、解消まで確定操作（調剤確定・送付等）をブロックする**。② その他のチャネルは confirm を下限（floor）として表示する。「7.5」の降格不可 floor は本 fail-safe を含む全ての表示判定に常に優先する（floor が勝つ）。欠落・未知値の発生率は override 率 KPI（「7.5」）と同様に監視対象とする（欠落の常態化は alert fatigue 側の害になるため）。（fail-safe デフォルト、2026-07-02 改版時追加。rev2 でレビュー指摘により「一段高い tier」の曖昧表現を撤廃し発生源別へ強化）
- **Japan domestic date basis.** 国内業務日の締め、期限、訪問日、請求週/月、表示日、期限切れ判定は `Asia/Tokyo` の date key を正本にする。UTC timestamp の rolling window をそのまま業務日 window として使わない。UTC は Prisma `@db.Date` / `@db.Time` sentinel と runtime-TZ 回帰テストに限定する。
- **No hidden PHI in helper metadata.** UI が「他N件」「未解決N件」「非表示N件」を示すための metadata に、患者名、薬剤自由記述、電話番号、住所、備考、監査本文を含めない。必要なら `hidden_count` と severity/type ごとの count だけ返す。
- **Backend-owned ordering.** 変更履歴、患者ヘッダー、監査ログ、期限、未処理キューなどで「最新」「優先」を示す場合、API は `sort_basis` と tie-breaker（例: `updated_at`, `created_at`, `id`）を明示し、UI は backend の正本順序を再実装しない。
- **Shared path and resolver helpers.** 患者・報告書・薬剤・監査・在庫などの API path / code resolver は画面ごとに raw string で組み立てない。既存 helper がある場合は helper に寄せ、dot-segment fail-closed、hostile id encoding、ambiguous code rejection、resolver auditability を局所実装に分散させない。

### 2.9 実装前チェック

- 画面は trunk test（PH-OS であること、現在ページ、主要導線、次にできる操作、検索/戻り先）が 3 秒以内に分かるか。
- モバイルで本文・状態バッジ・リンクが同じ行に押し込まれていないか。
- 取得失敗、未接続、権限不足、空状態がそれぞれ別の見た目と文言になっているか。
- 重要操作は対象データ・根拠・監査記録の近くにあり、44px 以上の操作面を持つか。
- 個別画面の新しい見た目は、既存共通部品で表現できない明確なユーザー需要とスクリーンショット根拠があるか。
- API が件数を切り詰めている場合、UI は `visible_count` を総数として表示していないか。
- 薬剤・在庫・処方・重複警告は canonical code / resolver status を表示根拠として持っているか。
- 国内業務日の判定に UTC timestamp window や利用者端末 timezone が混ざっていないか。
- 保存・確定・印刷・外部送信の UI は、API の precondition / audit / stale-state 契約を確認してから成功表示しているか。
- 固定ヘッダー、下部固定アクション、Drawer、Modal は keyboard focus、エラー summary、主要ボタンを覆っていないか。
- 変更前後スクリーンショットで、最初に目に入る 3 要素が「現在地」「患者/業務対象」「次にすべき操作」になっているか（2026-06-28 追加ゲート）。
- 全ページの主要操作は 44px 以上、フォーカス可視、見出し順維持、`<main>` 内に主要内容、モバイルで source order と visual order の逆転なし（2026-06-28 追加ゲート）。
- loading / error / empty / stale / partial-success の 5 状態を、空状態やスピナー単独に畳み込んでいないか。
- CSS/JS の足し算より先に、冗長なカード、重複ラベル、低頻度操作の常時露出、状態意味のない色面を削ったか。
- 全ポインタターゲットが 44px 以上か（例外なし。「8.2」参照。44px を下回る変更は差し戻す）。
- 新設 API に UI 導線（または到達性台帳での内部専用/廃止判定）があるか。UI が呼ぶ API は実在し、契約（型・カウント・状態メタ）が一致しているか（片翼実装の禁止、「2.11」）。
- 主要操作ボタンは desktop でラベルが 1 行に収まるか。折り返す場合は文言を短くするか、ボタン幅・配置を見直す。医療安全上の説明が長い場合はボタン外の補足へ出す。
- disabled の重要操作には、PHI を含まない理由を `aria-describedby` 等で接続しているか。理由は「何を満たせば実行可能か」まで示し、tooltip だけに閉じ込めない。
- loading は画面/領域固有の `aria-label` を持つ `role="status"` になっているか。利用者に見える本文へ「読み込み中...」だけを置いていないか。
- `rounded-xl` / `rounded-2xl` / gradient / `backdrop-blur` / shadow を追加する場合、既存共通部品の variant か、意味グループ・固定シェル・モーダル等の明確な理由があるか。装飾目的なら差し戻す。

### 2.10 エビデンス駆動の検証プロセス（2026-07-02 リサーチ統合）

- 患者識別・投薬・アラートに関わる UI 変更は、危害につながりうる操作シナリオ（hazard-related use scenario）を列挙し、重大度で選抜して評価する。選抜根拠を文書化する。出典: [IEC 62366-1:2015/A1:2020](https://www.intertek.com/medical/regulatory-requirements/iec-62366-1-and-iec-60601-1-6/)
- 形成的評価（設計中の軽量確認）→総括評価（実ユーザーでの検証）の UCD プロセスに従う。出典: [NIST GCR 15-996](https://nvlpubs.nist.gov/nistpubs/gcr/2015/NIST.GCR.15-996.pdf)
- 国内整合は JAHIS「医療情報システムの患者安全に関するリスクマネジメントガイドライン」を参照する（下記出典ページは旧版 10-101 の解説編。JAHIS サイトで最新版の版番号・URL を確認して参照すること）。出典: [JAHIS](https://www.jahis.jp/standard/detail/id=210)

### 2.11 フロントエンド・バックエンド連動（片翼実装の禁止）（2026-07-02 ratified）

**全画面・全 API 適用の原則**。機能は「API（バックエンド）と UI 導線（フロントエンド）が揃ってはじめて完成」とみなす。片方が欠けたコード——UI から到達できない孤児エンドポイント、実在しない/未接続の API を呼ぶ UI、モック固定の本番同型画面——を残さない。

- **新機能は API と UI 導線をセットで設計する。** 実装順序は問わない（BE 先行 / FE 先行どちらも可）が、どちらか一方だけを land して完了扱いにしない。先行 land する場合は残り半分を `.agent-loop/FEATURE_QUEUE.md` に記録し、対で追跡する。
- **到達性台帳を運用正本とする。** 全 API route の UI 到達性は `.agent-loop/API_REACHABILITY_LEDGER.md`（E1 監査）で管理し、孤児エンドポイントは「① UI 導線を追加 ② 廃止 ③ 内部専用（cron / webhook / 内部 BFF / 開発支援）と明記」のいずれかへ解消する。判定不能のまま放置しない。
- **契約変更は提供側と消費側を連動して更新する。** API のフィールド追加・意味変更・カウント契約（「2.8」）の導入時は、FE 消費者を同一スライスまたは連動スライスで更新する。後方互換の optional 追加は BE 先行を許可するが、FE 消費予定を台帳へ記録し、未消費のまま放置しない（counted-list フィールドを返しても UI が表示しなければ「2.8」の安全表現は成立しない）。
- **型・契約の単一ソース。** レスポンス型は `src/types/` の共有型（または Prisma 生成型）を単一ソースとし、FE が画面ローカルにレスポンス形状を再定義しない（型 drift は片翼化の入口）。
- **「2.8」と一体で運用する。** Backend-supported UI Safety Contracts は「API が安全な状態表現を返し、UI がそれを実際に消費・表示する」ところまで含めて完成とする。
- レビュー時チェック: 新設 API に UI 消費者（または台帳上の内部専用/廃止判定）があるか。新設 UI が呼ぶ API は実在し、契約（型・カウント・状態メタ）が一致しているか。

## 3. デザイントークン

### 3.1 色 — 6軸状態色

- プライマリは深ネイビー（レセコン `#1f4e79` 相当、`--primary: oklch(0.38 0.09 252)`）を SSOT とする。信頼・清潔感を表す基調色で、白とのコントラストは約 8.7:1（`#1f4e79`）／約 10:1（`--primary` トークン oklch(0.38 0.09 252) ≒ `#182c46`。いずれも WCAG 相対輝度計算による実測値）。WCAG AA 4.5:1 を満たす（2026-07-02 rev1 で誤記 16:1 を実測値へ訂正）。
- 境界表現は `border-border/70` を基準に使う。グループ背景は `bg-card` を基本とし、補助グループのみ淡い差分を許可する。危険・注意・情報は状態意味があるときだけ色を使う。
- 状態色は **6軸セマンティック**を正本とする（「6軸」は歴史的名称。実体は state 系 5 role（blocked / done / confirm / waiting / readonly）+ tag 系 2 family（info / hazard）+ neutral の構成）。中央トークン（`globals.css` の `--state-*` / `--tag-*`）と共通部品 `StateBadge` / `StatusDot`（`role` を渡す）を使い、個別に `bg-*-100` 等の Tailwind 状態色をベタ書きしない。
  - **info（青 `--tag-info`）**: 主操作の状態表示・現在地（current）バッジ（ボタンの塗り色は「5.1」の `--primary` が正本）/ 情報タグ（処方変更・セット変更・返信待ちを「一覧に出す」）/ 予定・待ち。
  - **blocked（赤 `--state-blocked`）**: 止まっている理由 / ブロッカー / キャンセル / 通信なし / 送付失敗。
  - **done（緑 `--state-done`）**: 完了 / 承認済 / 確認済。
  - **confirm（橙 `--state-confirm`）**: 確認が必要 / 保留 / 差戻し / 延期 / 要対応。
  - **hazard（橙 `--tag-hazard`）**: 麻薬・冷所・インスリン・抗凝固 等の危険タグ（隠さない）。
  - **waiting（紫 `--state-waiting`）**: 別の人（薬剤師 / 事務）の確認待ち。
  - **readonly（灰 `--state-readonly`）**: 閲覧のみ / 権限なし / 終了・退院 / 中立。
  - **neutral（状態色なし）**: 既定 Badge または `text-muted-foreground`。稼働中（CaseStatus.active）や下書き（draft）など「状態色を付けない」ものはこちら。
- **旧「患者緑橙灰 spec」（稼働中=緑 / 保留=橙 / 終了=灰）は不採用。** CLAUDE.md の旧記述は本 6軸に置き換える。差分理由: 患者ケースは「ワークフローの止まり/完了」ではなく「関係の段階」を表すため、状態色と語彙が衝突していた。6軸では active を neutral に倒し、on_hold=confirm・discharged=readonly・terminated=blocked へ意味を再割当した。family×value×role の割当は「10. 状態色 family×value×role 確定表」を正本とする。
- chart / グラフの系列色は状態色ではない。系列には `globals.css` の `--chart-1..5` を使い、`--state-*` / `--tag-*` を系列色へ流用しない。
- 変更タイプ色は 6軸へ写像する（追加=info（青）/ 変更=info（青、情報タグ）/ 解除=readonly（灰））。装飾には使わない。
- テーマ（フォント＋配色トークン）はアプリ全体に適用する。高密度なレセコン風レイアウト（F1-F12 ファンクション帯 / 1540px 固定幅 / グラデーション帯）は調剤ワークベンチ等の業務画面に限定し、一般画面には持ち込まない。

### 3.2 状態色の塗り面積を最小化する（2026-06-26 ratified）

状態色（`--state-*` / `--tag-*`）は「面」ではなく「点・線・ラベル」で伝え、塗り面積を最小に保つ。アラート色を装飾面に広げると、本当のアラートとの区別が失われる（アラート 4 段階の厳格分離に直結）。

- **ステータスタイル（cat.3: 状態つきの確認カード）は全面塗りしない。** タイル背景は `bg-card`（中立）に保ち、状態は ① 左ボーダー `border-l-4 border-l-state-*` の細い帯 ② ステータスラベルの文字色 `text-state-*` の 2 点だけで表す。本文・メタは `text-foreground` / `text-muted-foreground` を使い、状態色を継承させない。`bg-state-*/10` をタイル全面に敷くのは不可。
  - 例外: 小さなバッジ／ピル（`rounded-full` の件数・ステータス章）は全面 `bg-state-*/10 text-state-*` でよい（面積が小さく、点として機能するため）。
- **データテーブルの行に状態色をベタ塗りしない。** 麻薬・冷所・ハイリスク等の行属性は、専用の「安全」列のトークンベース バッジ（`getHandlingTagBadgeClass` 等）で表す。行全体に `bg-red-50` / `bg-amber-50` のような生のアラート色を敷くのは、バッジと重複する装飾であり禁止。行の識別は zebra stripe と罫線で行う。
- **依頼先の負荷バッジは、アクティブ負荷の中央値×1.5（絶対 floor 20）を超える高負荷スタッフを `state-confirm`（注意/橙）+アイコンで強調し、数値を併記して色依存を避ける。** 相対しきい値なので上限なしスコアでも文脈適応する。
- 上記いずれも「色だけに依存しない」原則（ラベル併記）を満たすこと。

### 3.3 識別トークン登録簿（カテゴリ/臨床の固定色 — 状態色ではない）

6軸トークンは**状態（state）**専用。相互排他のカテゴリ・臨床ハザード区分は識別トークンとして別系統に定義済み（`globals.css`、light/dark 両対応、低彩度・text/border/dot/小チップのみ・大面積塗り禁止。AA 証明は `docs/color-token-remediation-plan.md` §Phase2）。

| family       | トークン                                   | 用途                                                        |
| ------------ | ------------------------------------------ | ----------------------------------------------------------- |
| SOAP         | `--soap-s/o/a/p`                           | SOAP セクション識別                                         |
| 投与経路     | `--route-internal/external/injection`      | 内服/外用/注射                                              |
| 介入種別     | `--intervention-*`（6種）                  | 用量調整/薬剤変更/副作用/アドヒアランス/処方医照会/患者教育 |
| 依頼先ロール | `--role-patient/clerk/institution`         | 患者/事務/医療機関                                          |
| 時間帯       | `--time-slot-morning/noon/evening/bedtime` | 服薬カレンダー                                              |
| 調剤方法     | `--method-standard/unit-dose/crushed`      | 通常/一包化/粉砕                                            |
| 取込経路     | `--intake-lane-fax/online/walk-in`         | FAX/オンライン/持込                                         |
| 週末・祝日   | `--weekend-sun/sat/holiday`                | カレンダー慣習色                                            |

- **意図的に raw パレット/専用実装のまま残すもの**（2026-06-20 監査確定・トークン化はスコープ外）: 臨床グラデーションスケール（`soap-options.ts` の遵守度 1-5 / 副作用程度 — 連続スケールで 6軸へ畳むと勾配の意味が失われる）、協働者プレゼンス色ローテ（ユーザー識別、chart 系列同等）、患者ステータスアイコン 12値（`status-icon.ts` — 固有 hue+専用アイコンで一覧性維持）、ガント区分・施設テーマ accent・装飾/外部閲覧。安全タグ（麻薬・冷所等）は `tag-hazard` トークン+左ボーダーへ移行済み（`safety-board.tsx` 参照）。
- 新しいカテゴリ色が必要になったら、生 Tailwind でなくこの登録簿へ family を追加してから使う。
- **週末・祝日トークンの規範**（2026-06-21 ADD ratified、決定記録は「4.9」）: **実装済みトークン: `--weekend-sun`（日=低彩度の赤）/ `--weekend-sat`（土=低彩度の青）**（`globals.css`、`@theme` で `--color-weekend-sun/sat` 公開 → クラス `text-weekend-sun` / `text-weekend-sat`）。状態色（`--state-blocked` / `--tag-info`）より低彩度でアラートと読み違えないこと（AA 検証済: card/muted 上で 4.5:1 以上）。カレンダーの曜日見出し・日番号はこのトークンを使う（共通 `MonthGrid` の既定で適用済み）。**祝日・休業日マーカー（「休」等）は専用の `text-weekend-holiday`（低彩度のローズ専用トークン）を使う — 生の rose/alert 色や日曜（`weekend-sun`）の流用は不可。** 系列性のある識別色（時間帯など）は `--chart-*` を使い、生 Tailwind（`text-blue-500` 等）の直書きはしない。SOAP トークンの契約は「7.7」を参照。

### 3.4 タイポグラフィ

- 本文 14px 以上、ラベル 12px 以上。データ密度の高い画面でも行間 1.6 以上を確保する。`text-[9px]` / `text-[10px]` / `text-[11px]` は廃し、最小 `text-xs`(12px)。密度はブロック高・余白で調整する。
- フォントスタックは Meiryo → Noto Sans JP → system-ui の段階フォールバックを標準とする（`--font-sans`）。Windows では Meiryo、その他環境では next/font でロード済みの Noto Sans JP、いずれも無ければ system-ui。旧来の「Noto Sans JP 単独指定」は本標準に置き換える。
- タイポグラフィスケールを role 単位（display / title / section / body / label / caption）で定義・再利用し、画面ごとの即席サイズ（h1 の `text-xl` と `text-2xl` 混在など）を禁止。
- コード記法を UI 文言に漏らさない: バッククォート・生 enum キー（`match_keywords` / `in_app` 等）を利用者向け文言に出さず、日本語ラベルへマップする。
- （2026-07-02 リサーチ統合）読み物系（説明文・報告書プレビュー・患者向け生成ビュー）の本文は 16px を推奨する（14px 最低線は維持し、緩和しない）。デジタル庁デザインシステムは視認性の観点から基本 16px 以上・Noto Sans JP を規定。出典: [デジタル庁タイポグラフィ](https://design.digital.go.jp/foundations/typography/?tab=accessibility)
- （2026-07-02 リサーチ統合）日本語の連続文は 1 行あたり全角 25〜40 字を目安に `max-width` で行長を制約する（データテーブルには適用しない。「4.9」の max-width 許可対象と併用）。出典（参考: 実務慣行。印刷会社コラムによる紹介で、一次研究の直接出典なし）: [book-hon.com コラム](https://www.book-hon.com/column/5521/)
- （2026-07-02 リサーチ統合）日本語長文への斜体（合成スラント）を使わない。テキストの画像化を禁止する（フォント切替・拡大を阻害）。200% 拡大で機能・情報を失わない。出典: [デジタル庁タイポグラフィ（アクセシビリティ）](https://design.digital.go.jp/dads/foundations/typography/accessibility/)

### 3.5 余白（8pt グリッド）

- **8pt グリッド**: margin/padding は 8 の倍数（8/16/24/32）。アイコン・小テキストは 4pt half-step。8pt グリッド外のマジック余白（`mt-14` / `xl:pt-20` 等）を作らない。
- ページ全体の主要グループ間は `space-y-6` 以上。グループ内の主要セクション間は `space-y-4` から `space-y-6`。密度の高い一覧でも、見出しと本文の間に最低 8px を確保する。
- **Pinned クラスタは密に束ねる。** 識別ストリップ・セーフティボードなど Pinned zone の要素は内側を `space-y-3` で密集させ、以降の主要セクションとは `space-y-6` で分離する。Pinned 内をページ全体と同じ余白で開けると「常に一緒に見るべき情報」がばらけて見える。
- データ非連動の巨大固定高（`min-h-[720px]` 等）は内容が少ない時に巨大空白を生むため、内容追従にし列高さは grid で揃える。
- 影（`shadow-sm`）は状態意味を持たないなら削り、`border` ＋余白で階層を表す。

### 3.6 角丸

- 操作部品・入力・テーブル内要素の角丸は `radius: 0.375rem`（`rounded-md`）基準。新規の画面ローカル UI で `rounded-xl` / `rounded-2xl` を常用しない。
- 2026-07-04 コードスキャン時点で、`Card` / `PageScaffold` / `WorkflowPageHeader` など一部の共通シェルは `rounded-xl` / responsive `rounded-2xl` を持つ。これは**共通部品側の互換例外**であり、画面ローカルに同じ大角丸コンテナを増殖させる根拠にしない。大角丸を使いたい場合は共通部品の variant として追加し、用途・許容画面・検証スクショを明記する。
- `rounded-full` は badge / pill / toggle / status dot / avatar / progress のような小面積・状態/選択表現に限定する。業務グループの外枠や繰り返しカードを pill 化しない。`rounded-3xl` 以上の新設は原則禁止。

### 3.7 モーションと prefers-reduced-motion

- 速く・控えめ・非妨害（`less delight, more usability`）。装飾アニメーション禁止。
- micro 100–200ms / transition 150–300ms、easing は `ease-out` 基本。
- **`prefers-reduced-motion: reduce` 対応を必須とする。** transition / animation は reduced-motion 時に無効化または即時化する（Tailwind `motion-reduce:` variant またはグローバル media query）。スケルトンの pulse も reduced-motion では静的表示に落とす。
- （2026-07-02 リサーチ統合）アニメーションは `no-preference` 側のメディアクエリで opt-in 記述にする（既定はモーションなし→preference 有りで付与）。JS で追従する場合は `matchMedia('(prefers-reduced-motion: reduce)')` + change リスナを使う。reduce は「無動作」ではなく「非本質的モーションの削減」であり、状態変化の機能的フィードバックは静的表現で残す。出典: [web.dev prefers-reduced-motion](https://web.dev/articles/prefers-reduced-motion)
- landing / portfolio 向け skill にある GSAP scroll hijack、sticky-stack、magnetic hover、parallax、marquee、hero reveal は PH-OS の業務画面には持ち込まない。例外は教育用/公開マーケティングページなど本アプリ業務面から分離された surface のみで、採用時も reduced-motion と Core Web Vitals（「9.6」）を通す。

### 3.8 等幅数字

- **`font-variant-numeric: tabular-nums` を必須**とする: 用量・薬価・点数・保険者番号・検査値・残数・金額・件数・残日数・部屋番号・時刻など、縦に並ぶ/比較する数値すべてに明示する。数字の縦揃えで用量誤読を防ぐ。

### 3.9 CVD（色覚多様性）検証ゲート（2026-07-02 リサーチ統合）

- 状態・重症度の伝達は色単独禁止（アイコン形状+テキストラベル併記。既存原則の再掲）。特に緑/橙/赤の 3 状態系は最頻の混同軸（赤緑）に載るため形状差を義務化する。出典: [J Patient Safety](https://vision.psychol.cam.ac.uk/jdmollon/papers/J%20Patient%20Safety.pdf)
- 状態色・識別トークンのパレット変更時は CVD シミュレーション（protan / deutan）での識別性検証をリリースゲートに含める。出典: [arXiv 2401.10357](https://arxiv.org/pdf/2401.10357)

### 3.10 アイコノグラフィ（アイコンによる情報伝達）（2026-07-02 ratified）

**全画面適用の原則**。重要な情報・状態・アクションは、テキストだけに頼らずアイコンを併記して一目で意味が伝わるようにする（スキャン速度・可読性・CVD 対応の同時達成）。医療現場の短時間判断を支える手段であり、装飾ではない。

- **同一意味＝同一アイコンを全画面で固定する。** 意味とアイコンの対応（警告=`TriangleAlert`、期限=`Clock`、患者=`UserCheck`、訪問=`Car`、タスク=`CheckSquare`、次アクション=`ArrowRight` 等）を画面ごとに勝手に変えない。対応を増やす場合はこの節に登録してから使う（勝手な一回限りのアイコン選択は禁止）。
- **アイコンライブラリは `lucide-react` に統一。** 2026-07-04 コードスキャンで `package.json` と既存 UI 全域の標準採用を確認済み。taste-skill 側の「Lucide 回避」は PH-OS には適用しない。画面独自のアイコンセット・インライン SVG を新設しない（二重実装禁止、「7.1」）。
- **色単独依存の回避（「3.9」）と一体で運用する。** 状態・重症度は「アイコン形状 ＋ テキストラベル」で伝え、色だけ／アイコンだけで状態を表さない。緑/橙/赤の 3 状態系は形状差を必須とする。
- **アイコンだけで情報を持たせない（テキスト併記が原則）。** アイコン単独のボタン・タグには `aria-label` を必須、装飾目的（意味を持たない）のアイコンには `aria-hidden="true"` を付す（「8.9」）。
- **アイコンのホバー/フォーカスで詳細情報を表示する。** 略記・状態・安全タグ等のアイコンには共通 `Tooltip` 部品（**新設予定**——`src/components/ui/tooltip.tsx` を base-ui ベースで用意し、画面ごとの独自ツールチップを作らない＝「7.9」共通化）でマウスオーバー時に詳細（正式名称・意味・数値の内訳・根拠）を出し、一覧の情報密度を上げつつ詳細へ辿れるようにする。制約: ① **hover はタッチ端末で発火しない**ため、キーボード `focus` と tap/長押しでも同一詳細へ到達できること（「8.3」「8.2」）。② **患者安全に直結する情報（アレルギー・ハイリスク・禁忌・重症度）を Tooltip の中だけに隠さない**——常時表示が正本（「2.3」「4.3」）で、Tooltip は補足に限る。③ Tooltip は `aria-describedby` 等で支援技術へ露出し、装飾扱いにしない。
- **サイズはトークンスケール（`size-4` 等、「3.4」）に従い、即席サイズを作らない。** タッチターゲットは 44px（「8.2」）。密度の高い一覧では情報過多を避け、状態/安全に直結するアイコンを優先する（引き算、「2.5」）。
- 参照実装: `StateBadge` / `StatusDot`（アイコン+ラベル）、`AlertTier`（4 段階でアイコンを出し分け）、`SafetyTagBadge`、`ExpiryBadge`。

## 4. 情報アーキテクチャ

### 4.1 情報重力ゾーン（Pinned / Primary / Scroll）

すべての画面を縦 3 ゾーンで設計する。

| ゾーン                                | 特性                       | 配置基準                                     |
| ------------------------------------- | -------------------------- | -------------------------------------------- |
| **Pinned zone**（固定・常時表示）     | スクロールしても消えない   | 「これが見えなければ患者に害が及ぶ情報」のみ |
| **Primary zone**（fold 内・即時判断） | ページ読み込み直後に見える | 今やる操作・最重要データ・状態               |
| **Scroll zone**（スクロール到達）     | 必要な時だけ見る           | 履歴・詳細・補助情報・設定                   |

- Pinned zone の対象は必要最小限に絞る。置きすぎると本当に重要な情報の視認性が下がる。
- Primary zone は fold 内に収める。モバイルでは高さ 600px 相当が上限。
- Scroll zone の情報は progressive disclosure の 2 階層ルール（「2.5」）に従って fold/展開を使う。

**画面タイプ別 Pinned zone の中身:**

| 画面             | Pinned に置くもの                                          |
| ---------------- | ---------------------------------------------------------- |
| 患者詳細         | ハイリスクタグ・アレルギー・患者名/年齢/性別/要介護度      |
| 訪問記録入力     | 患者名・現在の訪問日時・前回 SOAP 要約                     |
| 調剤ワークベンチ | 処方患者名・ハイリスクタグ・現ステップ（調剤/鑑査/セット） |
| ワークリスト     | 日付・未対応/対応中/完了の件数ストリップ                   |

### 4.2 Z軸（深さ）の使い分け

操作の深さ・リスク・継続性によって 6 段階を使い分ける。

| 深さ                     | パターン                                   | 使用条件                                                                                                                                | 禁止用途                                                 |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **0. Inline**            | その場編集・インライン検証                 | 単一フィールドの低リスク編集                                                                                                            | 複数フィールドをまたぐ操作                               |
| **1. Toast**             | 画面端に浮く非破壊通知（3〜5秒で自動消滅） | 操作結果の**成功**フィードバック（保存成功等）。失敗は永続的な行内/インラインの失敗状態+再試行導線で示す（「6.1」「6.3」「6.6」が正本） | 判断・確認が必要な内容。**失敗・エラーの唯一の通知手段** |
| **2. Tooltip / Popover** | ホバー/タップで補足情報                    | 略語展開・数値の単位説明・項目の補足                                                                                                    | 主要な操作や判断が必要な内容                             |
| **3. Drawer（右/下）**   | 本文を残したまま補助情報をオーバーレイ     | 参照しながら作業を継続する場合。Escape/外クリックで閉じる                                                                               | 確認が必要な操作の完了                                   |
| **4. Modal**             | 本文をブロックする確認ダイアログ           | **破壊的・取消不可の操作**（確定送付・削除・強制終了）、および「7.5」段階1の緊急中断アラート（重大かつ患者固有の閾値超過）              | 一般の情報表示・参照・低リスク操作                       |
| **5. Full page**         | 独立した別ページ                           | 独立した文脈が必要な複雑ワークフロー（報告書作成・処方受付）                                                                            | Drawer で収まるもの                                      |

**判断フロー:**

```
操作が必要か?
  No  → 緊急中断アラート(「7.5」段階1)か?
    Yes → Modal(4) 等の中断表示
    No  → Tooltip(2)
  Yes → 破壊的/取消不可か?
    Yes → Modal(4)
    No  → 本文を参照しながら操作するか?
      Yes → Drawer(3)
      No  → 独立した文脈が必要か?
        Yes → Full page(5)
        No  → Inline(0) または Toast(1)
```

### 4.3 画面タイプ別レイアウト

- **標準ページ**: ヘッダーグループ → 主作業グループ → 補助グループ。
- **ダッシュボード**: 今日の運用 → 業務導線 → 横断監視または患者確認 → 参考情報。
- **一覧画面**: ヘッダーグループ → フィルタ/集計グループ → 一覧グループ → 詳細や補足は別グループ。上部に現在地・日付/検索・件数ストリップ、本文に行動可能なテーブル/行リスト、補助情報は右 Drawer または下部詳細。カードの乱立ではなく比較できる行構造を優先する。
- **詳細画面**: ヘッダーグループ → サマリーグループ（固定表示の重要項目・在宅ステータス・重要タグ・アラート）→ 正本の編集セクション群（各項目に項目メタを併記）→ 変更履歴 → 監査/補助情報。最上部に **at-a-glance 固定サマリー**を置き、スクロールせず判断できるようにする。患者詳細では「在宅状態・年齢/要介護度・アレルギー・ハイリスク薬タグ（麻薬/インスリン/冷所/抗凝固）・最新処方・次回訪問」を fold 内に収める。**ハイリスク/アレルギーは常時表示・折りたたみ禁止**（Musubi 準拠）。
- **管理画面**: admin は「設定ハブ」ではなく運用管理ワークベンチ。`AdminPageHeader` の直下にフィルタ/検索/新規作成、続いて DataTable、詳細編集は Drawer/Modal の深さルールに従う。
- **ワークリスト画面**:

```
[PINNED]  日付ナビ + 件数ストリップ（未対応N / 対応中N / 完了N）
[PRIMARY] 訪問行（時刻 + 患者名 + フラグ + インラインアクション）× 8〜10件
[SCROLL]  完了済み一覧（折りたたみ、展開可）
```

- 件数ストリップは Pinned zone に固定し、スクロール後も残す。各行は「時刻 + 患者名 + フラグ + インラインアクション」で完結。行タップで詳細 Drawer 展開。
- フラグは `--tag-hazard`（麻薬等）と `--tag-info`（処方変更・訪問変更）の 2 種に限定。完了済みは折りたたまれた Scroll zone に格納し、Primary zone を汚染しない。
- 「記録未提出」は `--state-confirm`（橙）でハイライトして放置リストを一目で分かるようにする。

- **訪問キャプチャ画面**:

```
[PINNED]  患者名・訪問日時・ハイリスクタグ・アレルギー
[PRIMARY] SOAP（S/O/A/P）入力フィールド + 写真追加 + 保存ボタン（Thumb zone）
[SCROLL]  前回記録（前回SOAP・差分） / 現在処方一覧
```

- Pinned zone に患者名・ハイリスクタグを常時表示（タップ/入力中でも見えること）。SOAP の S〜P は Primary zone に全て収め、スクロールなしで記録完結させる。
- 保存・完了ボタンは画面下部 Thumb zone（Y 70%〜90%）に配置。前回記録は Scroll zone（参照は任意、主動線にしない）。

- **スケジュール画面**:

```
[PINNED]  ビュー切り替え（日/週/職員別）+ 対象日
[PRIMARY] 職員列 × 時間帯グリッド（状態 + 患者名のみ）
[SCROLL]  午後の予定 / 完了詳細
```

- スケジュール = カレンダーではなく**チームの作業進捗ダッシュボード**として設計する。各セルは「状態（未/中/完）+ 患者名」の 2 要素のみ。タップで Drawer 展開。
- 「記録未提出」のハイライトはワークリスト画面と同じ（`--state-confirm` 橙）。日ビューと週ビューはタブで切り替え、週ビューは縦スクロール。

**実装ルール（新規作成・改修の手順規範。旧「実装ルール」章より保持）:**

- グループ境界を新規に作る場合は、既存の section/group コンポーネントを再利用する。
- 新しいページを作るときは、まずこの文書にある標準ページ構成に合わせる。
- 既存画面を改修するときも、まず情報を「即時対応」「主要作業」「補助情報」に再分類してから UI を変える。本文はこの順序を保つ（VA IA 由来。「2.6」の情報順と同じ三分類）。

### 4.4 ナビゲーション・シェル

- ヘッダ部品統一: 通常=`WorkflowPageIntro`、ハブ=`WorkflowPageHeader`、admin=`AdminPageHeader`。画面内 raw `h1` を本文直置きしない。`PageScaffold` を必ず経由する（直返しで外枠・幅・余白を不統一にしない）。
- ページの主要内容は `<main>` ランドマーク内に置く（`PageScaffold` 経由で担保。2026-06-28 追加ゲート第3項=「2.9」）。
- 左ナビゲーションと右の補助3点セット（「次にやること」「止まっている理由」「根拠・記録」）は、通常状態で本文幅を占有しない。左ナビは上部バーのナビボタンから開くドロワー、補助3点セットは右ドロワーとして扱う。静止画デザインで左右レールが見えている場合は「展開状態」の表現として解釈し、初期表示は主作業グループを優先する。
- 安全タグ、期限超過、訪問可否など即時判断に必要な情報は、補助パネルだけに閉じ込めず本文側にも表示する。
- ドロワーを開くボタンは 44px 以上のタッチターゲット、明示的な `aria-label`、キーボードフォーカス、Escape/閉じる操作を備える。
- 対象日ナビ（前日/今日/翌日）は共通 `DayNavigator` を使い、`?date` URL 依存・mount 時固定をやめる。日付+件数ストリップを sticky な Pinned にする。
- **DOM 順と視覚順を入れ替えない**（`order-*` 禁止）。重要要素は DOM 上でも先頭。モバイルは source order のまま縦積み。
- 画面役割の重複（入口の二系統分散）を解消する。リダイレクト専用ルートに `loading.tsx` を残さない。
- ナビゲーション: モバイルはボトムタブバー（最大 4 項目）をハンバーガーメニューより優先する。
- （2026-07-02 リサーチ統合）「戻る」導線はページ最上部（ヘッダ直下、`WorkflowPageIntro` の戻り導線）に置き、送信ボタン群と並べない。進む操作と戻る操作を空間分離して誤操作を防ぐ。出典: [GOV.UK back link](https://design-system.service.gov.uk/components/back-link/)
- （2026-07-02 リサーチ統合）ヘルプ導線（問い合わせ先・FAQ 等）を置く場合、全ページで同じ相対順序（DOM 上のシリアライズ順）に配置する（WCAG 2.2 3.2.6 Consistent Help、Level A）。出典: [W3C Understanding 3.2.6](https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html)

### 4.5 見出し階層と trunk test

- ページタイトル: `h1` / 大グループ見出し: `h2` / グループ内セクション: `h3`。装飾目的で見出しレベルを飛ばさない。
- ワークスペース型トップは `page.tsx` に `<h1 className="sr-only">` を置き、本文先頭は `<h2>` から始める（可視 h1 を本文に直置きしない）。
- セクション見出しに `CardTitle` を使う場合は `asChild` で `<h2>`/`<h3>` を付与し、ページの見出し階層に組み込む（装飾ラベル用途のみ text として可）。
- trunk test: 画面を初見で開いて 3 秒以内に「PH-OS であること・現在ページ・主要導線・次にできる操作・検索/戻り先」が分かること（「2.9 実装前チェック」の第一項）。

### 4.6 レスポンシブ設計（mobile390 / tablet768 / desktop1440 / wide1920）

- 高さは `100dvh` ベース。固定 `px` / `100vh` / `min-h-screen` を使わない。height ユーティリティの cn 二重指定をしない。
- 業務ワークスペースは PC ディスプレイサイズとブラウザ表示領域に合わせて本文を全幅・全高で使う。読み物系・印刷系・フォーム系など行長制御が必要な画面だけ個別に `max-width` を使う。**max-width の許可対象**（2026-06-21 ADD ratified、決定記録は「4.9」）: 「読み物・印刷・フォーム」に加え、設定・選択系の操作画面でも `max-width` を許可する。業務ワークスペース（一覧/詳細/ダッシュボード）は全幅を維持する。
- 縦長フォームは外側 `overflow-y-auto` で低ビューポート高でも上部到達性を保証する。

| ブレークポイント | 方針                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| mobile 390       | 1カラム縦積み（source order 維持）。主操作は下部 Thumb zone。多列テーブルは重要列に絞った縦カードへフォールバック。KPI は2列+折返し |
| tablet 768       | 2カラム（主+根拠）維持か補助をドロワー化。中間幅グリッド（md/lg）を定義し、xl 専用多カラムで md〜xl を1カラム超長尺にしない         |
| desktop 1440     | 業務ワークスペースは全幅・全高                                                                                                      |
| wide 1920        | `PageScaffold` 経由で幅制御。読み物/印刷/フォーム/設定・選択系のみ `max-width`                                                      |

- 月間グリッドはモバイルで週送り/縦リストへフォールバックし、横スクロール時は日付ヘッダ/左列を sticky にする。セル内に重量フォームを埋め込まない（ドロワーへ退避）。

### 4.7 モバイルの Thumb zone 配置ルール

在宅訪問中（屋外・片手・グローブ装着）の追加配置制約。

```
画面上部  0〜30%: Pinned zone（患者名・ハイリスクタグ）
画面中部 30〜70%: Primary zone（現在のタスク）
画面下部 70〜100%: Thumb zone（プライマリアクション）← 片手親指の届く範囲
```

- プライマリアクション（保存・次へ・完了）は Y: 70%〜90% に配置。
- **破壊的アクション**（削除・取消）は Thumb zone に置かない。意図的な上部操作を要求する。
- 下部固定アクションバーは最大 2 ボタン。3 つ以上は Drawer に格納。
- 屋外/直射日光を想定し、重要情報のコントラストは 4.5:1 を上回る余裕を持たせる。オフライン（PWA + Dexie）で訪問記録入力・処方確認が継続できること（表示規範は「6.6」）。

### 4.8 正本・変更履歴・差分の表示

医療情報は「いつ・誰が・何を・何から何へ・どの確認元で」変えたかを追える必要がある。

- **項目メタ（現在値に併記）**: 各項目の現在値に「最終更新日 / 更新者 / 確認元（本人・家族・医師・訪看・書類など）」を小さく併記する。確認元・適用開始日が登録されている場合はそれも示す。メタは本文より弱い文字色（`text-muted-foreground`）・小さめ（12px）で、現在値の可読性を損なわない。
- **変更履歴タイムライン**: 時系列（新しい順）で「日付・カテゴリ・項目名・変更前→変更後・確認元・更新者」を 1 件ずつ表示する。カテゴリ（基本情報/住所/連絡先/病名/臨床/医療処置/麻薬/保険/連携 など）で絞り込めるフィルタを置く。訪問前確認ビューには全履歴ではなく「前回訪問以降の変更」だけを抜き出して見せる。
- **変更タイプと差分**: 変更タイプは「追加 / 解除 / 変更」の 3 種をバッジで示し、色のみに依存せずラベルを併記する。差分本文は「変更前 → 変更後」で表し、片側しか無い場合は矢印を出さず途切れさせない。集合（連絡先一覧・保険など）は件数または要素単位の追加/解除で示す。
- **PHI の取り扱い**: 電話番号・保険者番号・住所などの識別子は、差分・履歴・生成ビューで生値を露出させない。「変更あり」の事実とフィールド名のみを示し、値の詳細は正本の権限付き編集画面でのみ確認する。凍結スナップショットを画面や外部共有で読み出す経路では、現在値と同じ privacy マスクを必ず適用する。

### 4.9 配置監査確定事項（2026-06-21 ADD ratified）

全画面コンポーネント配置監査で判断が割れた点の確定（監査台帳: `.agent-loop/PLACEMENT_AUDIT.md` / 提案: `.agent-loop/PLACEMENT_SSOT_PROPOSALS.md`）。

- **識別目的の固定色（非状態色）**: SOAP の S/O/A/P、証跡カテゴリ、服薬カレンダーの時間帯/曜日など「状態ではない識別色」は、状態色（`--state-*`/`--tag-*`）とは別系統として許可する（2026-06-21 決定）。weekend/holiday トークンの規範本文は「3.3」、SOAP トークンは「7.7」を正本とする。状態を表す色は従来どおり6軸トークン＋`StateBadge`/`StatusDot`。
- **ページ見出し（h1）の配置**: 「4.5」を正本とする（sr-only h1 方式、2026-06-21 決定）。
- **トップ階層ヘッダ部品**: 「4.4」を正本とする（ヘッダ部品 3 種の使い分け、2026-06-21 決定）。
- **CardTitle と見出し要素**: `asChild` で `<h2>`/`<h3>` を付与する（「4.5」参照）。
- **KPI ストリップ**: 同種の指標を横並びにする KPI 群は「1件ずつカード化しない」の例外として許容する。ただし意味グループの外枠で内包し、影・過剰な角丸などの装飾は最小に留める。
- **確認専用ビューでの編集**: 患者正本への編集導線でなければ、生成物（AI 要約など）への確認・訂正フィードバックや施設ロジ申し送りは read-only ビューでも許可する（正本の改変ではないため）。
- **max-width の許可対象**: 「4.6」を正本とする（2026-06-21 決定）。
- **大機能を持つ画面の分割基準**: 1画面は主作業1グループ + 補助は `PageSection`（h2）で大グループ化する。補助大機能が3つ以上に膨らむ場合は Tab / ドロワー / 別ページへ分割する。
- **印刷文書・アプリ名**: 印刷文書は画面配色方針の対象外とし文書様式（濃色見出し帯など）を許容する。アプリ名表記は「PH-OS」に統一し、`metadata.title` を揃える。
- **ダミー/未実装画面**: 実データ未接続の段階では「サンプル表示」である旨を明示し、loading/empty/error の状態スタブは実データ接続時に同時導入する。

## 5. 操作性

### 5.1 ボタン設計（5階層）

操作の優先順位を全画面で統一する。**1画面の主操作は1つ**に絞る。

| 階層            | 用途                                                        | 見た目                                                          |
| --------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| **Primary**     | その画面で次にやる主操作（登録 / 送信 / 採用）              | `--primary`（深ネイビー）塗り。1画面1つ                         |
| **Secondary**   | 主操作に次ぐ操作（別ビューを開く / 比較対象追加）           | outline                                                         |
| **Tertiary**    | 補助・離脱（一覧へ戻る / キャンセル / 閉じる）              | ghost / link                                                    |
| **Destructive** | 破壊的・取消不可（削除 / 失効 / 強制終了）                  | `--state-blocked` 系。Thumb zone に置かない。ConfirmDialog 必須 |
| **System**      | システム連携・広域 mutate（全件取込 / 薬価更新 / 月次締め） | outline。確認ダイアログで対象・件数・最終実行を提示             |

- variant はこの 5 階層に集約し、画面独自のボタン視覚を新設しない（汎用要件の Primary/Secondary/Ghost/Danger 4系統は 5階層の部分集合として満たす）。
- 下部アクションバーで全ボタン outline のように**階層が消える配置を作らない**。
- 主操作色に `done`（緑）を使わない（完了の意味と衝突）。完了アクションも Primary（`--primary`）とし、done 緑はステータス表示に限定する。**ボタン塗り色の正本は本節（`--primary`）**であり、「3.1」の info はバッジ・状態表示用（ボタン塗りには使わない）。
- 同一の主操作導線を1画面に二重に置かない。モバイルは主操作を下部 Thumb zone に固定、下部固定バーは最大 2 ボタン。

### 5.2 ボタン配置規範（2026-07-02 リサーチ統合・新設）

- **ダイアログ/フッターアクション内の複数ボタンは「secondary 左・primary 右」に統一する**（例外を認めない）。破壊的操作のモーダルでは primary の位置（右端）に Destructive ボタンを置き、位置とプライマリ相当の視覚強調は維持する（位置の予測性を保つ）。出典: [Carbon modal usage](https://carbondesignsystem.com/components/modal/usage/)
- 確認ダイアログの Cancel は常に左、実行（破壊的含む）は右。破壊的操作では Cancel 側を既定フォーカス（安全側）に倒す。出典: [Apple HIG alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)
- 3 ボタンのモーダルは例外扱い（右端のみ primary）。選択肢増加は誤操作リスクなので原則 2 ボタン。出典: [Carbon modal usage](https://carbondesignsystem.com/components/modal/usage/)
- ボタンを垂直に積む場合は Primary を上、Secondary を下（モバイル片手操作で最上部が最も到達しやすい）。出典: [SmartHR Button](https://smarthr.design/products/components/button/)
- ページ遷移型の単一カラム長尺フォーム（Full page）では、送信ボタンをフォーム本文の左端（ラベルの視線帰着点）に揃えることを許容する。ダイアログ/下部固定バーの右端 primary 規範とは文脈で使い分け、1 画面内で混在させない。出典: [GOV.UK button](https://design-system.service.gov.uk/components/button/)
- **破壊的アクションを良性アクション（保存・閉じる等）の隣に同格で並べない。** 距離・スタイルで分離する（密な行内では `…` メニューへ畳む。「7.4」参照）。Thumb zone に置かない規範（「4.7」）と併用。出典: [NN/g proximity of consequential options](https://www.nngroup.com/articles/proximity-consequential-options/)
- 危険色（赤）ボタンは「容易に取り消せない重大な破壊的操作」専用とする。出典: [GOV.UK warning button](https://design-system.service.gov.uk/components/button/)

### 5.3 ボタンラベル・タッチターゲット

- **ボタンラベルは動詞で明確にする。「OK」「はい」だけの確認ボタンは禁止。** Modal の確認ボタンは操作内容を再掲する（「削除する」「送付を取り消す」等）。Destructive は色に依存せず、ラベルテキストだけで危険性が伝わる文言にする。
- **主要操作ボタンのラベルは desktop で 1 行に収める。** 2 行以上に折り返すボタンは、タップ対象の高さ・左右余白・視線走査を壊し、主操作の識別を遅らせる。長い説明はボタン外の本文、`aria-describedby`、確認ダイアログ内の対象要約へ分離し、ボタン自体は「監査して印刷」「月次締めを実行」など短い動詞句にする。
- **同一 intent のボタン文言を画面内で揺らさない。** 「保存」「登録」「反映」が同じ mutation を指す画面を作らない。nav / header / footer / drawer で同じ intent を出す場合は同じラベルに統一し、二重導線になる場合は一方を減らす。
- **disabled の重要操作は理由を持つ。** 理由は PHI を含まない日本語で、ボタンへ `aria-describedby` で接続する。画面内の実装例は `DataTable` toolbar の CSV/印刷 disable reason、billing close / export、offline-sync の同期ボタン、患者文書保存 blocker など。理由は「なぜ不可か」だけでなく「何を満たせば可能か」を示す。
- タッチターゲット契約: Button variant は coarse pointer 44px / desktop compact をエンコードする（test-locked 契約を保全。`sm:h-11` / `sm:min-h-[44px]` / `!h-11` は意図的な medical touch-target であり撤去しない）。44px はルートレベルの `!h-11` / `[&_input]:!min-h-[44px]` 包括 override でなく部品のサイズトークンで保証する。
- 二重送信防止は送信中 disabled（`LoadingButton`）を必須とし、サーバ側防御と併用する（調剤記録の二重登録は監査事故に直結。2026-07-02 リサーチ統合。出典: [GOV.UK button](https://design-system.service.gov.uk/components/button/)）。

### 5.4 フォーム設計

- 入力画面はゆとり重視（1カラム中心、`max-width` 許可対象）。
- shadcn の `Input` / `Select` / `Checkbox` を使い、生 `<select>` / `<input>` / 自作チェックボックスを新規に作らない。`SelectValue` には**明示 children** を必ず付け、SSR で生 enum 値（all / warning 等）が漏れないようにする。
- placeholder を label 代わりにしない。label / helper / error は常時到達可能にし、placeholder・helper・error・focus ring は背景に対して WCAG AA の contrast を満たす。白地に薄灰 placeholder だけで意味を伝えるフォームは禁止。
- 入力中の離脱防止・自動保存（「5.8 未保存離脱ガード」参照）。
- **エラーは到達可能に**: 送信失敗時はエラー要素へスクロール+フォーカスし `role="alert"` / `aria-live` で通知。長大フォームは冒頭に error summary（`FormErrorSummary`）。エラー後もユーザー入力値は必ず保持して再表示する。
- 重複 PHI 生成など危険な続行（「それでも登録する」）は単一クリックでなくチェック+確定の二段にする。
- **生 JSON を一次入力にしない**。高頻度フィールドは構造化フォーム、JSON は上級者向け折りたたみへ退避し、保存には差分プレビュー+確認+離脱防止を付ける。
- OTP / パスワード強度 / 確認トグルは共通部品化する（`OtpInput` / `PasswordStrengthField` は**新設予定**の計画部品。現状は画面ローカル実装。「7.1」参照）。要件達成は緑色のみに依存せず Check アイコン＋テキスト併記。
- （2026-07-02 リサーチ統合）同一プロセス内（例: 訪問記録→報告書作成の多段フォーム）で既入力情報の再入力を要求しない。自動転記または選択式（「前回と同じ」等）を提供する（WCAG 2.2 3.3.7 Redundant Entry、Level A。セキュリティ目的の再入力・情報が無効化した場合は例外）。出典: [W3C Understanding 3.3.7](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html)
- （2026-07-02 リサーチ統合）blur 時のインラインバリデーションを既定にしない。送信時にまとめて検証し、導入する場合はユーザー調査で利益が上回る証拠を要求する（入力が遅いユーザーでの誤爆防止）。出典: [GOV.UK validation](https://design-system.service.gov.uk/patterns/validation/)
- （2026-07-02 リサーチ統合）必須/任意の表示方式は 1 方式に統一し、混在させない（ラベル横のテキスト表示。アスタリスク単独は不可）。出典: [SmartHR FormControl](https://smarthr.design/products/components/form-control/)

### 5.5 キーボード完結操作

- 全主要業務フロー（受付 → 調剤 → 鑑査 → 訪問記録 → 報告書 → 請求）は**キーボードのみで完遂できること**。
- Drawer / Modal はフォーカストラップ + Escape で閉じる + 閉時にトリガーへフォーカス返却。
- カスタム部品（コンボボックス・日付選択・グリッド）は矢印キー・Home/End・Enter/Space の標準操作に従う。hover のみで到達する操作や drag-and-drop のみの操作を主動線にしない（代替操作を必ず用意。「8.4」参照）。

### 5.6 誤操作防止 — confirm と undo の使い分け（2026-07-02 リサーチ統合）

エラーの型で対策を分ける（slip=手が滑る系 / mistake=誤解系）。出典: [NN/g slips](https://www.nngroup.com/articles/slips/) / [NN/g user mistakes](https://www.nngroup.com/articles/user-mistakes/)

- **slip は確認ダイアログでなく「制約・良い既定値・危険操作の物理的分離」で防ぐ**（破壊ボタンの分離=「5.2」、Thumb zone 除外=「4.7」、`…` メニュー格納=「7.4」）。
- **可逆化できる操作は undo を優先する**（取り消しトースト「元に戻す」等）。確認ダイアログの habituation 回避は**可逆・良性の日常操作にのみ**適用する（可逆な日常操作に確認を付けると habituation=無意識クリックで防御力を失う）。出典: [NN/g confirmation dialog](https://www.nngroup.com/articles/confirmation-dialog/)
  - **undo ウィンドウ（2026-07-02 rev2 レビュー反映）**: undo トーストは「4.2」の 3〜5 秒既定を適用せず**最低 10 秒以上表示し、hover / focus 中は自動消滅を停止する**（時間制限の調整可能性。出典: [W3C Understanding 2.2.1 Timing Adjustable](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html)）。トースト消滅後も undo に到達できる恒久導線（操作履歴・直近操作の取り消し）を用意し、undo 手段がトーストとともに消失する「防御ゼロ」状態を作らない。
  - **「可逆」の定義**: システム内で完全に復元でき、外部送信・監査確定・PHI 共有を伴わない操作のみを可逆とする。送付・共有等の準不可逆操作を可逆と分類してはならず、定義に該当しない操作は従来どおり確認必須とする。
- **破壊的・取消不可の操作は頻度に関わらず二段階確認（Modal + 操作対象と影響の明示）を必須とする**（旧規則維持。「2.7」「4.2」「5.1」と同一で、本節はこれを緩和しない）。高頻度×最高リスクの不可逆操作（調剤確定・鑑査承認・報告書送付等）は受動確認をやめ、「2.3」の能動的確認（対象名の一部再入力・チェック+確定の二段）へ格上げする（確認の省略は不可）。
- **確認ダイアログには対象の実データ（患者名・薬剤名・件数・金額）を必ず埋め込み、「本当によろしいですか」等の汎用文言を禁止する**（既存の「対象・件数・金額・取消不可を提示」規範の強化。能動的確認への格上げは前項）。出典: [Adelman RCT](https://pubmed.ncbi.nlm.nih.gov/22753810/)
- 不可逆操作の失敗後は**再試行導線（明示的な再試行ボタン+失敗状態の永続表示）**を提示する。**「元に戻す」ラベルの導線は可逆操作専用**であり、不可逆操作の UI に undo /「元に戻す」文言を出さない（偽の可逆性アフォーダンス=「2.7」偽の安全保証禁止。禁止事項一覧=「11.」）。可逆な操作には Undo または復旧導線（`recovery_action`）を提示し、取消不可の場合は「この操作は取り消せません」を確認 UI に明記する。

### 5.7 モーダル・確認ダイアログ（追加規則）

- 承認/却下ダイアログは raw `JSON.stringify` でなく before→after を項目化する。
- 二択の不可逆操作（「最新を使う=自分の入力破棄」/「自分で上書き」）は差分提示つきの共通確認部品で扱い、両側を同等の警告強度にする。
- 削除は専用の削除確認パターン（`ConfirmDialog` + Destructive ボタン + 対象名の明示）に統一し、全機能で同型化する。
- メニューは共通 `DropdownMenu`（キーボード操作・フォーカストラップ）。手組み absolute popover で誤選択を誘発しない。
- 自動印刷（`window.print()`）を無人で発火させない（PHI 意図せず出力）。明示確認または手動ボタンを既定にする。
- 全画面モーダル型フォームでは離脱手段をキャンセルボタンに一本化し、戻るリンクを重複して置かない（2026-07-02 リサーチ統合。出典: [SmartHR modal UI](https://smarthr.design/products/design-patterns/modal-ui/)）。

### 5.8 未保存離脱ガード（FEUX-8）

- 入力フォームは `use-unsaved-changes-guard` を結線し、未保存変更がある状態でのページ離脱・タブ閉鎖に警告する。react-hook-form のフォームに加え、**素の controlled-state フォームも対象**とする。
- 長文入力（SOAP・報告書・音声メモ）は離脱警告より自動保存（下書き）を優先し、復元可能性を上げる。

## 6. 状態設計

### 6.1 5状態の分離（binding）

`loading / error / empty / stale / partial-success` を別物として表示する。取得失敗を空状態に見せない。汎用要件の「Loading / Empty / Error / Success」4状態は、PH-OS では **5状態分離 + Toast による success feedback** で満たす。新規実装は 5状態規約を正とし、4状態へ縮退させない。

| 状態              | 表現                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| 取得失敗(error)   | 共通 `ErrorState`（再試行導線つき、`role="alert"`）。素の `<p className="text-destructive">` 1行で済ませない |
| 未接続            | 「サンプル表示（実データ未接続）」「準備中」を明示し空と区別                                                 |
| 権限不足          | `ErrorState`(forbidden)。「閲覧のみ/権限なし」を理由提示                                                     |
| 空(empty)         | `EmptyState`。「まだありません」+ 次のアクション導線                                                         |
| 部分成功(partial) | 成功/失敗件数を明示。toast だけに頼らず行内ステータスでも示す                                                |

- `isError` 分岐の欠落（false-empty）を作らない。ページ全体を 1 枚の QueryError でゲートせず、クエリ別 skeleton / ErrorState で partial 表示を可能にする。
- **false-zero を防ぐ**: 初回ロード中に 0 を実値のように描画しない。`isLoading` を `isError` と別にガードする。

### 6.2 ローディング規範

**スケルトン binding（FEUX-1 ratified）:**

- ローディングは**実コンテンツの形状を保つスケルトン**にする。スピナー単独は不可。共通 `Skeleton` / `SkeletonRows`（`src/components/ui/loading.tsx`）を必須とし、**裸の `animate-pulse` div の新規追加を禁止する**（aria 契約を共通部品にエンコードするため）。
- 支援技術への通知は region 単位で行う: ローディング領域を `role="status"` + `aria-label` + `sr-only` テキストで**1回だけ**通知し、カードごとの status 乱立をしない。領域内の個々の Skeleton は装飾（`aria-hidden`、共通部品の既定）に保ち、二重読み上げを避ける。参考実装: `admin/analytics/analytics-content.tsx` の `LoadingRegion`。
- `Loading` / `SkeletonRows` を使う場合も、画面/領域固有の label を渡す。共通既定値の「読み込み中...」だけを利用者に見せない。既存テストでは `screen.queryByText('読み込み中...', { selector: 'p' })` 等で可視の汎用 loading copy を拒否している。新規テストでも同じ契約を守る。
- 汎用スケルトンを全高ワークベンチ・ガント・カレンダーの前に出して CLS を起こさない。`loading.tsx` と本体のシェル差・形状差をなくす。スケルトンは実コンテンツと同寸法で描画し、レイアウトシフトを CLS 0.1 以下に抑える（「9.6」参照）。
- 全画面 `<Loading/>` 置換でヘッダ/現在地を消さない。ヘッダ・フィルタは残しリスト領域のみスケルトン化する。

**インジケータ表示閾値（2026-07-02 リサーチ統合・新設）:**

- 応答 0.1 秒以内は追加フィードバック不要、1 秒以内は思考が途切れない限界（特別表示不要）、**1 秒超はインジケータ必須**、**10 秒超は進捗表示+中断手段を必須**とする。出典: [NN/g Response Times](https://www.nngroup.com/articles/response-times-3-important-limits/)
- スケルトンの適用先はコンテナ系（一覧/テーブル/カード/タイル）とデータ由来テキストに限定する。**トースト・ドロップダウン・オーバーフローメニュー・モーダル・ボタン等のアクション部品にスケルトンを使わない。** 出典: [Carbon loading pattern](https://carbondesignsystem.com/patterns/loading-pattern/)
- リロードを伴わないインライン操作（保存・検証）は inline loading（実行中→成功/失敗を同位置で表示。`LoadingButton` の送信中表示等）とし、全画面スピナーを出さない。出典: [Carbon inline loading](https://carbondesignsystem.com/components/inline-loading/usage/)
- 進捗が既知の長時間処理（取込・アップロード）は進捗率表示（プログレスバー）にする。無限スピナーの放置を禁止する（「6.6」「9.4」参照）。

### 6.3 エラー文言・エラー状態

- エラー表示は **「何が起きたか（原因）+ 次の行動」** を日本語で必ず併記する。例: 「保険情報を取得できませんでした。通信状態を確認して再試行してください。」原因なしの「エラーが発生しました」単独は禁止。
- （2026-07-02 リサーチ統合）文言は「事象・原因・対処」で構成し、スペース不足時は **原因 > 対処 > 事象** の優先順で残す。対処（次の操作）なしのエラー表示を禁止する。出典: [SmartHR エラーメッセージ](https://smarthr.design/products/contents/error-messages/overview/)
- 再試行可能な失敗には再試行導線を必ず付ける（`ErrorState` variant=server + refetch / `DataTable` の `errorMessage` + `onRetry` / サマリー系は「—」表示 + 明示バナー）。取得失敗を空状態・0件・全クリアに見せない（false-empty 禁止）。
- エラー後も入力済みデータを消さない（WCAG 2.2 / NHS 準拠）。PHI・secret をエラー文言やログへ露出させない（generic メッセージ + 監査側で追跡）。
- 認証失敗は「メールまたはパスワードが正しくありません」に統一し、どのフィールドが誤りかを漏らさない（列挙攻撃対策）。
- **行き止まりを作らない**: lockout の連絡先・解除時間にプレースホルダ固定値（`03-XXXX-XXXX` 等）を出さない。組織情報から供給し、未設定時は「管理者にお問い合わせください」へフォールバック。
- （2026-07-02 リサーチ統合）「システム側の障害」か「ユーザーの回線切断」かを文言で区別する（責任の所在を透明に）。出典: [web.dev offline UX](https://web.dev/articles/offline-ux-design-guidelines)

### 6.4 空状態

- `EmptyState` は「タイトル + 本文 + （必要時）次のアクション導線」の固定構造とする。初回利用 / 検索・フィルタ 0 件 / データ削除済みを文言で区別し、次の一手を必ず提示する（2026-07-02 リサーチ統合。出典: [Carbon empty states](https://carbondesignsystem.com/patterns/empty-states-pattern/)）。
- 取得失敗・権限不足・未接続を空状態に畳み込まない（「6.1」の表が正本）。

### 6.5 stale（鮮度）表示

- stale 表示は「X 分前のデータ + 更新」。`refetchInterval` はタブ非表示時に停止する。
- キャッシュ許容画面には「最終更新時刻」を UI に表示し、stale の可能性を可視化する（2026-07-02 リサーチ統合。出典: [web.dev offline UX](https://web.dev/articles/offline-ux-design-guidelines)）。CDN キャッシュ側の制御は「9.2」を正本とする。

### 6.6 オフライン・劣化モード（2026-07-02 リサーチ統合・新設）

PWA + Dexie のオフライン訪問業務、および AWS 依存サービスの部分障害時の表示規範。出典（本節共通）: [web.dev offline UX design guidelines](https://web.dev/articles/offline-ux-design-guidelines) / [AWS Well-Architected REL05-BP01](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_graceful_degradation.html)

- **レコード同期の 4 状態バッジ**: オフライン対象レコードは「端末保存済 / 送信待ち / 送信失敗 / 同期済み」の 4 状態を行内バッジで常時表示する（**送信失敗を常時表示から外さない** — 同期されないままの訪問記録・写真に気づけない false-success を防ぐ、「2.7」）。色だけに依存せず文言+アイコン併用。6軸ロール写像: 端末保存済=info（情報タグ）/ 送信待ち=info（待ち。「3.1」の waiting は「別の人の確認待ち」でありシステム応答待ちには流用しない — 本書はこの写像で確定する）/ 送信失敗=blocked（再試行導線必須。4 状態中最も目立たせる）/ 同期済み=done。実装時は確定表（「10.」）へ同期状態 family を追加してから使う。
- **行動ベースの文言**: 技術用語「オフライン」より「端末に保存しました」「接続回復時に自動送信されます」等の行動ベース文言を優先する。
- **接続状態の通知はデバウンスする**: 接続状態の一次表現は永続インジケータとする。切断・復帰の非侵襲的トースト（`role="status"`）は状態が数秒以上安定した場合のみ表示し、短時間の再通知を抑制する（屋外訪問では接続が数秒単位でフラップするため、イベント毎の即時トーストは通知の洪水となり、送信失敗・安全性警告への注意を希釈する）。
- **オフライン中の記録操作はブロックしない**: キューに積み、「接続回復時に自動送信されます」と保証文言を出す。ローディングモーダルで作業を止めない。
- **読み取り専用モード**: DB 書き込み不能などの障害時は「読み取り専用モード」バナーを全画面に掲示し、参照系（患者情報・薬歴閲覧）は継続提供する。機能全停止のエラーページより縮退応答を優先する。
- **部分縮退**: 依存サービス（CDS 外部データ・帳票生成等）の障害時は該当パネルのみエラー表示にし、他は稼働させる（hard dependency を soft dependency に変換。5状態の partial と同じ思想）。
- **無限スピナー禁止**: 失敗し続ける下流呼び出しには「一時的に利用できません（自動復旧を試行中）」と再試行の見込みを提示する。
- **事前ダウンロードはユーザー制御**: オフライン参照用データ（担当患者の直近薬歴等）の事前ダウンロードは自動で行わず、設定/ピン留めで明示的に選択させる。

## 7. コンポーネント規範

### 7.1 実在部品と計画部品

**実在する共通部品（これらを使う。再発明禁止）:**

| 部品                                                                                                                                                                                     | パス                                                    | 役割                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `StatCard`                                                                                                                                                                               | `src/components/ui/stat-card.tsx`                       | KPI/メトリクスカード（7.2）                                                               |
| `StateBadge` / `StatusDot`                                                                                                                                                               | `src/components/ui/state-badge.tsx` / `status-dot.tsx`  | 6軸状態表示（7.3）                                                                        |
| `DataTable`                                                                                                                                                                              | `src/components/ui/data-table.tsx`                      | 一覧（loading/error/empty/再試行内包、7.4）                                               |
| `ErrorState` / `EmptyState`                                                                                                                                                              | `src/components/ui/error-state.tsx` / `empty-state.tsx` | 状態表示（6章）                                                                           |
| `Skeleton` / `SkeletonRows`                                                                                                                                                              | `src/components/ui/loading.tsx`                         | ローディング（6.2）                                                                       |
| `ConfirmDialog`                                                                                                                                                                          | `src/components/ui/confirm-dialog.tsx`                  | 確認ダイアログ（5.6/5.7）                                                                 |
| `PageScaffold` / `PageSection`                                                                                                                                                           | `src/components/layout/`                                | ページ外枠・大グループ                                                                    |
| `WorkflowPageHeader` / `WorkflowPageIntro` / `AdminPageHeader`                                                                                                                           | `src/components/features/`                              | ヘッダ 3 種（4.4）                                                                        |
| `AlertTier`                                                                                                                                                                              | `src/components/ui/alert-tier.tsx`                      | 4段階アラート（7.5）                                                                      |
| `ExpiryBadge`                                                                                                                                                                            | `src/components/ui/expiry-badge.tsx`                    | 期限バッジ（7.3）                                                                         |
| `DayNavigator` / `MonthGrid`・`MonthGridNav`                                                                                                                                             | `src/components/ui/`                                    | 日付ナビ・月間グリッド                                                                    |
| `PatientHeader`                                                                                                                                                                          | `src/components/features/patients/patient-header.tsx`   | 患者識別ヘッダ（「2.3」の実装正本。sticky 既定・safety 常時表示）                         |
| `FilterChipBar`                                                                                                                                                                          | `src/components/features/workspace/filter-chip-bar.tsx` | フィルタチップ行（role=group / aria-pressed / 44px / focus-visible）                      |
| `SafetyTagBadge` / `selectVisibleSafetyTags`                                                                                                                                             | `src/components/features/patients/safety-tag-badge.tsx` | 安全タグ（critical-never-hidden、「7.3」。順序ロジックは共有 helper へ収斂中 2026-07-02） |
| `LoadingButton` / `HelpPopover` / `PhiMaskField` / `StickyFooterAction` / `SignalTile` / `FilterSummaryBar` / `FormErrorSummary` / `SectionIntro` / `PatientPinnedHeader` / `ActionRail` | `src/components/ui/`                                    | 各種                                                                                      |
| `useUnsavedChangesGuard`                                                                                                                                                                 | `src/lib/hooks/use-unsaved-changes-guard.ts`            | 未保存離脱ガード（5.8）                                                                   |

**計画部品（未実在。「使え」と書かない — 新設予定として扱う）:**

| 名前                    | 実状                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `AlertBanner(severity)` | export 実在せず。実装は `AlertTier` が正（`AlertBanner` は別名/計画名）                                                             |
| `OtpInput`              | 未実在（`shared-viewer-content.tsx` に素の state 実装のみ）→ 新設予定                                                               |
| `PasswordStrengthField` | 未実在 → 新設予定                                                                                                                   |
| `Tooltip`               | 未実在（共有 UI 部品なし）→ base-ui ベースで新設予定。アイコン hover/focus 詳細（3.10）の共通実装先。画面独自ツールチップを作らない |

### 7.2 メトリクスカード binding（FEUX-2）

- KPI・メトリクスカードは共通 `StatCard` を使う。画面ローカルの `MetricCard` / `KpiCard` / `SummaryCard` / `SignalTile` 相当の再実装は統合対象であり、**新規追加を禁止する**。
- 数値は `tabular-nums`、状態アクセントは全面塗りしない（点・線・ラベル）、操作面 44px、ローディングは `Skeleton`（aria-hidden）— これらを StatCard 側で一元担保する。
- KPI 値の文字色に chart 系列色を当てて装飾化しない（閾値超過時のみ confirm/blocked の点表示を足す）。点表示は `StatusDot` 等を使う（2026-06-26 全画面監査正本より保持）。
- KPI ストリップの配置例外は「4.9」参照。KPI 件数に色を付けない規則は「10. 適用範囲と除外」参照。

### 7.3 バッジ設計（StateBadge / StatusDot / ExpiryBadge / SafetyTagBadge）

- 状態は `StateBadge`（`role` を渡す）/ `StatusDot` のみで描く。`variant`/`className` 直渡し・ローカル `statusVariant` を経由しない。新 enum は 6軸ロールへの写像表（「10.」）を拡張して共通定数化する。
- raw shadcn `Badge variant`（`destructive` / `secondary` / `outline`）を状態表現に使わない。`destructive`（赤）を「終了・期限切れ・休業日・回答待ち・低負荷」など**止まっていない状態**に流用しない。「回答待ち（疑義照会 pending）」は他者確認待ち＝`waiting`（紫）であり `blocked`（赤）にしない。画面間で同一データを別色にしない。
- 色だけに依存しない: `showIcon` を活かしアイコン＋ラベル併記。enum / コード値は日本語ラベルへマップしてからバッジ化する。
- 期限バッジは共通 `ExpiryBadge(date, thresholds)` に集約し、残日数→role の閾値を SSOT 化する（期限切れ/30日以内=`blocked`、90日以内=`confirm`、以遠=中立）。画面ごとに再実装しない。近接でない期限も弱色で常時表示する（消さない）。（旧版規範を逐語維持。麻薬免許・施設基準・保険・同意等の期限が 31〜90 日残の間に無警告となる緩和は改版規律「1.3」違反のため認めない）
- **ExpiryBadge 実装ギャップ（期限付きの必須改修）**: 現行実装 `src/components/ui/expiry-badge.tsx` は単一 `warnWithinDays`（既定 30 日→`confirm`、期限切れ=`blocked`、以遠=中立、未設定=中立、不正値=`confirm`）で、上記 2 段閾値規範より弱い。複数 thresholds 拡張を**期限付きの必須改修**として `docs/color-token-remediation-plan.md`（是正台帳）へ登録する。是正完了までの暫定措置: ① `warnWithinDays` の既定を 90 日へ引き上げる。② 単一閾値のまま使う画面には差分理由の明記を必須とする（「1.3」）。`pharmacist-credentials-content.tsx` / `facility-standards-content.tsx` のローカル 2 段閾値実装は規範準拠だが共通部品へ統合予定（追跡: `.agent-loop/FEATURE_QUEUE.md`）。
- **安全タグは `+N` の裏に隠さない**: 麻薬・ハイリスク・アレルギー・抗凝固・冷所・インスリン等の重大タグは常時表示し、軽微タグのみ省略する。実装正本は共通 `SafetyTagBadge` / `selectVisibleSafetyTags`（`src/components/features/patients/safety-tag-badge.tsx`、2026-07-02 共通化済み `1f9de4d9`。critical タグは表示上限に関わらず必ず可視）。順序・可視判定の純ロジックはサーバ側（患者ヘッダ API）と共有するため共有 helper（`src/lib/patient/safety-tags.ts`）へ収斂中（2026-07-02）。

### 7.4 テーブル設計（DataTable）

- 比較・照合・監査・一覧はテーブル優先。`DataTable` 共通部品を使い、loading / error / empty / 再試行を内包させる。手組み table + 手動 zebra は `DataTable` へ寄せ、画面ごとの独自テーブルを作らない。
- 行に状態色をベタ塗りしない（「3.2」）。行属性は専用「安全」列のトークンベースバッジで表し、行識別は zebra stripe＋罫線＋sticky header で行う。
- 数値列に `tabular-nums` 必須。操作列は末尾（右）。破壊的操作は密な行内に常時露出せず `…` メニューへ畳み `ConfirmDialog` で受ける。
- **件数ストリップはサーバ総数に基づく**。window 集計しかできない場合は「読込済み N 件中」、一覧上限は「表示は直近 N 件」と明示し、暗黙の切り捨てを防ぐ（「2.8 Counted list contract」）。
- 件数サマリー/KPI はテーブルの「上」（サマリー→詳細の走査順）。`overflow-x-auto` + `role="region"` でラップする。

### 7.5 アラート設計（4段階の実装）

中断型アラート（割込み）は「重大かつ患者固有の閾値超過」のみ。以下 4 段階を**同じ見た目にしない**（2026-06-26 ratified）。実装は `AlertTier` を使い、各画面が `bg-state-*/10` 全面ボックスを自前実装しない。

| 段階                | 意味                                                                                  | 見た目                              | role              |
| ------------------- | ------------------------------------------------------------------------------------- | ----------------------------------- | ----------------- |
| 1. 緊急中断         | 割込み・要即時行動（重大かつ患者固有の閾値超過）                                      | 赤の強い左ボーダー + `role="alert"` | `blocked`         |
| 2. 要確認           | 通常の確認待ち（期限90日以内=`confirm`（`ExpiryBadge`、「7.3」）/ CDS 注意 / 差戻し） | 橙の左ボーダー                      | `confirm`         |
| 3. 記録上の状態     | 定常リマインダー・進捗状態                                                            | 中立 + ラベル、`role="status"`      | `readonly` / 中立 |
| 4. 期限リマインダー | 期日の予告（次回算定可・改定未作成）                                                  | 情報色の左ボーダー + 期限テキスト   | `info`            |

- 重大度をフラット化しない（「算定不可=赤」と「期限90日以内=橙」を 1 つのバナーに同居させない）。バナーも左ボーダー+文字色基本で全面塗りしない。
- 偽アラート禁止: 0 件で点灯する赤、達成時も常時橙、`role="alert"`(assertive) の常設。状態色は値>0・閾値超過時のみ点灯。
- 情報バナーに警告アイコン（AlertTriangle）を使わない。情報は Info アイコン。

**CDS アラート運用（2026-07-02 リサーチ統合）:**

- **降格不可の floor（2026-07-02 改版時追加・レビュー指摘反映）**: 患者固有のアレルギー禁忌・絶対禁忌・妊婦禁忌等の最重症層は常に割り込み（interrupt）とし、受動表示へ降格できない。重症度分類の変更は臨床根拠と承認記録を必須とする。**本 floor は「2.8」の fail-safe デフォルトを含む全ての表示判定に常に優先する（floor が勝つ）**。患者固有・CDS 禁忌系チャネルでメタデータが欠落した場合の interrupt 扱いと欠落率監視は「2.8 Alert contract separation」を正本とする。
- 薬物相互作用・禁忌アラートは重症度で層別し、割り込み（Modal 等の中断表示）は最重症層のみとする。低優先度 DDI は非割り込み（受動表示）を既定にする。tiering 導入で下位層の遵守率が約 3 倍になった実証がある。出典: [Paterno 2009, JAMIA](https://pmc.ncbi.nlm.nih.gov/articles/PMC2605599/)
- 完全ハードストップ（続行不能ブロック）は「絶対禁忌かつ例外が存在しない」場合のみ許可する。例外があり得る場面では使わず、使う場合は緊急迂回手段と導入後モニタリングを必須にする（治療遅延の実害報告あり）。出典: [Strom 2010 RCT](https://pubmed.ncbi.nlm.nih.gov/20876410/) / [系統的レビュー](https://pmc.ncbi.nlm.nih.gov/articles/PMC6915824/)
- override 時は自由記述でなく構造化された理由選択を提示し、監査ログに残す（API 側の `dismiss_policy` 契約=「2.8」と連動。UI 実装は**新設予定**）。出典: [JAMIA 2019](https://academic.oup.com/jamia/article/26/10/934/5480565)
- 割り込みアラートの override 率を KPI として計測し、90% 超が常態なら該当ルールの特異度を見直す（**新設予定**の運用指標）。出典: [メタ解析 2024](https://journals.sagepub.com/doi/10.1177/14604582241263242)
- アラート文言は患者固有の文脈（検査値・年齢・併用）を含め、職種（薬剤師/事務）で出し分ける。出典: [JAMIA systematic review](https://academic.oup.com/jamia/article/26/10/1141/5519579)

### 7.6 カード設計（追加規則）

- 連絡先・服薬・候補・ノートを 1 件ごとに `rounded-2xl` カード化して縦に積まない（罫線リスト / DataTable へ寄せる）。
- 個別カードは「予約・連絡先・単一行動つきステータス」などカード自体が操作対象になる時に限定する。
- カード内カードを作らない。外側は `PageScaffold` / `PageSection` / `Card` のいずれか 1 つで意味グループを作り、内側の繰り返し項目は罫線リスト・table・小チップ・status badge で表す。入れ子カードが必要に見える場合は、情報階層の分類か `DataTable` / Drawer 化を先に検討する。
- `Card` の `rounded-xl` と `PageScaffold` の responsive `rounded-2xl` は既存共通部品の互換例外（「3.6」）。画面ローカルで同じ角丸・影・背景の見た目を複製しない。カードの差分が必要なら共通部品へ prop / variant を足す。

### 7.7 SOAP 識別色トークン（FEUX-4 契約）

- SOAP S/O/A/P の識別色は専用トークン **`--soap-s` / `--soap-o` / `--soap-a` / `--soap-p`** を使う（「識別目的の固定色」系統。状態色 `--state-*` / `--tag-*` とは別系統で、`--weekend-*` と同じ扱い）。
- トークンは **`globals.css` に定義済み**（P3-soap `5780ded7`、light/dark 両対応、S=青 oklch(0.51 0.105 256) / O=緑 / A=紫 / P=橙の低彩度系）。参考実装: `soap-step-wizard.tsx`。
- 生 Tailwind（`text-blue-500` / `text-purple-500` 等）の直書きは禁止。既知の残存違反は **2026-07-02 に全て解消済み**（`visit-record-detail.tsx` の `SoapSection` は `text-soap-*` へ移行済み、最後の残存だった `visit-record-form.tsx` の SOAP 見出しアイコン 4 箇所も `03d49349` で置換完了）。新規 SOAP UI は最初からトークンを使うこと。

### 7.8 薬剤名・用量・日付の安全表示（2026-07-02 リサーチ統合）

- 欧文薬剤名を表示する場合は FDA/ISMP の Tall Man 表記リストに従う（例: vinBLAStine / vinCRIStine）。リスト外へ独自の Tall Man 化を拡大しない。出典: [FDA Name Differentiation Project](https://www.fda.gov/drugs/medication-errors-related-cder-regulated-drug-products/fda-name-differentiation-project) / [ISMP リスト](https://home.ecri.org/blogs/ismp-resources/look-alike-drug-names-with-recommended-tall-man-mixed-case-letters)
- 和文の販売名類似薬（アマリール/アルマール型）は薬効クラスの併記で区別できるようにし、選択 UI で名称単独表示にしない。出典: [PMDA 医療安全情報](https://www.pmda.go.jp/safety/info-services/medical-safety-info/0013.html)
- 用量表記: 1 未満は先頭ゼロ必須（0.3mg）、**末尾ゼロ禁止**（5.0mg 不可）、単位はピリオドなしの mg / mL に固定する。出典: [ISMP Safe Electronic Communication 2019](https://www.ismp.org/system/files/resources/2019-03/Electronic-Guidelines-2019.pdf)
- 誤読誘発略語（ISMP error-prone abbreviations）を UI 表示・帳票で使わない。出典: [ISMP List](https://psnet.ahrq.gov/issue/ismp-list-error-prone-abbreviations-symbols-and-dose-designations)
- 臨床判断に使う日付は桁混同（03/04）を避けるため月名/和式表記（例: 2026年7月2日）を用い、数字のみの MM/DD 単独表示を臨床画面の一次表記にしない。出典: [NHS CUI（ISB 1500系、患者安全要素のみ採用）](https://digital.nhs.uk/data-and-information/information-standards/information-standards-and-data-collections-including-extractions/publications-and-notifications/standards-and-collections/isb-1500-1508-common-user-interface)

### 7.9 画面遷移の視覚的安定性（共通コンポーネント化）（2026-07-02 ratified）

**全画面適用の原則**。画面間で共通の「枠」（ヘッダ・パンくず・ページ足場・患者識別・件数ストリップ・ナビシェル・フィルタ行・テーブル）は必ず共通コンポーネントで実装し、画面ごとに独自マークアップで再実装しない。目的は、遷移時に共通要素の位置・高さ・余白が微妙にずれる（ガタつき／レイアウトシフト）のを防ぎ、操作の予測性と信頼感を保つこと。

- **既存の共通枠を使う（bespoke 再実装は禁止、「7.1」）。** `PageScaffold` / `PageSection`、`WorkflowPageHeader` / `WorkflowPageIntro`、`PatientHeader`（患者識別 SSOT 「2.3」）、`FilterChipBar`、`DataTable`、`StatCard`。同等の枠を画面ローカルで作らない。差分が必要なら共通部品に prop を足す（全画面へ一貫波及）。
- **同じ役割の要素は全画面で同じ位置・順序・余白に置く。** sticky/Pinned の高さ・`z-index`・背景（`backdrop-blur` 等）も共通化し、画面をまたいでヘッダやツールバーが跳ねないようにする（「4.1」／「4.4」）。
- **非同期領域は寸法を予約してレイアウトシフトを防ぐ。** ローディング `Skeleton` は実コンテンツと同じ高さ・行数・グリッド形状にする（「6.2」）。件数・数値は `tabular-nums`（「3.8」）で桁変動時の幅ずれを抑える。画像・チャート等は縦横比／最小高さを確保する。
- **変更は共通コンポーネント側で行い、画面ローカルの上書きで一貫性を崩さない。** クラス上書きで共通枠の寸法・配置を画面ごとに変えない（変える場合は共通部品の variant として定義）。
- 定量ゲートは Core Web Vitals の CLS（「9.6」）に接続する。遷移前後で共通枠のバウンディングボックスが変化しないことを設計上の不変条件とする。

## 8. アクセシビリティ

### 8.1 準拠基準

- 準拠目標は **WCAG 2.2 AA** を一次基準とする（旧版（2026-06-26 以降）から継続の基準を本章で明文化。NHS/GDS も 2.2 で監査中）。出典: [NHS new requirements](https://service-manual.nhs.uk/accessibility/new-accessibility-requirements-wcag-2-2) / [W3C new in 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)
- 主要操作 44px 以上、見えるフォーカス、エラー後の入力保持、支援技術への状態通知は**共通部品レベルで確認する**（2026-06-26 ratified）。出典: [NHS WCAG 2.2 changes](https://service-manual.nhs.uk/design-system/changes-to-design-system-wcag-2-2)
- JIS X 8341-3:2016 は WCAG 2.0（ISO/IEC 40500:2012）の一致規格（IDT）であり、WCAG 2.2 AA 準拠は JIS 整合を包含する上位基準として扱う（JIS 準拠のみでは 2.5.8 等の 2.2 新基準を満たさない）。実務資料は WAIC 公開文書を参照先とする。出典: [JIS X 8341-3:2016](https://kikakurui.com/x8/X8341-3-2016-01.html) / [WAIC](https://waic.jp/docs/jis2016/understanding/)
- AAA 基準（Focus Appearance 2.4.13 等）は必須対象外（採用する場合は個別に明記）。

### 8.2 ターゲットサイズ（WCAG 2.2 2.5.8 / PH-OS 44px）

- **既定は 44px 以上（唯一の実装目標）**。全ポインタターゲットの実運用値は 44px 以上を維持する（屋外タブレット・グローブ・片手操作前提。AAA 2.5.5 相当で、WCAG 2.2 AA 2.5.8 の絶対下限 24×24 CSS px を上回る）。視覚要素が小さくても padding/margin でヒット領域を拡張する。出典: [W3C Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- （2026-07-02 リサーチ統合）WCAG 2.2 AA 2.5.8 の「24px + spacing」基準は**準拠監査上の絶対下限であって、PH-OS の実装基準ではない**。PH-OS は CLAUDE.md・test-locked 契約（Button variant の coarse 44px）に基づき **44px を無条件で維持する（例外条項なし）**。密度の高い一覧内のアイコン群も padding/margin のヒット領域拡張、または `…` メニューへの集約・レイアウト変更で 44px を確保する。小型ターゲットの近接配置を禁止する（指タッチは固定精度項をもち、小さすぎるとタップ分布の裾でミスが発生する。出典: [FFitts law, CHI 2013](https://www3.cs.stonybrook.edu/~xiaojun/pdf/FFitts.pdf)）

### 8.3 フォーカス

- フォーカスは常に可視（WCAG 2.4.7）。フォーカスインジケータは隣接背景に対し 3:1 以上（1.4.11）。
- （2026-07-02 リサーチ統合）sticky header / 下部固定バー・固定バナーがフォーカス要素を**完全に**隠してはならない（WCAG 2.2 2.4.11 Focus Not Obscured (Minimum)）。固定要素の高さ分を `scroll-padding` で確保する。出典: [W3C Understanding 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)

### 8.4 ドラッグ代替（WCAG 2.2 2.5.7）

- ドラッグ操作（並べ替え・スライダー・カンバン移動）には必ずシングルポインタ/キーボード代替（上下ボタン・移動メニュー・クリック配置）を併設する。出典: [W3C Understanding 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)

### 8.5 Redundant Entry / Consistent Help

- 同一プロセス内の再入力禁止は「5.4」、ヘルプ導線の一貫配置は「4.4」を正本とする（いずれも WCAG 2.2 Level A）。

### 8.6 Accessible Authentication（WCAG 2.2 3.3.8）

- 認証・再認証でパスワードマネージャの自動入力とコピー&ペーストをブロックしない。OTP/TOTP コードは貼り付け可能にする（手動転記の強制は不適合）。記憶・転記・計算を要する認知機能テスト（テキスト CAPTCHA 含む）を認証フローに置かない。出典: [W3C Understanding 3.3.8](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html)（2026-07-02 リサーチ統合。Cognito 側の実装は「9.3」）

### 8.7 コントラスト

- 本文テキストはコントラスト比 4.5:1 以上（WCAG 1.4.3。屋外想定で余裕を持たせる=「4.7」）。日本語の「大きいテキスト」例外（3:1）は保守的に扱い、既定は 4.5:1 とする。出典: [W3C Understanding 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- （2026-07-02 リサーチ統合）UI 部品の識別に必要な視覚情報（入力枠線・チェック状態・フォーカスリング・グラフ線・アイコン）は隣接色と 3:1 以上（WCAG 1.4.11 Non-text Contrast。disabled は免除）。出典: [W3C Understanding 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

### 8.8 ライブリージョン（2026-07-02 リサーチ統合）

- 保存完了・件数更新・進捗などの非緊急通知は `role="status"`（暗黙 polite）、即時対応が必要なエラー・安全性警告のみ `role="alert"`（暗黙 assertive）。assertive の乱用禁止（「7.5」の偽アラート禁止と連動）。出典: [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/#status)
- ライブリージョンは空の状態で初期 DOM に常設し、後から中身だけを書き換える（リージョンごと動的挿入すると読み上げられないことがある）。出典: [MDN Live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)
- `role="alert"` に `aria-live` を重ねて指定しない（iOS VoiceOver で二重読み上げ）。`role="status"` には互換性のため `aria-live="polite"` を併記する。全体読み上げが必要な数値（タイマー・カウンタ）は `aria-atomic="true"`。出典: 同上

### 8.9 支援技術対応（既存規則）

- 区切りは色だけに頼らず、見出し・線・余白を併用する。グループ見出しは見出し要素で実装する。
- 棒/チャートに数値テーブル等の代替テキスト構造を併設し、チャートノードは凡例＋ラベルで色依存を避ける。
- グループ見出し・リスト項目（患者名・時刻）を `<p>` でなく見出し/リスト要素にし、支援技術で走査可能にする。
- CVD 検証ゲートは「3.9」を参照。

### 8.10 グローブ・屋外操作（推奨・要追加検証）

- 医療用グローブ（ニトリル等）は静電容量信号を減衰させタッチ登録信頼性が素手比で低下する。訪問モードで使う画面は 44px 以上に加え、隣接ターゲット間に明示スペーシングを確保する。※査読付き定量研究は未確認のためベンダー技術文書ベースの「推奨」として扱う（2026-07-02 リサーチ統合）。出典: [andersDX](https://www.andersdx.com/effective-touchscreen-control-with-medical-gloves/) / [Focus LCDs](https://focuslcds.com/journals/using-capacitive-touch-panels-with-gloves/)

## 9. AWS 運用起因の UX 規範（2026-07-02 リサーチ統合・新章）

インフラ（Amplify Hosting / Cognito / RDS / S3 / CloudFront / SES、ap-northeast-1 固定）の挙動・制約に由来する UX 規範。バックエンド不可侵の範囲で、UI とルーティング・fetch 設定側の義務を定める。

### 9.1 Amplify / Next.js ストリーミングとローディング設計

- 全ルートセグメント（リダイレクト専用ルートを除く、「4.4」参照）に `loading.tsx`（実形状スケルトン、「6.2」準拠）を必置し、ナビゲーション即応と共有レイアウトの操作可能性を保証する。出典: [Next.js streaming](https://nextjs.org/docs/app/guides/streaming)
- 重いデータ取得は page 全体でなく `<Suspense>` で区画単位に分割し、患者識別（患者ヘッダ）を最初のフラッシュに含める。出典: 同上
- **Amplify Hosting はストリーミング応答をバッファする既知の報告がある**（全応答完了後に一括送出）。ローディング設計は「streaming が効かなくても成立する」ことを前提とし、デプロイ環境で first-flush 挙動を実測検証してから骨格表示の細部を確定する（公式明記でなく re:Post 報告ベース。自環境実測を推奨）。出典: [AWS re:Post](https://repost.aws/questions/QU5WPXEy6YSaCVXz6W73nCvg/why-doesnt-streaming-readable-stream-work-for-next-js-api-routes-on-aws-amplify-hosting)
- Edge Middleware / Edge API Routes / On-Demand ISR は Amplify 非対応前提で設計する（認可チェック等は Node runtime middleware か Route Handler 内で行う）。出典: [Amplify troubleshooting](https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting-SSR.html)
- Amplify Web Compute の最大レスポンスサイズは 5.72MB で、超過時は 504（コンテンツなし）になる。処方箋写真等の大容量画像は SSR / `next/image` 応答で返さず、S3 presigned 直取得に統一する。出典: [Amplify troubleshooting-SSR](https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting-SSR.html)（"My application's HTTP response size is too large"）

### 9.2 キャッシュと stale 制御（CloudFront）

- PHI・薬歴・在庫などリアルタイム性が患者安全に関わる API 応答は `Cache-Control: no-store` を明示し、CDN・ブラウザ双方でキャッシュ禁止。出典: [CloudFront Expiration](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)
- `stale-while-revalidate` / `stale-if-error` を使う場合は「古いデータが表示されうる画面」を明示的に列挙し、**臨床判断画面（相互作用チェック・アレルギー）では禁止**する。出典: [CloudFront SWR/SIE](https://aws.amazon.com/about-aws/whats-new/2023/05/amazon-cloudfront-stale-while-revalidate-stale-if-error-cache-control-directives/)
- 動的レンダリング必須の Route Handler / fetch は `cache: 'no-store'` を明示し、暗黙キャッシュに依存しない（Next.js 側と CloudFront 側の二層を両方制御）。出典: [Next.js fetch](https://nextjs.org/docs/app/api-reference/functions/fetch)
- キャッシュ許容画面の「最終更新時刻」表示は「6.5」を正本とする。

### 9.3 Cognito セッション・再認証 UX

- アクセストークン（既定 1h）の更新はリフレッシュトークンでバックグラウンド実行し、有効な限り再ログインを見せない。失効時のみ再認証画面へ。出典: [Cognito refresh token](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html)
- セッション満了で強制ログアウトする場合は満了前に警告を出し、最低 20 秒の猶予で 1 クリック延長を可能にする（WCAG 2.2.1 Timing Adjustable, Level A）。出典: [W3C time limits](https://www.w3.org/TR/UNDERSTANDING-WCAG20/time-limits-required-behaviors.html)
- **再認証が発生しても入力途中の訪問記録・下書きを失わない**（自動保存またはローカル退避→再認証後復元。「5.8」の自動保存原則と連動）。「再ログインしてください」で作業を破棄させない。出典: [SC 2.2.1 解説](https://www.digitala11y.com/understanding-sc-2-2-1-timing-adjustable/)
- TOTP 入力欄はコピー&ペースト・パスワードマネージャ入力を禁止しない。CAPTCHA 等の追加パズルを認証フローに置かない（「8.6」準拠）。
- TOTP 初期設定は「QR コード + 手入力用シークレット文字列」の両方を提示し、検証コード確認まで完了させてから MFA を有効化する（associate → verify → set preference）。出典: [Cognito TOTP](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html)
- サインアウト・パスワード変更等のセキュリティイベント時はリフレッシュトークン失効（revocation）を行い、他端末セッションの扱いを UI 上で説明できるようにする。出典: [Cognito token revocation](https://aws.amazon.com/about-aws/whats-new/2021/06/amazon-cognito-now-supports-targeted-sign-out-through-refresh-token-revocation/)

### 9.4 S3 アップロード進捗・再試行

- presigned URL は短い有効期限とし、失効エラー（403）は「URL を再取得して自動再試行」で吸収する。ただし自動吸収には上限（回数または時間）を設け、超過時は当該項目を「送信失敗」（blocked + 明示的な再試行ボタン）としてリスト上に表示し、サイレントに留めない（「6.6」の無限スピナー禁止・「2.7」の偽の安全保証禁止と整合）。出典: [S3 presigned upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- 訪問写真等の大容量はマルチパート化し、パート単位の進捗バー・失敗パートのみの指数バックオフ再送・中断からの再開（完了パート manifest 保持）を必須にする。低速回線（在宅訪問の屋外）ではパートサイズを最小 5MB に落とし、並列数に上限を設ける。出典: [AWS Compute Blog](https://aws.amazon.com/blogs/compute/uploading-large-objects-to-amazon-s3-using-multipart-upload-and-transfer-acceleration/)
- アップロードは非モーダル（バックグラウンド）で行い、送信中・完了・失敗をリスト上のステータスで表示する。失敗には明示的な再試行ボタンを提供する（「6.6」のキュー原則と同型）。出典: [web.dev offline UX](https://web.dev/articles/offline-ux-design-guidelines)

### 9.5 リージョン障害・graceful degradation

- 依存サービス障害時の部分縮退・読み取り専用モード・無限スピナー禁止・障害/回線切断の文言区別は「6.6」を正本とする。
- 設計上は hard dependency を soft dependency に変換し、障害時はエラーページより静的/縮退応答を優先する。失敗し続ける下流呼び出しにはサーキットブレーカーを入れる。出典: [AWS Well-Architected REL05-BP01](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_graceful_degradation.html)

### 9.6 Core Web Vitals 目標値と RUM

- 性能目標は **p75 で LCP ≤ 2.5s / INP ≤ 200ms / CLS ≤ 0.1**。モバイル（訪問タブレット）とデスクトップを分けて評価する。出典: [web.dev vitals](https://web.dev/articles/vitals)
- CloudWatch RUM web client を導入し、実ユーザーの Web Vitals・JS エラー・HTTP エラーを収集、p75 LCP と JS エラー率にアラームを設定する（**新設予定**の運用整備）。出典: [CloudWatch RUM metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM-metrics.html)
- RUM 収集設定では PHI 混入防止を明示レビューする（URL・カスタム属性に患者識別子を載せない）。出典: [CloudWatch RUM privacy](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM-privacy.html)
- CLS 対策のスケルトン同寸法描画は「6.2」を正本とする。

### 9.7 レンダリング最適化（実装規範）（2026-07-02 ratified）

**全画面適用の原則**。UI は「速く出て・速く応答し・ガタつかない」ことを実装レベルで担保する。目標値は「9.6」（p75 LCP ≤ 2.5s / INP ≤ 200ms / CLS ≤ 0.1）を正本とし、本節はそれを満たすための実装手段を定める。**計測が先（「2.10」）**——プロファイル（React DevTools Profiler / RUM）で実ボトルネックを特定してから最適化し、投機的な最適化でコードを複雑化しない。

- **React Compiler に memo 化を任せる（手動 memo 化の新規追加は禁止）。** 本リポジトリは React 19 + React Compiler を採用し、`useMemo` / `useCallback` / `React.memo` を自動挿入する。手動の `useMemo` / `useCallback` は lint（`react-hooks` の preserve-manual-memoization）と早期 return 後の rules-of-hooks 違反を誘発するため新設しない。重い純計算はコンポーネント外の純関数へ切り出す。
- **Server Components 優先・Client は薄く。** Next.js 16 App Router で、データ取得と静的な重い描画は Server Component 側に置き、`'use client'` はインタラクティブ末端に限定する。クライアントバンドルへ大きな依存を持ち込まない。
- **重い/fold 下の部品は動的 import で遅延ロードする。** `next/dynamic`（例: `@zxing` バーコードスキャナ、チャート、地図、リッチエディタ）でコード分割し、初期表示の JS を削る。ライブラリはツリーシェイク可能な形（`lucide-react` の個別アイコン import 等）で使う。
- **Suspense + Skeleton でストリーミング表示する。** 段階的表示で LCP を早め、`Skeleton` は実寸で予約して CLS を防ぐ（「6.2」「7.9」「9.1」）。
- **データ取得は TanStack Query のキャッシュを活かす。** 適切な `staleTime`/`gcTime` で再フェッチを抑え、`select` で必要フィールドに絞り、大規模一覧はカーソルページネーション（`fetchAllCursorPages` 等）で over-fetch を避ける。`isError` を握って false-empty にしない（「6.3」「6.4」）。
- **密なデータテーブルは仮想化（windowing）する。** 数百行超の医療テーブルは可視行だけ描画し、sticky ヘッダは reflow を起こさない実装にする（「7.4」）。
- **緊急でない更新は遅延・トランジション化する。** フィルタ・検索・URL 同期など非緊急の状態更新は `startTransition` / `useDeferredValue`（既存 `useSyncedSearchParams` は `startTransition` 採用）で入力応答（INP）を守る。長い同期処理でメインスレッドをブロックしない。
- **レイアウトスラッシングを避ける。** リスト要素へ安定した `key` を付け、レンダー毎の同期レイアウト測定（`getBoundingClientRect` 連打等）を避け、アニメーションは `transform`/`opacity` に寄せる（`prefers-reduced-motion` 対応は「3.7」）。
- **アセット最適化。** 画像は `next/image`（サイズ/フォーマット/遅延）で出し、フォントは `font-display` を適切化、アイコンは個別 import。オフライン層（Dexie/IndexedDB）の読み書きは表示クリティカルパスをブロックしない。
- **共通枠の再実装を避けることも性能規範。** 画面ローカルの独自枠は重複バンドルと再レンダーを増やす。共通コンポーネント化（「7.9」）はレイアウト安定と同時にバンドル/描画コストを下げる。

## 10. 状態色 family×value×role 確定表（旧 docs/state-color-migration-map.md 統合）

6軸ロールの意味は「3.1 色」章を正とする。実装の正本は `src/lib/constants/status-labels.ts` の `*_ROLE` 定数。`neutral` は `status-tokens.ts` に存在しない運用指示（型は `StatusRoleOrNeutral`）で、`StateBadge` ではなく既定 Badge / `text-muted-foreground` で描く。本章の各確定表は enum 名（`*_ROLE` 定数名）で引く。末尾の「適用範囲と除外」「移行の経緯（記録）」も本章の一部。

### CaseStatus — `CASE_STATUS_ROLE`

| value             | role     | 備考                                       |
| ----------------- | -------- | ------------------------------------------ |
| referral_received | info     | 段階の入口                                 |
| assessment        | info     | アセスメント中                             |
| active            | neutral  | 稼働中は状態色を付けない（旧「緑」不採用） |
| on_hold           | confirm  | 保留=要対応                                |
| discharged        | readonly | 退院/終了=閲覧                             |
| terminated        | blocked  | 解約=止まる                                |

### ScheduleStatus — `SCHEDULE_STATUS_ROLE`

| value          | role    | 備考           |
| -------------- | ------- | -------------- |
| planned        | info    | 予定           |
| in_preparation | info    | 準備中         |
| ready          | info    | 準備完了       |
| departed       | info    | 出発           |
| in_progress    | info    | 訪問中         |
| completed      | done    | 完了           |
| cancelled      | blocked | キャンセル     |
| postponed      | confirm | 延期           |
| rescheduled    | confirm | 再調整(要確認) |
| no_show        | blocked | 不在=止まる    |

### 優先度（VisitPriority / IssuePriority / TaskPriority）— `PRIORITY_ROLE`

| value     | role     | 備考                 |
| --------- | -------- | -------------------- |
| emergency | blocked  | 緊急                 |
| critical  | blocked  | IssuePriority 最上位 |
| urgent    | confirm  | 至急                 |
| high      | confirm  | 高                   |
| normal    | info     | 通常                 |
| medium    | info     | 中                   |
| low       | readonly | 低                   |

### VisitOutcome — `VISIT_OUTCOME_ROLE`

| value                | role    | 備考                |
| -------------------- | ------- | ------------------- |
| completed            | done    | 完了                |
| revisit_needed       | confirm | 再訪問必要          |
| postponed            | confirm | 延期                |
| cancelled            | blocked | キャンセル          |
| delivery_only        | info    | 配薬のみ            |
| completed_with_issue | confirm | 課題あり完了=要対応 |

### ReportStatus — `REPORT_STATUS_ROLE`

| value            | role    | 備考              |
| ---------------- | ------- | ----------------- |
| draft            | neutral | 下書き=未確定     |
| sent             | done    | 送付済            |
| failed           | blocked | 送付失敗          |
| confirmed        | done    | 確認済            |
| response_waiting | waiting | 返信待ち=他者待ち |

### MedicationCycleStatus — `MEDICATION_CYCLE_STATUS_ROLE`

| value             | role    | 備考              |
| ----------------- | ------- | ----------------- |
| intake_received   | info    | 線形フロー進行中  |
| structuring       | info    | 〃                |
| inquiry_pending   | confirm | 疑義照会中=要確認 |
| inquiry_resolved  | info    | 〃                |
| ready_to_dispense | info    | 〃                |
| dispensing        | info    | 〃                |
| dispensed         | info    | 〃                |
| audit_pending     | info    | 〃                |
| audited           | info    | 〃                |
| setting           | info    | 〃                |
| set_audited       | info    | 〃                |
| visit_ready       | info    | 〃                |
| visit_completed   | info    | 〃                |
| reported          | done    | 完了              |
| on_hold           | confirm | 保留              |
| cancelled         | blocked | 取消              |

注: 工程の「現在地(いまここ)」表示は `info`(current)。完了済み工程の表現は別途 done。

### TaskStatus — `TASK_STATUS_ROLE`

| value       | role    |
| ----------- | ------- |
| pending     | neutral |
| in_progress | info    |
| completed   | done    |
| cancelled   | blocked |

### IssueStatus — `ISSUE_STATUS_ROLE`

| value       | role     | 備考          |
| ----------- | -------- | ------------- |
| open        | confirm  | 要対応        |
| in_progress | info     | 対応中        |
| resolved    | done     | 解決          |
| dismissed   | readonly | 却下=以後参照 |

### VisitProposalStatus — `VISIT_PROPOSAL_STATUS_ROLE`

| value                   | role     | 備考                  |
| ----------------------- | -------- | --------------------- |
| proposed                | info     | 提案中                |
| patient_contact_pending | waiting  | 患者連絡待ち=他者待ち |
| confirmed               | done     | 確定                  |
| rejected                | blocked  | 却下                  |
| superseded              | readonly | 差替済(過去)          |
| expired                 | blocked  | 期限切れ              |
| reschedule_pending      | confirm  | 再調整待ち            |

### PatientContactStatus — `PATIENT_CONTACT_STATUS_ROLE`

| value            | role    | 備考            |
| ---------------- | ------- | --------------- |
| pending          | neutral | 未連絡          |
| attempted        | info    | 連絡試行        |
| confirmed        | done    | 確定            |
| declined         | blocked | 拒否            |
| change_requested | confirm | 変更要望=要確認 |
| unreachable      | blocked | 連絡不能        |

### RequestStatus — `REQUEST_STATUS_ROLE`

| value       | role     | 備考                    |
| ----------- | -------- | ----------------------- |
| draft       | neutral  | 下書き                  |
| sent        | waiting  | 送付済=相手回答待ち     |
| received    | info     | 受領                    |
| in_progress | info     | 対応中                  |
| responded   | done     | 回答済                  |
| closed      | readonly | クローズ                |
| escalated   | confirm  | エスカレーション=要対応 |
| cancelled   | blocked  | 取消                    |
| expired     | blocked  | 期限切れ                |

### TracingReportStatus — `TRACING_REPORT_STATUS_ROLE`

| value        | role    |
| ------------ | ------- |
| draft        | neutral |
| sent         | waiting |
| received     | info    |
| acknowledged | done    |

### SelfReportStatus — `SELF_REPORT_STATUS_ROLE`

| value             | role     | 備考                  |
| ----------------- | -------- | --------------------- |
| submitted         | confirm  | 受領=トリアージ要対応 |
| triaged           | info     | トリアージ済          |
| converted_to_task | done     | タスク化              |
| resolved          | done     | 解決                  |
| dismissed         | readonly | 却下                  |

### PatientShareCaseStatus — `PATIENT_SHARE_CASE_STATUS_ROLE`

| value                        | role     | 備考            |
| ---------------------------- | -------- | --------------- |
| draft                        | neutral  | 下書き          |
| consent_pending              | waiting  | 同意待ち        |
| partner_confirmation_pending | waiting  | 相手確認待ち    |
| active                       | done     | 共有成立        |
| suspended                    | confirm  | 一時停止=要対応 |
| revoked                      | blocked  | 撤回            |
| ended                        | readonly | 終了            |
| declined                     | blocked  | 辞退            |

### PharmacyVisitRequestStatus — `PHARMACY_VISIT_REQUEST_STATUS_ROLE`

| value                    | role    | 備考                   |
| ------------------------ | ------- | ---------------------- |
| draft                    | neutral | 下書き                 |
| requested                | waiting | 相手の受諾待ち         |
| accepted                 | info    | 受諾                   |
| declined                 | blocked | 辞退                   |
| scheduled                | info    | 日程確定               |
| visited                  | info    | 訪問済                 |
| recording                | info    | 記録中                 |
| submitted                | waiting | 基幹薬局レビュー待ち   |
| base_reviewing           | waiting | 基幹薬局レビュー中     |
| returned                 | confirm | 差戻し                 |
| confirmed                | info    | 確認(後続あり)         |
| physician_report_created | info    | 報告書作成済(後続あり) |
| claim_checked            | info    | 算定確認済(後続あり)   |
| completed                | done    | 完了                   |

### PharmacyContractStatus — `PHARMACY_CONTRACT_STATUS_ROLE`

| value                    | role    | 備考           |
| ------------------------ | ------- | -------------- |
| draft                    | neutral | 下書き         |
| pending_base_approval    | waiting | 基幹承認待ち   |
| pending_partner_approval | waiting | 連携先承認待ち |
| active                   | done    | 有効           |
| expired                  | blocked | 期限切れ       |
| terminated               | blocked | 解除           |
| suspended                | confirm | 一時停止       |

### VisitBillingStatus — `VISIT_BILLING_STATUS_ROLE`

| value     | role     | 備考            |
| --------- | -------- | --------------- |
| candidate | neutral  | 算定候補=未確定 |
| confirmed | done     | 確定            |
| excluded  | readonly | 除外            |
| invoiced  | done     | 請求済          |
| voided    | blocked  | 無効化          |

### QrDraftStatus — `QR_DRAFT_STATUS_ROLE`

| value     | role    |
| --------- | ------- |
| pending   | neutral |
| confirmed | done    |
| discarded | blocked |

### PackagingInstructionTag — `PACKAGING_INSTRUCTION_TAG_ROLE`

| value            | role   | 備考                   |
| ---------------- | ------ | ---------------------- |
| cold_storage     | hazard | 冷所                   |
| narcotic         | hazard | 麻薬                   |
| crush_prohibited | hazard | 粉砕禁止               |
| half_tablet      | info   | 半錠(作業指示)         |
| separate_pack    | info   | 別包                   |
| unit_dose        | info   | 一包化                 |
| staple_required  | info   | ステープル             |
| label_required   | info   | ラベル                 |
| ptp              | info   | PTP・ヒート(作業指示)  |
| mixing           | info   | 混合(作業指示)         |
| excipient        | info   | 賦形(作業指示)         |
| decapsulation    | info   | 脱カプセル(作業指示)   |
| no_unit_dose     | info   | 一包化しない(作業指示) |
| manual_ptp       | info   | 手撒きPTP(作業指示)    |

### DispenseAuditResult — `DISPENSE_AUDIT_RESULT_ROLE`

| value              | role    |
| ------------------ | ------- |
| approved           | done    |
| rejected           | blocked |
| hold               | confirm |
| emergency_approved | done    |

### SetAuditResult — `SET_AUDIT_RESULT_ROLE`

| value            | role    |
| ---------------- | ------- |
| approved         | done    |
| partial_approved | confirm |
| rejected         | blocked |

### SetCellState — `SET_CELL_STATE_ROLE`

| value   | role    |
| ------- | ------- |
| pending | neutral |
| set     | done    |
| hold    | confirm |

### SetAuditCellState — `SET_AUDIT_CELL_STATE_ROLE`

| value     | role    | 備考   |
| --------- | ------- | ------ |
| unaudited | neutral | 未監査 |
| ok        | done    | OK     |
| ng        | blocked | NG     |

### UserAccountStatus — `USER_ACCOUNT_STATUS_ROLE`

| value           | role     | 備考             |
| --------------- | -------- | ---------------- |
| pending_cognito | waiting  | Cognito連携待ち  |
| invited         | waiting  | 招待済(応答待ち) |
| active          | done     | 有効             |
| suspended       | blocked  | 停止             |
| retired         | readonly | 退職             |
| cognito_failed  | blocked  | 連携失敗         |

### 適用範囲と除外

- **移行対象**: status 系 enum / `*_LABELS` / `*_VARIANTS` / `*_CONFIG` を消費する画面の状態バッジ/状態ドット、個別ベタ書きの `bg-{red,green,...}-100 text-*-800` 等の状態色。
- **移行対象外**: chart / グラフ系列色（`--chart-1..5`）、純粋な装飾、印刷/PDF/帳票、状態意味を持たない区分値（GENDER / CHANNEL / VisitType / 後発・先発等 — 色を付けない）。
- **KPI / サマリーの件数表示は色を付けない**（neutral 強調のみ）。件数は単一エンティティの状態ではなく、数値への状態色は「赤=危険」の偽シグナルになる。`text-foreground`（ゼロ件は `text-muted-foreground`）で表し、件数チップの区別はラベル＋空間分離で行う（確定例: clerk-support KPI, eed6cc63）。
- **境界事例の判定**: カテゴリにも状態にも読めるバッジは、(1)ラベルが識別を担い色は識別に不要、かつ(2)値が単一エンティティの進行状態に対応する場合は state 軸＝移行する（例: card-workspace `ACTIVITY_BADGE_CLASSES` → transition=info / inquiry=confirm / intake=neutral）。

### 移行の経緯（記録）

- 基盤フェーズ: 中央トークン / `StateBadge`・`StatusDot` / `*_ROLE` マップ整備（additive）。`SCHEDULE_STATUS_STYLES`（死にコード）と `badge-semantics.ts`（6軸と競合する重複セマンティック）は削除済み。
- 消費者移行 5 スライス完了（2026-06-20）: tasks-content `d7c1b7d5` / handoff-workspace `7e183d81` / prescription.shared `f5793fe4` / set-workspace `0dfede25` / schedule day-view `0df5dd1e`。以降、状態色ドリフトは残ゼロ（残存 raw は「3.3 意図的に残す」該当のみ）。
- 識別トークン化フェーズ（2026-06-27〜28、`docs/color-token-remediation-plan.md`）: Phase 1-3 完了で登録簿の 8 family が land。

## 11. 禁止事項（統合リスト）

各項目の根拠章は括弧内。詳細規則は該当章を正とする。

- 色を増やすこと。生 Tailwind 状態色の直書き。状態色の全面塗り（タイル/カード/行/入力欄）（3.1/3.2）。
- raw `Badge variant`・ローカル `statusVariant` での状態表現。`destructive` の止まっていない状態への流用（7.3）。
- アラート4段階のフラット化。偽アラート（0件で赤点灯・達成時も常時橙）。`role="alert"`(assertive) の常設（7.5/8.8）。
- 偽の安全保証・偽データ（ハードコード ✓、未接続の全 0、永続化されない「採用」、window 集計の過小件数、暗黙の一覧切り捨て）（2.7/2.8）。
- PHI の生値露出。破壊的・広域・準不可逆操作の確認なし即実行。破壊的操作の Thumb zone・密な行内配置（2.7/4.7/7.4）。
- 安全情報（麻薬/ハイリスク/冷所/抗凝固/アレルギー/腎機能/患者識別）の Pinned 欠落・`+N` 隠し・モバイル列非表示（4.1/7.3）。
- スピナー/テキスト単独ローディング、実形状と不一致のスケルトン、false-zero / false-empty。裸の `animate-pulse` div（6.1/6.2）。
- 12px 未満の文字。数値への `tabular-nums` 欠落。見出しレベルのスキップ。即席タイポサイズ（3.4/3.8/4.5）。
- 過大角丸（`rounded-2xl` 常用）。状態意味のない影・装飾カード・重複表示。1件ずつの全カード化（3.5/3.6/7.6）。
- 固定 `px`/`100vh`/`min-h-screen` 高さ、データ非連動の巨大 `min-h-[...]`、マジック余白（3.5/4.6）。
- 生 `<select>`/`<input>` の新規実装。`SelectValue` の明示 children 欠落。ルート override での 44px 担保（5.3/5.4）。
- DOM 順と視覚順の入替（`order-*`）。可視 h1 の本文直置き。`PageScaffold`/共通ヘッダの未経由（4.4/4.5）。
- 生 JSON の一次入力化。コード記法・生 enum 値の利用者向け露出。無人 `window.print()`（3.4/5.4/5.7）。
- 「OK」「はい」だけの確認ボタン。対象実データのない汎用確認文言「本当によろしいですか」（5.3/5.6）。
- 不可逆操作の UI（失敗後を含む）への undo /「元に戻す」文言（偽の可逆性アフォーダンス）（5.6、2026-07-02 rev2）。
- 失敗・エラーの唯一の通知手段としての自動消滅トースト（4.2/6.3/6.6、2026-07-02 rev2）。
- 可逆な日常操作への確認ダイアログの常用（habituation で防御力を失う。undo 優先。**破壊的・取消不可操作は対象外＝頻度に関わらず二段階確認必須のまま**）（5.6、2026-07-02 リサーチ統合）。
- 装飾アニメーション。`prefers-reduced-motion` 未対応の transition/animation（3.7）。
- OTP・パスワード欄のコピー&ペースト禁止、認証フローへの認知機能テスト/CAPTCHA 追加（8.6/9.3、2026-07-02 リサーチ統合）。
- 臨床判断画面（相互作用・アレルギー）への `stale-while-revalidate` / `stale-if-error` 適用（9.2、2026-07-02 リサーチ統合）。
- 用量の末尾ゼロ表記（5.0mg）、1 未満の先頭ゼロ省略（.3mg）（7.8、2026-07-02 リサーチ統合）。
- トースト・ドロップダウン・モーダル・ボタン等アクション部品へのスケルトン適用（6.2、2026-07-02 リサーチ統合）。
- 例外があり得る場面での完全ハードストップ（迂回手段なしの続行不能ブロック）（7.5、2026-07-02 リサーチ統合）。
- UI 導線のない孤児 API の放置。実在しない/未接続の API を呼ぶ UI（片翼実装）（2.11、2026-07-02）。
- 画面独自アイコンセット・一回限りのアイコン割当・インライン SVG の新設。共通枠（ヘッダ・患者識別・フィルタ行・テーブル）の画面ローカル再実装（3.10/7.9、2026-07-02）。
- 手動 `useMemo` / `useCallback` / `React.memo` の新設（React Compiler 前提）（9.7、2026-07-02）。
- landing / portfolio 向け skill の hero、AIDA、logo wall、GSAP scroll hijack、magnetic hover、image-first surface を業務画面へ持ち込むこと。PH-OS では「2.4.1」の適用範囲が正本。
- skill や外部デザイン流派を根拠に、`lucide-react`、PH-OS 色トークン、既存共通部品、44px、状態5分離を置き換えること（1.3/2.4.1/3.10/7.1）。
- 画面名・領域名のない可視の汎用 loading copy（「読み込み中...」だけの本文表示）。`role="status"` + 固有 `aria-label` + 実形状 skeleton を正とする（6.2）。
- 画面ローカルな `rounded-xl` / `rounded-2xl` / `rounded-3xl` コンテナ、decorative gradient、広域 `backdrop-blur`、意味のない shadow を増やすこと（3.5/3.6/7.6）。

## 12. 変更履歴・経緯

- **2026-07-04（product boundary scope 明確化）**: ユーザー明示により、active objective 達成に必要な場合は product API / DB / auth / authorization / PHI / billing / deploy / package dependency も変更対象に含める方針へ更新。従来の「DB 除く」表記を撤廃し、backend/API/DB と UI を連動して正しい product contract へ修正することを明文化した。安全ゲートは緩和しないため、migration 適用・deploy・secret rotation・production data mutation・destructive operation は current-task の明示許可を必要とする。
- **2026-07-04（taste-skill 追加後のコードスキャン反映）**: 追加された `design-taste-frontend` / `redesign-existing-projects` 系 skill をそのまま採用せず、PH-OS の医療・薬局向け高密度業務 UI に適用できる部分だけを SSOT へ翻訳。`PageScaffold` / `PageSection`、`DataTable`、`Loading` / `SkeletonRows`、`ErrorState` / `EmptyState`、`StateBadge` / `StatusDot`、`Button`、`HelpPopover`、`lucide-react` の現行実装をコードスキャンし、①アクティブ実装エージェント（Codex 単独）前提の文言へ更新、②skill 適用範囲（dashboard/data table/product UI への不適合部分の除外）を明文化、③button label 1 行・PHI-free disabled reason・可視 generic loading copy 禁止・角丸/カード互換例外・Lucide 維持を追記。数値規範の緩和なし。
- **2026-06-20**: 6軸状態色の基盤整備と消費者移行 5 スライス完了（コミット記録は「10. 移行の経緯」）。raw 残存の「意図的に残す」リスト確定。
- **2026-06-21**: 配置監査 ADD ratified（「4.9」）。weekend トークン・sr-only h1・ヘッダ部品 3 種・KPI ストリップ例外ほか確定。
- **2026-06-26**: 状態色の塗り面積最小化 ratified(「3.2」) / 世界水準リファイン規約（リサーチ統合: 足し算引き算・at-a-glance・クリック予算・アラート4段階・8pt/tabular-nums・モーション数値・5状態・Thumb zone・レーン着手順）/ 全画面監査に基づく実装規範章（現5〜7章の実装規則群）。根拠: `docs/research/medical-uiux-research-2026-06-26.md`。
- **2026-06-27〜28**: 識別トークン化 Phase 1-3 land（登録簿 8 family、「3.3」）。
- **2026-06-28**: 実装前リサーチ追補 ratified（SAFER-first / Use-risk / Public-health layout / Safety-critical display / route announcer、「2.2」。画面骨格 4 種は「4.3」、追加ゲートは「2.9」へ統合）。
- **2026-06-30**: Backend-supported UI Safety Contracts ratified（13 契約 + 実装前チェック、「2.8」「2.9」）。
- **2026-07-02（ユーザー裁定）**: 調剤ワークベンチ本体（/dispense /audit /set /set-audit）の視覚変更保護を**解除**（「2.1」Workbench first を更新）。視覚変更は許可されるが、操作体系・工程フロー・test-locked 契約の保全と、特性テスト + before/after スクショによる通常より高い検証水準を必須とする。
- **2026-07-02（集約）**: 本書を唯一のデザイン SSOT として集約。旧 `docs/uiux-design-system.md` / `docs/state-color-migration-map.md` を統合しリダイレクトスタブ化。医療フロントエンド刷新規約統合（ボタン動詞ラベル / エラー文言=原因+次の行動 / FEUX-1 スケルトン binding / FEUX-2 StatCard binding / FEUX-4 SOAP トークン / prefers-reduced-motion 必須 / キーボード完結 / FEUX-8 未保存離脱ガード / 5状態対応）。
- **2026-07-02（リサーチ統合改版・本版）**: 章構成を 12 章へ再編（内容の削除なし・確定表は逐語保持）。以下を新設: 患者識別・誤認防止（2.3）/ エビデンス駆動検証プロセス（2.10）/ CVD 検証ゲート（3.9）/ ボタン配置規範（5.2）/ confirm vs undo の使い分け根拠（5.6）/ インジケータ表示閾値（6.2）/ オフライン・劣化モード（6.6）/ CDS アラート運用（7.5 後半）/ 薬剤名・用量・日付の安全表示（7.8）/ WCAG 2.2 AA への準拠基準更新と JIS 整合注記（8 章）/ AWS 運用起因の UX 規範（9 章）。実在部品と計画部品の区別を明文化（7.1: `SafetyTagBadge` / `OtpInput` / `PasswordStrengthField` は新設予定、`AlertBanner` は `AlertTier` が実装正本）。数値規範の緩和はなし（本文 14px 最低線・44px・8pt・radius・モーション数値・閾値はすべて維持。16px は読み物系への推奨追加のみ）。
- **2026-07-02（rev2・確定指摘反映）**: ①ExpiryBadge 規範を旧版の 2 段閾値（期限切れ/30日以内=blocked、90日以内=confirm）へ**逐語復元**（rev1④の「実装契約の正本化」は改版規律「1.3」数値規範緩和禁止に違反するため撤回。実装ギャップは期限付き必須改修として是正台帳登録、暫定は warnWithinDays 既定 90 日化または差分理由必須。7.5 段階2の例示も 90 日基準へ復元。ローカル 2 段実装の共通化 TODO は FEATURE_QUEUE へ）。②「2.8」fail-safe デフォルトを発生源別へ強化（CDS 禁忌・アレルギー・相互作用チャネル/patient_specific=true の欠落は interrupt+確定操作ブロック、他チャネルのみ confirm floor。「一段高い tier」の曖昧表現を撤廃、7.5 降格不可 floor の優先を明文化、欠落率を監視 KPI 化）。③不可逆操作の失敗後導線を「再試行導線（明示ボタン+永続失敗表示）」へ修正し、「元に戻す」ラベルを可逆操作専用と規定（禁止事項へ追加）。④「4.2」Toast の使用条件を成功フィードバックに限定し、失敗の唯一の通知手段とすることを禁止。⑤undo ウィンドウ規範（最低 10 秒+hover/focus 停止+恒久導線）と「可逆」の定義を新設。⑥能動的確認への移行に台帳・目標期日を課し、新規画面は初版から能動的確認必須（例外なし）、移行中画面の受動確認に実データ埋め込みを最低条件化。⑦接続状態トーストのデバウンス/集約を規定（一次表現は永続インジケータ）。⑧「2.9」に 44px 例外の検出チェックを追加。**land 時の裁定（2026-07-02 Claude maker 裁定・記録）**: ①「8.2」の 24px+spacing 例外条項は**却下・削除**（CLAUDE.md の 44px 必須と test-locked 契約への緩和経路新設はガード付きでもドリフトの入口となるため、44px を無条件維持。24px は監査上の絶対下限としての言及のみ残す）。②「4.2」Modal 行への緊急中断アラート追加は**承認**（旧規範のアラート4段階「緊急中断=割込み」が既に modal 的中断表示を含意しており、Z軸章との章間矛盾の解消=明確化であって緩和ではない）。
- **2026-07-02（ユーザー指示・追記）**: 全画面適用の 2 規範を新設（追加のみ・数値規範の緩和なし）。①**アイコノグラフィ（3.10）**: 重要情報・状態・アクションはアイコン＋テキストで伝え、同一意味＝同一アイコンを全画面で固定、`lucide-react` 統一、色/アイコン単独依存の禁止（3.9 と一体）、装飾アイコンは `aria-hidden` / 情報アイコン単独は `aria-label`。②**画面遷移の視覚的安定性（7.9）**: 共通枠（`PageScaffold`/`WorkflowPageHeader`/`PatientHeader`/`FilterChipBar`/`DataTable`/`StatCard`）を共通コンポーネント化して画面ローカル再実装を禁止（二重実装禁止 7.1 と一体）、非同期領域は寸法予約でレイアウトシフト（CLS）防止、Core Web Vitals CLS（9.6）へ接続。
- **2026-07-02（ユーザー指示・追記 3 + 全体精査）**: ①**フロントエンド・バックエンド連動（2.11 新設・全画面/全 API 適用）**: 片翼実装（UI 導線のない孤児 API / 実在しない API を呼ぶ UI / モック固定の本番同型画面）の禁止、`.agent-loop/API_REACHABILITY_LEDGER.md`（E1 監査）の運用正本化、契約変更の提供側/消費側連動更新、型の単一ソース化。「2.9」チェックと「11.」禁止事項へ反映。②**全体精査による stale 是正**（規範変更なし・事実更新のみ）: 「7.1」実在部品表へ `PatientHeader` / `FilterChipBar` / `SafetyTagBadge`（`1f9de4d9` で共通化済み）を登録し SafetyTagBadge を計画部品から昇格、「7.3」の SafetyTagBadge 新設予定表記を実在へ更新（順序ロジックは共有 helper へ収斂中）、「7.7」の既知残存違反（SoapSection）を全解消済みへ更新（form 側 4 箇所も `03d49349` で置換完了）。③「1.3」の手動メモ化記述を明確化（「要求する規範を書かない」趣旨の明示。新設禁止の正本は「9.7」、禁止事項一覧へも追加）。数値規範の変更なし。
- **2026-07-02（ユーザー指示・追記 2）**: ①**アイコン hover/focus 詳細（3.10 追記）**: 共通 `Tooltip`（新設予定、7.1 計画部品へ登録）でアイコンのホバー/フォーカス時に詳細を表示。touch/keyboard 到達性を必須化し、患者安全直結情報は Tooltip に隠さず常時表示（2.3/4.3）を維持。②**レンダリング最適化 実装規範（9.7 新設）**: React Compiler に memo 化を委ね手動 memo を新設しない（React 19 + React Compiler 採用）／RSC 優先・Client 薄く／`next/dynamic` 遅延ロード／Suspense+Skeleton ストリーミング／TanStack Query キャッシュ・`select`・カーソルページング／密テーブル仮想化／`startTransition`・`useDeferredValue` で INP 保護／レイアウトスラッシング回避／アセット最適化。計測先行（2.10）・目標は 9.6。追加のみ・数値規範緩和なし。
- **2026-07-02（rev1・改版レビュー反映）**: 医療安全・規範消失・エビデンス・repo 整合・構成のレビュー指摘を反映。①confirm/undo 規則の適用範囲を「可逆・良性の日常操作」に限定し直し、破壊的・取消不可操作の「二段階確認（Modal + 操作対象と影響の明示）必須」（旧規則）を「5.6」「11.」に復元。②旧「実装ルール」3 規則（4.3）・2026-06-28 追加ゲート第3項（`<main>` 含む、2.9/4.4）・「列、フィルタ、CSV/印刷は状態と連動」（2.4）・「KPI 値の文字色に chart 系列色を当てない」（7.2）を復元。③プライマリ色コントラストの誤記（16:1）を実測値（約 8.7:1 / 約 10:1）へ訂正、Amplify 応答制限を Web Compute 実値（5.72MB / 504）へ訂正、CDS 4 分類の出典を Paterno 2009 へ差し替え。④ExpiryBadge 規範を実装契約（expired=blocked / ≤30日=confirm / 以遠=中立）へ整合させ、30/90 二段閾値は共通部品への拡張予定（新設予定）として明示。PackagingInstructionTag 確定表へ実装済み 6 値（ptp/mixing/excipient/decapsulation/no_unit_dose/manual_ptp、全て info）を追記。⑤オフライン同期バッジを 4 状態（送信失敗=blocked を常時表示に含む）へ確定。⑥8.2 の 24px+spacing を「監査合格基準」に限定（実装目標は 44px、患者行内・訪問モードは例外不可）。⑦CDS 最重症層の降格不可 floor と alert contract の fail-safe デフォルト（欠落時は一段高い tier）を追加。⑧重複規則を相互参照化（日付基準=2.8、sr-only h1=4.5、ヘッダ部品=4.4、weekend トークン=3.3、max-width=4.6 を各正本に）、4.2 Modal 条件に 7.5 段階1 の緊急中断アラートを明記、主操作ボタン塗り色の正本を 5.1（`--primary`）に一本化。8.1 の「2.1 から更新」という不正確な履歴記述を削除（WCAG 2.2 AA は 2026-06-26 以降継続）。数値規範の緩和なし（強化・訂正のみ）。
