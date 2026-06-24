# 配置監査 ADD — SSOT 解決案ドラフト (人間ラチファイ用)

PLACEMENT_AUDIT.md の ADD 群 (docs/ui-ux-design-guidelines.md 未記載で判断が割れた点) について、推奨解決案 + 根拠を提示する。

> **✅ RATIFIED 2026-06-21**: 9項目すべて推奨案で人間承認済。docs/ui-ux-design-guidelines.md「## 追加規約（2026-06-21 配置監査 ADD ratified）」に反映済。ADD依存項目(SYS-4のSOAP/カレンダー色, SYS-5/HIGH-3のh1, KPIストリップ等)は着手可。

| ID | 論点 | 推奨解決案 | 根拠 | アンブロック対象 |
|----|------|-----------|------|-----------------|
| ADD-1 | SOAP の S/O/A/P 色・服薬カレンダーの時間帯/曜日色・証跡カテゴリ色 (非状態色) の扱い | **「識別目的の固定色は状態色と別系統として許可」を明記**。ただし系列性のあるもの(時間帯)は `--chart-*`、土日など慣習色は専用トークン(`--weekend` 等)を新設し生 Tailwind 直書きは不可。 | L170 は「状態色のベタ書き禁止」が主眼。識別色まで禁止すると表現できない。系列/慣習は別トークン系統が筋。 | SYS-4 の SOAP/カレンダー/capture 分 |
| ADD-2 | ワークスペース型トップの h1 配置 + トップ階層ヘッダ規約 | **page.tsx に `<h1 class="sr-only">` を置き、本文先頭は h2** に統一 (visits/reports 方式)。ヘッダ部品は通常ページ=`WorkflowPageIntro`(back付)、ハブ=`WorkflowPageHeader`。handoff の可視h1直置きは sr-only h1+h2 へ寄せる。 | 多数派が page.tsx sr-only h1 方式。視覚見出しは h2 でもページ構造上 h1 が保証され WCAG 適合。 | SYS-5 h1統一, HIGH-3, billing/notifications/card-workspace/collaboration/intake の h1 |
| ADD-3 | KPI ストリップ (1指標=1カード) は L84「1件ずつカード化しない」違反か | **「同種の指標群を横並びにする KPI ストリップは許容パターン」と明記**。ただし外枠(意味グループ)で内包し、装飾(影/過剰角丸)は最小。 | KPI 比較は一覧性が要件。statistics/billing-candidates/external 等で頻出の確立パターン。 | Low: KPI カード化指摘群 (statistics/billing-candidates/partner-cooperation/external) |
| ADD-4 | CardTitle と heading 要素の関係 | **CardTitle は `asChild` で h2/h3 を必須付与** (セクション見出しに使う場合)。装飾ラベル用途は別 (text-only)。 | L231「見出しは見出し要素で」。shadcn 既定 div のままは階層断絶。 | SYS-1 |
| ADD-5 | 確認専用ビューでの生成物への確認/訂正フィードバック・施設ロジ申し送り | **「正本(患者情報)への編集導線でなければ、生成物(AI要約)への確認・訂正フィードバックや施設ロジ申し送りは read-only ビューでも許可」と明記**。 | L96-101 の「正本分離」の趣旨は患者正本の保護。生成物への注記は正本改変でない。 | visits/[id]/brief, facility-packet の Med 解消 |
| ADD-6 | max-width 許可対象に設定・選択系操作画面を含めるか | **含める** (「読み物/印刷/フォーム + 設定・選択系の操作画面」へ拡張)。ただし業務ワークスペース(一覧/詳細/ダッシュボード)は全幅維持。 | views/edit は入力ゆとり優先 (CLAUDE.md 情報密度: 入力はゆとり)。 | views(max-w-5xl), patients/[id]/edit(max-w-7xl→max-w-5xl) |
| ADD-7 | 1ページに大量大機能を直列する admin 画面の分割基準 | **「主作業1グループ + 補助は PageSection(h2)で大グループ化、補助が3つ以上なら Tab/ドロワー/別ページへ」**を目安として明記。 | drug-masters/template-content の埋没を防ぐ。L83-88 階層原則の運用基準。 | M5 (template), M6 (drug-master) |
| ADD-8 | 印刷文書の配色 + アプリ名表記 | 印刷文書は `bg-gray-800` 等の文書様式を許容 (画面配色方針の対象外と明記)。**アプリ名は1つ (PH-OS 推奨、docs/CLAUDE.md が PH-OS) に統一**し metadata.title を揃える。 | 印刷は別媒体。名称混在 (PH-OS/CareViaX) は学習コスト。 | Low: print 色, metadata.title 統一 |
| ADD-9 | ダミー/未実装画面 (MasterEditorView) の状態スタブ要否 | **実データ接続まではダミー明示 (「サンプル表示」バナー) を置き、loading/empty/error スタブは実装時に同時導入**。 | clear-state は実データ前提。ダミーに偽の状態は不要だが「ダミーである」明示は必要。 | SYS-2 の状態欠落 (T3 実装と連動) |

## 反映後の効果
- ADD-2 承認 → SYS-5 h1統一 + HIGH-3 が確定基準で着手可
- ADD-4 承認 → SYS-1 (CardTitle asChild) が確定仕様で着手可
- ADD-1 承認 → SYS-4 の SOAP/カレンダー/capture 分が確定基準で着手可
- ADD-3/5/6/7 承認 → 対応 Med/Low が「逸脱」から「許容」へ再分類され、無駄な churn を回避

> 未承認の項目は PLACEMENT_AUDIT.md の「ADD確定後に着手推奨」に従い保留。SYS-1/2/3 と HIGH-1/2、SYS-4 の prescription-history/card-workspace/realtime 分は ADD 非依存で今すぐ着手可。
