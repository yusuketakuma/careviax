# G4: アクセシビリティ規格調査 — WCAG 2.2 / JIS X 8341-3:2016 / デジタル庁ガイドブック

調査日: 2026-07-11 / 出典種別: 公開一次資料

対象システム: PH-OS Pharmacy（在宅訪問薬局向け業務 SaaS。高密度データ一覧、キーボード中心の調剤ワークベンチ操作、訪問先でのタブレット併用、オフライン対応 PWA）。

本書は UI/UX リフレッシュ Phase 1 の規格調査記録である。競合製品の固有表現は含まない。各項目の適用性区分は以下を使用: Mandatory / Applicable / Conditionally applicable / Not applicable / Requires legal review / Requires clinical safety review / Requires security review。

---

## 1. 規格・ガイドライン台帳

### 1.1 WCAG 2.2（Web Content Accessibility Guidelines 2.2）

| 項目 | 内容 |
| --- | --- |
| 正式名称 | Web Content Accessibility Guidelines (WCAG) 2.2 |
| 発行主体 | W3C（Web Accessibility Initiative / AG WG） |
| バージョン | 2.2（W3C Recommendation） |
| 公表日/改定日 | 初版勧告 2023-10-05、最新勧告版 2024-12-12（編集的更新。達成基準の実質内容は不変） |
| 確認日 | 2026-07-11 |
| 公式出典URL | https://www.w3.org/TR/WCAG22/ ／ 更新履歴: https://www.w3.org/standards/history/WCAG22/ ／ 新規基準解説: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/ |
| 対象範囲 | Web コンテンツ全般（Web アプリ・PWA を含む）。達成基準は A / AA / AAA の3レベル |
| 適用性 | **Applicable（AA を設計目標として採用推奨）** — 日本の法令が WCAG 2.2 への適合を直接義務付けているわけではないが、国際的なデファクト基準であり、JIS 改正（後述 1.3）が WCAG 2.2 相当（ISO/IEC 40500:2025 一致）へ向かっているため、先行採用が合理的 |
| 適用性判断の根拠 | ISO/IEC 40500:2025 として国際規格化済み（2025年、W3C WAI 発表: https://www.w3.org/WAI/standards-guidelines/wcag/ 確認日 2026-07-11）。WCAG 2.0/2.1 との後方互換（2.2 AA 適合はほぼ 2.0/2.1 AA を包含。ただし 4.1.1 Parsing は 2.2 で廃止・削除） |
| UIへの含意 | 新規9基準のうち本システムに直結するのは 2.4.11 Focus Not Obscured (Minimum, AA)、2.5.7 Dragging Movements (AA)、2.5.8 Target Size (Minimum, AA)、3.2.6 Consistent Help (A)、3.3.7 Redundant Entry (A)、3.3.8 Accessible Authentication (Minimum, AA)。詳細は §2 |

WCAG 2.2 の新規達成基準（W3C "What's New in WCAG 2.2" より、確認日 2026-07-11）:

- 2.4.11 Focus Not Obscured (Minimum) — AA
- 2.4.12 Focus Not Obscured (Enhanced) — AAA
- 2.4.13 Focus Appearance — AAA
- 2.5.7 Dragging Movements — AA
- 2.5.8 Target Size (Minimum) — AA
- 3.2.6 Consistent Help — A
- 3.3.7 Redundant Entry — A
- 3.3.8 Accessible Authentication (Minimum) — AA
- 3.3.9 Accessible Authentication (Enhanced) — AAA
- （削除）4.1.1 Parsing は obsolete として WCAG 2.2 から削除

### 1.2 WCAG 3.0（動向・参考）

| 項目 | 内容 |
| --- | --- |
| 正式名称 | W3C Accessibility Guidelines (WCAG) 3.0 |
| 発行主体 | W3C（AG WG） |
| バージョン | Working Draft（勧告ではない） |
| 公表日/改定日 | 確認できた最新ドラフト: 2026-03-03 公開の Working Draft（要求事項 174 項目、Bronze/Silver/Gold 等級案）。勧告化は 2028 年以前にはならない見込み（Candidate Recommendation 目標 2027 Q4） |
| 確認日 | 2026-07-11 |
| 公式出典URL | https://www.w3.org/WAI/news/2026-03-03/wcag3/ ／ https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/ |
| 対象範囲 | Web コンテンツ＋アプリ＋ツール（WCAG 2 系より広い） |
| 適用性 | **Not applicable（現時点では設計基準にしない）** — Working Draft であり内容が流動的 |
| 適用性判断の根拠 | W3C 自身が「WCAG 3 は完成まで数年かかる。現行標準は WCAG 2.2」と明示（上記 URL、確認日 2026-07-11） |
| UIへの含意 | 追跡のみ。APCA 等の新コントラスト指標はドラフト段階のため採用しない。現行は WCAG 2.x のコントラスト比（4.5:1 / 3:1）で判定する |

### 1.3 JIS X 8341-3:2016

| 項目 | 内容 |
| --- | --- |
| 正式名称 | JIS X 8341-3:2016 高齢者・障害者等配慮設計指針－情報通信における機器，ソフトウェア及びサービス－第3部：ウェブコンテンツ |
| 発行主体 | 日本産業標準調査会（JISC）／原案: ウェブアクセシビリティ基盤委員会（WAIC） |
| バージョン | 2016 年版（確認できた現行版。ISO/IEC 40500:2012 = WCAG 2.0 との一致規格） |
| 公表日/改定日 | 2016 年 3 月改正。**改正動向**: WCAG 2.2 の ISO 化（ISO/IEC 40500:2025、2025 年 10 月）を受け、2025-11 に JIS X 8341-3 改正原案作成委員会が発足。ISO/IEC 40500:2025 との一致規格とする方針で、順調なら 2026 年度中の改正・発行見込み（本調査時点で未発行。最新版と断定しない） |
| 確認日 | 2026-07-11 |
| 公式出典URL | WAIC ガイドライン: https://waic.jp/guideline/ ／ JIS X 8341-3:2016 解説: https://waic.jp/docs/jis2016/understanding/ ／ 改正原案委員会発足: https://waic.jp/news/20251113/ ／ 改正概要資料: https://waic.jp/wp-content/uploads/2026/02/20260206-waic-a11y-seminar-2.pdf ／ 総務省講習会資料: https://www.soumu.go.jp/main_content/000439181.pdf |
| 対象範囲 | ウェブコンテンツ（達成基準は WCAG 2.0 と同一。適合レベル A / AA / AAA） |
| 適用性 | **Conditionally applicable** — 民間 SaaS への法的義務はないが、公的機関・自治体連携（多職種連携の相手先に行政・地域包括が入る場合）や入札要件で「JIS X 8341-3:2016 レベル AA 準拠」が求められる可能性が高い |
| 適用性判断の根拠 | 総務省「みんなの公共サイト運用ガイドライン」系の運用で公的機関はレベル AA 準拠が事実上の標準。WCAG 2.2 AA を満たせば WCAG 2.0 AA（= JIS 2016 AA 相当）は 4.1.1 を除き包含される（4.1.1 は 2.2 で削除されたが、HTML の適正なパースは実装品質として維持） |
| UIへの含意 | WCAG 2.2 AA を目標にすれば JIS 2016 AA も同時に満たせる。JIS 改正（WCAG 2.2 相当化）後も追加対応が不要になるよう、新規9基準を先行実装しておく |

### 1.4 デジタル庁「ウェブアクセシビリティ導入ガイドブック」

| 項目 | 内容 |
| --- | --- |
| 正式名称 | ウェブアクセシビリティ導入ガイドブック（DS-671.2、デジタル社会推進標準ガイドライン群） |
| 発行主体 | デジタル庁 |
| バージョン | 確認できた最新版: 2025-10-16 付でデジタル社会推進標準ガイドライン群に編入された DS-671.2 版（初版 2022-12-05、改定 2023-05-12 ほか） |
| 公表日/改定日 | 2025-10-16（編入・更新）。同日に補完資料「DS-672.1 ウェブアクセシビリティ広報向けガイドブック」も公開 |
| 確認日 | 2026-07-11 |
| 公式出典URL | https://www.digital.go.jp/resources/introduction-to-web-accessibility-guidebook ／ PDF: https://www.digital.go.jp/assets/contents/node/basic_page/field_ref_resources/08ed88e1-d622-43cb-900b-84957ab87826/bf5f4482/20251016_introduction_to_web_accessibility.pdf |
| 対象範囲 | 行政機関・事業者向けの導入解説（規格ではなく取り組み方の指針。JIS X 8341-3 / WCAG を参照） |
| 適用性 | **Applicable（参考指針として）** — 法的拘束力はないが、国内での説明責任・調達対応の共通言語として有効 |
| 適用性判断の根拠 | デジタル庁の公式ガイドブックであり、国内公共調達・行政連携時の期待水準を示す一次資料 |
| UIへの含意 | 「方針策定 → 対象範囲の明示 → 試験 → 公開」という取り組みプロセスの雛形として利用。PH-OS でもアクセシビリティ方針文書（対象範囲・目標レベル・試験方法）を用意する根拠になる |

### 1.5 法的コンテキスト（参考）

- 障害者差別解消法の改正により 2024-04-01 から事業者の合理的配慮の提供が義務化（内閣府: https://www8.cao.go.jp/shougai/suishin/sabekai.html 確認日 2026-07-11）。ウェブアクセシビリティ自体は「環境の整備」（努力義務）と整理されるのが一般的だが、B2B 医療 SaaS における具体的な法的要求水準の判定は **Requires legal review**。
- 医療機関・薬局の従事者（高齢の薬剤師を含む）が業務上使用するシステムであるため、視覚・操作特性への配慮は労働安全・業務安全の観点でも実益がある（ここは規格要求ではなく設計判断）。

---

## 2. 医療業務システムへの適用上の要点（PH-OS 向け）

前提となる PH-OS の特性: (a) 高密度データテーブル（薬歴・処方一覧・在庫）、(b) キーボード中心操作（調剤ワークベンチの F キー/Enter 運用）、(c) 訪問先タブレット（タッチ）、(d) 状態遷移が業務安全に直結（差戻し・疑義照会・アラート）。

### 2.1 コントラスト（1.4.3 / 1.4.6 / 1.4.11）

- 根拠: WCAG 2.2 SC 1.4.3 Contrast (Minimum, AA) テキスト 4.5:1（大テキスト 3:1）、SC 1.4.11 Non-text Contrast (AA) UI 部品・グラフィックオブジェクト 3:1、SC 1.4.6 (AAA) 7:1。出典: https://www.w3.org/TR/WCAG22/#contrast-minimum （確認日 2026-07-11）
- 適用性: **Mandatory（プロジェクト規約として。CLAUDE.md の WCAG AA 必須方針と一致）**
- 医療特有の要点:
  - 状態色（稼働=緑/保留=橙/終了=灰、待ち=青/進行中=緑/差戻し=赤 等）は「色のみ」で伝達しない（SC 1.4.1）。アイコン＋テキスト併記は既存方針どおり。加えてバッジ/ドットは背景と 3:1（1.4.11）を満たすこと。淡色 zebra stripe 上の灰色テキストが 4.5:1 を割りやすいので注意。
  - 警告 3 段階（赤/橙/黄）のうち**黄系は白背景で 3:1 を満たしにくい**。黄は塗りではなく濃色テキスト＋黄背景（十分に濃い境界線）で構成する。
  - disabled 表示はコントラスト要件の適用除外だが、「読めないと業務が止まる」画面（監査画面の非活性項目等）では除外に頼らず読める濃度を選ぶ — ここは **Requires clinical safety review**（非活性でも参照が必要な臨床情報の識別）。

### 2.2 ターゲットサイズ（2.5.8 Target Size (Minimum), AA — WCAG 2.2 新規）

- 根拠: ターゲットは 24×24 CSS px 以上。例外: 間隔（24px 円が重ならない spacing）、インラインテキスト内リンク、等価な代替手段の存在、ユーザーエージェント既定、essential。出典: https://www.w3.org/TR/WCAG22/#target-size-minimum （確認日 2026-07-11）
- 適用性: **Mandatory（AA 目標のため）**。ただし PH-OS は既にタッチターゲット 44px 以上を規約化しており（CLAUDE.md、Button variant contract: coarse=44px）、2.5.8 の 24px を大きく上回る。
- 医療特有の要点:
  - 高密度テーブル内の行内アクションアイコン（編集/削除/展開）が 24px を割りやすい最頻出違反点。行高を削っても**ヒット領域**（padding 込み）は 24px 以上を維持する。
  - タブレット（coarse pointer）では 44px 系 variant、デスクトップ（fine pointer）では compact を許す現行の 2 段構えは 2.5.8 と両立する。`sm:h-11` / `sm:min-h-[44px]` 等の意図的タッチターゲットは撤去しない（既存 test-locked 契約）。
  - 併せて 2.5.7 Dragging Movements (AA): ドラッグ操作（並べ替え等）には単純クリック代替（上へ/下へボタン等）を必ず用意する。

### 2.3 フォーカス（2.4.11 / 2.4.12 / 2.4.13、既存 2.4.7）

- 根拠: 2.4.11 Focus Not Obscured (Minimum, AA): フォーカスされた要素が作成者由来のコンテンツで完全に隠れないこと。2.4.12 (Enhanced, AAA): 一部も隠れないこと。2.4.13 Focus Appearance (AAA): フォーカスインジケータの面積・コントラスト（2px 周囲相当、3:1）。出典: https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum （確認日 2026-07-11）
- 適用性: 2.4.11 **Mandatory（AA）**。2.4.12 / 2.4.13 **Applicable（AAA だが、キーボード中心の調剤ワークベンチでは実質必須品質として採用推奨）**
- 医療特有の要点:
  - sticky header + zebra テーブルは 2.4.11 の典型的リスク。キーボードでテーブル内を上方向に移動した際、フォーカス行が sticky header / 固定フッター（操作バー）/ 通知トーストの下に完全に隠れないよう `scroll-padding-top/bottom` を設定する。
  - 調剤ワークベンチ（F12→Enter 等のキーボード運用）では「今どこにフォーカスがあるか」が誤操作防止の生命線。2.4.13 相当の太く高コントラストなフォーカスリングを標準化する — フォーカス起点の誤確定は調剤過誤に直結するため **Requires clinical safety review** を伴う設計項目。
  - 非モーダルなパネル/ドロワー展開時にフォーカス対象を覆わないこと。ConfirmDialog の autoFocusConfirm（F12→Enter 運用の意図設計）は維持しつつ、フォーカス移動が視覚的に追えること。

### 2.4 ステータスメッセージ（4.1.3 Status Messages, AA — WCAG 2.1 由来）

- 根拠: ステータスメッセージはフォーカスを受け取らずに支援技術へ通知できること（`role="status"` / `role="alert"` / `aria-live`）。出典: https://www.w3.org/TR/WCAG22/#status-messages （確認日 2026-07-11）
- 適用性: **Mandatory（AA）**
- 医療特有の要点:
  - 自動保存の「保存しました」、オフライン PWA の「同期中/同期完了/オフラインです」、検索結果件数の更新は `role="status"`（polite）。
  - 相互作用・アレルギー等の**安全性アラートは `role="alert"`（assertive）**とし、視覚表示と支援技術通知を同時に行う。ただしアラートの割り込み設計（読み上げの中断挙動）は誤操作誘発と裏腹のため **Requires clinical safety review**。
  - ライブリージョンの乱用（テーブル全体を aria-live にする等）は読み上げ洪水を招く。件数サマリ等の要約ノードだけを通知する。

### 2.5 Reduced Motion（prefers-reduced-motion）

- 根拠: WCAG 2.2 SC 2.3.3 Animation from Interactions (AAA)（インタラクション起因のモーションを無効化可能に）、SC 2.2.2 Pause, Stop, Hide (A)。OS 設定の検出は CSS Media Queries Level 5 の `prefers-reduced-motion`。出典: https://www.w3.org/TR/WCAG22/#animation-from-interactions ／ https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion （確認日 2026-07-11）
- 適用性: 2.2.2 **Mandatory（A）**、2.3.3 は AAA だが `prefers-reduced-motion` 対応は低コストのため **Applicable（採用推奨）**
- 医療特有の要点:
  - 業務システムのため装飾モーションは元来最小。対象はトースト/ドロワー/アコーディオンのトランジション、スケルトンローディングの明滅、同期スピナー。`@media (prefers-reduced-motion: reduce)` でトランジションを即時切替へ縮退する共通 CSS を1箇所に定義する。
  - ただし**安全性アラートの視覚的顕著性はモーションに依存させない**（点滅で注意喚起しない）。reduce 環境でも警告が同等に目立つこと（色＋アイコン＋配置で担保）。

### 2.6 Forced Colors（forced-colors / Windows ハイコントラスト）

- 根拠: CSS Media Queries Level 5 `forced-colors` メディア特性（ユーザー強制パレット環境の検出）。WCAG の達成基準そのものではないが、SC 1.4.1 Use of Color / 1.4.11 の趣旨を強制配色環境でも成立させるために必要。出典: https://www.w3.org/TR/mediaqueries-5/#forced-colors （確認日 2026-07-11）
- 適用性: **Conditionally applicable** — 薬局 PC は Windows 比率が高く、ロービジョンの従事者がコントラストテーマを使う蓋然性があるため対応推奨。優先度は AA 必須項目より下。
- 医療特有の要点:
  - forced-colors 環境では背景色・box-shadow が除去されるため、**背景色だけでエンコードした状態（zebra、選択行、状態バッジの塗り）が消失**する。選択状態は border/outline、状態は SVG アイコン（`currentColor` ではなく `forced-color-adjust` を考慮）＋テキストで冗長化する。
  - フォーカスリングを box-shadow のみで実装すると forced-colors で消える。`outline`（transparent outline + shadow の併用パターン）を基本にする。
  - 全面対応は工数が大きいため、まず「調剤ワークベンチ・監査・患者一覧」の主要動線で状態が読めることをスモークテストする段階的方針を推奨。

### 2.7 その他 PH-OS に直結する WCAG 2.2 新規基準（要点のみ）

- 3.2.6 Consistent Help (A): ヘルプ導線（HelpPopover 等）の配置を全ページで一貫させる。既存の WorkflowPageHeader 共通化と整合。適用性: **Mandatory（A）**。
- 3.3.7 Redundant Entry (A): 同一プロセス内で既入力情報（患者情報・住所等）の再入力を求めない（自動転記/選択可能に）。訪問報告書ワークフローに直結。適用性: **Mandatory（A）**。
- 3.3.8 Accessible Authentication (Minimum, AA): 認知テスト（記憶転記等）に依存しないログイン。Cognito + TOTP/FIDO2 構成はコピー&ペースト許可・パスワードマネージャ非阻害を確認。適用性: **Mandatory（AA）**、ただし認証 UI の変更は **Requires security review**（既存 hard-stop 規律に従う）。

---

## 3. 適用性サマリ

| 項目 | 区分 | 一言根拠 |
| --- | --- | --- |
| WCAG 2.2 レベル AA 全体 | Applicable（プロジェクト目標として Mandatory 扱い） | 国際デファクト。JIS 改正先取り |
| WCAG 2.2 AAA（2.4.12/2.4.13/2.3.3 等） | Applicable（選択採用） | キーボード中心業務での実益 |
| WCAG 3.0 | Not applicable | Working Draft（2026-03-03 版）、勧告は 2028 年以降 |
| JIS X 8341-3:2016 AA | Conditionally applicable | 公的連携・調達要件で要求され得る。2026 年度中に WCAG 2.2 相当へ改正見込み（未発行） |
| デジタル庁導入ガイドブック | Applicable（参考指針） | 方針策定・試験プロセスの雛形 |
| 障害者差別解消法（合理的配慮） | Requires legal review | B2B SaaS への要求水準は法務判断 |
| コントラスト（1.4.3/1.4.11） | Mandatory | AA + 既存プロジェクト規約 |
| ターゲットサイズ（2.5.8） | Mandatory（既存 44px 規約が上回る） | AA。テーブル行内アイコンが要監視点 |
| フォーカス（2.4.7/2.4.11） | Mandatory | AA。sticky header/トーストによる遮蔽が要監視点 |
| フォーカス外観（2.4.13） | Applicable + Requires clinical safety review | 調剤誤操作防止に直結 |
| ステータスメッセージ（4.1.3） | Mandatory（アラート設計は Requires clinical safety review） | AA。安全性アラートは role=alert |
| prefers-reduced-motion | Applicable | 低コスト。警告はモーション非依存で顕著性維持 |
| forced-colors | Conditionally applicable | Windows 主体環境で推奨。主要動線から段階対応 |
| アクセシブル認証（3.3.8） | Mandatory + Requires security review | 認証 UI は hard-stop 規律対象 |

## 4. 出典一覧（すべて確認日 2026-07-11）

1. W3C, WCAG 2.2（勧告本文）: https://www.w3.org/TR/WCAG22/
2. W3C, WCAG 2.2 Publication History（2023-10-05 初版勧告 / 2024-12-12 最新勧告版）: https://www.w3.org/standards/history/WCAG22/
3. W3C WAI, What's New in WCAG 2.2（新規9基準・4.1.1 削除）: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
4. W3C WAI, WCAG 2 Overview（ISO/IEC 40500:2025 承認を含む）: https://www.w3.org/WAI/standards-guidelines/wcag/
5. W3C WAI, WCAG 3 Introduction / 2026-03-03 Working Draft 告知: https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/ ／ https://www.w3.org/WAI/news/2026-03-03/wcag3/
6. W3C, Media Queries Level 5（prefers-reduced-motion / forced-colors）: https://www.w3.org/TR/mediaqueries-5/
7. WAIC, ガイドライン（JIS X 8341-3:2016）: https://waic.jp/guideline/ ／ 解説: https://waic.jp/docs/jis2016/understanding/
8. WAIC, JIS X 8341-3 改正原案作成委員会 発足のお知らせ（2025-11-13）: https://waic.jp/news/20251113/ ／ 改正概要セミナー資料（2026-02-06）: https://waic.jp/wp-content/uploads/2026/02/20260206-waic-a11y-seminar-2.pdf
9. 総務省, JIS X 8341-3:2016 概要（講習会資料）: https://www.soumu.go.jp/main_content/000439181.pdf
10. デジタル庁, ウェブアクセシビリティ導入ガイドブック（DS-671.2、2025-10-16 版 PDF）: https://www.digital.go.jp/resources/introduction-to-web-accessibility-guidebook ／ https://www.digital.go.jp/assets/contents/node/basic_page/field_ref_resources/08ed88e1-d622-43cb-900b-84957ab87826/bf5f4482/20251016_introduction_to_web_accessibility.pdf
11. 内閣府, 障害者差別解消法関連: https://www8.cao.go.jp/shougai/suishin/sabekai.html

注記: JIS X 8341-3 は本調査時点で確認できた現行版が 2016 年版であり、改正版（WCAG 2.2 / ISO/IEC 40500:2025 一致予定）は未発行のため最新版と断定しない。ISO/IEC 40500:2025 の正確な発行日は一次資料での日付特定に至らず「2025 年（10 月頃）」の粒度で記録した。
