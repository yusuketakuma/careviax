# UI/UX Audit

## 概要

本監査は careviax（PH-OS Pharmacy）の全ルートクラスタ（約121ページ）を対象に、医療情報システムとしての安全性・運用効率・アクセシビリティ・実装の一貫性を評価した。技術スタックは Next.js 16 / React 19 / Tailwind 4 / shadcn であり、共通部品として `PageScaffold` / `PageSection` / `WorkflowPageHeader` / `WorkflowPageIntro` / `AdminPageHeader` / `DataTable` / `StateBadge` / `StatusDot` が用意されている。

評価軸は以下の6点。

- **状態色 SSOT 準拠**: 6軸トークン（StateBadge / StatusDot）への統一、生 Tailwind 色・raw shadcn variant の排除、塗り面積最小化（点・線・ラベル、全面塗り禁止）。
- **情報重力 / trunk test**: 即時対応情報を Primary/Pinned zone に置き、3秒で主導線を把握できるか。
- **医療安全**: アラート4段階の厳格分離、ハイリスク薬・アレルギーの常時表示、PHI マスク、破壊的操作の確認、サンプル/未接続データの明示。
- **状態分離**: loading（スケルトン）/ empty / error（再試行）/ 取得失敗≠空 の4状態。
- **アクセシビリティ**: 色だけに依存しない、ラベル12px以上・本文14px以上、タッチターゲット44px、見出し階層。
- **パフォーマンス / レスポンシブ**: 巨大単一コンポーネントの分割、debounce、仮想化、CLS、100dvh、thumb zone。

全体傾向として、共通部品（StateBadge / PageSection / KPIストリップ / Stepper 等）が整備されていながら未採用の画面が多く、似た実装の重複と SSOT 逸脱が逸脱の温床になっている。とくに状態色の全面塗りとアラート段階のフラット化が複数クラスタで再発し、医療現場での「赤を見たら必ず行動」という信号価値を損なっている。

## 対象ページ一覧

| Page | Route | 目的 | 現状の課題 | 改善方針 |
| --- | --- | --- | --- | --- |
| 認証共通シェル | `(auth)/layout.tsx` | 全認証画面の外枠（ロゴ/h1/コンプラ表記） | min-h-screen で 100dvh 非追従、縦中央寄せ+内部スクロール無で縦長フォーム上部が到達不能、rounded-2xl 大角丸 | 100dvh+overflow-y-auto で上部到達保証、rounded-lg へ統一 |
| ログイン | `(auth)/login` | 一次認証して MFA/初回PW/ロックアウトへ分岐 | aside のマーケ装飾過多、3ステップ説明と下部 info の重複、bg-slate-50/80 直書き、autoFocus 無、Suspense 高さ固定でCLS | aside 縮約・単段化、トークン化、email に autoFocus、実形状スケルトン |
| MFA認証 | `(auth)/mfa` | TOTP/リカバリーで二要素認証 | OTP6桁が3画面で重複実装、再送導線無、390pxで6ボックス窮屈 | 共通 OtpInput 化、grid-cols-6 w-full へ統一 |
| 初回ログイン | `(auth)/first-login` | 初回業務パスワード設定→MFAへ | 要件チェックが緑色のみ（アイコン/語なし=色依存）、確認欄に表示トグル無、強度UI重複 | Check アイコン+達成語併記、確認欄にトグル、PasswordStrengthField共通化 |
| パスワード再設定 | `(auth)/password/reset` | メール→コード→新PWの2段復旧 | ステッパー不統一、コード再送無、強度/OTP重複、step切替時フォーカス未移動 | 番号付きステッパー共通化、再送ボタン、共通部品流用 |
| パスワード変更 | `(auth)/password/change` | ログイン済の本人確認+変更 | 戻り先が「ログインへ」のみで作業文脈断、再ログイン理由の明示弱、強度UI重複、確認欄トグル無 | 呼出元への戻り導線、再ログイン理由明示、共通化 |
| ロックアウト | `(auth)/lockout` | ロック事実・解除条件・連絡先通知 | 連絡先がプレースホルダ固定値(03-XXXX)、解除時間30分ハードコード、連絡先パネル全面青塗り、二重提示 | 設定供給+未設定フォールバック、青はラベルのみ、提示1回に集約 |
| MFA設定 | `(auth)/mfa/setup` | QR登録→検証→リカバリー保存 | QRローディングがスピナー単独、リカバリー未保存で完了可能（自己ロック）、tabular-nums無 | 192pxスケルトン、保存確認チェック必須化、OtpInput流用 |
| マスターハブ | `/admin` | 全マスター鮮度の一望と誘導 | tabular-nums欠落、ActionRailが fold 外、鮮度バナーが青固定で温度感無 | 数値tabular-nums、ActionRail上部/sticky、due_soon=橙/期限切=赤に段階分け |
| ユーザー管理 | `/admin/users` | スタッフ招待・権限・停止退職管理 | 件数ストリップがテーブル下、raw Badge variant（停止中=赤）、詳細Sheetのサマリー非固定、Select enum漏れ余地 | ストリップを上へ、StateBadge写像、固定サマリーバンド、明示children |
| スタッフマスタ | `/admin/staff` | スタッフ登録編集（サンプル固定） | 実データ未接続ダミーが本番同型で誤認、装飾過多、状態スタブ無 | サンプル帯を注意バナーに、institutions型へ統一、状態同時導入 |
| 施設マスタ | `/admin/facilities` | 施設登録編集（サンプル固定） | 患者訪問先という重要マスタが機能しないダミー | 実装優先度上げ実CRUDへ、未接続明示 |
| 車両マスタ | `/admin/vehicles` | 車両登録編集（サンプル固定） | 車検/保険期限の鮮度対象なのに編集不能 | 期限バッジ実装+鮮度ハブ連動、サンプル明示 |
| 他職種リダイレクト | `/admin/professionals` | external-professionals へリダイレクト | UI無だが loading.tsx でちらつき | loading.tsx 整理 |
| 薬剤師認定 | `/admin/pharmacist-credentials` | 研修認定・期限管理 | 集約アラートが期限切れ(赤)も90日(橙)も橙でフラット化、失効ボタン行内露出、同意患者氏名(PHI)露出 | 赤/橙2バナー分離、失効を詳細へ、PHIは件数のみ |
| 医療機関マスタ | `/admin/institutions` | 処方元医療機関CRUD | 識別子素表示、検索debounce無、鮮度可視化無 | 300ms debounce、最終処方日バッジ、電話弱色 |
| 施設基準 | `/admin/facility-standards` | 届出・要件・算定可否 | 算定不可(blocked)と90日(confirm)が同一橙バナー、ClaimStatusBadge destructive直書き、querySelector直叩き | 赤/橙2バナー分離、StateBadge統一、refベース移動 |
| 訪問エリア | `/admin/service-areas` | GeoJSONで訪問可能エリア管理 | 生JSON textarea一次入力、バッククォート生表示、geo_data全文展開、error分岐無 | チップ入力化+JSON折りたたみ、disclosure、ErrorState追加 |
| シフト管理 | `/admin/shifts` | 月間シフト/メンバー/定型/休日 | 生 rose/sky 直書き、2388行に全機能内包、ローディングがテキスト、操作ボタン密集 | --weekendトークン、Tab/別ルート分割、スケルトン、破壊系を…メニューへ |
| キャパシティ | `/admin/capacity` | 訪問枠/稼働/緊急余力の確認 | KPI値に系列色で良し悪し不伝達、棒グラフ凡例不足 | 値色は中立+閾値超過のみ点表示、数値ラベル+title |
| 休業日 | `/admin/business-holidays` | 休業日・祝日カレンダー設定 | 生 red/blue 多数直書き、休業=destructive赤、テキストローディング+error分岐無、サマリー最下部 | --weekend+状態トークン、StateBadge、スケルトン+ErrorState、サマリー上部 |
| 設定 | `/admin/settings` | 外部連携監視+各スコープ設定 | コントロールh-8(32px)で44px未達、テキストローディング、JSON一括編集が確認無、Health対処導線無 | 44pxへ、スケルトン+ErrorState、差分プレビュー+確認+離脱防止、runbook導線 |
| 医薬品マスタ | `/admin/drug-masters` | 全国医薬品マスター台帳 | 4485行・密度過多、薬価/全件取込が確認無で即実行、自作チェックボックス、見出し階層混在 | 広域mutateに確認、共通Checkbox、h2階層統一、formularyを別タブ |
| 採用薬リスト | `/admin/formulary` | 拠点別採用薬リスト運用 | 約15クエリ同時発火、選択中キュー無ハイライト、期限超過が中立色、承認がraw JSON | aria-pressed+current表現、滞留に橙ピル、運用ツールをタブへ、段階表示、差分整形 |
| 配薬方法 | `/admin/packaging-methods` | 配薬方法マスタ登録編集 | 素Card×2、全件カード化、編集対象不明確、error分岐無 | DataTable/罫線リスト化、ErrorState、編集中見出し固定、PageSection |
| PCAポンプ | `/admin/pca-pumps` | ポンプ台帳・貸出・返却 | 返却と取消(破壊的)が同variantで隣接・確認無、検索debounce無、延滞が橙止まり | 取消に確認+分離、debounce、件数ストリップ、PageSection |
| 文書テンプレート | `/admin/document-templates` | 報告書/契約書等の版管理 | 本文を生JSON textarea直書き、種別フィルタ折返し過多、編集面が二重 | 構造フォーム化、Select/Tabs集約、編集正本一本化 |
| 連絡先プロファイル | `/admin/contact-profiles` | 連絡傾向の確認・送付方法 | 検索debounce無、未完了KPI全面塗り、全件カード仮想化無 | debounce、左ボーダー化、ページング+current表示 |
| 他職種マスタ | `/admin/external-professionals` | 他職種/医療機関マスタ（サンプル） | 実在しない医療機関1〜8を本番に露出、固定3レール装飾過多、状態スタブ無 | ナビ露出抑制/準備中化、接続時に共通パターンへ |
| 薬局基本情報 | `/admin/pharmacy-sites` | 薬局情報・届出・改定別算定設定 | 2026改定リマインダーが赤(中断級)、一覧検索無、保険設定Sheet長尺 | confirm/通常Alertへ格下げ、検索+PageSection、Drawer分離 |
| 薬局間連携 | `/admin/pharmacy-cooperation` | 協力薬局・契約・契約書生成 | 独自SectionShell/NativeSelect、終了/期限切れに赤、包括44pxハック、全画面一括ゲート | PageSection/共通Selectへ、StateBadge再割当、partial表示、中間グリッド |
| 分析 | `/admin/analytics` | 請求SSOT+運用実績の月次分析 | MetricCard乱立、休日ギャップ全面塗り、!h-11 override、最優先サマリー無 | StatCard共通化、左ボーダー化、サイズトークン側で解決、縦カード段階開示 |
| 経営指標 | `/admin/metrics` | 集中率/後発率等のモニタリング | API未接続で全0を実測同様に表示・サンプルバナー無、橙文字一様 | PlaceholderNotice、blocked/confirm段階分離、4状態整備 |
| パフォーマンス | `/admin/performance` | 訪問制御/API遅延の継続監視 | API P95が常時橙(偽シグナル)、isLoading未ガードでfalse-zero、全面塗り、8大ブロック | 値ベース着色、スケルトン、左ボーダー化、Tab再編、SignalTile導入 |
| 運用インサイト | `/admin/operations-insights` | 訪問件数/工程時間の可視化 | ラベル11px、独自BarChart、棒の数値代替無 | 12px以上、共通BarChart、数値テーブル併設 |
| リアルタイム | `/admin/realtime` | 通知+ワークフロー制御の監視 | 0件でも至急=赤/高=橙が常時点灯、order入替、全面塗り、未処理例外二重表示 | >0時のみ点灯、order撤去、二重掲示解消 |
| ジョブ監視 | `/admin/jobs` | 連携バッチの監視・再実行 | サマリー独自実装、7列横スクロール、再実行が確認無の即時POST | StatCard、軽量確認、縦カード段階開示 |
| 在庫予測 | `/admin/inventory-forecast` | 不足薬と影響患者の突合 | SummaryCard独自、影響患者に緊急度バッジ無 | StatCard統一、残薬切れ予定日+緊急度バッジ |
| 鑑査統計 | `/admin/dispense-audit-stats` | 差戻し理由別集計 | 独自棒実装、見出しがtext-sm装飾化、比較軸薄 | 共通BarChart、asChildでh2/h3、前期間比 |
| データエクスプローラ | `/admin/data-explorer` | 全テーブル閲覧+許可フィールド更新 | 生データJSONでPHI露出、保存が確認無、md帯で高さ不適用、型不整合誘発 | PHIマスク、diff確認/undo、ブレークポイント拡張 |
| 監査ログ | `/admin/audit-logs` | 監査証跡の閲覧+CSV/JSON出力 | limit=100固定・総件数無で証跡が暗黙切り捨て | 総件数明示/ページング、「直近100件」注記 |
| ヒヤリハット | `/admin/incidents` | 再発防止メモ入力 | 複数行内容が単一行Input、min-h固定で間延び | Textarea自動拡張、min-h撤廃、未入力強調 |
| アラートルール | `/admin/alert-rules` | 処方安全ルールCRUD | 4大機能縦積み、condition freeform JSON検証無、生JSON常時展開 | Tab再編、スキーマ補助、折りたたみ |
| 通知設定 | `/admin/notification-settings` | イベント別通知ルール管理 | useEffect+fetch手書き、バッククォート露出、マトリクス長大 | react-query化、文言修正、分類折りたたみ |
| 算定ルール | `/admin/billing-rules` | 在宅算定SSOT照合・CRUD | ヘッダー手組みflex、操作列が中央、 | supportingContent活用、操作列を末尾、件数差分明示 |
| UAT | `/admin/uat` | パイロットUAT集約 | 7大セクション縦積み、素p段落エラー、患者住所(PHI)露出、英語リテラル | Tab分割、ErrorState統一、PHIマスク、StateBadge日本語化 |
| 患者一覧 | `/patients` | 対応必要患者のカードハブ | 素h1（WorkflowPageHeader不使用）、新規/比較導線無、サマリー/チップ二重、now毎レンダ、安全タグ+N埋没 | 共通ヘッダ、Primary/Secondary CTA、役割分離、now固定、重大タグ常時表示 |
| 患者新規登録 | `/patients/new` | 患者基本情報の新規登録 | 2360行単一フォーム、Tabs+段階ナビ二重、送信末尾右寄せ、自動保存無、重複警告単一クリック解除 | ナビ一本化、下部FormActionBar、二段確認、下書き自動保存、PageSection化 |
| 患者比較 | `/patients/compare` | 注目カード最大3枚比較 | min-h-720px固定、ピッカー無URL依存、素h1戻り導線無、主導線二重 | min-h撤廃、WorkflowPageIntro+ピッカー、主操作一本化、患者識別明示 |
| 患者詳細 | `/patients/[id]` | 1処方サイクルの単一作業台 | 4655行、ActionRail最下部、SafetyBoard非sticky、定常リマインダーを橙アラート化、全面塗りタイル | aside解体しPrimaryへ昇格、sticky化、中立タイル+左ボーダー、dynamic import |
| 患者編集 | `/patients/[id]/edit` | 患者基本情報の正本更新 | 離脱防止/自動保存がページ層から不可視、項目メタ無 | 共通フォーム部品で担保、項目メタ併記 |
| 服薬管理 | `/patients/[id]/medications` | 服薬中薬剤・残薬確認 | Suspense4つがスピナー、長className直書き、補助情報が大面積 | スケルトン統一、buttonVariants化 |
| 服薬カレンダー | `/patients/[id]/medication-calendar` | 月間服薬スケジュール | モバイル横スクロール、スピナーfallback、画面/印刷責務混在 | 週送り/縦リスト/sticky、スケルトン |
| 処方履歴 | `/patients/[id]/prescriptions` | 患者単位の処方履歴 | 補助サマリーが主データ上で履歴がfold外、補助Suspense無 | 履歴をPrimaryへ、補助をSuspense+スケルトン |
| MCS連携 | `/patients/[id]/mcs` | MCS連携状態・同期 | 4状態分離がcontent依存、通信失敗と未連携が同見た目 | StatusDot/StateBadgeで別表現 |
| 同意管理 | `/patients/[id]/consent` | 同意状況・期限・撤回 | 期限間近と撤回が同警告色、PHIマスク不可視 | confirm/blocked語彙分離 |
| 外部共有 | `/patients/[id]/share` | 他職種向け外部共有(JWT+OTP) | 共有入口が2系統、破壊的操作の確認不可視、3カラム過密 | 入口集約、二重確認Modal+失効導線 |
| 共同編集 | `/patients/[id]/collaboration` | presence共有で上書き事故防止 | bare で戻り導線無、スピナーfallback | 最小ヘッダ保証、スケルトン |
| 安全チェック | `/patients/[id]/safety-check` | 患者文脈の薬の安全チェック | bare で戻り導線無、スピナー、SafetyBoardと重複 | 患者名+危険タグPinned再掲、スケルトン+4状態分離 |
| 残薬調整 | `/patients/[id]/residual-adjustment` | 残薬確認→調整→確定 | PageScaffold/Intro無の裸ページ、org-id直書き | PageScaffold+Intro、buildOrgHeaders |
| 処方受付一覧 | `/prescriptions` | レセコン風master-detail | ローカルStatusDotがBadge描画、text-9/10px多用、件数がwindow集計で過小、height二重指定、安全タグ無 | StateBadge写像、12px以上、サーバ集計、height集約、安全タグ列追加 |
| 処方詳細 | `/prescriptions/[id]` | 処方受付詳細の正本閲覧 | pending=赤(inlineは紫)で不整合・誤アラート、安全情報無、アクション全outline、調剤方法がmd隠れ | pending=waiting統一、安全列追加、Primary格付け、調剤方法常時表示 |
| 処方新規受付 | `/prescriptions/new` | 新規処方受付入力 | 2982行、見出しh2/legend混在、生select/input、差分全面塗り、エラー画面外 | 左ボーダー化、shadcn寄せ、h2統一、エラーへスクロール、明細memo化 |
| 処方取込トリアージ | `/prescriptions/intake` | FAX/オンライン取込トリアージ | bg-emerald-100等生色、行全面塗り、h1→h3階層飛び、完了色流用 | 6軸トークン、zebra、h2開始、数値強調 |
| QR下書き一覧 | `/prescriptions/qr-drafts` | QR処方箋下書き一覧 | Badge variant直指定、独自フィルタ、未照合表現弱 | StateBadge、FilterChipBar、confirmバッジ |
| QR下書き詳細 | `/prescriptions/qr-drafts/[id]` | QR下書き確認・確定 | 切詰めUUID表示、Card多段長尺、text-10px、required全面塗り | 人が読めるラベル、枠線+マーカー、自動スクロール |
| 調剤 | `/dispense` | 調剤ワークベンチ（モック） | loadingと本体で形状不一致CLS、サンプル明示無、empty/error未接続 | workbench専用スケルトン、サンプルバッジ、4状態正式化 |
| 監査 | `/audit` | 調剤監査ワークベンチ（モック） | 形状不一致CLS、ハイリスク画面なのにサンプル明示無 | スケルトン統一、サンプル明示優先、停止メッセージ |
| セット | `/set` | 一包化セット作成（モック） | 形状不一致、サンプル明示無、loading.tsx 4ファイル重複 | 共通スケルトン集約、サンプルバッジ |
| セット監査 | `/set-audit` | 一包化セット監査（モック） | 形状不一致、サンプル明示無、出し分け未接続 | 共通スケルトン、サンプル明示+停止メッセージ |
| ワークフロー | `/workflow` | 主業務フロー横断監視 | 20+セクション縦積み、Pinned無、AlertPill全部同一赤、raw Badge、二系統ローディング、変更確定が確認無 | Tab/別ページ分割、Pinnedストリップ、4段階AlertPill、StateBadge、確認ダイアログ |
| ワークフロー薬局連携 | `/workflow/pharmacy-cooperation` | 薬局間協力の作業面 | statusVariant raw Badge、KPI非sticky、セル内6入力フォーム、Skeleton形状不一致 | StateBadge集約、Pinnedストリップ、ドロワー退避、テーブル形状スケルトン |
| 訪問準備 | `/visits` | 出発前準備チェック | 本文直置きh1、h1→h3階層飛び、患者名が`<p>`、Pinnedストリップ無、ActionRail沈む | sr-only h1+h2、件数ストリップsticky、見出し化、本文に止まる理由 |
| 訪問詳細 | `/visits/[id]` | 訪問記録詳細+後続起こし | 固定サマリーに患者識別無、テキストローディング、生 SOAP色、手組み残薬table、手組みpopover | 患者Pinnedサマリー、スケルトン、トークン化、DataTable、共通DropdownMenu |
| 訪問前まとめ | `/visits/[id]/brief` | AI要約の確認3カラム | sr-only h1無、3カラムlg以上のみ、選択肢全面塗り | sr-only h1、md 2カラム/ドロワー、左ボーダー化 |
| 訪問撮影 | `/visits/[id]/capture` | モバイル没入型写真撮影 | bg-slate-900生色、オフライン注記全面塗り | 中立トークン、info左ボーダー化 |
| 訪問記録入力 | `/visits/[id]/record` | SOAP記録入力 | Pinnedにハイリスク/アレルギー無でCDS埋没、生SOAP色、警告4種同一全面塗り、2457行useWatch全体購読 | 危険タグ常時表示、4段階分離、useMemo/分割購読、トークン化 |
| ボイスメモ | `/visits/[id]/voice-memo` | 口頭メモ録音→文字起こし | 状態が汎用Badge variant、2カラムlg以上のみ | StateBadge寄せ、tablet 2カラム、4状態スタブ |
| 施設パケット | `/visits/[id]/facility-packet` | 施設一括訪問パケット3カラム | PageScaffold非経由でフルブリード、sr-only h1無 | PageScaffold+sr-only h1、tablet 2カラム、tabular-nums |
| 訪問証跡 | `/visits/evidence` | 証跡ギャラリー | 装飾shadow-sm、実画像未接続明示無、tabular-nums無 | shadow撤去、サンプル明示、tabular-nums |
| スケジュール当日 | `/schedules` (team-board) | 当日チーム進捗ダッシュボード | ActionRail最下部縦積み、Pinned非sticky、日付ナビ無、推奨車両反映が確認無、全面塗り、role=alert常設 | サイドレール化、Pinnedストリップ+DayNavigator、ConfirmDialog、左ボーダー、role=status |
| スケジュール月 | `/schedules` (calendar) | 月グリッド閲覧 | テキストローディング、text-9/10px、+N件不可視、日↔週往復フェッチ | グリッドスケルトン、12px以上、keepPreviousData |
| 重なり調整 | `/schedules/conflicts` | 時間/車両重複の調整案 | 採用が永続化されずtoastのみ（偽完了）、ラベル固定で対象不一致、min-h固定、h1分岐 | API反映/非永続明示、ラベル連動、min-h撤廃、h1統一 |
| 緊急ルート | `/schedules/emergency-route` | 緊急処方の割込み再計算 | 影響確認チェックがハードコード緑✓（偽の安全保証）、案2採用不可、ノード色のみ依存 | 実データ3値表示、案2採用/参考明示、凡例併記 |
| ルート比較 | `/schedules/route-compare` | 推奨+3案比較反映 | 採用導線が二重、min-h固定、w-44固定、SVG重複実装 | 採用一本化、固定撤廃、RouteSchematicChart共通化 |
| 提案ダッシュボード | `/schedules/proposals` (dashboard) | 自動提案の承認処理 | rounded-2xl多用、1カード5〜9バッジ、全面塗り、要素過多、テキストローディング | rounded-md、バッジ3つに絞る、左ボーダー、折りたたみ、スケルトン |
| 週次最適化 | `/schedules/proposals` (optimizer) | 週次グリッド最適化 | 機能密集、ドラッグのキーボード代替要点検、高密度 | Tab/ドロワー、代替順序変更、12px下限 |
| スケジュールloading/error | `/schedules/*` | スケルトン+境界エラー | 実画面と形状不一致、PageScaffold variant差 | ボード形状スケルトン、bare統一 |
| 報告共有 | `/reports` | 報告共有ワークスペース | actionRail最下部埋没、セクション順逆、解決済み全面塗り、可視h1、60s refetch | actionRail昇格、即時対応を上、左ボーダー、sr-only h1 |
| 報告分析 | `/reports/analytics` | 送達率・未確認フォロー | 未確認一覧が最下部、小集計にDataTable過剰、経過根拠不明、装飾重 | フォローをPrimaryへ、軽量table、影最小化 |
| 報告詳細 | `/reports/[id]` | 報告書閲覧・編集・送付 | 固定サマリーに患者識別無、警告がサイドバーのみ、Alert見た目横断同一、派生配列再計算 | 患者Pinnedサマリー、警告を本文へ、Alert役割別、useMemo |
| 報告印刷 | `/reports/[id]/print` | A4印刷+印刷監査 | 確定1秒後に自動window.print()でPHI意図せず印刷 | カウントダウン/手動既定 |
| 印刷ハブ | `/reports/print` | 帳票印刷ハブ | 100vh固定、mt-14グリッド外、帳票説明無 | 100dvh、8の倍数、補足1行 |
| 報告共有(他職種) | `/reports/[id]/share` | 相手別プレビュー共有 | 権限/状態/失敗が同一橙、モバイルで相手と本文離れる | トークン別描き分け、選択中相手を見出し併記 |
| 算定チェック | `/billing` | 月次算定チェック | PrimaryStripとActionRail二重描画、KPIがテーブル下、critical生destructive、可視h1 | レール一本化、KPI上へ、state-blocked、sr-only h1 |
| 請求候補 | `/billing/candidates` | 月次請求候補・締め | 月次締めが確認無の即実行（不可逆）、生JSON内訳、情報過多 | ConfirmDialog（件数/金額/取消不可）、定義リスト、意味グループ再編 |
| 協力薬局請求 | `/billing/partner-cooperation` | 協力薬局請求管理 | ネイティブselect、ドラフト作成確認無の非対称、4セクション長尺 | 共通Select、ミニ確認、到達状況サマリー近接 |
| ルート | `/` | /dashboard へリダイレクト | redirectのみ（責務外で妥当） | 変更不要 |
| ダッシュボード | `/dashboard` | 運用コックピット | h1重複ラベル、Pinned非sticky、タイムラインがモバイル極小、会話フィード欠落 | sr-only h1、件数ストリップsticky、モバイル縦リスト |
| マイデイ | `/my-day` | 個人ワークリスト | dashboardと重複、緊急カード/QuickStat全面塗り、xl:pt-20マジック余白、リスト3回再実装 | 左ボーダー化、役割明確化、共通ListRow |
| タスク | `/tasks` | 運用タスク作業面 | PageSection6連縦長、今すぐ処理と実行サマリー重複、仮想化無、一括完了確認無、bare span | Tab/ドロワー、FilterSummaryBar統合、仮想化、件数確認 |
| ハンドオフ | `/handoff` | 責任移動ボード | section7縦積み、相談3カラム文脈分断、bare SelectValue、ローディングばらばら | 私に来たをPinned、Tab段階開示、明示children、スケルトン高さ統一 |
| 連絡リダイレクト | `/communications` | requestsへリダイレクト | redirectのみ（妥当） | 変更不要 |
| 連絡依頼 | `/communications/requests` | 依頼返信待ちフォロー | 経過バッジ色依存、対応済みがbg-state-done直塗り、空でも完了可、モバイル往復 | アイコン併記、主操作=青、根拠必須、ドロワー展開 |
| カンファレンス | `/conferences` | カンファ記録・タスク化 | 2235行・10超クエリ、全件カード化、見出し重複、カレンダー窮屈 | ダイアログ別ルート/遅延、リスト行化、見出し解消 |
| 紹介新規 | `/referrals/new` | 紹介患者登録 | Select空value項目、書類サマリー無 | placeholder化、受領件数+未受領注意 |
| 外部ビューア | `/external` | 外部共有・自己申告triage | grid-cols-3固定、英語scopeキー、解決が確認無、Badge outline | 日本語ラベル、StateBadge、確認/Undo、2列折返し |
| 検索 | `/search` | 横断検索 | 全件近く並列fetch、h1 text-2xl不統一、部分失敗で件数空欄 | 段階表示/遅延、h1統一、取得失敗マーク |
| 保存ビュー | `/views` | 絞り込みプリセット管理 | shadow-sm一律、h1 text-2xl、非オーナー理由提示弱 | shadow撤去、ヘッダ統一、理由1行 |
| 統計 | `/statistics` | KPIストリップ+ハブ | 素header h1不統一、stale時刻明示無、KPI重複実装 | 共通ヘッダ、N分前表示、KPIストリップ集約 |
| お知らせ | `/notifications` | 通知受信箱 | h1 text-2xl、初期全画面Loadingで現在地消失、urgentと通常混在 | リスト領域のみスケルトン、ヘッダ統一、4段階差別化 |
| 事務サポート | `/clerk-support` | 事務ランディング | テーブルにモバイルカード無、h1 text-2xl、要対応KPI無色 | sm:hiddenカード、ヘッダ統一、点/左罫の注意 |
| モード選択 | `/select-mode` | 入口モード選択 | text-blue/violet/emerald-600生色、現在地表示無、失敗フィードバック弱 | 識別トークン、選択中表示、インライン再試行 |
| 薬局選択 | `/select-site` | 所属薬局切替 | 共通ヘッダ未使用 | ヘッダ統一、元に戻す導線 |
| オフライン同期 | `/offline-sync` | 未同期キュー・競合解決 | サマリー/行カード全面塗り、競合ビュー全置換、不可逆ボタン非対称、h1 text-2xl | 左ボーダー化、ドロワー化、警告強度を揃える |
| QRスキャン | `/qr-scan` | お薬手帳QR読取 | 保険者/公費番号生表示、primary action非固定、tabular-nums無 | 要約+展開、thumb zone固定、tabular-nums |
| オフライン | `/offline` | PWAオフラインフォールバック | 継続可能作業への導線無 | offline-sync/キャッシュ訪問導線 |
| 外部ポータル | `/shared/[token]` | OTP保護外部ポータル | 生 slate/sky/indigo/rose多用、素checkbox、生enum値表示 | トークン化、共通Checkbox、日本語ラベル化 |

## 共通UIの課題

クラスタ横断で繰り返し現れた構造的課題は以下の通り。

- **状態色 SSOT のバイパスが常態化**: 6軸トークン（StateBadge / StatusDot）が用意されているにもかかわらず、raw shadcn Badge variant（destructive / secondary / outline）、ローカル statusVariant、生 Tailwind 色（bg-emerald-100 / text-blue-500 / bg-rose-50 等）、CYCLE_STATUS_CONFIG の variant/className 直渡しが多数の画面で使われている。同一データ（疑義 result=pending）が画面間で別色（赤 vs 紫）になる不整合も発生。
- **状態色の全面塗り**: `bg-state-*/10` をタイル・カード・テーブル行・入力欄の面に敷く実装が performance / realtime / analytics / my-day / offline-sync / patients[id] / schedules / reports / billing 等に散在。SSOT「状態色は点・線・ラベルで塗り面積最小（左ボーダー+文字色）」に反し、複数の橙/赤面が並んで真の警告を希釈する。
- **ヘッダ/見出しの不統一**: WorkflowPageHeader / WorkflowPageIntro / AdminPageHeader / 素の h1（text-xl / text-2xl 混在）/ bare scaffold / scaffold無 がページごとにばらばら。sr-only h1+本文 h2 開始の規約が徹底されず、h1→h3 の階層飛びや CardTitle が div 化した装飾見出しも残る。
- **ローディングのスケルトン非対応**: テキスト「読み込み中...」やスピナー単独が settings / shifts / business-holidays / calendar-view / proposals / visit-record-detail / visit-record-form / 患者サブページの Suspense 等に残存。loading.tsx と本体の形状不一致による CLS も全クラスタで頻発。
- **サマリー/件数ストリップの配置と重複**: KPI/サマリーがテーブルやカレンダーの「下」に置かれる画面が複数（users / business-holidays / analytics / billing / reports/analytics）。MetricCard / KpiCard / SummaryCard / SignalTile / QuickStat が画面ごとに再実装され、余白・タイポ・着色が分散している。
- **12px 未満のラベル多用**: text-[9px]/[10px]/[11px] が処方せん系・スケジュール系・gantt・カレンダー・各バッジで横断的に使われ、ラベル12px以上・本文14px以上の規約を下回る。
- **タッチターゲットのページレベル override**: `!h-11` / `[&_input]:!min-h-[44px]` / `[&_button]:!h-11` のハックが多用され、共通 Input/Button/Select のサイズトークンで44pxが担保されていないことの裏返しになっている。設定行の h-8(32px) のように未達のまま残る箇所もある。
- **検索 debounce の欠如**: contact-profiles / pca-pumps / institutions が query を queryKey 直結で打鍵ごとに fetch（drug-masters は debounce 済で対照的）。
- **生 select / native select の混在**: prescriptions/new・pharmacy-cooperation・partner-cooperation・referrals が shadcn Select でなく生 `<select>` を使い、フォーカス/状態スタイルと SSR enum 漏れ対策が不統一。
- **角丸の乖離**: rounded-2xl / rounded-xl が認証クラスタ・proposals・処方せん系で常用され、CLAUDE.md「角丸控えめ（radius 0.375rem）」と乖離。
- **補助大機能3つ以上の未分割**: shifts / drug-masters / formulary / performance / uat / alert-rules / workflow / pharmacy-cooperation / tasks / conferences が Tab/ドロワー/別ページ分割されず縦積みで肥大化。

## 医療システムとしてのリスク

医療現場（在宅訪問薬局）の業務安全・コンプライアンスに直結するリスクを重大度順に整理する。

- **偽の安全保証（最重要）**: `/schedules/emergency-route` の「影響確認」チェックリストが社用車・薬剤師負荷・正式決定を常に緑✓のハードコードで表示し、実際の車両競合や過負荷を隠す。`/schedules/conflicts` の採用・再確認が永続化されず toast のみで「直した」と誤認させる。いずれも重なり/競合が解消されていないまま運用が継続する恐れ。
- **アラート4段階のフラット化と赤の濫用**: facility-standards（算定不可=赤 と 90日=橙 を同一橙バナー）、credentials（期限切れ と 90日 を橙集約）、performance（API P95 が達成時も常時橙）、realtime（0件でも至急=赤点灯）、workflow（例外/期限超過と報告待ち/リマインダを同一赤の AlertPill）、pharmacy-sites（改定リマインダーが赤）、business-holidays（休業=destructive赤）など、定常状態・リマインダーと即時中断アラートが同じ見た目に混在。「赤を見たら必ず行動」の信号価値が失われ、alert fatigue で重大警告を見落とす。
- **ハイリスク情報の埋没・欠落**: patients/[id] の SafetyBoard が非sticky でスクロールすると消える。visit-record-detail / reports/[id] の固定サマリーに患者識別（氏名/生年月日/年齢/アレルギー/ハイリスク薬）が無く、誰の記録かを見ずに報告書生成・算定へ進める（取り違え・禁忌見落とし）。処方せん一覧・inline・[id] に麻薬/ハイリスク/冷所/アレルギーの安全タグが無い。patients ボードの安全タグが +N に省略され重大タグが裏に隠れる。
- **色だけに依存**: first-login のパスワード要件達成が緑色のみ（アイコン/語なし）、business-holidays/shifts の曜日・休業の面塗り、emergency-route/route-compare のノード色（凡例なし）。色覚特性のある職員・屋外直射下で判別困難。
- **PHI の生値露出**: data-explorer 生データ JSON、uat 患者住所、credentials 同意患者氏名、institutions 電話/FAX/住所、qr-scan/shared-viewer の保険者・公費番号。マスク/段階開示方針が無く、画面共有・肩越し閲覧で要配慮個人情報が漏れうる。
- **サンプル/未接続データの誤認**: staff / facilities / vehicles / external-professionals が本番同型の編集UIを disabled で表示し、実在しない「医療機関1〜8」を露出。dispense/audit/set/set-audit がモック駆動なのに「サンプル表示」明示なし。metrics が API未接続の全0を実測同様に表示。架空データへの操作・経営判断の誤読を招く。
- **破壊的/不可逆操作の確認欠如**: billing/candidates の月次締め、drug-masters の薬価更新/全件取込、pca-pumps の貸出取消、schedules の推奨車両反映、jobs の再実行、tasks の一括完了、workflow の処方変更確定、patient-form の重複登録解除が ConfirmDialog なしで実行可能。
- **PHI の意図せぬ出力**: reports/[id]/print が確定1秒後に自動 window.print() を発火し、無人画面から PHI を含む報告書が印刷されうる。
- **監査証跡の暗黙切り捨て**: audit-logs が limit=100 固定・総件数非表示で「これで全件」と誤認させるコンプライアンスリスク。
- **false-zero / 未保存ロック**: performance/realtime の isLoading 未ガードで初回ロード中の0を「問題なし」と誤認。mfa/setup でリカバリーコード未保存のまま完了でき端末喪失時に自己ロック。lockout の連絡先プレースホルダで業務停止時に管理者へ到達不能。

## パフォーマンス課題

- **巨大単一クライアントコンポーネント**: card-workspace.tsx(4655行)、drug-master-content.tsx(4485行)、pharmacy-cooperation-content.tsx(3400行)、prescription-intake-form.tsx(2982行)、visit-record-form.tsx(2457行)、shifts-content.tsx(2388行)、conferences-content.tsx(2235行)、uat-content.tsx(1117行)、workflow-dashboard-view.tsx(約1500行)。dynamic import / コード分割 / React.memo が無く、初期JSが重く再レンダリング範囲が広い。
- **大量の並列 useQuery**: formulary（拠点選択で約15）、conferences（10超）、uat（6並列）、performance（3 useRealtimeQuery 60s + runtime 60s + SSE + StaffKpiPanel）。タブ1枚あたりの並列フェッチ/再描画負荷が突出。
- **debounce 欠如による打鍵ごと fetch**: contact-profiles / pca-pumps / institutions。search は8カテゴリを毎打鍵で全件近く並列取得（debounce/Abort はあるが payload 大）。
- **仮想化/ページング不在**: business-holidays/shifts のカレンダー・グリッド、packaging-methods/contact-profiles/pca-pumps の全件カード、tasks/communications の fetchAllCursorPages、analytics/jobs/audit-logs/billing の DataTable。件数増で DOM 肥大。
- **常時ポーリング**: settings の healthQuery 60s（タブ非表示停止無）、visit-record-form の 5秒 sync count、reports の60s refetch、dashboard の now 更新。
- **毎レンダ再計算**: patients-board の now=new Date()、visit-record-form の useWatch 全体購読+structuredSoapDraft 再構築、data-explorer/billing-candidates の JSON.stringify、reports/[id] の派生配列(useMemo無)、users-content の columns 非memo。
- **CLS**: loading.tsx と本体の形状不一致（全クラスタ）、login の Suspense 高さ固定、min-h固定カード、スピナー/テキストローディング。
- **共通部品不在による bundle 重複**: OTP/強度/要件/MetricCard/SignalTile/BarChart/SVGルートチャートの個別再実装。

## レスポンシブ課題

- **多カラムが lg 以上のみ**: brief / facility-packet / conflicts / emergency-route / route-compare / handoff相談 が tablet(768) で縦積みになり、補助カラムが本文下へ沈んで「参照しながら作業」動線が崩れる。
- **固定 min-h / 固定高**: compare(min-h-720px)、conflicts/route-compare(xl:min-h-760/820px)、my-day/visits の min-h、data-explorer(calc(100dvh-16rem) が lg のみ)、print-hub(100vh 固定)。データが少ないと巨大空白、md帯で内部スクロール不効。
- **広い DataTable に横スクロール+カードフォールバック無**: analytics(7列)/jobs(7列)/audit-logs(6列)/prescriptions/clerk-support。重要列が右に隠れる。clerk-support は tasks/offline-sync と違いカード代替が無い。
- **モバイル thumb zone 未対応**: patients/new・visits・qr-scan・schedules・reports/billing の主操作（登録/採用/反映/送信/締め）が下部固定でなくスクロール末尾。
- **order 入替**: realtime / patients[id] が DOM順と視覚順を入替（VA IA 違反）。MasterEditorView も order-1/2/3 指定。
- **100vh vs 100dvh**: auth layout(min-h-screen)、print-hub(100vh)。モバイルブラウザ chrome 増減でずれる。
- **OTP/グリッドの窮屈**: mfa の6ボックス(h-12 w-12)が390pxで余裕小、business-holidays/conferences カレンダー、external grid-cols-3 固定、gantt の中央列。
- **長文の折返し崩れ**: long なエラー/患者名/機関名で行高ばらつき、truncate による情報欠落と折返しの混在。

## 優先改善リスト

### P0: 必ず直す

- **偽の安全保証を除去**: `/schedules/emergency-route` のハードコード緑✓を実データ3値（満たす/未確認/競合）へ。`/schedules/conflicts` の採用を実 API 反映+ConfirmDialog にするか非永続を明示。
- **アラート4段階の共通部品化と適用**: 緊急中断=赤/要確認=橙/状態=中立/期限リマインダ=情報 を役割分離する AlertBanner/SeverityBadge/AlertPill を新設し、facility-standards・credentials・performance(API P95)・realtime・workflow・pharmacy-sites・business-holidays の赤/橙濫用を是正。
- **巨大ワークベンチの再構築**: shifts(2388行)・business-holidays・drug-masters/formulary(4485行)・performance(8ブロック)・uat(7セクション)・workflow(20+)・patients/[id](4655行) を Tab/別ルート/dynamic import で分割し、生 Tailwind 状態色を6軸トークンへ置換、ローディングを形状一致スケルトンへ。
- **破壊的/不可逆操作に確認ダイアログ**: billing/candidates 月次締め（件数/金額/取消不可提示）、drug-masters 薬価更新/全件取込、pca-pumps 貸出取消、schedules 推奨車両反映。
- **患者安全 Pinned サマリーの導入**: patients/[id]・visits/[id]・visit-record・reports/[id]・処方せん系 に患者識別（氏名/生年月日/年齢/アレルギー/ハイリスク薬）+SafetyBoard を sticky で常時表示（折りたたみ禁止）。
- **処方せん系の状態色・安全情報・件数集計**: pending=赤を waiting へ統一、麻薬/ハイリスク/冷所/アレルギー安全タグ列を追加、件数をサーバ集計へ、text-9/10px を12px以上へ。
- **reports/[id]/print の自動印刷抑制**: カウントダウン/手動印刷既定で PHI の意図せぬ出力を防止。

### P1: できるだけ直す

- **状態色の全面塗りを左ボーダー+文字色へ**: my-day / offline-sync / patients[id] / reports / billing / analytics / capture / visits-record / schedules の `bg-state-*/10` タイルを是正。
- **ローディングのスケルトン化**: settings / shifts / business-holidays / calendar-view / proposals / visit-record-detail/form / 患者サブページ Suspense / pharmacy-cooperation。loading.tsx を本体形状に合わせ CLS を解消。
- **共通部品の整備と適用**: OtpInput / PasswordStrengthField / AuthStepper / 期限 ExpiryBadge / StatCard(KpiStrip) / StatusTile(左ボーダー) / DayNavigator / RouteSchematicChart / PHIマスクユーティリティ / 患者識別 Pinned ヘッダ。
- **PHI マスク**: data-explorer / uat / credentials / institutions / qr-scan / shared-viewer の生値を権限付き段階開示へ。
- **情報順の修正**: users / business-holidays / analytics / billing / reports/analytics の件数サマリーをテーブル/カレンダー上へ、prescriptions/reports の補助サマリーを主データの後段へ。
- **ヘッダ/見出しの統一**: 素 h1（text-xl/2xl 混在）を共通ヘッダ部品+sr-only h1+本文 h2 開始へ収束（search/notifications/clerk-support/select-mode/dashboard/handoff/visits/billing/reports ほか）。
- **debounce / react-query 化**: contact-profiles / pca-pumps / institutions に debounce、notification-settings を react-query へ。
- **色だけに依存しない化**: first-login 要件にアイコン+語、通信失敗バッジにアイコン併記、ルートチャートに凡例。
- **アクセシビリティ/操作性**: settings の h-8 を44pxへ、visit-record-detail の手組み popover を共通 DropdownMenu へ、tasks/clerk-support にモバイルカードフォールバック。
- **サンプル/未接続の明示**: dispense/audit/set/set-audit/metrics/staff/facilities/vehicles/external-professionals/evidence にサンプルバッジ+4状態スタブ。
- **共有/フォームの安全化**: patients share の入口集約+二重確認、patient-form の重複登録二段確認+下書き自動保存+下部FormActionBar。

### P2: 余力があれば直す

- **角丸の統一**: auth クラスタ・proposals の rounded-2xl/xl を rounded-md（0.375rem系）へ。
- **装飾の引き算**: views/evidence の shadow-sm 撤去、conferences/external/shared-viewer のカード過多をリスト行+必要時展開へ、proposals のバッジを必須3つに絞る。
- **数値整列**: master-hub / business-holidays / shifts / 残薬テーブル / qr-scan / 金額・用量・件数に tabular-nums を一貫適用。
- **トークン化の徹底**: select-mode（text-blue/violet/emerald-600）、shared-viewer（slate/sky/indigo/rose）、capture（bg-slate-900）、SOAP色（text-blue/green/purple/orange-500）を識別/中立トークンへ。
- **チャート/グラフの共通化と可読性**: operations-insights / dispense-audit-stats の BarChart 共通化、ラベル12px以上、棒に数値テーブル代替。
- **微細な整理**: professionals の loading.tsx 撤去、service-areas のバッククォート除去、文言の英語生キー/生 enum 日本語ラベル化、offline に継続作業導線、select-site に「元に戻す」導線、100vh→100dvh。
- **役割境界の明確化**: /dashboard と /my-day の重複コンテンツを整理し利用者視点の役割を分離。