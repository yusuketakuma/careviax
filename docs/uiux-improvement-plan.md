# UI/UX Improvement Plan

本書は構造化UI/UX監査所見（9クラスタ／約70ルート）を、careviax の運用規律（maker/checker 分離・objective gate・LOCK 規律・hard-stop 領域）に載せて実装可能にするための改善計画である。SSOT は `docs/ui-ux-design-guidelines.md`、配色・状態色は 6軸トークン（StateBadge/StatusDot）と `docs/state-color-migration-map.md`、コンプライアンスは CLAUDE.md（3省2ガイドライン）に従う。

## 改善ゴール

- **医療安全の信号価値を回復する**: アラート4段階（緊急中断=赤／要確認=橙／状態=中立／期限リマインダー=情報）を厳格分離し、「赤を見たら必ず行動」を守る。偽シグナル（常時橙・0件でも赤・偽の緑✓）を排除する。
- **見落としを構造的に防ぐ**: 患者識別（氏名／生年月日／年齢）・アレルギー・ハイリスク薬・腎機能を詳細画面の Pinned サマリーへ常時表示（折りたたみ禁止・sticky）し、安全タグの `+N` 折りたたみから重大タグを除外する。
- **状態色 SSOT へ収束する**: raw shadcn Badge variant／生 Tailwind 色（bg-*-100, text-rose-600 等）を 6軸トークン化し、状態色の塗り面積を最小化（左ボーダー＋文字色＋点／ピル、全面 `bg-state-*/10` 禁止）する。
- **情報重力を整える**: 「今すぐ対応・次にやること・止まっている理由」を Primary/Pinned zone（fold 内）へ、KPI/件数ストリップを一覧の上へ昇格し、補助大機能が3つ以上の超長画面を Tab/ドロワー/別ページへ分割する。
- **共通部品を先に作って重複を減らす**: StatCard/SignalTile/AlertTier/ExpiryBadge/OtpInput/PasswordStrengthField/PatientPinnedHeader 等を抽出し、各画面の再発明と逸脱の温床を断つ。
- **ローディング/エラー/空/権限の4状態分離**: スピナー/テキスト単独を廃し、レイアウト形状を保つスケルトン＋再試行付き ErrorState を全画面で徹底し CLS を抑える。
- **アクセシビリティ/レスポンシブの下限を守る**: ラベル12px／本文14px以上、タッチターゲット44px、色のみ依存禁止（アイコン+テキスト）、モバイルの source/visual order 不入替、thumb zone への主操作固定。
- **破壊的・広域操作を二段化する**: 月次締め・薬価全件取込・貸出取消・外部共有リンク発行・重複患者強行登録等に ConfirmDialog（対象・件数・取消可否提示）を必須化する。

## 対象範囲

- 全 admin クラスタ（組織系マスタ／臨床マスタ／運用分析系）の表示層・状態色・情報順・確認ダイアログ・スケルトン整備
- 患者一覧／患者詳細＆サブページ／処方せん系／訪問系／スケジュール系／報告書・請求系／連携・コアナビ系の表示層改善
- 認証クラスタ（auth）の UI 整合・到達性・アクセシビリティ・共通部品化（**ロジックは不変**）
- 共通コンポーネントの拡張・新規（PageScaffold/PageSection/各Header/DataTable/StateBadge/StatusDot ＋ 新規部品群）
- パフォーマンス（巨大クライアントコンポーネント分割・debounce・memo・スケルトン整合）
- レスポンシブ（dvh ベース高さ・横スクロール代替・thumb zone・order 入替解消）
- アクセシビリティ（タイポ下限・44px・色のみ依存解消・キーボード操作・aria）

## 非対象範囲

- **DB変更**（スキーマ・カラム・migration）
- **API破壊的変更**（レスポンス形・エンドポイント契約の変更）
- **認可認証仕様変更**（ロール権限・アクセスモデル・Cognito/NextAuth フロー・MFA ロジック）
- **課金ロジック変更**（在宅算定 SSOT、billing-rules の評価・締め計算ロジック。表示・確認導線のみ可）
- **Clinical Workbench 本体の視覚変更**（dispense/audit/set/set-audit 本体。周辺の loading/empty/error/サンプル表示バッジのみ可）
- auth/billing/security/破壊的 migration/本番 deploy は別途承認（`.agent-loop/BLOCKED.md` 退避対象）

## ページ別改善計画

### P0（医療安全・偽シグナル・最重要情報順の是正）

| Page | 改善内容 | 足し算 | 引き算 | リスク | 完了条件 |
| --- | --- | --- | --- | --- | --- |
| `/patients/[id]` | 識別ストリップ+SafetyBoard を sticky Pinned 化、最下部 aside の「次にやること/止まっている理由」を Primary zone へ昇格、在宅運用タイルの全面塗りを左ボーダー化、未処理アラートと定常リマインダーを分離、HomeOperations/quick-form を dynamic import 分割 | sticky Pinned、Primary CTA、ドロワー起動ボタン | 全面塗り、最下部 aside、二重 props 記述 | 巨大ファイル(4655行)改修のリグレッション | スクロール時もアレルギー/ハイリスク薬が画面内に残る／next-action が fold 内／全面 `bg-state-*/10` 0件／lint・typecheck・build green |
| `/visits/[id]` | 患者名/生年月日/年齢/アレルギー/ハイリスク薬の Pinned サマリー追加、loading をスケルトン化、SOAP 生Tailwind色をトークン化、キャンセル理由を state-blocked、残薬テーブルを共通DataTable+tabular-nums、報告書宛先を共通DropdownMenu | Pinned サマリー、宛先キーボード操作 | テキスト loading、生Tailwind色、手組みpopover | 宛先誤選択の安全影響 | fold 内に患者識別+危険タグ常時表示／残薬数値が等幅／宛先メニューがキーボード操作可／4状態分離 |
| `/visits/[id]/record` | モバイル/PC ヘッダ Pinned にアレルギー/ハイリスク薬常時表示、CDS 即時中断を Pinned 直下へ、警告4種を様式分離（赤/橙/青/中立左ボーダー）、useWatch分割+useMemo化、loadingスケルトン、金額/用量 tabular-nums | Pinned 危険タグ、4段階様式分離 | 全面塗りカード、全体購読 useWatch | 入力中の危険タグ消失 | 入力中も危険タグ可視／警告が見た目で4段階区別可／再レンダリング負荷低減を確認／build green |
| `/prescriptions` | text-[9px/10px]廃止し最小12px、CYCLE_STATUS_CONFIG を 6軸 StateBadge/StatusDot へ、麻薬/ハイリスク/冷所/アレルギー/年齢を Pinned 相当へ追加、件数ストリップをサーバ集計化（不可なら「読込済N件中」明示）、height 指定一元化、期限を弱色で常時表示 | 安全タグ列、サーバ集計件数 | 過小件数、2日先期限の非表示、極小フォント | 疑義/調剤待の過小表示で見落とし | ラベル≥12px／状態が StateBadge／件数が総数準拠 or 明示／安全タグ表示 |
| `/prescriptions/[id]` | pending を destructive→waiting(紫)へ統一、状態を StateBadge、固定サマリに年齢/アレルギー/ハイリスク/麻薬タグ、明細に安全列、調剤方法をモバイルで非表示にしない、アクションバーに Primary/Secondary 格付け、change_detail 全面塗り→左ボーダー、rounded-xl→rounded-md | 安全列、Primary CTA | 誤アラート(赤pending)、全面塗り、モバイル列非表示 | 回答待ちを緊急と誤認 | pending=waiting で inline と一致／一包化/粉砕がモバイルで残る／安全タグ表示 |
| `/prescriptions/new` | 差分/疑義/施設パネルの全面塗り→左ボーダー、生 input/select を shadcn へ、主要グループ見出しを h2 統一、送信失敗時にエラー要素へスクロール+フォーカス+aria-live、明細行 React.memo、GenericCandidatePanel を条件絞り | エラーフォーカス移動、h2統一 | 全面塗り、生フォーム要素 | 末尾送信後のエラー見落とし | 送信失敗でエラーへ自動移動／見出し階層連続／タイプアヘッド負荷低減 |
| `/prescriptions/intake` | 行の状態色全面ベタ塗り廃止（zebra+左ボーダー/バッジ）、生 Tailwind 色を6軸トークン化、h1 を sr-only にし本文 h2 開始、auto_read_percent を中立/数値強調に | h2開始、数値強調 | 行ベタ塗り、生色、見出しスキップ | 重複検知警告の埋没 | 行ベタ塗り0件／状態色トークン化／見出し h1(sr-only)→h2 |
| `/admin/shifts` | 週末色を `--weekend`、祝日を状態トークン化、メンバー管理/定型シフトを Tab か別ルート分割、loading をグリッド形状スケルトン、破壊系を…メニューへ畳む | Tab/別ルート、スケルトン | 生rose/sky色、2388行の単一画面 | 巨大画面分割のリグレッション | 生Tailwind状態色0件／月間グリッドが主作業に集中／スケルトン整合 |
| `/admin/business-holidays` | 休日チップ/曜日色を `--weekend`+状態トークン、休業/営業を StateBadge（destructive不使用）、loading=スケルトン+isError=ErrorState、サマリーを上部へ+tabular-nums、削除を…側へ | ErrorState、tabular-nums | 生red/blue色、destructive濫用、下部サマリー | false-empty で取得失敗を空表示 | 生色0件／取得失敗が空に潰れない／サマリーが上部 |
| `/admin/drug-masters` | 薬価更新/全件取込/HOT/PMDA等の広域 mutate に ConfirmDialog（ソース・想定件数・最終取込日時）必須化、自作チェックボックスを共通Checkbox+アイコン、CardTitle を h2 化、formulary 専用ブロックを別ルート/タブへ | 広域操作の確認、h2階層 | 4485行の縦積み密度、生チェックボックス | 組織全体の薬価誤上書き | 取込が確認なしで実行されない／検索→一覧→詳細の3クリック動線／見出し階層一貫 |
| `/admin/formulary` | KPIキューに aria-pressed+current 表現、期限超過/要対応件数に confirm ピル、影響/不一致/コピー/一括を運用ツールタブへ退避、拠点別クエリ段階表示+per-section skeleton、申請承認を raw JSON→before/after 整形 | 現在キュー明示、滞留可視化 | 縦積み肥大、raw JSON | 別キュー誤認操作 | 現在キューが視覚的に判別可／約15クエリの段階表示／申請差分が整形表示 |
| `/admin/performance` | API P95 を値ベース着色（達成時中立）、初回ロードにスケルルトン、シグナルタイル全面塗り→左ボーダー+ピル、8ブロックを「今すぐ対応/業務KPI/APIパフォーマンス(別タブ)」へ再編、共通 SignalTile 導入 | 値ベース着色、スケルトン | 常時橙、全面塗り、8大ブロック | 偽シグナルでの alert fatigue | P95達成時に橙が出ない／false-zero解消／タイルが点線表現 |
| `/admin/uat` | 7大セクションを Tab 分割（Pinned に phase2判断/blocker件数）、全クエリを共通 ErrorState(再試行)へ、要確認患者の住所等 PHI マスク、external readiness を StateBadge+日本語、tabular-nums | Tab、PHIマスク | 7大セクション縦積み、生p段落エラー | PHI 露出 | Tab で目的セクション即到達／PHI マスク済／再試行導線統一 |
| `/schedules`（day-board） | pending/risk の全面塗り→左ボーダー、日週トグル+対象日+件数ストリップを sticky Pinned、前日/今日/翌日 DayNavigator 追加、推奨車両反映に ConfirmDialog、リスクバナー role=status、ラベル≥12px | DayNavigator、ConfirmDialog、Pinned | 全面塗り、role=alert常設、極小フォント | 車両/順路の誤反映 | 日付ナビで別日移動可／反映に確認／件数帯が sticky／ラベル≥12px |
| `/schedules/conflicts` | 採用/再確認の永続化（API反映+ConfirmDialog）または非永続の明示、採用ボタンラベルを recommendedPlan 連動、min-h-[760px]撤去、h1 統一 | 永続化 or 明示、ラベル連動 | min-h固定、偽の完了 | 重なり未解消を「直した」と誤認 | 採用が実反映 or 非永続を明示／ラベルが対象案と一致 |
| `/schedules/emergency-route` | ハードコード緑✓を実データ3値（満たす/未確認/競合）へ、案2にも採用 or 「参考(採用不可)」明示、チャートに凡例（赤=緊急/紫=固定/青=通常）+ノード種別 title | 実データ充足表示、凡例 | 偽の安全保証、選べない案 | 競合/過負荷を安全と誤認 | 未計算が緑にならない／凡例で色覚非依存／案選択の整合 |
| `/reports/[id]` | WorkflowPageIntro 直下に患者識別 Pinned サマリー（氏名/カナ/生年月日/年齢/ハイリスク・アレルギー）、content warnings を本文側にも要約、Alert を役割別トークンで描き分け、shareTargets を useMemo | Pinned サマリー、警告本文要約 | 患者名がダイアログまで出ない、Alert同一見た目 | 患者取り違え/警告見落とし | fold 内に患者識別／警告がモバイルで本文後に埋没しない／Alert4段階分離 |
| `/billing/candidates` | 月次締めに ConfirmDialog（対象件数・金額・取消不可提示、ロジック不変更）、計算内訳の生JSON→定義リスト/小テーブル、サマリー/主因/操作を1ブロック集約 | 締め確認、内訳整形 | 確認なし締め、生JSON | 不可逆な月次締めの誤実行 | 締めが確認なしで実行されない／内訳が可読／締め可否判断が一望 |
| `/workflow` | 20+セクションを Tab/別ページ分割、Pinned 件数ストリップ sticky、AlertPill を4段階分離、raw Badge を 6軸へ、疑義「変更ありで確定」に ConfirmDialog、loading をセクション形状スケルトン、継続調剤テーブルを overflow-x+tabular-nums | Tab、Pinned帯、確認 | 単一赤AlertPill、縦積み20+ | 処方変更の単一クリック実行 | 主導線が3秒で把握可／赤が緊急のみ／処方変更に確認 |

### P1（共通部品化・状態色統一・到達性/PHI/破壊操作）

| Page | 改善内容 | 足し算 | 引き算 | リスク | 完了条件 |
| --- | --- | --- | --- | --- | --- |
| `(auth)/login` | aside を単段化、3ステップ説明と下部 info を統合、bg-slate-50/80→bg-muted、email に autoFocus、Suspense fallback を実形状スケルトンへ | autoFocus | 重複説明、装飾aside | 認証フロー(ロジック不変) | 重複説明解消／トークン化／フォールバックのCLS低減 |
| `(auth)/mfa` | OTP を共通 OtpInput 化、390px で grid-cols-6 w-full min-w-0 方式へ | 共通OtpInput | 三重実装 | 入力体験のリグレッション | OTP共通部品使用／390px で破綻なし |
| `(auth)/first-login` | 要件リスト達成に Check アイコン+語併記（色非依存）、確認欄に表示トグル、PasswordStrengthField 共通化 | アイコン+語、トグル | 色のみ達成表示、重複実装 | アクセシビリティ未達 | 色覚非依存で達成判別可／新旧トグル一致 |
| `(auth)/password/reset` | 共通 AuthStepper、コード再送ボタン（表示導線のみ）、OtpInput/PasswordStrengthField 共通化、step切替時フォーカス移動 | Stepper、再送導線 | 重複実装 | 復旧成功率 | ステッパー共通化／再送導線あり |
| `(auth)/lockout` | 連絡先/解除時間を組織情報供給、未設定時フォールバック文（捏造値排除）、連絡先パネル本文を text-foreground、ロック事実をヘッダ or Alert に集約 | フォールバック文 | プレースホルダ固定値、青文字本文、二重提示 | 業務停止時に管理者へ到達不能 | 03-XXXX 等の固定値が本番に出ない／コントラスト確保 |
| `(auth)/mfa/setup` | QR loading を192pxスケルトン、リカバリーコード保存チェックを必須化してから完了活性、OtpInput 共通化、tabular-nums | 保存確認ガード、スケルトン | スピナー単独 | 未保存→自己ロック | 保存確認なしで完了不可（UIガードのみ） |
| `/admin/users` | 件数ストリップを検索直下/テーブル上へ、STATUS_MAP を StateBadge へ写像（赤はブロック限定）、詳細Sheet 上部に固定サマリーバンド、全Select に明示 children（SSR enum 漏れ封止） | 固定サマリー、明示children | 下部件数、destructive濫用 | SSR enum 生表示 | 件数が上部／状態が StateBadge／enum 漏れ0件 |
| `/admin/staff`・`/admin/facilities`・`/admin/vehicles`・`/admin/external-professionals` | サンプル帯を readonly 注意バナーに集約し彩度を落とす、実装時は institutions 同型 DataTable+PageSection へ、loading/empty/error 同時導入、vehicles は車検/保険期限バッジ | 注意バナー、状態スタブ | 装飾過多3レール、ダミー誤認 | 未接続マスタの誤認 | サンプルが本番と判別可／実装時に4状態同時 |
| `/admin/pharmacist-credentials` | アラートを「期限切れ/30日=blocked赤」「90日=confirm橙」の2バナー分離、失効ボタンを詳細/メニューへ、同意患者は件数のみ（PHI最小化） | 2段アラート | 重大度フラット、PHI露出 | 期限切れ見落とし/PHI | 赤/橙が分離／同意患者氏名が一覧非展開 |
| `/admin/facility-standards` | 算定不可=赤独立バナー/期限接近=橙別バナー、ClaimStatusBadge を StateBadge 統一、スクロール移動を ref ベース化 | 役割別バナー | destructive直書き、querySelector直叩き | 算定不可(収益直結)の埋没 | 算定不可が独立赤／トークン統一 |
| `/admin/service-areas` | match_keywords/facility_ids をチップ入力化（JSONは折りたたみ）、geo_data 既定折りたたみ、isError 分岐 ErrorState、description のバッククォート除去 | 構造化入力、ErrorState | 生JSON一次入力、文言崩れ | 誤入力、false-empty | 非エンジニアが安全入力可／取得失敗に再試行 |
| `/admin/settings` | 設定行を44px(h-8→h-11)、ScopePanel loading=スケルトン/error=ErrorState、JSON保存に差分プレビュー+確認+離脱防止、Health degraded/down に対処導線 | 確認/離脱防止、対処導線 | 32px、確認なしJSON上書き | 設定値破壊 | 44px達成／JSON保存に確認／4状態統一 |
| `/admin/pca-pumps` | 取消に ConfirmDialog（資産/機関/請求予定額提示）、検索 debounce、返却検品待ちを Pinned 件数化、3Card を PageSection 化、overdue を blocked へ | 取消確認、Pinned件数 | debounce欠如 | 貸出/請求記録の誤消去 | 取消に確認／打鍵ごとfetch解消 |
| `/admin/document-templates` | 生JSON編集を構造フォームへ（JSONは折りたたみ）、種別フィルタを Select/Tabs、文面編集の正本を一本化 | 構造フォーム | 重複編集面 | テンプレ破損→文書生成波及 | 高頻度項目が構造化／編集の正本明確 |
| `/admin/contact-profiles` | 検索 debounce、未完了KPIを左ボーダー+文字色（全面塗り回避）、ページング/仮想化検討 | debounce | 全面塗りKPI | 打鍵ごとfetch | debounce適用／KPI塗り面積最小 |
| `/admin/pharmacy-sites` | 2026改定リマインダーを confirm(橙)へ格下げ、拠点一覧に検索+PageSection、保険設定を別Drawer分離 | 検索、Drawer | destructive濫用 | 赤の規律低下 | リマインダーが赤でない／検索あり |
| `/admin/pharmacy-cooperation` | SectionShell→PageSection、NativeSelect→共通Select、包括44pxハック撤廃、状態を StateBadge（終了/期限切れ=readonly、停止/失敗のみ赤）、クエリ別 skeleton/ErrorState で partial 表示、中間グリッド定義 | partial表示、中間列 | 独自部品、包括CSSハック、全画面ゲート | 中立状態に赤=誤判断 | 共通部品化／6軸統一／1クエリ遅延で全画面落ちない |
| `/admin/metrics` | placeholder(404)時に「サンプル/未接続」明示バナー、閾値超過=blocked/目標未達=confirm 分離+補助アイコン、4状態スタブ整備 | PlaceholderNotice | 0値の実測誤読 | 経営判断の誤データ | 未接続が明示／重大度分離 |
| `/admin/realtime` | シグナルタイルを件数>0 のみ点灯（0件=中立）、order-* 入替撤去で workbench を DOM 先頭、全面塗り廃止、未処理例外の二重掲示解消 | 件数条件点灯 | 0件赤、order入替、二重表示 | alert fatigue | 0件で赤/橙が出ない／DOM順=視覚順 |
| `/admin/audit-logs` | 総件数/「100件以上は出力で確認」明示 or ページング、FilterSummaryBar に「直近100件」注記 | 総件数表示 | 暗黙の切り捨て | 監査証跡の暗黙切り捨て | 100件超が明示／全件誤認なし |
| `/admin/alert-rules` | 4機能を Tab 再編、condition JSON にスキーマ補助/プレビュー、生JSON を折りたたみ | Tab、スキーマ補助 | 縦積み、生JSON常時展開 | 誤った安全ルール投入 | Tab分割／誤条件抑止 |
| `/admin/data-explorer` | 生データ/詳細の PHI マスク、保存に差分確認 or undo、高さ制御を md から効くブレークポイントへ | PHIマスク、差分確認 | 生PHI露出、確認なしPATCH | PHI露出/誤更新 | PHIマスク済／保存に確認 |
| `/patients` | 素h1 を WorkflowPageHeader へ、新規登録(Primary)/比較(Secondary) を 44px 常設、サマリータイルとチップの役割分離（release特例解消）、now を useMemo 固定、重大安全タグは +N に折り畳まない | 主要CTA、now固定 | 二重絞り込み、特例 | 重大タグの埋没 | 共通ヘッダ／重大タグ常時表示／再計算抑制 |
| `/patients/new` | Tabs か段階ナビに統一、モバイル下部固定 FormActionBar、重複警告を二段確認、タブ単位下書き自動保存、visit/care 4カラムを PageSection 化 | FormActionBar、自動保存、二段確認 | ナビ二重 | 重複PHI生成、入力途中の損失 | 重複強行に二重確認／下書き復元可 |
| `/patients/[id]/edit` | dirty 時の離脱ガード+送信中 disabled を共通フォームで担保、正本項目に項目メタ併記 | 離脱ガード、項目メタ | — | 入力途中損失 | 離脱警告/二重送信防止が部品で担保 |
| `/patients/[id]/medications` | 4分割 Loading をスケルトン統一、introActionLinkClassName を buttonVariants へ | スケルトン | 重複スタイル | CLS | スケルトン化／共通ボタン使用 |
| `/patients/[id]/medication-calendar` | モバイルは週送り/縦リスト or 日付ヘッダ sticky、fallback をカレンダー形状スケルトン | sticky/縦リスト | スピナー | モバイル列潰れ | モバイルで判読可／スケルトン |
| `/patients/[id]/prescriptions` | 処方履歴を Primary zone へ昇格、MCS/要点を後段/右補助へ、補助2カラムを Suspense+スケルトン | 主データ昇格 | 補助の前面配置 | 取得失敗の空表示 | 履歴が fold 内優先／補助に4状態 |
| `/patients/[id]/share` | 共有入口を1系統に集約（カード内は誘導に縮約）、リンク発行(取消不可)に二重確認+失効導線 | 二重確認、失効導線 | 入口2系統 | 誤発行/過剰スコープ | 入口一本化／発行に確認 |
| `/patients/[id]/safety-check` | 患者名・ハイリスク/アレルギーを Pinned 再掲+戻り導線、fallback スケルトン、error/empty/権限を分離 | Pinned再掲 | スピナー | 取得失敗を空表示 | 危険タグ再掲／4状態分離 |
| `/patients/[id]/residual-adjustment` | PageScaffold+WorkflowPageIntro で外枠統一、x-org-id 直書きを buildOrgHeaders へ | 共通scaffold | 直書きヘッダ | 現在地喪失下の誤操作 | 共通scaffold適用／ヘッダ共通化 |
| `/prescriptions/qr-drafts/[id]` | ケース選択を人可読ラベル（開始日/施設/状態）、required 全面塗りを枠線中心、明細を折りたたみ/未入力行へ自動スクロール | 可読ラベル | UUID切詰め、全面塗り | 誤選択 | ケースが人可読／走査短縮 |
| `/visits` | 本文h1撤去し sr-only h1+本文h2、件数ストリップ sticky Pinned、患者名を見出し要素化、blocked理由を本文に要約 | Pinned件数 | 見出しスキップ | 放置記録の埋没 | 見出し階層連続／件数が sticky |
| `/visits/[id]/brief` | page に sr-only h1、md でも 2カラム(主+根拠)維持 or 補助ドロワー、選択強調を左ボーダー中心 | sr-only h1 | 全面塗り | 根拠参照動線崩れ | h1保証／tablet で根拠参照可 |
| `/visits/[id]/facility-packet` | PageScaffold で外枠統一+sr-only h1、tablet で 2カラム維持、部屋番号/件数 tabular-nums | 共通scaffold | フルブリード | 外枠不統一 | scaffold適用／h1保証 |
| `/schedules`（calendar週ビュー） | 「読み込み中」をグリッド形状スケルトン、ラベル≥12px、日↔週を keepPreviousData/共有キャッシュ化 | スケルトン | テキストloading、極小フォント | 往復fetch | スケルトン／ラベル≥12px |
| `/schedules/route-compare` | 推奨詳細と3案の二重採用導線を整理、min-h/w-44固定撤去、RouteSchematicChart 共通化 | 共通チャート | 二重導線、固定min-h | — | 採用導線一本化 |
| `/schedules/proposals?workspace=dashboard` | rounded-2xl→rounded-md、装飾tintを左ボーダー、候補カードのバッジを3つに絞る、loading スケルトン、tabular-nums | スケルトン | 角丸/バッジ過多、全面塗り | 走査性低下 | バッジ削減／角丸統一 |
| `/workflow/pharmacy-cooperation` | statusVariant の raw Badge を StateBadge へ、3KPI を sticky Pinned、テーブルセル内重量フォームをドロワー退避、loading テーブル形状スケルトン、行内ステータスで4状態 | Pinned、ドロワー | raw Badge、セル内フォーム | 6軸逸脱 | StateBadge統一／モバイルでフォーム操作可 |
| `/reports`（report-share-workspace） | actionRail を sticky サイド/上部へ昇格、セクション順を即時対応→主作業→参照、解決済みカード全面塗り→左ボーダー、h1 sr-only 化 | sticky rail | 最下部rail、全面塗り | next-action埋没 | next-action が fold 内／h1統一 |
| `/reports/analytics` | 未確認報告フォローを KPI 直下へ繰り上げ、小集計を軽量table化（ツールバー外す）、KPI の影/角丸最小化 | 行動対象昇格 | 過剰DataTable | 即時対応の逆順 | 未確認が上部／小集計が軽量 |
| `/billing`（billing-check） | PrimaryStrip と WorkspaceActionRail の重複解消（1配置）、KPIストリップを疑義テーブル上へ、critical/warning を state-blocked/confirm トークン | レール一本化 | 二重描画、生destructive | 重複ノイズ | 3点セットが1配置／トークン化 |
| `/my-day` | 緊急カード/QuickStat の全面塗り→左ボーダー、/dashboard との役割文言明確化+重複削減、訪問/タスク/ステータス行を共通 ListRow へ | 役割明確化 | 全面塗り、重複UI | アラート塗り面積過多 | 全面塗り解消／役割境界明確 |
| `/tasks` | 抱え込み/業務依頼を Tab/ドロワー退避、今すぐ処理と実行サマリーを統合、一括完了に件数つき確認、行数閾値で仮想化、SelectValue 明示 | 確認、仮想化 | 6連PageSection、重複表示 | 多数誤完了 | 一括完了に確認／重複解消 |
| `/handoff` | 「私に来た」を Pinned/Primary 固定、他を Tab/アコーディオン段階開示、TransferDialog 優先度に明示 children、section スケルトン高さ統一 | Pinned、明示children | 7section縦積み | enum生値漏れ | 最重要が fold 内／enum 漏れ封止 |
| `/communications/requests` | 完了ボタンを主操作(青)へ統一（done緑はバッジ限定）、期限バッジにアイコン併記、モバイルは詳細ドロワー | アイコン併記 | done色の主操作流用 | 色のみ依存、完了根拠の薄さ | 主操作=青／色非依存 |
| `/conferences` | 新規/活動/報告ダイアログを別ルート/遅延ロード、NoteCard 群をリスト行+詳細展開へ、ヘッダ見出し重複解消 | 遅延ロード | カード過多、見出し重複 | 初期負荷/バンドル肥大 | 初期fetch削減／カード過多解消 |
| `/external` | grant scope を日本語ラベル化（共通化）、自己申告状態を StateBadge、解決に確認/Undo、サマリーをモバイル2列 | 日本語ラベル、確認 | 英語生キー、色なし状態 | 解決の不可逆 | scope 日本語／状態色付与 |
| `/notifications` | 全画面 Loading をやめヘッダ/フィルタ残しリストのみスケルトン、urgent と通常/リマインドを差別化、ヘッダ共通化 | 部分スケルトン | 全画面Loading | 現在地喪失/警告埋没 | ロード中も現在地維持／4段階差別化 |
| `/clerk-support` | 作業テーブルに sm:hidden カードフォールバック、ヘッダ共通化、要対応KPIに点/左罫の軽い注意 | カードフォールバック | — | モバイル横溢れ | モバイルで横溢れ解消 |
| `/select-mode` | モード識別色を識別トークン(chart-*/専用)へ、現在モードを「選択中」表示、切替失敗のインライン再試行 | 現在地表示 | 生Tailwind色 | 配色SSOT逸脱 | 生色0件／選択中ハイライト |
| `/offline-sync` | サマリー/行カードの全面塗り→左ボーダー、競合解決をドロワー/モーダル化（現在地保持）、不可逆操作の警告強度を揃える | ドロワー化 | 全面塗り、全置換ビュー | アラート塗り面積過多 | 全面塗り解消／現在地保持 |
| `/shared/[token]` | 生 Tailwind 色をトークン化、status/report_type を日本語ラベル、折返し希望を共通Checkbox(44px)、OTP失敗理由を文言分離 | 日本語ラベル | 生色多用、生enum | 配色逸脱/外部者の誤読 | 生色0件／日本語ラベル／44px |

### P2（calm/装飾整理・微改善・低リスク）

| Page | 改善内容 | 足し算 | 引き算 | リスク | 完了条件 |
| --- | --- | --- | --- | --- | --- |
| `(auth)/layout` | min-h-[100dvh]+overflow-y-auto で縦長フォーム到達性、カード角丸を rounded-lg 統一 | 到達性 | 大角丸 | — | 縦長フォームで上部到達可 |
| `(auth)/password/change` | 設定画面起点の戻り導線分離、成功カードに再ログイン理由明示、確認欄トグル+PasswordStrengthField 共通化 | 戻り導線、説明 | 重複実装 | — | 戻り先が文脈別／理由明示 |
| `/admin`（master-hub） | サマリー/件数に tabular-nums、ActionRail を上部/sticky 補助列へ、鮮度バナーを due_soon=confirm/期限切れ=blocked 段階化 | tabular-nums | — | — | 件数縦揃え／次にやることが fold 内 |
| `/admin/professionals` | redirect 専用ルートの loading.tsx 整理（ちらつき除去） | — | 不要loading | — | ちらつき解消 |
| `/admin/institutions` | 検索 300ms debounce、最終処方日が古い行に confirm バッジ、電話/FAX を弱色+コピー | 鮮度バッジ | debounce欠如 | — | debounce適用 |
| `/admin/capacity` | KPI値色を中立化（閾値超過時のみ confirm/blocked 点表示）、棒グラフに数値ラベル+title | 閾値色 | 装飾的系列色 | — | KPIが状態を誤伝しない |
| `/admin/packaging-methods` | 一覧を罫線リスト/DataTable へ、ErrorState 追加、編集中見出し固定、PageSection ラップ | ErrorState | カード過多 | false-empty | 4状態分離 |
| `/admin/analytics` | 休日ギャップを左ボーダー化、MetricCard を共通 StatCard へ、`[&_input]:!h-11` を部品側で解決、月次推移をモバイル縦カード | 共通StatCard | 全面塗り、CSSハック | — | StatCard共通化／overrideハック撤去 |
| `/admin/operations-insights` | ラベル≥12px、共通 BarChart 化、棒チャートに数値テーブル併設 | a11y代替 | 11px | — | ラベル≥12px |
| `/admin/jobs` | サマリー4枚を共通 StatCard、再実行に軽量確認、モバイル縦カード | 確認 | — | 誤連打 | 再実行に確認 |
| `/admin/inventory-forecast` | 影響患者カードに切れ予定日/緊急度バッジ、SummaryCard を共通 StatCard | 緊急度バッジ | — | — | 患者リスク連動表示 |
| `/admin/dispense-audit-stats` | CardTitle を h2/h3 へ、前期間比/トレンド補助、共通 BarChart | トレンド | text-sm見出し | — | 見出し階層保証 |
| `/admin/incidents` | テキスト項目を Textarea、min-h固定撤去、未入力項目を form 内強調 | Textarea | min-h固定 | — | 長文記録可 |
| `/admin/notification-settings` | fetch を react-query 化+共通 ErrorState、UI文言のバッククォート除去、通知ルールを分類折りたたみ | react-query統一 | 手書きfetch、文言崩れ | — | ErrorState統一 |
| `/admin/billing-rules` | ヘッダを AdminPageHeader supportingContent へ、操作列を末尾へ、同期結果を件数差分明示（ロジック不変） | — | 手組みflex、操作列中央 | hard-stop領域(表示のみ) | 操作列末尾／手組み撤去 |
| `/patients/compare` | min-h-[720px]撤去、WorkflowPageIntro+PatientPicker、主操作一本化、患者識別明示 | Picker、戻り導線 | min-h固定、導線二重 | 取り違え | 戻り導線あり／識別明示 |
| `/patients/[id]/mcs` | 連携状態を StatusDot/StateBadge（未接続/失敗/同期済を別表現） | 状態分離 | — | 取得失敗を空表示 | 4状態分離 |
| `/patients/[id]/consent` | 期限リマインダー=confirm/撤回・失効=blocked or readonly に語彙分離 | 語彙分離 | — | 重大度誤読 | 色のみ依存解消 |
| `/patients/[id]/collaboration` | content に患者名+戻りリンク最小ヘッダ、fallback スケルトン | 最小ヘッダ | スピナー | 現在地喪失 | 戻り先明確 |
| `/prescriptions/qr-drafts` | 独自フィルタを共通 FilterChipBar へ、status を StateBadge、未照合を confirm バッジ+件数 | — | 重複実装 | 未照合の弱表現 | StateBadge化 |
| `/visits/[id]/capture` | bg-slate-900 をトークン化、オフライン注記を左ボーダー info へ | — | 生色、全面塗り | — | 塗り面積最小 |
| `/visits/[id]/voice-memo` | 状態バッジを StateBadge へ、tablet 2カラム維持、STT 接続後の4状態スタブ | — | 汎用Badge | — | 状態語彙統一 |
| `/visits/evidence` | shadow-sm 撤去（border+余白）、実画像未接続を明示、撮影時刻 tabular-nums | サンプル明示 | 装飾影 | — | 影撤去／サンプル明示 |
| `/schedules/proposals?workspace=optimizer` | 生成フォームと結果グリッドを Tab/ドロワー段階開示、ドラッグにキーボード/ボタン代替+44px | 代替操作 | 機能密集 | キーボード非対応 | 段階開示／代替順序変更 |
| `/schedules/* loading/error` | loading.tsx をボード形状スケルトンへ、PageScaffold variant=bare 統一 | — | 形状不一致 | CLS | スケルトン整合 |
| `/dispense`・`/audit`・`/set`・`/set-audit` | loading.tsx を workbench 形状スケルトン（phase引数）へ集約、ヘッダ近傍に「サンプル表示(実データ未接続)」バッジ（**本体視覚不変**）、周辺で error/empty/権限/未接続を出し分け | サンプルバッジ、4状態 | 重複loading | 本体保護領域 | 本体視覚不変／周辺スケルトン整合 |
| `/dashboard` | h1 と「PH-OS ダッシュボード」二重表記を1つに、件数帯を sticky Pinned、タイムラインをモバイル縦リストへ | Pinned帯 | 重複ラベル | — | 二重表記解消／件数 sticky |
| `/reports/[id]/print` | 自動印刷前にカウントダウン/トースト or 初回手動印刷へ | 予告 | 不意の自動印刷 | PHI意図せず出力 | 自動発火が抑制/予告される |
| `/reports/print`（print-hub） | 100vh→100dvh、mt-14 を 8の倍数、帳票ボタンに補足1行 | 補足 | 100vh、任意余白 | — | dvh化／8ptグリッド |
| `/reports/[id]/share` | 取得失敗/権限/状態待ちをトークン描き分け、選択中相手を中央見出し併記 | — | 同一橙系 | — | 役割別トークン |
| `/billing/partner-cooperation` | ネイティブ select を共通 Select、ドラフト作成にミニ確認、当月到達状況サマリー近接（ロジック不変） | サマリー | ネイティブselect | — | 共通Select化 |
| `/search` | h1 をタイポスケール統一、失敗カテゴリに「取得失敗」マーク、高頻度カテゴリ優先の段階表示 | 段階表示 | サイズ不統一 | false-empty | 失敗と0件を区別 |
| `/views` | Card の shadow 撤去、ヘッダ共通化、非オーナービューに理由表示1行 | 理由表示 | 装飾影 | — | 影撤去 |
| `/statistics` | ヘッダ共通化、KPI に取得時刻/stale 表示、KPI 部品共通化 | stale表示 | 重複実装 | — | 4状態明示 |
| `/select-site` | ヘッダ様式統一、切替成功 Toast に「元に戻す」 | Undo | — | — | 様式統一 |
| `/qr-scan` | 主操作をモバイル下部 thumb zone 固定、識別子を要約+必要時展開、数値 tabular-nums | thumb zone固定 | 生PHI面積 | PHI露出面 | 主操作が thumb zone／識別子要約 |
| `/offline` | オフライン中も使える /offline-sync/キャッシュ訪問への secondaryAction 追加 | 継続作業導線 | — | — | オフライン作業導線あり |
| `/`・`/communications`（redirect） | 変更不要（責務外） | — | — | — | 現状維持 |

## 共通コンポーネント改善

### 既存部品の拡張
- **PageScaffold / PageSection**: admin/患者サブページの「素 Card 直積み」「独自 SectionShell」「MasterEditorView 独自レイアウト」を PageSection に一本化。variant（bare/標準）と見出し・説明・余白を統一。residual-adjustment 等の scaffold 非経由ページを包む。
- **WorkflowPageHeader / WorkflowPageIntro / AdminPageHeader**: 補助パネルトグル（右ドロワー起動）の口を追加。supportingContent に件数/SSOT サマリを格納できるよう拡張。h1 を sr-only に統一し本文 h2 開始、タイポスケール（title/display）を role 単位で固定。
- **DataTable**: モバイルでの重要列カードフォールバック、行数閾値での仮想化/ページング、tabular-nums 既定、状態色を行ベタ塗りせず zebra+左ボーダー。小集計用の軽量バリアントを別途用意（DataTable 過剰装備の回避）。
- **StateBadge / StatusDot**: 6軸 role マッピングを拡張（処方サイクル overall_status、協力ドメイン status: draft/pending/accepted/confirmed/returned/revoked、契約 terminated/expired/ended=readonly、患者リスク 高/注意/安定）。showIcon 既定で色のみ依存を排除。
- **buttonVariants / Input / Select / Checkbox**: サイズトークンで 44px を既定保証（`!h-11`/`[&_input]:!min-h-[44px]` のルート override ハックを撤去）。Select は明示 children で SSR enum 漏れを封止。

### 新規部品
- **EmptyState / ErrorState（再試行付き）/ LoadingSkeleton**: 全画面で4状態（loading/empty/error/権限）分離を強制。スケルトンはレイアウト形状を保持（カレンダー形状・テーブル形状・workbench 全高 phase 引数付き）。素テキスト/スピナー単独・生 p 段落エラーを置換。
- **ConfirmDialog（広域/破壊操作）**: 対象・件数・取消可否を提示する共通ラッパ。月次締め・薬価全件取込・貸出取消・推奨車両反映・外部共有リンク発行・重複患者強行登録・処方変更確定へ適用。差分提示つき二択（offline-sync 競合解決）バリアントを含む。
- **ActionBar / StickyFooterAction（FormActionBar）**: モバイル下部 thumb zone に主操作（最大2ボタン）を固定。長大フォーム（patient/new, prescriptions/new, visit record, qr-scan）に適用。
- **StatCard / KpiStrip / SignalTile**: value/label/caption/icon/tone/isLoading を持つ単一 KPI 部品。SignalTile は tone を値×閾値から決め、点/線/ピルで表現（全面塗り禁止）。MetricCard/KpiCard/SummaryCard/QuickStat の乱立を集約。
- **AlertTier / AlertBanner（severity）**: アラート4段階（緊急中断=赤/要確認=橙/状態=中立/期限リマインダー=情報）を見た目で強制分離。各画面の自作橙ボックスを置換。
- **ExpiryBadge(date, thresholds)**: 残日数→blocked(≤30/期限切れ)/confirm(≤90)/done の閾値と色段階を SSOT 化。credentials/facility-standards/vehicles で共有。
- **PatientPinnedHeader / PatientSubPageScaffold**: 患者名/カナ/生年月日/年齢/アレルギー/ハイリスク薬（麻薬・インスリン・冷所・抗凝固）を sticky で常時表示。patient detail/record/visit detail/reports detail/safety-check で再利用。
- **SafetyTagBadge（オーバーフロー対応）**: 重大タグ（麻薬/ハイリスク/アレルギー）を必ず表示し軽微タグのみ +N 折りたたみ。DrugSafetyTags（明細用）と統合。
- **OtpInput / PasswordStrengthField / AuthStepper / AuthPanel / AuthResult**: 認証クラスタの三〜六重実装を集約。OtpInput は paste/backspace/フォーカス送り/aria-label/tabular-nums/44px を内包。
- **DayNavigator（Pinned）**: 前日/今日/翌日+日付+件数ストリップを sticky。day-board/conflicts/emergency-route/route-compare の日移動不能を解消。
- **RouteSchematicChart**: 訪問順 SVG（polyline+番号ノード+状態色+凡例+aria）。emergency-route/route-compare の重複を集約、色覚対応の凡例込み。
- **WorkbenchSplitView / WorkspaceSideRail / MasterListScaffold**: レセコン風 master-detail、右レール（次にやること/止まっている理由/根拠）、admin の一覧+検索+Sheet+削除Confirm 定型を共通化。
- **PHIMaskField / enum→日本語ラベルマッパ / PlaceholderNotice**: 閲覧ビューの統一マスク、scope/status/report_type 等の生値表示解消、未接続/サンプル段階の明示。
- **CalendarDayCell（weekend/holiday トークン）/ StatusTile（左ボーダー）**: shifts/business-holidays の生色実装と全面塗りを集約。

## パフォーマンス改善

- **巨大クライアントコンポーネントの分割と dynamic import**: drug-master-content(4485行)、shifts(2388行)、card-workspace(4655行)、prescription-intake-form(2982行)、visit-record-form(2457行)、pharmacy-cooperation(3400行)、conferences(2235行)、workflow-dashboard-view(約1500行)、uat(1117行)。セクション単位の React.memo/lazy、初期表示を主作業に限定。
- **検索の debounce**: institutions/contact-profiles/pca-pumps が queryKey 直結の打鍵ごと fetch → 300ms debounce。search は既存 180ms debounce 維持＋低頻度カテゴリ遅延 fetch。
- **クエリの段階表示と per-section skeleton**: formulary（約15クエリ同時発火）、performance（複数 realtime+SSE+StaffKpiPanel）、pharmacy-cooperation（全画面ゲート→partial 表示）、uat（6並列）。keepPreviousData/共有 staleTime でカレンダー日↔週往復 fetch を抑制。
- **再計算の抑制**: patients-board の `now=new Date()` を useMemo 固定、users columns を useMemo、card-workspace の quick-form コールバックを useCallback、visit-record-form の structured_soap/readiness を useMemo、useWatch をフィールド単位購読、reports shareTargets を useMemo。
- **ポーリング制御**: settings healthQuery(60s)/reports(60s)/visit-record-form(5s) の可視性連動停止、dashboard の setInterval を memo 化。
- **スケルトン整合で CLS 削減**: route loading.tsx と本体形状を一致（schedules/dispense系/workflow）。login Suspense fallback の高さ一致。
- **生 JSON.stringify の削減**: data-explorer 生データタブ・billing-candidates 展開行を整形ビュー/メモ化へ。

## レスポンシブ改善

- **高さ基準を dvh へ統一**: auth layout の min-h-screen、print-hub の 100vh、prescriptions の height 二重指定（page と workspace の衝突）を 100dvh/min-h に集約。
- **横スクロール多列テーブルの代替**: prescriptions/[id] の調剤方法(一包化/粉砕)をモバイルで非表示にしない、analytics/jobs/audit-logs/workflow 継続調剤テーブルに overflow-x+role=region と重要列カードフォールバック。
- **source/visual order の不入替**: realtime/card-workspace の order-* を撤去し DOM 順=視覚順。
- **thumb zone への主操作固定**: patient/new, prescriptions/new, visit record, qr-scan, schedule 採用/反映, /visits 訪問モード開始 をモバイル下部固定。
- **中間ブレークポイント定義**: pharmacy-cooperation の契約フォーム（xl のみ多カラム→md/lg 中間グリッド）、brief/facility-packet の3カラムを tablet で 2カラム維持 or 補助ドロワー、MasterEditorView の order 入替（モバイル order 入替禁止）解消。
- **カレンダー/グリッドのモバイル配慮**: shifts 月間表・business-holidays・conferences・medication-calendar を週送り/縦リスト or 日付ヘッダ sticky、セル文字潰れ回避。
- **固定 min-h の撤去**: conflicts/route-compare/compare-board の min-h-[720/760/820px] を内容追従＋grid 高さ揃えへ。

## アクセシビリティ改善

- **タイポ下限**: prescriptions/schedules/visits/intake の text-[9px/10px/11px] を全廃しラベル≥12px・本文≥14px・行間1.6以上。
- **タッチターゲット44px**: settings(h-8)/auth ボタン・入力・チェックボックスを 44px、部品側サイズトークンで既定保証。
- **色のみ依存の解消**: first-login 要件達成（緑のみ）に Check アイコン+語、business-holidays/shifts の曜日・休日（生 red/blue/rose/sky）、route チャートのノード色（凡例追加）、communications 期限バッジ（アイコン併記）。
- **キーボード操作/フォーカス管理**: visit-record-detail/conferences の手組み popover を共通 DropdownMenu（矢印移動・フォーカストラップ・初期フォーカス）、schedules ドラッグ並べ替えにボタン/キーボード代替。
- **見出し階層の連続性**: sr-only h1→h2→h3 を全クラスタで統一（CardTitle を asChild で h2/h3 化、見出しスキップ・装飾的レベル飛ばし禁止）。
- **支援技術への通知**: エラーは role=alert、状態更新は aria-live/role=status（リスクバナーの assertive 濫用是正）、棒チャートに数値テーブル/aria 代替、患者名/時刻を見出し要素化。
- **PHI の最小露出**: data-explorer/uat/credentials/qr-scan/shared-viewer で生値マスク・件数のみ表示・権限付き展開。

## 実装ステージング

maker/checker 分離を維持し、実装者は自己完了判定しない。各段で objective gate（`pnpm lint` / `typecheck` / `typecheck:no-unused` / `format:check` / `test` / `build`、UI 系は `test:e2e` 必要時）＋スクリーンショット検証（mobile/tablet/desktop/wide）を通す。`pnpm build` と `pnpm typecheck` は並列実行しない（`.next/types` race 回避）。LOCK 規律に従い編集前に対象 path を LOCK、自ファイルのみ stage。

- **Stage 0 — 共通部品（基盤）**: StatCard/SignalTile/AlertTier/ExpiryBadge/StatusTile/EmptyState/ErrorState/LoadingSkeleton/ConfirmDialog/ActionBar/StickyFooterAction/PatientPinnedHeader/OtpInput/PasswordStrengthField/DayNavigator/RouteSchematicChart/PHIMaskField、StateBadge/StatusDot の role 拡張、Input/Button/Select/Checkbox のサイズトークン化。新規部品は単体で Storybook 的検証＋ユニットテスト。**この段が後続の前提**。
- **Stage 1 — P0 画面群**: patient detail/visit detail/visit record/prescriptions 一覧&[id]&new&intake/shifts/business-holidays/drug-masters/formulary/performance/uat/schedules day-board&conflicts&emergency-route/reports[id]/billing candidates/workflow。医療安全（Pinned 危険タグ・偽シグナル排除・破壊操作確認）を最優先。各画面で checker レビュー＋gate＋4ビューポート screenshot。
- **Stage 2 — P1 画面群**: 状態色 6軸統一・共通部品適用・PHI マスク・到達性（auth/admin 組織&臨床マスタ/患者サブページ/連携・コアナビ）。MasterListScaffold/WorkbenchSplitView 等の構造部品をここで横展開。
- **Stage 3 — P2 画面群**: calm/装飾整理（影撤去・角丸統一・全面塗り残り）・dvh 化・微改善・サンプル表示明示。リスク最小のため最後にまとめて。
- **承認ゲート（別途）**: auth クラスタ（ロジック不変でも認証画面）・billing/billing-rules（hard-stop、表示のみ）・Clinical Workbench 本体（dispense/audit/set/set-audit の本体視覚は不変、周辺のみ）・破壊的操作の確認導線追加は、両 supervisor 合意＋人間承認を得てから着手。`docs/state-color-migration-map.md` 更新を伴う色変更は台帳と同期。

## 検証方法

- **objective gate**: 各 PR で `pnpm lint`・`pnpm typecheck`・`pnpm typecheck:no-unused`・`pnpm format:check`・`pnpm test` を必須。`pnpm build` は背景/別レーンで実行（typecheck と非並列）。UI 変更は `pnpm test:e2e`（必要に応じ `test:e2e:audit`）。
- **maker/checker 分離**: 実装者と別 identity（Claude↔Codex）がレビュー。PATCH_REVIEW_REQUEST/VERIFY_REQUEST を経て承認。承認前に独立再検証（unstaged patch 破壊→teeth 確認の運用に準拠）。
- **回帰の機械チェック**: 生 Tailwind 状態色（`bg-(rose|sky|red|blue|emerald|amber|violet)-(50|100|...)`・`text-*-500/600`）と raw shadcn Badge variant の grep を 0 件に近づける lint ルール/CI チェックを追加。`!h-11`/`[&_input]:!min-h-[44px]` の override 検出。
- **アクセシビリティ検証**: 軸として WCAG AA（コントラスト4.5:1）、44px ターゲット、色のみ依存無し、見出し階層、aria/role を axe 系チェック＋手動確認。
- **医療安全の重点確認**: 詳細画面の Pinned 危険タグがスクロール後も可視、アラート4段階の見た目区別、偽シグナル（常時橙・0件赤・偽✓）の不在、破壊操作の確認ダイアログ、PHI マスクを checker が明示確認。
- **No fake completion**: TODO/`test.skip`/`.only`/stub/未実装分岐を blocker として変更ファイルを検査。残置があれば実装するか BLOCKED へ退避。

## スクリーンショット確認方法（mobile/tablet/desktop/wide）

gstack の `/browse`（可視確認は `/connect-chrome`）でローカル/ステージングを駆動し、before/after を取得・差分比較する。

- **ブレークポイント**: mobile=390×844、tablet=768×1024、desktop=1440×900、wide=1920×1080 の4幅で各対象ルートを撮影。
- **撮影観点**:
  - 情報順（Pinned/Primary zone が fold 内、次にやること/止まっている理由が見える）
  - 状態色（全面塗りが残っていないか、赤=緊急のみか、点/線/ピル表現か）
  - Pinned 危険タグがスクロール後も残るか（sticky 検証は中間スクロール位置でも撮影）
  - アラート4段階の見た目区別、サンプル表示バッジの有無（dispense系/metrics）
  - レスポンシブ（横スクロール代替、thumb zone 固定、order 不入替、min-h 撤去後の余白、カレンダー潰れ）
  - ローディング状態のスケルトン形状一致（loading→本体の CLS 目視）
- **証跡の保存**: `tools/tests/.artifacts` 配下に before/after を保存し PR/proof に添付。`.agent-loop` の proof 記録慣行に合わせ codex 側にも共有。検証 NG はステージを進めず iterate。
