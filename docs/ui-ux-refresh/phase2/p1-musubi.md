# P1 競合調査: カケハシ Musubi（クラウド電子薬歴 + Musubi在宅）

調査日: 2026-07-11 / 出典種別: 公開一次資料

- 調査対象: 株式会社カケハシ「Musubi」（クラウド型電子薬歴・服薬指導システム）および在宅訪問サポート機能（いわゆる Musubi在宅）
- 使用ソース: カケハシ公式製品サイト（musubi.kakehashi.life）、カケハシ公式コーポレートサイト（kakehashi.life）のニュース/プレスリリースのみ。ログイン必須のサポートサイト・非公開マニュアルは取得していない。
- 注意: 本書は公式ページの文言に基づく抽象原理レベルの整理であり、画面文言・アイコン・画像等のブランド表現は複製していない。各項目は「調査時点(2026-07-11)に確認できたページ」の記述であり、最新版・全機能を網羅する保証はない。
- 製品構成の前提: Musubi はレセコンではなく、NSIPS® 準拠レセコンと連携して動作する電子薬歴+服薬指導システム。会計・レセプト処理はレセコン側の責務（確認日 2026-07-11、https://musubi.kakehashi.life/musubi-yakureki/receipt-computer / https://musubi.kakehashi.life/faq ）。関連製品として Pocket Musubi（服薬フォロー）、Musubi Insight（経営可視化）、Musubi AI在庫管理がある（https://musubi.kakehashi.life/ ）。

---

## パターン一覧

### P-01 服薬指導中タッチ記録による薬歴下書き自動生成（瞬間薬歴）

- **Product/source**: Musubi 電子薬歴（公式製品ページ）
- **Screen or workflow**: 服薬指導画面（タブレット）→ 薬歴作成
- **Observed pattern**: 服薬指導中にタブレット画面に表示される指導内容をタッチするだけで、その内容が SOAP 形式の薬歴下書きとして自動保存される。指導後に聞き取った情報や指導内容を追記して薬歴を完成させる二段階構成。「10分以上かかっていた薬歴が2〜3分で完了」した事例が公式に紹介されている。
- **Problem solved**: 指導と記録の二度手間（指導内容を後から文字起こしする作業）の解消。記載漏れ防止。
- **Strength**: 記録行為が指導行為の副産物として発生するため、記録が「後回しの負債」にならない。下書き→追記→完成という明確な段階がある。
- **Limitation**: タッチ対象の指導文テンプレートに依存するため、テンプレート外の個別事象は追記が必要。専用タブレット前提の運用（2026-05 の AI音声薬歴はブラウザ版限定と明記されており、デバイス制約が存在する）。
- **Possible misinterpretation**: 「薬歴が自動で完成する」わけではない。公式も下書き+追記で完成という構成を明示している。全自動と誤読して確認工程を省くと記録品質が落ちる。
- **Patient safety implication**: 指導内容と記録の一致が構造的に担保されやすく、薬歴の網羅性が向上。一方でタッチ選択式は「押しただけで指導した扱い」になる形骸化リスクがある。
- **Applicable principle for this system**: PH-OS の服薬指導/薬歴でも「指導中の構造化タッチ入力 → SOAP 下書き → 追記して確定」の二段階を採用可能。既存の下書き/確定分離設計と整合する。
- **Adopt/Reject**: **Adopt（原理採用）**。Workflow First / Structured Data First と一致。指導テンプレートの形骸化対策として、下書き確定前の必須確認項目を設ける。
- **Evidence(URL)**: https://musubi.kakehashi.life/musubi-yakureki / https://musubi.kakehashi.life/product/product-shunkanyakureki / https://musubi.kakehashi.life/musubi-yakureki/demo2
- **Access date**: 2026-07-11

### P-02 処方監査画面: 前回処方との差分をテキスト+アイコンで表示、同一成分を隣接配置

- **Product/source**: Musubi 電子薬歴（公式製品ページ・検索スニペット）
- **Screen or workflow**: 処方監査（鑑査）画面
- **Observed pattern**: 今回処方が同一医療機関・同一診療科の過去処方（前2回）と自動的に並べて表示され、同一成分の薬剤が隣に配置される。新規追加や増減量はテキストとアイコンで表示され、「処方の経時的変化、アラート、過去薬歴、前回処方との差分など、処方監査に必要な情報をひと目で確認」できるとされる。
- **Problem solved**: 前回 Do 処方か変更処方かの見極めを目視の突き合わせなしで行える。変更点の見落とし防止。
- **Limitation**: 公式公開ページで確認できたのは「同一医療機関・診療科」の前回処方との比較。医療機関横断の差分表示の有無は公開情報からは確認できない（カレンダー機能が横断参照を補完、P-04 参照）。「新規/増量/減量/中止」の具体的なラベル語彙・アイコン意匠は公開情報なし（推測しない）。
- **Possible misinterpretation**: 差分表示は同一成分の隣接配置と組み合わせて初めて機能する。単純な行差分（テキスト diff）だけだと、剤形変更や同効薬切替が「中止+新規」に見えて文脈を失う。
- **Patient safety implication**: 増減量・中止の見落としは重大インシデント直結。差分の明示化は監査の中核安全機能。
- **Applicable principle for this system**: PH-OS の監査ワークベンチで「前回処方との自動突合 + 同一成分（YJ 上位桁）で行アラインメント + 変化種別（新規/増量/減量/中止）をアイコン+テキスト併記」を採用。色のみに依存しない表現は CLAUDE.md のアクセシビリティ方針とも一致。
- **Adopt/Reject**: **Adopt（原理採用）**。ラベル語彙は自システムで独自定義する（意匠は複製しない）。医療機関横断の差分は Musubi 公開情報で確認できない領域であり、PH-OS の差別化候補。
- **Evidence(URL)**: https://musubi.kakehashi.life/musubi-yakureki （「同一成分の薬剤が隣に表示」「新規や増減はテキストとアイコンで表示」）
- **Access date**: 2026-07-11

### P-03 アラートの類型網羅と「色付き明示 + ワンタッチ詳細」の二層表示

- **Product/source**: Musubi 電子薬歴（処方チェック公式ページ）
- **Screen or workflow**: 処方画面（監査時のアラート表示）
- **Observed pattern**: 患者サマリ（頭書き）と前回処方を踏まえ、禁忌・慎重投与が含まれる場合に自動で注意喚起。対応類型として「相互作用・配合変化 / 成分重複 / 適応症×禁忌 / 投与日数 / 投与量 / アレルギー / 妊婦・授乳 / 年齢 / 副作用 / 疾患」の11分類前後を列挙。「各アラートは、処方画面にわかりやすく表示。ワンタッチで詳細を確認することも可能」。ハイリスク薬・漫然投与注意薬・禁忌/慎重投与は色付きで明示。
- **Problem solved**: 監査に必要なチェック観点の網羅と、一次表示（存在の明示）と二次表示（根拠詳細）の分離による画面の過密回避。
- **Strength**: アラートを一覧密度を壊さず提示し、詳細はオンデマンド展開。患者属性（年齢・妊娠授乳・アレルギー）と処方内容の突合を含む。
- **Limitation**: 重症度の段階数（何段階の警告レベルか）、抑制・オーバーライド操作、警告疲労対策（既読管理・頻度制御など）は公開情報なし。
- **Possible misinterpretation**: 「類型が多い＝安全」ではない。一次表示の閾値設計を誤ると警告疲労で全アラートが無視される。公開情報からは Musubi の閾値設計は読み取れない。
- **Patient safety implication**: アレルギーや禁忌の見落とし防止に直結。二層化は「重大なものが軽微なものに埋もれる」問題への一つの回答。
- **Applicable principle for this system**: PH-OS の CDS は既に重大/注意/情報の3段階を持つ。Musubi から採るのは「アラート類型の網羅リスト（11類型）を要件チェックリストとして使う」ことと「一次表示は存在+種別、詳細はワンタッチ展開」の二層構造。
- **Adopt/Reject**: **Adopt（二層表示・類型網羅）/ 部分Reject**: 重症度・オーバーライド設計は公開情報がないため参考にせず、PH-OS 独自の3段階+オーバーライド理由記録（監査証跡）で設計する。
- **Evidence(URL)**: https://musubi.kakehashi.life/product/product-checkprescription / https://musubi.kakehashi.life/musubi-yakureki/checkprescription / https://musubi.kakehashi.life/musubi-yakureki
- **Access date**: 2026-07-11

### P-04 カレンダー形式の処方歴 + 薬効重複の一覧表示

- **Product/source**: Musubi（公式ニュース 2022-01-13「カレンダー機能」）
- **Screen or workflow**: 処方監査・薬歴参照
- **Observed pattern**: 「患者さんに処方された薬剤とそれぞれの処方期間がカレンダー形式で表示され、過去の処方歴や薬歴をすばやく参照」「処方歴と薬効重複を一覧表示させ、必要に応じて薬歴を参照できる」。薬剤ごとに処方歴・薬歴を参照、絞り込み機能あり。
- **Problem solved**: 時系列での服用期間の重なり（薬効重複・漫然投与・飲み残し期間）をテーブルでは把握しづらい問題を、期間バーの視覚化で解決。
- **Strength**: 「いつからいつまで何が出ていたか」という監査の時間軸質問に1画面で答える。
- **Limitation**: 複数医療機関処方の統合表示の有無はプレスリリースに明記なし（公開情報なし）。
- **Possible misinterpretation**: カレンダー表示は処方日+日数からの推定であり、実服用の保証ではない。残薬・アドヒアランスと混同した読み方をさせない注意書きが要る。
- **Patient safety implication**: 薬効重複・過量継続の検出に有効。特に在宅の多剤併用患者で価値が高い。
- **Applicable principle for this system**: PH-OS 薬歴/監査に「薬剤×期間のガントチャート型ビュー + 薬効分類での重複ハイライト」を将来候補として採用可能。
- **Adopt/Reject**: **Adopt（バックログ候補）**。実装コストが高いため Phase2 では差分表示（P-02）優先、カレンダーは後続。
- **Evidence(URL)**: https://musubi.kakehashi.life/news/20220113
- **Access date**: 2026-07-11

### P-05 患者サマリ（頭書き）起点のパーソナライズ指導文 + 画面共有型指導

- **Product/source**: Musubi 電子薬歴（公式製品ページ）
- **Screen or workflow**: 服薬指導画面（タブレットを患者に見せる運用）
- **Observed pattern**: 「タブレットPC画面を患者さんに見せながら服薬指導」。患者サマリの年齢・性別・生活習慣をもとに個々の患者に合わせた指導文を表示、薬剤画像付き指導文はオンライン服薬指導にも使える。公的機関情報・学術論文をもとに社内薬剤師が作成したイラスト付き健康アドバイスが会話のきっかけとして自動提案される。
- **Problem solved**: 画一的な指導文の読み上げ化と、患者との情報非対称。画面を共有物にすることで指導が対話になる。
- **Strength**: 頭書き（構造化患者属性）を指導コンテンツ選択の入力にしている＝データが指導品質に直結する設計。薬剤画像は聞き間違い・取り違え防止に寄与。
- **Limitation**: コンテンツはベンダー監修に依存。患者に見せる画面と薬剤師専用情報（アラート等）の表示切り分けの詳細は公開情報なし。
- **Possible misinterpretation**: 患者に画面を見せる運用では、他患者情報・内部メモ・アラートが映り込まない「患者向け表示モード」が前提になる。この分離を欠いたまま画面共有だけ真似るとプライバシー事故になる。
- **Patient safety implication**: 視覚材料により理解度が上がり、服薬過誤を減らす。映り込みは要配慮個人情報の漏えいリスク。
- **Applicable principle for this system**: PH-OS で患者対面表示を導入する場合は「患者向けビュー / 薬剤師向けビュー」のモード分離を必須要件とする。頭書き→指導文の連動は構造化患者属性の活用先として参考になる。
- **Adopt/Reject**: **部分Adopt**。画面共有指導は将来候補。指導コンテンツ制作は自前では過大なため、まず構造化属性→指導チェックリストの連動のみ採用。
- **Evidence(URL)**: https://musubi.kakehashi.life/musubi-yakureki
- **Access date**: 2026-07-11

### P-06 OP（次回確認事項）の自動引き継ぎによる継続薬学管理

- **Product/source**: Musubi 電子薬歴（継続的な薬学管理 公式ページ）
- **Screen or workflow**: 薬歴記載 → 次回来局時の準備画面
- **Observed pattern**: 前回薬歴に「次回処方の際に確認したい事項を OP として記載」でき、同一医療機関・診療科の前回処方に記載された OP が次回来局時に「自動的に準備画面へ」表示される。OP 一覧から項目を選択すると薬剤一覧画面に表示され、その場でテキスト編集も可能。「前回投薬者からの確認や引き継ぎが漏れる心配もありません」。
- **Problem solved**: 担当者が毎回変わる薬局で、前回の申し送りが読まれない問題。フリーテキスト薬歴の末尾に埋もれる「次回確認」の構造化。
- **Strength**: 申し送りを「書く場所」ではなく「次回必ず表示される場所」に格上げしている。担当者非依存の継続性。
- **Limitation**: OP の消化（確認済みにする操作）やエスカレーションの仕組みは公開情報なし。
- **Possible misinterpretation**: 自動表示は「読まれる」ことを保証しない。確認済みチェック等のクローズループがないと表示疲れで無視される。
- **Patient safety implication**: 副作用モニタリング・残薬確認などの経時タスクの抜け漏れ防止に直結。
- **Applicable principle for this system**: PH-OS の薬歴に「次回確認事項」を構造化フィールドとして持ち、次回受付/監査/指導画面に自動サーフェスする。handoff 連絡ハブ（既存機能）との統合が自然。
- **Adopt/Reject**: **Adopt**。既存 handoff 機構の拡張として実装可能性が高い。表示だけでなく「確認済み」操作まで含めてクローズループ化する（Musubi 公開情報からは確認できない部分を補強）。
- **Evidence(URL)**: https://musubi.kakehashi.life/musubi-yakureki/continuous
- **Access date**: 2026-07-11

### P-07 在宅訪問サポート: 訪問時必要情報の1画面集約 + 患者クイック切替 + 対応メモ→薬歴転記

- **Product/source**: Musubi 在宅訪問サポート機能（公式ニュース 2025-04-23）
- **Screen or workflow**: 在宅訪問中の情報参照・記録（Musubi在宅）
- **Observed pattern**: ①「管理画面上で複数の患者情報をスムーズに切り替えられる」患者クイック切替、②「訪問時に必要な情報のみを集約して1画面に表示し、画面の切り替え操作を最小限に抑え」る在宅特化ビュー、③「訪問中に患者さんごとのメモが記録でき」薬歴へスムーズに転記できる下書き機能。背景として在宅患者約24万人/日（2023年推計）、85%が75歳以上という文脈を提示。
- **Problem solved**: 施設訪問で数十人を連続対応する際の画面遷移コストと、訪問中メモ→帰局後清書の二度手間。
- **Strength**: 「訪問」という業務モードに合わせて情報の取捨選択をシステム側が行う（外来画面の使い回しではない）。メモが薬歴の一次入力になる。
- **Limitation**: オフライン動作の記述はプレスリリースになし。クラウド前提で「インターネットにつながる環境であれば、店舗の外でも利用可能」（公式）であり、通信不能環境での挙動は公開情報なし。
- **Possible misinterpretation**: 「1画面集約」は情報を全部出すことではなく、訪問時に不要な情報を削ることが本質。集約を「詰め込み」と誤読すると在宅端末で使い物にならない。
- **Patient safety implication**: 施設で患者を取り違えるリスクに対し、クイック切替は諸刃（速い切替は取り違えも速い）。切替時の患者識別表示の強調が必須。
- **Applicable principle for this system**: PH-OS の訪問モードに「訪問特化1画面ビュー + 施設内患者ローテーション切替 + 訪問メモ→報告書/薬歴転記」を採用。切替時は PatientHeader（既存の患者識別 SSOT）を常時固定表示し取り違え対策とする。
- **Adopt/Reject**: **Adopt**。PH-OS は在宅特化を掲げており中核参考パターン。加えて PH-OS はオフライン PWA（Dexie）を持つため、Musubi が公開情報上カバーしない通信不能環境が差別化点。
- **Evidence(URL)**: https://musubi.kakehashi.life/news/20250423 / https://www.kakehashi.life/news-post/20250423 / https://musubi.kakehashi.life/musubi-yakureki/security
- **Access date**: 2026-07-11

### P-08 在宅計画書・報告書: 薬歴からの自動転記 + 要点先頭レイアウト + 送付先単位の一括作成・一括確定

- **Product/source**: Musubi 在宅計画書・報告書作成（公式製品ページ + 公式ニュース 2023-04-24）
- **Screen or workflow**: 在宅の計画書・報告書作成
- **Observed pattern**: 薬剤師監修フォーマットに「項目に沿って情報を埋めていくだけ」で書類が完成。「患者情報画面からワンタッチで書類作成をスタート」。「報告書には、薬歴に記載されている内容が自動的に転記」。「確実に伝えるべき要点が書類の冒頭にレイアウト」。2023-04 更新で店舗ごとのフォーマットカスタマイズと、「送付先単位で複数の計画書・報告書をまとめて作成できる『在宅一括対応』」（対象書類を選択し、共通項目をまとめて入力、一括で確定）に対応。
- **Problem solved**: 薬歴と報告書の二重入力。医師・ケアマネ等の読み手が要点に到達するまでのコスト。施設単位で数十枚発生する書類の個別処理。
- **Strength**: 「書く単位（患者）」と「送る単位（施設・医師）」を分けて後者での一括操作を提供。「一括で確定」という語から下書き→確定の状態遷移が書類にも存在することが読み取れる。
- **Limitation**: 承認（第三者レビュー）工程の有無は公開情報なし。確定後の訂正フロー・版管理も公開情報なし。
- **Possible misinterpretation**: 一括確定は効率化と引き換えに「読まずに確定」を誘発し得る。共通項目の一括入力が患者個別性を上書きしないガードが必要。
- **Patient safety implication**: 報告書は多職種連携の一次情報。転記自動化は転記ミスを減らすが、薬歴側の誤りが報告書へ自動伝播する点は逆リスク。
- **Applicable principle for this system**: PH-OS の訪問報告書に「薬歴/訪問記録からの自動転記」「要点（アセスメント・依頼事項）を文書先頭に置くフォーマット」「送付先単位の一括作成 + 個別確認を強制するステップ付き一括確定」を採用。
- **Adopt/Reject**: **Adopt**。一括確定は「1件ずつの確認チェック必須」の設計に修正して採用（誤伝播・読み飛ばし対策として Musubi 公開情報より保守的に倒す）。
- **Evidence(URL)**: https://musubi.kakehashi.life/product/product-zaitaku / https://musubi.kakehashi.life/news/20230424 / https://www.kakehashi.life/news-post/20230424
- **Access date**: 2026-07-11

### P-09 AI音声薬歴生成: 「薬剤師による確認・修正を前提とした下書き」という位置づけ

- **Product/source**: Musubi AIアシスタント—音声薬歴生成機能（公式ニュース 2024-09-17 開発着手 / 2026-05-11 本格提供）
- **Screen or workflow**: 服薬指導の録音 → SOAP 薬歴下書き生成 → 薬剤師編集 → 確定
- **Observed pattern**: 服薬指導の会話音声から SOAP 形式薬歴の下書きを生成。「処方内容を照合しながら専門用語を正確に認識」。2つの録音モード。「薬剤師による確認・修正を前提とした下書き作成をサポート」と明記。標準機能として追加費用なし（別途申込、ブラウザ版のみ）。
- **Problem solved**: タッチ記録（P-01）でも残る自由会話部分の記録コスト。
- **Strength**: AI 出力を「下書き」と明確に位置づけ、確定責任を薬剤師に置く責任分界の明示。処方内容との照合で音声認識の文脈精度を上げるドメイン設計。
- **Limitation**: 生成誤りの検知支援（差分ハイライト等）の有無は公開情報なし。録音への患者同意フローも公開情報なし。
- **Possible misinterpretation**: 「AIが薬歴を書く」ではない。下書き承認 UI の設計を怠ると、確認が形式化してAI誤りがそのまま法定記録になる。
- **Patient safety implication**: 薬歴は監査・訴訟・継続ケアの根拠記録。AI 下書きの無検証確定は誤情報の永続化リスク。
- **Applicable principle for this system**: PH-OS で生成 AI を薬歴・報告書に使う場合、(1) AI 出力は必ず draft 状態、(2) 確定操作は人間のみ、(3) AI 生成部分の由来表示、(4) ドメインデータ（処方内容）を認識コンテキストに使う、を設計原則とする。
- **Adopt/Reject**: **Adopt（原則のみ）**。機能自体は Phase2 スコープ外だが、下書き/確定の状態モデルはこの将来拡張に耐える形にしておく。
- **Evidence(URL)**: https://www.kakehashi.life/news-post/20260511 / https://www.kakehashi.life/news-post/20240917 / https://musubi.kakehashi.life/news/20240917
- **Access date**: 2026-07-11

### P-10 レセコン連携による受付〜薬歴の自動紐付け（二重入力排除・電子処方箋/オン資対応）

- **Product/source**: Musubi（公式FAQ・レセコン連携ページ・公式ニュース 2024-01-31 / 2025-04-10）
- **Screen or workflow**: 受付（レセコン入力）→ Musubi 上の患者・処方表示 → 指導・薬歴 → 調剤結果の還流
- **Observed pattern**: NSIPS® 準拠レセコンと連携し、レセコンに入力された処方と Musubi 内の患者情報を自動で結びつける。「Musubi に調剤結果を記録するだけで、レセコンを経由して電子処方箋管理サービスにも同様の情報が登録」。JAHIS 連携仕様書 Ver.1.1 対応レセコン経由で、オンライン資格確認情報（過去の調剤記録・特定健診情報）を Musubi 上で参照可能。PHC Pharnes シリーズとの一体型連携を推奨。
- **Problem solved**: 受付・会計系（レセコン）と薬歴・指導系（Musubi）の二重入力と情報断絶。外部データ（電子処方箋・オン資）の参照導線。
- **Strength**: 標準規格（NSIPS/JAHIS）ベースの Integration by Adapter。薬剤師の記録が一度で行政系サービスまで届く単方向の省力設計。
- **Limitation**: Musubi 自身は受付・会計 UI を持たない（会計体験は連携先レセコン依存）。患者検索 UI・同姓同名識別の公開情報なし。
- **Possible misinterpretation**: 「電子薬歴の業務フロー」を評価する際、受付〜会計は別システムである点を混同しない。PH-OS は受付〜会計まで自前で持つため、比較対象が非対称。
- **Patient safety implication**: 自動紐付けは転記ミスを排除する一方、レセコン側の患者取り違えがそのまま伝播する。連携境界での患者同一性検証が安全要件。
- **Applicable principle for this system**: PH-OS は NSIPS/JAHIS 相当の標準インターフェースを adapter 層に置き、オン資・電子処方箋情報を監査/指導画面から参照できる導線を設計する。
- **Adopt/Reject**: **Adopt（アーキテクチャ原則として既に整合）**。PH-OS は一体型のため、Musubi が外部依存する受付〜会計〜薬歴の一気通貫 UX が差別化点になる。
- **Evidence(URL)**: https://musubi.kakehashi.life/faq / https://musubi.kakehashi.life/musubi-yakureki/receipt-computer / https://www.kakehashi.life/news-post/20240131 / https://www.kakehashi.life/news-post/20250410
- **Access date**: 2026-07-11

### P-11 店舗間連携: 患者サマリ・薬歴・疑義照会内容の法人内共有

- **Product/source**: Musubi 店舗間・薬局間連携（公式製品ページ）
- **Screen or workflow**: 同一法人の別店舗来局時の患者情報参照
- **Observed pattern**: 同一法人複数店舗で患者情報を自動連携。別店舗来局時に「患者サマリ情報が初回のみ反映された状態」で当該店舗の患者データが作成される。過去処方歴・薬歴に加え「店舗Aで登録された疑義照会や問い合わせ内容についても店舗Bで確認できます」。
- **Problem solved**: 店舗をまたぐ患者の薬学管理の分断。疑義照会の重複発生。
- **Strength**: 疑義照会を共有可能な構造化記録として扱っている（フリーテキスト薬歴内に埋没させない）ことが読み取れる。
- **Limitation**: 疑義照会の入力 UI・処方医への連絡フロー・回答記録の形式は公開情報なし。Musubi Insight で疑義照会文書が分析ダッシュボードに可視化されるという言及があるのみ。
- **Possible misinterpretation**: 「初回のみ反映」＝以後は店舗ごとに分岐し得るサマリであり、常時同期の単一レコードとは限らない。マルチテナント設計の参考にする際はこの違いに注意。
- **Patient safety implication**: 疑義照会履歴の共有は同一疑義の再発・照会漏れを防ぐ。分岐したサマリは店舗間で矛盾する頭書きを生むリスク。
- **Applicable principle for this system**: PH-OS はテナント内で単一患者レコード（RLS による org 分離）なので構造的に優位。疑義照会は独立エンティティとして記録し、薬歴・監査・多職種連携から参照可能にする。
- **Adopt/Reject**: **Adopt（疑義照会の構造化記録という原理のみ）**。店舗ごとレコード複製方式は Reject（PH-OS の単一レコード+RLS の方が一貫性で優る）。
- **Evidence(URL)**: https://musubi.kakehashi.life/musubi-yakureki/linkage / https://musubi.kakehashi.life/product/product-linkage / https://musubi.kakehashi.life/musubi-insight
- **Access date**: 2026-07-11

### P-12 クラウド前提のデータ管理と可用性の訴求（バックアップ・災害・店舗外アクセス）

- **Product/source**: Musubi セキュリティ・データ管理（公式ページ）
- **Screen or workflow**: システム全体（非常時・可用性）
- **Observed pattern**: 「患者さまの個人情報をはじめすべてのデータをクラウドで管理。店舗ごとにバックアップをとる必要は一切ありません」「インターネットにつながる環境であれば、店舗の外でも利用可能」。災害等によるデータ損壊リスクへの備えとしてクラウドを訴求。2025 年に「デバイスフリー対応（ブラウザ利用）」を予告し、2026-05 の AI 機能はブラウザ版限定で提供。
- **Problem solved**: 店舗サーバ型薬歴の災害時データ喪失・端末障害・バックアップ運用負担。
- **Limitation / 公開情報なし**: 回線断・クラウド障害時のオフライン継続手順（非常時運用）、監査ログ・アクセスログの利用者向け表示、認証方式、3省2ガイドラインへの適合表明の詳細は、調査した公開ページには記載なし（ログイン必須のサポートサイトは調査対象外）。
- **Possible misinterpretation**: 「クラウド＝非常時に強い」は片面。データ保全には強いが、回線断時の業務継続はオフライン機構がなければむしろ弱い。公開情報上、Musubi はインターネット接続を利用条件としている。
- **Patient safety implication**: 在宅訪問先（電波不良の施設・山間部）での参照不能は指導・監査品質に直結する。
- **Applicable principle for this system**: PH-OS のオフライン PWA（Serwist + Dexie、IndexedDB 暗号化）は、公開情報上 Musubi が訴求していない「通信不能環境での訪問業務継続」を埋める差別化軸。非常時運用（回線断時の閲覧・記録キューイング・復帰時同期）を明示的な機能として設計・訴求する。
- **Adopt/Reject**: **Adopt（クラウド集中管理の訴求点）+ 差別化（オフライン継続）**。
- **Evidence(URL)**: https://musubi.kakehashi.life/musubi-yakureki/security / https://musubi.kakehashi.life/news/20250423 / https://www.kakehashi.life/news-post/20260511
- **Access date**: 2026-07-11

### P-13 キーボード/PC 時短の補助手段としての定型文クリップボード（公式ブログ）

- **Product/source**: Musubi 公式ブログ（薬剤師向け PC 時短術）
- **Screen or workflow**: 薬歴等のテキスト入力
- **Observed pattern**: 公式ブログで「薬局でよく使う文を2つの動作で入力」するクリップボード活用法を薬剤師向けに解説。製品はタッチ主体だが、テキスト追記の効率化ニーズを OS 機能の教育で補っている。
- **Problem solved**: 定型文入力の反復コスト。
- **Limitation**: 製品内のキーボードショートカット・ファンクションキー操作に関する公開情報なし（レセコン系製品と異なりタッチ/タップ中心の訴求）。情報密度の設計指針も公開ページからは詳細不明。
- **Possible misinterpretation**: タッチ最適化とキーボード最適化は排他ではない。Musubi の公開訴求がタッチ中心である事実を「キーボード操作は不要」と読まない。
- **Patient safety implication**: 直接影響は小。ただし入力コストが高いと記録が簡略化され記録品質が落ちる間接影響。
- **Applicable principle for this system**: PH-OS の調剤ワークベンチは既にレセコン風キーボード操作（F12→Enter 等）を持つ。指導・薬歴側では「タッチ/タップ主体 + 定型文の高速挿入」を併存させる。
- **Adopt/Reject**: **部分Adopt**（定型文の高速挿入をアプリ内機能として実装。OS 依存の回避策には頼らない）。
- **Evidence(URL)**: https://musubi.kakehashi.life/blog/pc_technic_03
- **Access date**: 2026-07-11

---

## 観点別サマリ（公開情報の有無）

| 観点 | 公開情報 | 参照パターン |
|---|---|---|
| 患者検索・同姓同名識別 | **公開情報なし**（レセコンからの自動紐付けのみ確認） | P-10 |
| 患者コンテキスト維持 | 在宅で患者クイック切替+1画面集約を確認 | P-07 |
| 受付〜会計の業務フロー | 受付/会計はレセコン側。Musubi は指導・薬歴・監査領域 | P-10 |
| 前回処方との差分表示 | 前2回比較・同一成分隣接・新規/増減のテキスト+アイコン表示を確認。「中止」の表現語彙は**公開情報なし** | P-02, P-04 |
| アラート階層・警告疲労対策 | 11類型+色付き明示+ワンタッチ詳細の二層。重症度段階・オーバーライドは**公開情報なし** | P-03 |
| 疑義照会 | 記録が店舗間共有・Insight で可視化される事実のみ。入力 UI は**公開情報なし** | P-11 |
| 下書き/確定/承認の区別 | 薬歴: 下書き→追記→完成。AI 出力は確認前提の下書き。報告書: 一括「確定」操作あり。第三者承認は**公開情報なし** | P-01, P-08, P-09 |
| 情報密度・キーボード操作 | タッチ中心の訴求。製品内ショートカットは**公開情報なし** | P-13 |
| タブレット/モバイル | 専用タブレット→ブラウザ版（デバイスフリー）へ拡大中 | P-01, P-12 |
| オフライン/同期 | クラウド+要インターネット。オフライン継続機構は**公開情報なし** | P-12 |
| 空状態・エラー表示 | **公開情報なし** | — |
| 監査証跡の見せ方 | **公開情報なし**（公開ページに記載なし） | — |
| 非常時運用 | 災害時データ保全（クラウド）訴求のみ。回線断時手順は**公開情報なし** | P-12 |

## PH-OS への示唆（優先順）

1. **監査画面の差分表示**（P-02）: 同一成分アラインメント + 変化種別のアイコン+テキスト併記。色のみ非依存。
2. **在宅訪問モード**（P-07/P-08）: 訪問特化1画面 + 患者切替時の識別強調 + 訪問メモ→報告書/薬歴転記 + 送付先単位一括処理（個別確認必須化で Musubi 公開仕様より保守的に）。
3. **次回確認事項（OP 相当）の自動サーフェス**（P-06）: handoff 機構の拡張として実装、確認済みクローズループ付き。
4. **下書き/確定の状態モデル堅持**（P-01/P-09）: AI 拡張に備え、確定は人間のみ・由来表示を原則化。
5. **差別化軸**: オフライン業務継続（P-12）、受付〜会計一体の一気通貫（P-10）、医療機関横断の差分（P-02 の空白）、監査証跡の可視化（公開情報の空白領域）。

## 出典一覧（すべて確認日 2026-07-11）

- https://musubi.kakehashi.life/ — Musubi 総合トップ（製品ラインナップ）
- https://musubi.kakehashi.life/musubi-yakureki — 電子薬歴 Musubi 製品ページ（タッチ薬歴・処方監査・在宅・AI音声）
- https://musubi.kakehashi.life/product/product-shunkanyakureki — 瞬間薬歴
- https://musubi.kakehashi.life/musubi-yakureki/demo2 — 服薬指導中タッチ記録デモ
- https://musubi.kakehashi.life/product/product-checkprescription / https://musubi.kakehashi.life/musubi-yakureki/checkprescription — 処方チェック
- https://musubi.kakehashi.life/news/20220113 — カレンダー機能プレスリリース
- https://musubi.kakehashi.life/musubi-yakureki/continuous — 継続的な薬学管理（OP）
- https://musubi.kakehashi.life/product/product-zaitaku — 在宅計画書・報告書作成
- https://musubi.kakehashi.life/news/20230424 / https://www.kakehashi.life/news-post/20230424 — 在宅一括対応・独自フォーマット
- https://musubi.kakehashi.life/news/20250423 / https://www.kakehashi.life/news-post/20250423 — 在宅訪問サポート機能
- https://www.kakehashi.life/news-post/20240917 — 薬歴作成における生成AI活用（開発着手）
- https://www.kakehashi.life/news-post/20260511 — AIアシスタント音声薬歴生成 本格提供
- https://musubi.kakehashi.life/faq — よくある質問（レセコン連携・NSIPS）
- https://musubi.kakehashi.life/musubi-yakureki/receipt-computer — レセコン連携
- https://www.kakehashi.life/news-post/20240131 — 電子処方箋対応
- https://www.kakehashi.life/news-post/20250410 — オンライン資格確認情報の参照
- https://musubi.kakehashi.life/musubi-yakureki/linkage / https://musubi.kakehashi.life/product/product-linkage — 店舗間・薬局間連携
- https://musubi.kakehashi.life/musubi-yakureki/security — セキュリティ・データ管理
- https://musubi.kakehashi.life/musubi-insight — Musubi Insight
- https://musubi.kakehashi.life/blog/pc_technic_03 — 公式ブログ PC 時短術
