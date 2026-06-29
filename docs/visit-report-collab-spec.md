# 在宅薬剤管理 3機能（訪問時記録 / 報告書自動生成 / 多職種共有）全面リファクタ仕様書 — 算定要件カバレッジ駆動リビルド（強化版 v2）

_ultracode 仕様策定ワークフロー由来 (2026-06-29)。research 9プローブ(最新算定要件Web + コードベース) → 合成 → 多角的レビュー→revise(v2)。算定対象: 薬剤師居宅療養管理指導費(介護) + 在宅患者訪問薬剤管理指導料(医療)。FE=Claude / BE=Codex、相互レビュー。数値(単位/点数/回数/間隔)は告示・留意事項通知の原文で要確認、未確定は fail-close。_

## Executive Summary

本仕様は「訪問時に算定要件を満たす構造化データを漏れなく収集し、その収集データから算定要件を機械的にカバーする報告書を自動生成し、他職種への発信(到達証跡付き)と他職種からの受信(オフライン事前同期・FAX/紙取込含む)を訪問時機能へ双方向に還流させる」ことを目的とした、訪問時機能・報告書機能・多職種共有機能の FE+BE 全面リファクタを定義する。対象算定は薬剤師居宅療養管理指導費（介護保険）と在宅患者訪問薬剤管理指導料（医療保険）。careviax は既に構造化SOAP（薬学的評価シート7項目）・BillingEvidence・billing-requirement-validator・report-generator（決定論的4宛先生成）・オフライン基盤・S3 Object Lock を備え骨格は厚いが、(1)算定要件→必須capture→報告書セクション→ゲートの単一SSOTマッピングが4箇所に分散、(2)ManagementPlan/CareReport.content/structured_soap が緩いJsonで必須性を強制しない、(3)医師指示の構造化と『有効期間内か』の時間軸ゲート欠如、(4)麻薬/CV持続注射/CVN/乳幼児の根拠収集と自動判定の欠如、(5)報告書到達の『到達証跡(delivery_proof)』定義不在で hard gate が運用上機能しない、(6)介護の逐次ガード(各回ごと医師→ケアマネ、月まとめ不可)未実装、(7)単一建物患者数の月次動的計数の欠如、(8)特別患者(週2/月8枠)該当トリガ属性の capture 不在で月キャップ計算の入力が欠落、(9)レセプト摘要欄(算定根拠文字列)の生成経路が皆無、(10)記録の真正性(確定者の薬剤師免許束縛・確定後の訂正/追記ワークフロー・un-lock権限)と保存年限の起算点/管轄ルールが未整備、(11)他職種inboundの訪問時還流が一方向read-onlyかつオフライン未対応・FAX/紙経路なし、が主要ギャップ。本仕様は『BillingRequirementCatalog』を**型付き・codegen済みの共有モジュール(zod+生成TS)**として新SSOT化し、各 requirement_id が capture-path群・報告書セクション群・gate種別・payer・revision を必ず持つことを CI の property test で機械保証する。算定が成立した証跡は**レセプト摘要欄文字列(claim-record)**として出力し、摘要欠落自体を算定ゲートとする。なお算定単位/点数・回数上限・訪問間隔(中6日/2026週1回)・新設加算額などの数値は2024年6月(介護)/2026年(医療)改定に関するWeb二次情報に基づくため、告示・留意事項通知(老企第36号系/調剤点数表C008通知)原文での最終確認を前提とし、**未確定数値は fail-close(算定保留)を既定**として billing-rules/revisions に隔離する。

## 算定要件カバレッジ・マトリクス (32項目: 充足5 / 部分16 / 未充足11)

| 状態 | 算定費 | 要件 | 現状/ギャップ | アクション |
|---|---|---|---|---|
| partial | both | 医師(歯科医師)の訪問指示に基づき実施し、かつ訪問日が指示の有効期間内であること。指示なし/期間外は算定不可 [KYO-002/ZTK-01] | BillingEvidence.order_ref が自由参照文字列で指示医/指示日/指示内容/有効期間が構造化されず、処方経由の暗黙運用。さらに『指示の存在』チェックはあっても『訪問日が有効期間内か』の時間軸検証が無く、期限切れ・期間外訪問が claimable を素通りしうる(prisma/schema/admin.prisma:104 order_ref) | BE: 構造化 VisitInstruction(指示医ID/氏名/医療機関/指示日/指示内容/有効開始-終了日)を計画・訪問前確認に紐付け。order_ref を BillingRequirementCatalog の必須ゲート化し、加えて visit_date ∈ [valid_from, valid_to] の時間軸ゲートを追加(期間外=claimable false, 理由を摘要欄へ)。FE: 訪問前確認で指示有効期間を明示、期限切れは赤警告 |
| partial | both | 薬学的管理指導計画を原則患家訪問前に策定し、管理方法・副作用/相互作用確認・実施すべき指導内容・訪問回数・訪問間隔(医療は連携他医師の氏名/医療機関名も)を記載 [KYO-003/ZTK-02/REQ-MED-01/REQ-CARE-01] | ManagementPlan(patient.prisma:306)はあるが content が optional 配列+catchall で、訪問回数/間隔・管理方法・副作用相互作用確認・連携他医師が機械可読でない(src/lib/validations/management-plan.ts:4-14) | BE: ManagementPlanContent zod を planned_visit_frequency/visit_interval/medication_management_method/interaction_review/collaborating_physicians[] を含む構造へ拡張・必須化(版管理付き)。FE(訪問時): 訪問前確認で当該計画を必須参照、未策定は訪問記録開始をガード。報告書: 計画項目を報告書ベースラインへ転記 |
| partial | both | 訪問後/状態変化時に計画を見直す(介護=PDCA / 医療=少なくとも月1回以上見直し) [KYO-004/ZTK-03] | next_review_date(patient.prisma:322)は任意で、validator は next_review_date が存在する時のみ overdue を出すため月次見直し漏れが silent に通過しうる | BE: 医療保険患者は月次見直しを必須化し next_review_date 未設定でも overdue 判定。処方変更/他職種情報受領をトリガに見直しリマインド。版管理(plan revision)。FE: 訪問完了時に見直し要否を提示 |
| partial | both | 対象者要件: 要介護(要支援)認定+在宅+通院困難(介護は被保険者)/医療は患家16km以内 [KYO-001/ZTK-04] | 保険区分は持つが、通院困難フラグ・要介護度・16km距離判定が算定区分判定へ能動連動しているか不明 | BE: 患者に care_level/homebound_flag を構造化、医療は距離(>16km は例外事由を構造化記録し摘要欄へ出力)を判定。FE: 訪問時ヘッダで保険区分(医療/介護)と算定区分を能動提示 |
| partial | both | 利用者の居宅を実際に訪問し薬学的管理指導を実施(実施事実のエビデンス) [KYO-005/ZTK-13] | VisitRecord.visit_date は単一DateTimeで開始/終了/滞在時間カラムが無く、visit_geo_log は任意Json。同日複数回・算定監査の根拠が弱い(prisma/schema/visit.prisma:188-214) | BE: visit_started_at/visit_ended_at(+任意 geo)を構造化カラム追加。FE: 訪問開始/終了を片手操作でキャプチャ(既存 visit-location.ts opt-in geo を昇格) |
| partial | both | 訪問結果を速やかに薬剤管理指導記録(薬歴)へ記載。法定記載項目=訪問日/薬剤師名/処方医情報要点/実施した薬学的管理指導内容(保管/服薬/残薬/併用薬/体調変化/重複相互作用確認/服薬支援)/医師へ提供した要点/他職種共有要点。介護はオン資取得薬剤情報も記載 [KYO-006/ZTK-09/RPT-001/REQ-MED-02/REQ-COMMON-05] | structured_soap が実質をカバーするが単一Jsonで法定6項目の網羅性を強制せず、レガシー文字列SOAPとの二重保存、オン資薬剤情報フィールド無し | BE: 算定根拠フィールドを payer/visit_type 条件で superRefine 必須化(現状 .optional/.passthrough を厳格化, validations/structured-soap.ts:150)。オン資取得薬剤情報フィールド追加。FE: 完了チェックで法定6項目の不足を提示しゲート(getMissingHomeVisit2026CompletionItems 統合) |
| no | both | 薬剤管理指導記録の保存(医療=最後の記入日から3年/介護=完結後2年、自治体5年指定あり)。起算点(最終記入/契約終了/ケースクローズ)と管轄(自治体指定)を保持 [RPT-002/ZTK-09] | 一律5年方針で、report_type/保険区分別の retention_until・起算点定義・管轄ルールが CareReport/VisitRecord に無い | BE: retention_basis(最終記入/完結/契約終了) + jurisdiction(自治体) + retention_rule_id を保持し retention_until を算出。起算点イベント発生時に再計算。S3 Object Lock ライフサイクルへ反映。確定文書をWORM保存 |
| partial | both | 訪問結果を処方医へ文書(電子文書/PDF)で情報提供。複数医師連携時は主治医にも報告。提供の『到達』をチャネル別証跡で確認 [KYO-007/ZTK-08/RPT-004/REQ-MED-03] | physician_report を自動生成し送付(DeliveryRecord)できるが、到達を算定確定の hard gate にしておらず、かつ FAX/メール/会議での『到達』を何で確認するか(送信ログ/受領確認/会議出席)が未定義のため hard gate が運用上機能しない。billing-evidence.report_delivery_ref は参照のみ | BE: delivery_proof_type(system_send_log/recipient_ack/conference_attendance/fax_confirmation)を捕捉し、準拠する証跡のみ hard gate にカウント。report_delivery_ref を BillingRequirementCatalog の必須ゲート化。提供日/提供先/手段/要点/証跡型を構造化トレース。FE: 報告書送付・到達状況を算定候補画面で可視化 |
| partial | 居宅療養 | 介護保険算定時はケアマネジャーへケアプラン作成に必要な情報提供を実施。情報提供がない月は算定不可。会議参加が基本、困難時は別紙様式1/2でメール/FAX可 [KYO-008/RPT-005/REQ-CARE-02] | payer_basis==='care' 時に care_manager_report を自動追加生成(report-generator.ts:366)するが、到達が算定ゲートでなく、提供手段(会議 vs 別紙様式)区別・到達証跡が無く、CareManagerReportContent に月訪問回数/服薬管理者/併用薬の構造化欄が無い(care-report-content.ts:70-105) | BE: CareManagerReportContent に monthly_visit_count/medication_manager/concomitant_meds 追加。提供手段(conference/document様式1/2) + delivery_proof_type を記録。ケアマネ未提供=介護算定不可の hard gate。FE: ケアマネ向け別紙様式テンプレ出力 |
| no | 居宅療養 | 介護: 月複数回算定でも1ヶ月分まとめ報告は不可。各回ごとに医師報告→ケアマネ情報提供を行わないと当該回を算定不可 [RPT-006] | 訪問単位の逐次ガード(各回ごと医師→ケアマネのシーケンス充足)が業務フローに組み込まれていない | BE: 訪問(回)単位で『医師報告済(到達証跡)→ケアマネ提供済(到達証跡)』を確認するシーケンスゲートを実装し、未充足の回を claimable false に |
| partial | both | 単位/点数を単一建物区分で算定(介護: 1人=518/2-9=379/10+=342単位 ; 医療: 1人=650/2-9=320/10+=290点) [KYO-010/ZTK-05] 要確認(改定数値) | 区分値・billing-rules(types.ts building_tier)は持つが、tierの根拠(building_patient_count)が静的入力に依存 | BE: 数値は改定告示で要確認(未確定は fail-close)。tier 判定を月次動的計数に接続。FE: 算定区分を訪問時/算定候補画面に表示 |
| partial | both | 単一建物患者数の計数(同一建物で自薬局が訪問指導算定する人数。介護分と医療分は別計数、GHはユニット単位、特例で1人扱い) [ZTK-06/REQ-MED-04/REQ-CARE-03] | single_building_*_count が手入力の静的患者属性で、実VisitRecord/BillingCandidateからの月次動的計数でない(patients/[id]/route.ts:711-719)。GHユニット/特例未反映 → tier誤分類リスク | BE: 請求月ごとに実訪問実績から建物別患者数を動的算出するサービスを新設し、payer別計数・GHユニット・特例(同一世帯/戸数10%以下/20戸未満2人以下)を encode。算出根拠を摘要欄へ。FE: 算定候補で算出根拠を表示 |
| no | 居宅療養 | 情報通信機器(オンライン服薬指導)=介護46単位。対面分と合算して月4回上限内 [KYO-011] | validator は VisitSchedule 行を数えており、オンライン分が月4回上限カウントへ合算されているか不明 | BE: オンライン服薬指導セッションを別 visit_type で記録しつつ、月次キャップ計数に合算。間隔ルール対象判定も統合。カウンタ変化時に claimable 再計算 |
| partial | both | 月の算定回数上限(原則4回/月。がん末期・注射麻薬・中心静脈栄養は週2回かつ月8回。医療は在宅緊急訪問・在宅相当服薬管理指導料と通算。薬剤師は週40回) [KYO-012/ZTK-07/REQ-MED-05] 要確認 | validator が monthly_cap/special_patient_weekly_cap/pharmacist_weekly_capacity を検証する想定だが、(a)枠を引き上げる特別患者トリガ属性の入力源が無く判定不能、(b)合算すべきオンライン分(KYO-011=no)・緊急訪問通算(ZTK-12)が未統合のため、現状の充足判定は時期尚早 | BE: SpecialPatientStatus を唯一の入力源として週2/月8枠を判定。オンライン分・緊急訪問分を月/週カウンタへ統合してからゲート確定。カウンタ入力変化で claimable 再計算トリガ。数値は改定で要確認 |
| no | both | 特別患者該当(がん末期/注射麻薬使用/中心静脈栄養法/心不全・呼吸不全等)の構造化。週2回・月8回枠の引き上げ判定の唯一の入力源 [KYO-012/ZTK-07] 条件付 | 枠を引き上げるトリガ属性を捕捉するフィールドが訪問時capture・BillingEvidenceに無く、誰がこのフラグを立てるか(薬剤師が訪問/計画策定時に設定)が未設計。特別患者該当事由のレセプト摘要欄出力も無い | BE: SpecialPatientStatus(構造化 capture: 該当区分/根拠/設定者=薬剤師/設定日)を追加し special_patient_weekly_cap 判定の唯一の入力源に。該当事由を摘要欄(claim-record)へ出力。FE: 計画策定/訪問時に薬剤師が設定 |
| no | both | レセプト摘要欄/算定根拠記載(単一建物患者数・16km超の理由・緊急訪問料1/料2の事由・特別患者該当事由・指示有効期間外の例外等)の出力。個別指導/監査対応に必須 [新規 CLAIM-01] | claimable 真偽は出すが、摘要欄に記載すべき算定根拠文字列の生成経路が無く、billing matrix にも schemaChanges にも現れない | BE: BillingEvidence から摘要欄文字列を生成する claim-record projector を新設。必須摘要の欠落自体を算定ゲートとして扱う(摘要欠落=claimable false)。要件→摘要テンプレは BillingRequirementCatalog に encode |
| partial | both | 複数回算定時の訪問間隔(従来=中6日以上。2026医療=週1回整理の論点) [KYO-013/ZTK-07/ZTK-14] 要確認 | 間隔ルールが算定ロジックに完全実装されているか不明確 | BE: 算定日の間隔ゲート(中6日/週1回)を実装。オンライン分も間隔判定対象に統合。2026『週1回』整理・夜間休日連絡体制は告示確定値で要確認とし fee-rules 更新フローで反映 |
| partial | both | 同一月に医療(在宅患者訪問薬剤管理指導料)と介護(居宅療養管理指導費)の併算定不可。介護被保険者は原則介護優先 [KYO-017] | payer_basis(medical/care/mixed)と same_month_exclusion_flags は持つが排他制御の網羅性要確認 | BE: payer区分の同月排他を BillingRuleConditions.exclusive_with で強制。混在月の優先判定を明示 |
| yes | both | 患者同意を取得し、当該薬局が調剤した薬剤の服用期間内に訪問。介護は重要事項説明/契約/個人情報(同意)文書の事前交付 [ZTK-13/REQ-CARE-04/RPT-011] | ConsentRecord + findActiveVisitConsent で同意検証、validator consent_expired_or_missing あり | 維持。APPI要配慮個人情報として他職種共有(第三者提供)時に加え、inbound受領・onward sharing 時も同意状態/利用目的/提供記録を確認・記録(ConsentRecord連動)。FE: 訪問時に同意状態を提示 |
| yes | both | 各訪問で残薬の有無確認/服薬状況/保管状況/有害事象モニタリング/重複処方・相互作用確認(処方変更対応) [REQ-COMMON-05] | structured-soap.ts + CDS check route がカバー。ただし残薬は非構造の写真添付に留まり構造化照合の機会を逃している | 維持。完了ゲートで必須化。残薬は QR/バーコード(@zxing)で薬剤現品照合し ResidualMedication テーブルへ構造化(structured_soap との二重保存を canonical 一本化, ARCH-3) |
| no | both | 麻薬管理指導加算(介護100単位/医療100点・オン22点): 麻薬の保管/服薬/残薬状況確認・取扱い指導・処方医情報提供 [KYO-014/ZTK-10] 条件付 | 麻薬の保管/服薬/残薬/取扱い指導/処方医情報提供を構造化する加算根拠フィールドが無い → 自動判定/報告書反映不可 | BE: NarcoticGuidanceEvidence を structured_soap に追加し加算コードをマスタ化。処方の麻薬区分から加算候補を自動提示。FE: 麻薬該当患者でセクション表示 |
| no | 居宅療養 | 医療用麻薬持続注射療法加算(介護250単位/回, 2024新設): 投与・保管状況・副作用確認 [KYO-015] 条件付 | 該当する構造化キャプチャ・加算判定が無い | BE: ContinuousNarcoticInfusionEvidence 追加+加算コードマスタ化。FE: 該当時セクション表示。数値要確認 |
| no | 居宅療養 | 在宅中心静脈栄養法加算(介護150単位/回, 2024新設): 投与・保管状況・配合変化確認 [KYO-016] 条件付 | 該当する構造化キャプチャ・加算判定が無い | BE: HomeCentralVenousNutritionEvidence(配合変化確認含む)追加+加算コードマスタ化。FE: 該当時セクション表示。数値要確認 |
| no | 在宅訪問 | 乳幼児加算(医療100点・オン12点): 6歳未満の在宅乳幼児への直接指導 [ZTK-11] 条件付 | 患者年齢(<6歳)からの加算候補自動提示が validator のアラート型に無い | BE: 患者生年月日から乳幼児加算候補を自動判定し算定候補へ提示 |
| no | 居宅療養 | (要確認)介護: 特別地域加算/中山間地域等における小規模事業所加算/中山間地域等に居住する者へのサービス提供加算等の地域系加算の適用可否 [新規 AREA-01] 条件付 | 麻薬/CV/CVN/乳幼児加算は拾うが地域系加算は一切検討されていない。居宅療養管理指導が対象外なら不要だが、適用される場合は遠隔地訪問の加算判定が完全欠落 | BE: まず居宅療養管理指導費に地域系加算が適用されるか告示で要確認(openQuestions)。適用される場合は事業所所在地・患者居住地から地域区分を判定する加算候補ロジックを billing-rules/revisions に追加。非適用なら明示的に対象外と記録 |
| partial | 在宅訪問 | 在宅患者緊急訪問薬剤管理指導料(料1=500点 計画対象疾患急変/料2=200点 対象外症状)。医師指示+訪問後文書情報提供、月4/8回枠へ通算。cycle非依存の臨時/緊急訪問でも報告書生成と算定が成立すること [ZTK-12] 条件付 | emergency_regular_concurrent アラートはあるが、料1/料2区分入力・判定・月枠通算が未確認。さらに cycle_id 無し(delivery_only/temporary/緊急)訪問は VISIT_SCHEDULE_CYCLE_REQUIRED_FOR_REPORT で報告書生成が弾かれ、文書情報提供が算定要件の緊急訪問が宙に浮く | BE: 緊急訪問に urgency_tier(料1/料2)+急変事由を構造化(摘要欄出力)、月4/8回枠へ通算。cycle非依存訪問でも報告書生成経路を保証(cycle_id を任意化し ad-hoc visit から生成可能に)。FE: 緊急訪問記録フロー |
| partial | both | 電子保存の真正性: 作成者・確定者・確定時刻・変更履歴を保持し、確定(finalize/lock)後の改ざんを防止。確定者は実際に訪問した薬剤師(免許保持者)に束縛。確定後の訂正・追記は理由/実施者/時刻付きの新版として履歴保持、un-lock権限を限定 [RPT-007/ARCH-10] | ReportStatus に confirmed はあるが sent と区別した finalize/lock セマンティクスが曖昧で確定者フィールドが無い(created_by のみ, communication.prisma:136)。確定後の訂正/追記ワークフロー(訂正理由・訂正者・時刻・un-lock権限)も未設計 | BE: finalized_by(薬剤師免許検証付き)/finalized_at を追加し確定後 content をロック。訂正/追記は amend_reason/amended_by/amended_at 付きの新版(version chain)として残し、un-lock は限定ロール+監査記録必須。AuditLog で全アクセス記録。MHLW v6.0 第7章 真正性準拠 |
| yes | both | 見読性: 報告書/記録を直ちに画面表示し書面(PDF)出力可能。PDFはS3保存+Presigned URLで安全取得 [RPT-008] | @react-pdf/renderer で confirmed のみ PDF 出力、S3保存実装済(pdf-documents.tsx:1465) | 維持・拡張。型ガード fallback の後方互換(content_schema_version)を強化 |
| partial | both | 保存性: 確定文書をWORM(S3 Object Lock)で改ざん・削除不可とし法定年限ライフサイクルで不変保存 [RPT-009] | S3 Object Lock は存在するが、保険区分別 retention・起算点に応じたライフサイクル分岐が明示されていない | BE: retention_basis/jurisdiction から算出した retention_until に基づく Object Lock ライフサイクル分岐(医療3年/介護2年/監査ログ5年/自治体5年指定) |
| no | both | 報告書全体の真正性担保強化: 確定PDFへ電子署名・認定TSA(時刻認証業務認定)タイムスタンプ付与 [RPT-010] 任意(将来要件) | 電子署名・認定TSA未実装。schemaコメントも将来拡張止まり | BE: 署名/タイムスタンプ付与の pluggable インターフェースを設計(実装はフェーズ後半)。MHLW v6.0 Q&A(2025-05)準拠。要確認(認定TSA事業者選定) |
| yes | both | 報告書生成根拠の追跡(source_provenance: visit_record_id/version, prescription_line_ids, billing_evidence_id 等 + billing_context) [REP-007] | report-generator が source_provenance/billing_context を content に埋込済(report-generator.ts:389-454) | 維持。CareReport.visit_record_id を実FKリレーション化(現状素のString, communication.prisma:125)し参照整合性をDB制約で担保(ARCH-5) |
| yes | both | 報告書生成・編集は薬剤師(canAuthorReport)に限定し事務職の作成を遮断 [REP-008] | generate-from-visit API が permission:canAuthorReport で保護済(route.ts:112) | 維持。finalize(確定)も薬剤師免許保持者に限定(finalized_by 束縛) |

## セクション

### 1. 目的と算定要件カバレッジ方針

## 1.1 目的
3つの密結合機能（訪問時記録 / 報告書自動生成 / 多職種共有）を、**「算定要件カバレッジ」を第一級の設計制約**として全面リファクタする。

1. **訪問時** = 算定要件を満たすために必要な構造化データを、スマホ/タブレット主・PC併用で**漏れなく収集**する。QR現品照合・端末センサ/POCデバイス連携で手入力を減らす。
2. **報告書** = 収集データから算定要件を**機械的にカバーする報告書を自動生成**し、PCでオーサリング・確定する。算定が成立した根拠は**レセプト摘要欄文字列(claim-record)**として併せて出力する。
3. **多職種共有** = 発信(到達証跡付き)を容易にし、受信情報(オフライン事前同期・FAX/紙取込含む)を**訪問時機能へ双方向に還流**させる。

## 1.2 カバレッジ方針: BillingRequirementCatalog を『型付き・codegen済みの共有SSOT』に
算定要件ロジックは `home-visit-2026-evidence.ts` / `billing-rules`(types.ts/rule-engine.ts) / `report-templates.ts` / `billing-requirement-validator.ts` の **4箇所に分散**している(ARCH-1)。これを下記の単一マッピング層へ統合する。批判で指摘された通り、抽象的な『文字列パス参照』のままでは stringly-typed 結合で脆いため、**zod スキーマ + そこから codegen した TS 型を持つ共有モジュール**として実装し、FE/BE は同一生成物を import する。

```ts
// 形状(サンプル1件)
interface BillingRequirement {
  requirement_id: 'KYO-002';
  payer: ('medical'|'care')[];
  revision: '2024-06-care' | '2026-medical' | ...;
  capture_paths: CapturePath[]; // 型安全な discriminated union (structured_soap.* / management_plan.* / visit_instruction.* 等)。生keyの文字列ではなく enum + パスビルダで参照
  report_sections: { report_type: ReportType; section: ReportSection }[];
  gate: 'hard' | 'warning';
  claim_note_template?: ClaimNoteTemplate; // 摘要欄文字列の生成テンプレ
}
// 例: KYO-002(医師指示)
{ requirement_id:'KYO-002', payer:['medical','care'], revision:'2026-medical',
  capture_paths:[ CP.visitInstruction.validFrom, CP.visitInstruction.validTo, CP.visitInstruction.physicianId ],
  report_sections:[{report_type:'physician_report', section:'prescriber'}],
  gate:'hard',
  claim_note_template: { kind:'instruction_out_of_period', render: (e)=>`指示有効期間外訪問: 事由 ${e.exception_reason}` } }
```

**機械保証(CI property test, §8)**: (a)全 requirement_id が capture_paths群 + report_sections群 + gate種別 + payer + revision を持つ、(b)全 hard-gate に対応する claimable チェックが BE 側に存在する、(c)摘要欄が要る要件は claim_note_template を持つ、(d)capture_path は実 StructuredSoap/ManagementPlan/VisitInstruction の zod スキーマに解決可能、を型レベル+テストで検証する。これにより「報告書が算定要件をカバーする」ことを**コードではなくデータ+テストで機械保証**でき、改定差分は Catalog の差し替えで吸収する。

## 1.3 確からしさと『要確認数値』の運用設計
単位/点数・回数上限・訪問間隔(中6日/2026週1回)・新設加算額の**数値**は Web 二次情報に基づくため、告示・留意事項通知(老企第36号系/調剤点数表C008通知/MHLW改定概要PDF)原文での最終確認を要する(要確認)。

- **未確定数値の既定挙動 = fail-close(算定保留)**: revision データに `confirmed: false` を持つ数値が claimable 計算に関与する場合、その算定候補は『要原文確認』ステータスで**保留**し、暫定 pass させない。
- **更新オーナーと確定フロー**: 数値は `billing-rules/revisions/<revision>.ts` に隔離し、各エントリに source(告示番号/通知名)・confirmed フラグ・確認者・確認日を持たせる。原文確認は人間承認(両 supervisor 合意)を経て `confirmed:true` へ昇格し、誤った数値で算定が静かに通らないようにする。

本仕様の構造設計は数値非依存で成立させ、数値は revision データに完全分離する。

### 2. 訪問時機能（capture-first: スマホ/タブレット優先 + PC併用）

## 2.1 役割分担とデバイスモード(タブレット明確化)
- **capture-first デバイス(スマホ/タブレット)** = 算定要件を満たす**構造化データ収集に特化**。屋外・片手・グローブ・電波不安定前提。
- **PC(帰着後)** = report オーサリング(§3)。
- 既存レスポンシブは md+ で PC 寄りレイアウトを描画するため、**横向きタブレットが md+ に入りオーサリングUIになる矛盾**を解消する: デバイス幅だけでなく**役割(capture/authoring)を明示トグル**で切替可能にし、タブレットは既定 capture-first として扱う(MUX-01/06)。44px タッチターゲット(coarse=min-h-44px, test-lock済)を踏襲。

## 2.2 取得すべき構造化データ(算定要件駆動)
既存 `StructuredSoap` を維持しつつ以下を追加・必須化:

| 追加項目 | 目的(算定要件) |
|---|---|
| `VisitInstruction`(有効期間付き)参照表示 | 医師指示+期間内判定(KYO-002/ZTK-01) |
| ManagementPlan 訪問前参照 | 計画策定(KYO-003/ZTK-02) |
| `visit_started_at`/`visit_ended_at`(+geo) | 実訪問エビデンス(KYO-005/ZTK-13) |
| オン資取得薬剤情報 | 介護の薬歴記載義務(KYO-006) |
| `SpecialPatientStatus`(がん末期/注射麻薬/CV栄養/心不全・呼吸不全) | 週2/月8枠判定の唯一の入力源(KYO-012) |
| `NarcoticGuidanceEvidence` 他3加算根拠 | 麻薬/CV持続注射/CVN加算(KYO-014/015/016) |
| 残薬の QR/バーコード現品照合 | 残薬構造化(REQ-COMMON-05) |
| 法定記録6項目の網羅フラグ | 薬剤管理指導記録(RPT-001/ZTK-09) |

zod 検証は `.optional/.passthrough` を **payer_basis/visit_type に応じた superRefine で条件付き必須化**(ARCH-7)。完了時に未充足を fail-close。

## 2.3 入力負荷軽減(構造化収集の核)
- **QR/バーコード現品照合(@zxing)**: 残薬・薬剤現品を `@zxing/browser` でスキャンして構造化 capture へ。残薬を非構造の写真添付から**構造化照合**へ昇格し ResidualMedication canonical へ書込(『自動収集』の実機会, MUX-12 新規)。
- **POCデバイス連携**: 血圧計/SpO2/体重計など対応機器からのバイタル取込インターフェースを設計(BLE/手入力フォールバック)。看板『構造化データの自動収集』に対しバイタル手入力依存を緩和(MUX-13 新規, 機器選定は要確認)。
- **タップで構造化**: 残薬数/バイタルは大型ステッパ/プリセットチップ/inputmode=numeric。屋外/グローブ最適化として**サンライト高輝度モード・大型フォントトグル・触覚フィードバック**を追加(MUX-09 強化)。
- **音声→STT→SOAP射影(2.3.1 でegress方針を先決)**。

### 2.3.1 STT のデプロイ方針(PHI egress を先に決定)
executive summary が掲げる『自動収集』の中核に STT を据えるなら、**PHI音声を外部API(汎用Amazon Transcribe等)へ素送信しない**ことを先に確定する。gbrain 埋め込みをローカル ollama 化した egress 教訓と整合させ、以下のいずれかを採用する:
- (推奨) **オンデバイス/オンプレ STT**、または **no-retention 契約 + VPC内(ap-northeast-1)Transcribe** を BAA/契約担保のうえ採用。
- 上記が満たせない場合、STT は出荷せず**口述メモ→帰着後手入力**に留める。
看板目標との乖離を避けるため、STT を出荷可能と判断した段階で P3 相当へ前倒しする(下記 1.0 参照)。決定論的収集に留める場合は executive summary を実態に合わせて再スコープ済み(本版は『漏れなく収集』に修正)。

## 2.4 オフライン(電波不安定な患家) — inbound prefetch / outbound queue を一本化
既存基盤(Dexie v9 + sync-engine 409競合退避 + AES-GCM暗号化下書き + Serwist)を維持。改善:
- **inbound 事前同期(prefetch)**: §4 の `multidisciplinary_updates/unresolved_items/must_check_today` を**暗号化オフラインストアへ訪問前に prefetch**し、オフライン患家でも最新 inbound を参照可能に(双方向の要, mobile/bidi 重複指摘の核)。
- **outbound キュー一本化**: 残薬写真・QR照合・**その場 outbound 共有送出(§4.1)**を、記録本体と**同一同期キュー**へ載せる(MUX-05/11 強化)。capture=オフライン可 / visit-attachments=オンライン必須 の非対称を解消。
- **autosave短縮**: 30秒間隔を onBlur/フィールド確定+短間隔(例10秒)へ(MUX-02)。
- 端末保持PHIは要配慮個人情報→暗号化必須、鍵欠如は fail-close(MUX-03, 3省2GL/APPI)。

## 2.5 他職種情報の還流表示(受信→訪問時, §4と連動)
`visit-brief` が集約する inbound を訪問ウィザード該当ステップ本文へ流し込み(オフライン prefetch 済), 訪問中に参照反映。`PatientCareTeamSourcePanel` の双方向導線を強化(MUX-11/RPT-012)。

## 2.6 完了ゲート
`getMissingHomeVisit2026CompletionItems` を BillingRequirementCatalog 起点に統合し、**算定要件未充足は訪問完了をブロック**(VR-05/MUX-10)。保険区分別の必須項目差・単一建物区分・特別患者該当を訪問時UIで能動分岐提示する。

### 3. 報告書機能（PC・算定要件カバレッジ + 摘要欄生成 + 確定/訂正ワークフロー）

## 3.1 自動生成パイプライン
`POST /api/care-reports/generate-from-visit` → `generateReportsFromVisit`(決定論的)を維持しつつ、635行モノリスを **data-loader / content-projector / billing-coverage-checker / claim-record-projector / persister(楽観ロック)** に責務分離(ARCH-8)。payer_basis による宛先自動選択を維持。

**cycle非依存生成の保証**: `VISIT_SCHEDULE_CYCLE_REQUIRED_FOR_REPORT` で delivery_only/temporary/緊急訪問の報告書生成が弾かれる問題を解消し、**cycle_id を任意化**して ad-hoc/緊急訪問からも生成可能にする。緊急訪問薬剤管理指導料(料1/料2)は文書情報提供が算定要件のため、生成経路を必ず通す。

## 3.2 算定要件を『満たす』生成 + レセプト摘要欄(claim-record)
現状の算定要件チェックは**記載の有無止まり**。これを **BillingRequirementCatalog 連動の coverage-checker** へ置換し、各 requirement_id について「必須capture充足」「対応報告書セクション充足」を判定、未充足は warning ではなく**確定/送付ブロックの hard gate**。

加えて **claim-record-projector** を新設し、BillingEvidence から**レセプト摘要欄文字列**(単一建物患者数・16km超の理由・緊急訪問tier事由・特別患者該当事由・指示期間外の例外事由)を生成する。摘要が必要な要件で摘要が欠落していること自体を**算定ゲート**として扱う(摘要欠落=claimable false)。

## 3.3 決定論生成の限界と質担保(LLMブリッジの位置づけ)
coverage-checker は capture/section の**有無**判定に留まり、自由記述SOAPの自然文要約・抜け漏れの意味的橋渡しは決定論では解けない。本仕様は次の二層で質を担保する:
- **構造化必須**(決定論・出荷対象): 算定に効く項目は自由文ではなく構造化フィールドへ収集し、coverage を構造で判定。これが算定の正本。
- **意味的ブリッジ(任意・補助)**: 自由文要約・抜け漏れ提案は**薬剤師レビュー前提の下書き支援**として分離し、生成テキストをそのまま算定根拠にしない。導入する場合も PHI egress 方針(§2.3.1)に従う。決定論で担保できない範囲は openQuestions に明示。

## 3.4 様式
- **医師向け(physician_report)**: 日本薬剤師会『在宅患者訪問薬剤管理指導ガイド』別添報告様式に準拠(KYO-009 参考様式)。
- **ケアマネ向け(care_manager_report)**: 既存項目 + **月訪問回数/服薬管理者/併用薬(OTC等)** を構造化追加(REQ-CARE-02)。会議参加 or 別紙様式1/2 + delivery_proof_type を区別記録。
- nurse_share/facility_handoff/family_share/internal_record の自動生成・手編集の欠落を補完。

## 3.5 編集・確定・訂正・PDF・送付
- **編集**: ReportEditForm を全 report_type へ拡張。PATCH 楽観ロック維持。
- **確定(finalize)**: sent と区別した明示 finalize 状態 + `finalized_by`(**薬剤師免許保持者に束縛**)/`finalized_at` を追加し、確定後 content をロック。
- **確定後の訂正・追記ワークフロー**: lock 後の訂正/追記は**理由(amend_reason)・実施者(amended_by)・時刻付きの新版**(version chain)として残し、旧版は不変保持。un-lock は限定ロール+監査記録必須(MHLW 真正性: 訂正履歴の保持)。
- **PDF**: confirmed のみ出力(維持)。`content_schema_version` で後方互換。
- **送付/到達**: DeliveryRecord/CareReportSendRequest(冪等化)維持。**到達(delivery)はチャネル別に `delivery_proof_type`(system_send_log/recipient_ack/conference_attendance/fax_confirmation)で定義**し、準拠証跡のみ hard gate にカウント(§4.3)。介護は §4 の逐次ガード(各回ごと医師→ケアマネ、月まとめ不可)を制御。

### 4. 多職種共有機能（双方向 + FAX/紙 + 到達証跡 + 通知）

## 4.1 発信(outbound)の容易さ
既存 `interprofessional-share`/`visit-handoff`/`communication-requests`/`external-share` を維持。報告書 content から相手区分別射影(REP-010)。
- 訪問中の申し送りを**その場で outbound 共有へ送出**(オフライン時は §2.4 の同一同期キューへ, MUX-11)。
- ケアマネ向けは別紙様式1/2テンプレ + メール/FAX手段を記録。

## 4.2 受信(inbound)の訪問時還流(双方向の要)
現状 inbound(tracing-reports/partner-visit-records/communication-requests返信/conference-data-sync/PatientSelfReport)は **read-only 集約**で往復しない(ARCH-6)。
- **FAX/紙 inbound の取込経路**: 多くの医師/ケアマネは FAX・紙で返信するため、**OCR/手入力での inbound digitization 経路**を新設し、デジタルパートナー前提を解消(COLLAB-01 新規)。
- **inbound到着の通知/プッシュ**: 訪問前に新着 inbound を薬剤師が知る手段(プッシュ/バッジ/`must_check_today` への配信トリガ)を設計(COLLAB-02 新規)。
- **往復リンクのモデル化(多対多)**: `resolved_visit_record_id` の 1:1 は『inbound1件が複数訪問にまたがる/訪問外でクローズ/どの訪問にも紐づかない』を表現できないため、**inbound↔訪問の多対多 解決リンク + resolution_status**(open/in_visit/resolved_outside_visit/not_applicable)へ緩める(ARCH-6 改)。
- inbound内容を**次回訪問の must-check / structured_soap チェック項目 / 計画見直しトリガ**へ構造的に流し込む。

## 4.3 到達(delivery)と受領(receipt)のセマンティクス
- **到達証跡(delivery_proof_type)**: system_send_log / recipient_ack / conference_attendance / fax_confirmation をチャネル別に定義。hard gate(医師/ケアマネ提供)は**準拠証跡が揃ったもののみカウント**し、単なる送信試行では claimable に効かせない。
- **outbound の受領/既読クローズループ**: inbound→対処→クローズだけでなく、**自薬局発信が相手に受領・対応されたか**の戻りループ(acknowledged/responded)をモデル化し、未受領を可視化(COLLAB-03 新規)。

## 4.4 inbound/onward sharing の APPI 法的根拠
他職種からの情報受領(inbound)、および inbound 由来情報の更なる第三者提供(onward sharing)時の**同意/利用目的を ConsentRecord と連動**して確認・記録する。現状 outbound 偏重の同意連動を inbound/onward へ拡張(RPT-011 強化)。

## 4.5 命名整合
`ReportType`(nurse_share/facility_handoff) と `ReportAudience`(visiting_nurse/facility) の命名不一致を整理(ARCH-4)。

### 5. データモデルと共有コントラクト

## 5.1 中核課題(ARCHプローブ)
1. **算定要件SSOTの分散** → BillingRequirementCatalog(型付き/codegen)へ統合(§1.2)。
2. **Json多用で型非強制** → ManagementPlanContent / CareReport.content / StructuredSoap を zod でDB契約化し `content_schema_version` 付与。
3. **SOAP/残薬の二重保存** → SOAP: レガシー文字列カラムは structured_soap 派生・読取専用化(ARCH-2)。残薬: ResidualMedication を canonical 一本化(ARCH-3)。
4. **CareReport.visit_record_id が非FK** → 実FKリレーション化し partner_visit_record_id と対称化(ARCH-5)。
5. **inbound連絡の往復未モデル化** → §4.2 多対多解決リンク追加(ARCH-6 改)。

## 5.2 共有コントラクト(FE↔BE契約)
- `BillingRequirementCatalog`(新, 共有モジュール, zod+codegen TS) = requirement_id→capture_paths(型安全)→report_sections→gate→claim_note_template→payer×revision。FE(完了ゲート/算定区分提示)とBE(coverage-checker/validator/claim-record-projector)が**同一生成物を import**。
- `StructuredSoap`(src/types/structured-soap.ts)+zod(superRefine 条件必須) = 訪問capture SSOT。SpecialPatientStatus/加算根拠/QR残薬照合を含む。
- `*ReportContent`(src/types/care-report-content.ts)+zod+content_schema_version = 報告書content契約。
- `BillingEvidence`(admin.prisma:104) = 訪問単位算定証跡。order_ref/consent_ref/management_plan_ref/report_delivery_ref を構造化参照+claimableゲートへ昇格。delivery_proof_type を保持。
- `ClaimRecord`(新) = 摘要欄文字列のプロジェクション。

## 5.3 単一建物患者数の月次動的計数(新サービス)
静的 single_building_*_count を、請求月ごとに実 VisitRecord/BillingCandidate から建物別に動的算出するサービスへ置換。payer別計数・GHユニット・特例(同一世帯/戸数10%以下/20戸未満2人以下)を encode。算出根拠を摘要欄(ClaimRecord)へ出力。

## 5.4 保存年限ルールの構造化
単一 retention_until 日付に潰さず、**retention_basis(最終記入/完結=ケースクローズ/契約終了)+ jurisdiction(自治体)+ retention_rule_id** を保持し、起算点イベント発生時に retention_until を再計算する(§6.1)。

### 6. コンプライアンス（3省2GL / APPI / 電子署名・保存）

## 6.1 3省2ガイドライン(MHLW v6.0)電子保存3基準
- **真正性**: 作成者・確定者(薬剤師免許束縛)・確定時刻・変更履歴を保持し、finalize後の改ざんを防止。`finalized_by/finalized_at` + 確定ロック。**訂正/追記は理由・実施者・時刻付きの新版**として履歴保持、un-lock は限定ロール+監査。AuditLog で全アクセス記録。RLS(`SET LOCAL app.current_org_id`)テナント分離を全経路で維持(ARCH-10)。
- **見読性**: 即時画面表示・PDF出力。S3保存+Presigned URL(実装済)。
- **保存性**: 確定文書をWORM(S3 Object Lock)で不変保存。**保存年限は起算点+管轄ルールで算出**: 医療=最後の記入から3年/介護=完結(ケースクローズ)後2年/監査ログ5年/自治体5年指定は jurisdiction 設定で上書き。retention_basis の起算点イベントで再計算しライフサイクル分岐(MHLW-7.1.3/7.2.1)。

## 6.2 電子署名・認定タイムスタンプ
確定PDFへ電子署名 + 認定TSA タイムスタンプ付与の **pluggableインターフェース**を設計(実装は後半フェーズ, RPT-010)。誰の鍵で署名するか(Cognito/KMS連携)・認定TSA事業者選定は要確認。

## 6.3 APPI 要配慮個人情報
- 端末一時保持PHI(SOAP下書き/写真/音声/inbound prefetch)はAES-GCM暗号化、鍵欠如は fail-close(MUX-03)。
- **STT音声のegress禁止/制限**(§2.3.1): 外部API素送信を中核に据えない。
- 他職種共有(第三者提供)に加え、**inbound受領・onward sharing 時も**同意状態/利用目的/提供記録を ConsentRecord と連動確認・記録(RPT-011/§4.4)。

## 6.4 ハードストップ
auth/billing確定ロジックの破壊的変更・破壊的migration・本番deployは承認なしに触らない(.agent-loop/BLOCKED.md 系運用)。

### 7. 既存からの移行/リファクタ方針

## 7.1 非破壊・段階移行の原則
既存の強い骨格(structured_soap / BillingEvidence / report-generator / オフライン / Object Lock)は温存し、上に被せる。schema変更は**追加カラム→デュアルライト→バックフィル→カットオーバー→旧カラム廃止**の順で、各段階を reviewed slice に。

## 7.2 zod warning→enforce 切替の判定基準とバックフィル検証
P1/P2 の厳格化は warning 先行→enforce 切替で行うが、批判の通り判定基準を明文化する:
- **enforce 切替条件**: (a)対象 org の直近Nヶ月の新規 capture で必須フィールド充足率 ≥ 閾値(例99%)が連続継続、(b)既存データのバックフィル不整合(欠落/型不一致)を検出するスキャンジョブが残件0、(c)coverage property test(§8)green。
- **バックフィル検証戦略**: 旧→新変換のドライラン → 差分レポート(不整合行リスト) → 手動補正 or 既定値ルール → 再スキャン。enforce 後も warning 期間のメトリクスを保持しロールバック判断材料に。

## 7.3 破壊的migrationのロールバック方針
P7(CareReport.visit_record_id FK昇格 / 残薬一本化 / レガシーSOAP削除)は本番バックフィルを伴う。各 migration に: (a)前方=デュアルライト期間中はいつでも旧経路へ戻せる、(b)カットオーバー後の rollback はスナップショット復元 + 逆変換スクリプト、(c)削除系は『読取専用化→一定観測期間→削除』の3段で、削除前に必ず観測期間を置く。実行タイミングとロールバック手順を人間承認(§openQuestions)。

## 7.4 レーン分割と巨大コンポーネント分解
- FE(Claude lane): visit-record-form.tsx(2494行)/reports/[id]/page.tsx(1682行) を責務分離。
- BE(Codex lane): report-generator.ts(635行)の分割、billing検証層の Catalog 統合、claim-record-projector。
- maker/checker分離を維持し、objective gate(lint/typecheck/test/build)で最終判定。

### 8. 検証・テスト戦略（中心主張の機械保証）

中心主張『報告書が算定要件を機械的にカバーする』を担保するテストを仕様に含める(批判の最重要指摘)。

## 8.1 Catalog 構造の property test(CI必須)
- 全 requirement_id が capture_paths群 + report_sections群 + gate + payer + revision を持つ。
- 全 capture_path が実 StructuredSoap/ManagementPlan/VisitInstruction zod スキーマに解決可能(壊れたパスを CI で検出, stringly-typed 結合の脆さを排除)。
- 全 hard-gate に対応する claimable チェックが BE 側に実在する(gate↔checker の双方向対応)。
- 摘要が必要な要件は claim_note_template を持つ。

## 8.2 カバレッジ契約テスト
- requirement_id ごとに『必須capture全充足の合成 VisitRecord → 当該要件が claimable』『一部欠落 → 当該要件が hard gate でブロック』のゴールデンケースを最低1件ずつ。
- payer(医療/介護)×revision のマトリクスで宛先自動選択・逐次ガード(介護 各回ごと医師→ケアマネ)を検証。

## 8.3 数値 fail-close テスト
- confirmed:false の数値が関与する算定候補が**保留**になり暫定 pass しないこと。

## 8.4 回帰・移行テスト
- warning→enforce 切替前のバックフィル不整合スキャンの単体テスト。
- 破壊的migrationのドライラン差分が期待集合と一致すること。


## アーキテクチャ・リファクタ方針

**Frontend (Claude lane):** Claude lane = src/app/(dashboard)/** + src/components/**。(1) 訪問capture: visit-record-form.tsx(2494行)を、capture/authoring 役割トグル(タブレット=既定capture-first, md breakpoint依存を解消)・ステップ・証跡レールを責務分離。BillingRequirementCatalog(codegen TS を import)連動で算定要件未充足を完了ゲート化。保険区分別必須項目・単一建物区分・SpecialPatientStatus を能動分岐提示。QR/バーコード残薬照合(@zxing)・POCデバイス(BP/SpO2/体重)取込UI・屋外/グローブ最適化(高輝度モード/大型フォントトグル/触覚)。(2) 他職種inbound還流: visit-brief の must_check_today/unresolved_items を暗号化オフラインストアへ prefetch し訪問ウィザード本文へ表示、その場 outbound 共有は記録本体と同一オフライン同期キューへ。inbound到着の通知/バッジ。(3) 報告書PCオーサリング: reports/[id]/page.tsx(1682行)を分解し全report_type編集対応、coverage-checker結果を hard gate として確定/送付に連結、finalize(薬剤師免許束縛・確定ロック)+ 確定後の訂正/追記(理由・実施者・時刻付き新版)UI。claim-record(摘要欄)プレビュー。STT射影UIは egress方針確定後に前倒し(任意)。

**Backend (Codex lane):** Codex lane = src/app/api/** + src/server/** + src/lib/** + prisma/**。(1) BillingRequirementCatalog を型付き共有モジュール(zod+codegen)として実装し4分散ロジックを統合(ARCH-1)、property test を CI に追加(§8)。(2) report-generator.ts(635行)を data-loader/content-projector/billing-coverage-checker/claim-record-projector/persister に分割(ARCH-8)。記載有無→カバレッジ判定へ置換。cycle_id 任意化で緊急/ad-hoc訪問の報告書生成を保証。(3) claim-record-projector 新設(摘要欄文字列生成、摘要欠落=claimableゲート)。(4) 単一建物患者数の月次動的計数サービス(payer別/GHユニット/特例)。(5) 加算判定: 麻薬/CV持続注射/CVN/乳幼児/(要確認)地域系 の構造化エビデンス→加算コードマスタ→自動判定。(6) 算定ゲート: order_ref+指示有効期間/management_plan/report_delivery(delivery_proof_type準拠の到達)/consent/特別患者枠(SpecialPatientStatus入力源)/摘要欄充足 を claimable の hard gate に。月キャップにオンライン46単位・緊急訪問通算を統合し入力変化で再計算。介護の逐次ガード。(7) finalize(finalized_by=薬剤師免許束縛/at+ロック)・確定後訂正版管理・un-lock限定・retention(basis/jurisdiction/rule)・電子署名/認定TSA pluggable。(8) inbound: FAX/紙OCR取込・多対多解決リンク+resolution_status・onward sharing の同意連動。

**データモデル:** prisma変更(要migration, 多くは承認要): (a) VisitRecord に visit_started_at/visit_ended_at(DateTime?)追加[非破壊]。(b) ManagementPlanContent zod構造化(planned_visit_frequency/visit_interval/medication_management_method/interaction_review/collaborating_physicians[])— Jsonのままschema厳格化, バックフィル要。(c) CareReport: finalized_by/finalized_at/content_schema_version 追加[非破壊], retention_basis(enum)/jurisdiction/retention_rule_id/retention_until 追加[非破壊], amend版管理(version chain) 用 amended_from_id/amend_reason/amended_by/amended_at 追加[非破壊], visit_record_id を String?から実FKへ昇格[要migration, 承認要]。(d) StructuredSoap型に SpecialPatientStatus/NarcoticGuidanceEvidence/ContinuousNarcoticInfusionEvidence/HomeCentralVenousNutritionEvidence/オン資薬剤情報/薬剤別アドヒアランス/QR残薬照合結果/法定6項目フラグ 追加(Jsonカラム内, zod厳格化)。(e) VisitInstruction(新 or 構造化): physician_id/医療機関/指示日/指示内容/valid_from/valid_to。(f) BillingEvidence: delivery_proof_type(enum)・*_ref を構造化参照+claimableゲートへ。(g) ClaimRecord(新): 摘要欄文字列+source。(h) inbound往復: 多対多 InboundResolutionLink(inbound_id, visit_record_id, resolution_status) [要migration], CommunicationResponse/PatientSelfReport/CommunicationRequest に resolution_status。(i) outbound受領: delivery acknowledged/responded ステータス。(j) FAX/紙inbound: 取込元/OCR原本参照。(k) 残薬の二重保存解消(ResidualMedication canonical化)[要migration, 承認要]。(l) レガシー文字列SOAP読取専用化/将来削除[要migration, 承認要]。(m) 加算コードマスタ(新テーブル or billing-rules/revisions, 数値は告示で要確認・confirmedフラグ)。破壊的migration(FK昇格/カラム削除/残薬一本化)は人間承認必須。

**共有コントラクト:** FE↔BEが同一の codegen 生成物を import する3+1点: (1) BillingRequirementCatalog(新, lib配下, zodスキーマ→codegen TS) = requirement_id→capture_paths(型安全 discriminated union, 生文字列パス禁止)→report_sections→gate種別→claim_note_template→payer×revision。各 requirement に最低1件のサンプルエントリ、CI property test で全件が必須要素を持つことを保証。FEは完了ゲート/算定区分提示、BEは coverage-checker/validator/claim-record-projector で使用。(2) StructuredSoap+zod(superRefineでpayer/visit_type条件必須, SpecialPatientStatus/加算根拠/QR残薬含む)。(3) *ReportContent+zod+content_schema_version。(4) BillingEvidence の *_ref を構造化参照+claimableゲート、delivery_proof_type を保持。enum命名不一致(nurse_share↔visiting_nurse, facility_handoff↔facility)を整理。

## フェーズ計画

- **P0 [BE]** BillingRequirementCatalog SSOT 新設（型付き/codegen + property test）
    - 算定要件↔capture_paths(型安全)↔報告書セクション↔gate↔claim_note_template↔payer×revision を zod+codegen 共有モジュールとして定義。requirement毎にサンプル1件。CIに property test 追加(全件が必須要素を持つ/capture_pathが実スキーマに解決/全hard-gateに対応checker存在)。点数/回数/間隔の数値は revisions 別に隔離し confirmed フラグ。未確定は fail-close 既定。既存4分散ロジックを順次参照差し替えできる土台。
- **P1 [BE+FE]** 訪問時 capture 構造化拡張 + zod 条件必須化（warning先行, 切替基準明文化）
    - VisitInstruction(有効期間)/visit_started_at,ended_at/オン資薬剤情報/法定6項目/SpecialPatientStatus/麻薬・CV・CVNエビデンス/QR残薬照合/薬剤別アドヒアランスを追加。StructuredSoap zod を payer/visit_type 条件 superRefine 化(まず warning)。enforce 切替基準(充足率閾値+バックフィル不整合0+property test green)を定義。FEは訪問ウィザードに項目反映+QR/高輝度/大型フォント。
- **P2 [BE+FE]** ManagementPlan 構造化 + 計画見直しサイクル強制
    - ManagementPlanContent を planned_visit_frequency/visit_interval/management_method/interaction_review/collaborating_physicians 構造化・必須化(版管理)。医療=月次見直し強制(next_review_date未設定でもoverdue)。FEは訪問前確認で必須参照・未策定ガード。バックフィル検証(ドライラン差分)。
- **P3 [BE]** 報告書 coverage-checker + claim-record(摘要欄) + report-generator分割 + cycle非依存生成
    - report-generator を data-loader/content-projector/billing-coverage-checker/claim-record-projector/persister に分割。記載有無→Catalog連動カバレッジ判定へ置換。摘要欄文字列生成(摘要欠落=claimableゲート)。cycle_id 任意化で緊急/ad-hoc訪問から生成保証。CareManagerReportContentに月訪問回数/服薬管理者/併用薬追加。全report_type自動生成補完。カバレッジ契約テスト(§8.2)。
- **P4 [BE+FE]** 報告書 finalize/確定ロック + 確定後訂正ワークフロー + PC編集拡張 + PDF後方互換
    - finalized_by(薬剤師免許束縛)/finalized_at+確定ロック。確定後の訂正/追記を理由・実施者・時刻付き新版(version chain)で保持、un-lock限定ロール+監査。ReportEditForm全report_type対応。coverage未充足を確定/送付の hard gate にFE連結。content_schema_version でPDF後方互換。
- **P5 [BE]** 算定ゲート連結 + 到達証跡 + 単一建物月次動的計数 + 月キャップ統合 + 加算自動判定
    - order_ref+指示有効期間/management_plan/report_delivery(delivery_proof_type準拠の到達)/consent/SpecialPatient枠/摘要欄充足 を claimable の hard gate に。介護の逐次ガード(各回ごと医師→ケアマネ・月まとめ不可)。単一建物患者数の月次動的計数(payer別/GHユニット/特例)。月/週キャップにオンライン46単位・緊急訪問通算を統合し入力変化で再計算。麻薬/CV持続注射/CVN/乳幼児/(要確認)地域系加算の自動判定+加算コードマスタ。数値fail-closeテスト(§8.3)。
- **P6 [BE+FE]** 多職種 inbound 往復モデル化 + 訪問時還流 + FAX/紙取込 + 通知 + 受領ループ
    - inbound↔訪問の多対多解決リンク+resolution_status(要migration)。visit-brief unresolved→訪問対処→クローズ往復。inbound を暗号化オフラインストアへ prefetch し訪問ウィザード本文へ還流+その場outbound(同一同期キュー)。FAX/紙inboundのOCR/手入力取込。inbound到着の通知/バッジ。outbound受領/既読クローズループ。inbound/onward sharing の同意連動(APPI)。enum命名整合。
- **P7 [BE]** 二重保存解消 + CareReport FK昇格（破壊的migration, 承認要・ロールバック手順付き）
    - 残薬 ResidualMedication canonical一本化、レガシー文字列SOAP読取専用化→観測期間→削除、CareReport.visit_record_id 実FK昇格。デュアルライト→バックフィル(ドライラン差分検証)→カットオーバー。各migrationにロールバック手順(スナップショット復元+逆変換)。人間承認後に実行。
- **P8 [BE+FE]** 保存性/真正性強化 + 電子署名/TSA + STT射影（egress方針確定後）
    - retention(basis/jurisdiction/rule)別ライフサイクル(Object Lock)。電子署名/認定TSA pluggable interface(事業者選定後)。STTはオンデバイス/オンプレ or no-retention VPC内Transcribe を採用した場合のみ出荷しSOAP自動射影(§2.3.1)。POCデバイス連携。

## スキーマ変更 (要承認・migration含む)

- VisitRecord: visit_started_at DateTime? / visit_ended_at DateTime? 追加（実訪問エビデンス, 非破壊）
- VisitInstruction 構造化: physician_id / physician_name / medical_institution / instruction_date / instruction_content / valid_from DateTime / valid_to DateTime?（医師指示+有効期間ゲート, 新エンティティ or 構造化, 非破壊優先）
- SpecialPatientStatus(structured_soap内 or 別テーブル): 該当区分enum(がん末期/注射麻薬/中心静脈栄養/心不全/呼吸不全) / 根拠 / set_by(薬剤師) / set_at（週2-月8枠判定の唯一の入力源, 非破壊）
- CareReport: finalized_by String?(薬剤師免許束縛) / finalized_at DateTime? / content_schema_version Int 追加[非破壊]; retention_basis enum(last_entry/case_closed/contract_end) / jurisdiction String? / retention_rule_id / retention_until DateTime? 追加[非破壊]; 確定後訂正用 amended_from_id / amend_reason / amended_by / amended_at 追加[非破壊]; visit_record_id を String?から実@relation(VisitRecord)へ昇格[要migration, 人間承認要]
- ManagementPlanContent zod構造拡張: planned_visit_frequency / visit_interval / medication_management_method / interaction_review / collaborating_physicians[]（content はJson維持・schema厳格化, バックフィル要）
- StructuredSoap型拡張(Jsonカラム内, zod厳格化): NarcoticGuidanceEvidence / ContinuousNarcoticInfusionEvidence / HomeCentralVenousNutritionEvidence / オン資取得薬剤情報 / 薬剤別アドヒアランス / QR残薬照合結果 / 法定記録6項目フラグ
- BillingEvidence: delivery_proof_type enum(system_send_log/recipient_ack/conference_attendance/fax_confirmation) 追加; *_ref(order_ref/consent_ref/management_plan_ref/report_delivery_ref) を自由参照から構造化参照+claimableゲート連動へ（カラム追加で対応・非破壊優先）
- ClaimRecord(新テーブル): billing_evidence_id / requirement_id / note_text（レセプト摘要欄文字列, 単一建物患者数・16km超事由・緊急tier事由・特別患者事由・指示期間外事由; 摘要欠落=claimableゲート）
- InboundResolutionLink(新, 多対多): inbound_id / inbound_type / visit_record_id? / resolution_status enum(open/in_visit/resolved_outside_visit/not_applicable)（inbound双方向往復, 1:1の硬直を解消, 要migration）
- CommunicationResponse / PatientSelfReport / CommunicationRequest: resolution_status 付与; outbound受領用 delivery acknowledged/responded ステータス追加
- FAX/紙inbound: 取込元・OCR原本S3参照・手入力フラグを持つ inbound digitization レコード（新, デジタルパートナー前提を解消）
- 加算コードマスタ: 麻薬管理指導/医療用麻薬持続注射療法/在宅中心静脈栄養法/乳幼児/(要確認)特別地域・中山間地域系 を billing-rules/revisions データ or 新テーブルで定義（数値は告示で要確認・confirmedフラグ・未確定は算定fail-close）
- 残薬二重保存解消: ResidualMedication テーブルを canonical 化し structured_soap.residual_medications を派生化（要migration, 人間承認要, ロールバック手順付き）
- レガシー文字列SOAP(soap_subjective/objective/assessment/plan)を structured_soap 派生・読取専用化→観測期間→将来カラム削除（要migration, 人間承認要）
- S3 Object Lock ライフサイクル: retention_basis/jurisdiction から算出した retention_until 起点で保険区分別(医療3年/介護完結後2年/監査ログ5年/自治体5年指定)分岐（インフラ設定, 承認要）

## 未決事項 (着手前に人間判断)

- 算定数値の確定(要確認): 単位/点数(介護518/379/342・医療650/320/290)、回数上限、訪問間隔(中6日 vs 2026『週1回』整理)、新設加算額(医療用麻薬持続注射250/在宅CV栄養150)を、告示・留意事項通知(老企第36号系/調剤点数表C008通知/MHLW改定概要PDF)原文で確定する必要。未確定数値は fail-close(算定保留)を既定とするが、暫定運用の許容範囲(原文確認待ちの間に保留させてよいか)を確認。更新オーナー・確認者・確定フローの責任分界。
- (要確認)介護の地域系加算: 居宅療養管理指導費に特別地域加算/中山間地域等小規模事業所加算/中山間地域等サービス提供加算が適用されるか。適用される場合は事業所所在地・患者居住地からの地域区分判定ロジックが必要、非適用なら明示的に対象外とする。
- 2026年診療報酬改定の確定事項: 算定間隔『週1回』整理、夜間・休日連絡体制整備の要件追加、オンライン薬剤管理指導料の服薬管理指導料への再編。これらを本リファクタに含めるか、別改定対応とするか。
- 報告書の法定様式: 日本薬剤師会ガイド別添様式・ケアマネ向け別紙様式1/2を、どこまで厳密にテンプレ再現するか(法定定型様式は無いが準拠が望ましい)。
- 到達(delivery_proof)のチャネル別運用: FAX確認(送達確認書/送信レポート)・メール受領確認(開封 vs 返信)・サービス担当者会議出席記録 のうち、どれを hard gate にカウントする『到達』とみなすか。recipient_ack を必須にすると運用負荷が上がるため、チャネル別の最低基準を業務側と確定。
- STT/PHI egress: オンデバイス/オンプレ STT か、no-retention 契約 + VPC内 Transcribe か、STT非出荷か。音声PHIの外部API送信は3省2GL/APPI上の egress 懸念があり gbrain ローカル化教訓と整合させる必要。決定が出るまで STT は P8 後置のまま、出荷可能と判断したら前倒し。
- POCデバイス連携(BP/SpO2/体重計): 対応機器・接続方式(BLE/手入力フォールバック)・医療機器連携の規制要件を確認。バイタル自動取得の費用対効果。
- 電子署名・認定TSA: 認定タイムスタンプ事業者の選定と電子署名方式(誰の鍵で・Cognito/KMS連携)。コスト・運用負荷。実装フェーズP8でよいか。
- 破壊的migrationの承認とロールバック: CareReport.visit_record_id FK昇格、残薬一本化、レガシーSOAPカラム削除は本番バックフィルを伴う。実行タイミング・観測期間・ロールバック手順(スナップショット復元+逆変換)の承認。
- 単一建物患者数の特例ルール: GHユニット単位・同一世帯2人以上・戸数10%以下・20戸未満2人以下で1人扱い等を、どこまで自動判定するか(誤分類リスク vs 手動確認運用)。
- 介護記録保存年限の起算点と管轄: 『完結後2年』の完結(最終記入/契約終了/ケースクローズ)の業務定義、自治体5年指定の適用ルールと管轄(事業所所在自治体)設定可否。
- 医療保険⇔介護保険の同月優先判定: 介護被保険者は原則介護優先だが、mixed月の自動判定ルールの業務要件確認。
- finalize 後の訂正/un-lock 権限: どのロールが un-lock 可能か、訂正理由の必須粒度、確定者が退職/異動した場合の訂正主体の扱い。
- 決定論生成の質担保(LLMブリッジ): 自由記述SOAPの自然文要約・抜け漏れ補完を薬剤師レビュー前提の下書き支援として導入するか、決定論+構造化必須に留めるか。導入する場合のPHI egress方針との整合。

## 多角的レビュー指摘 (revise反映済の元critique記録)

- 未カバー算定要件:
  - 特別患者(週2回/月8回枠)の該当判定が構造化されていない: validatorはspecial_patient_weekly_capを検証する想定だが、がん末期/注射麻薬使用/中心静脈栄養法/心不全・呼吸不全等という『枠を引き上げるトリガ属性』を捕捉するフィールドが訪問時captureにもBillingEvidenceにも無い。キャップ判定の入力が欠落しており、誰がこの特別患者フラグを立てるのか未設計(KYO-012/ZTK-07)。
  - レセプト摘要欄/算定根拠記載要件が完全に欠落: claimable真偽は出すが、単一建物患者数・16km超の理由・緊急訪問(料1/料2)の事由・特別患者該当事由などレセプト摘要欄に記載すべき算定根拠文字列の出力経路が無い。個別指導/監査対応に必須だが billing matrix にも schemaChanges にも一切現れない。
  - 月算定回数上限(monthly_cap)を『yes/維持』としているが内部矛盾: 同じ月キャップに合算すべきオンライン服薬指導46単位(KYO-011=no)と緊急訪問通算(ZTK-12=partial)が未統合。入力が欠けている以上キャップは正しく計算できず、『covered』判定は時期尚早(P5まで未連結)。
  - 医師指示の有効期間ガードが算定ゲートに無い: VisitInstructionに有効期間を持たせても、有効期限切れ・期間外の訪問をclaimable falseにする記述が無い。指示の存在チェック(order_ref gate)はあるが『有効な指示か』の時間軸検証が抜けている(KYO-002/ZTK-01)。
  - cycle_id無し(delivery_only/temporary/緊急)訪問の報告書生成と算定が宙に浮く: ARCH-8で『VISIT_SCHEDULE_CYCLE_REQUIRED_FOR_REPORTで弾く問題を検討』止まり。緊急訪問薬剤管理指導(料1/料2)も文書情報提供が算定要件なのに、報告書生成経路が保証されていない。
  - report_delivery hard gateの『到達』定義が未定義: 医師/ケアマネ未提供=claimable不可にすると言うが、FAX/メール/サービス担当者会議での提供は到達確認手段が無い。何をもって到達(送信ログ/受領確認/会議出席記録)とするか未定義で、hard gateが運用上機能しない恐れ。
  - 確定後の訂正・追記ワークフローが未設計: finalize lockは定義するが、MHLW真正性が求める『確定情報の訂正・追記は履歴として残す』運用(訂正理由・訂正者・時刻、un-lock権限)が無い。版管理に触れるのみで、確定者(finalized_by)を実際に訪問した薬剤師ライセンスに束縛する設計も無い。
  - (要確認)介護の特別地域加算/中山間地域等加算の適用可否を検討していない: 居宅療養管理指導が対象外なら問題ないが、適用される場合は遠隔地訪問の加算判定が完全に欠落。麻薬/CV/CVN/乳幼児加算は拾っているのに地域系加算は一切検討されていない。
- mobile-first ギャップ:
  - タブレットの扱いが曖昧: 目標は『スマホ/タブレット優先のcapture』だが、既存レスポンシブはmd+でPC寄りレイアウトを描画。横向きタブレットはmd+に入りオーサリングUIになり、capture役割と矛盾。タブレット専用モード/明示的ブレークポイント判断が無い。
  - STTのPHI egress矛盾: §2.3で Amazon Transcribe をフォールバックの核に据えながら、openQuestionsで『音声PHIの外部API送信は3省2GL/APPI上のegress懸念』と自ら警告。オンデバイス/オンプレ完結の意思決定が無いまま非準拠候補を中核に推奨。gbrain埋め込みをローカル化したegress教訓と整合しない。
  - オフライン×inboundのprefetch欠如: 『inboundを訪問時へ還流』するが患家は電波不安定。multidisciplinary_updates/unresolved_items/must_check_todayを暗号化オフラインストアへ事前同期する設計が無く、オフライン訪問では最新inboundを参照できない。
  - オフラインoutboundキュー未設計: MUX-11『その場でoutbound共有へ送出』は接続前提。オフライン時の発信を記録本体と同一同期キューに載せる記述が無い(写真の一本化は触れるが共有送出は別問題)。
  - QR/バーコード捕捉の不採用: @zxingが依存にあり残薬照合・薬剤現品確認の構造化captureに最適だが、仕様にQRが一切登場しない。残薬は依然として非構造の写真添付に留まり、『自動収集』の機会を逃している。
  - ポイントオブケアのデバイス連携(血圧計/SpO2/体重計)が省略: バイタル/検査値は手入力前提のままで、『算定要件を満たす構造化データの自動収集』という看板に対しバイタル自動取得が抜けている。
  - 屋外/グローブ最適化が研究指摘から部分的にしか引き継がれていない: サンライト高輝度モード・大型フォントトグル・触覚フィードバックが未整備。大型数値ステッパは触れるが網羅性が薄い。
- 双方向ギャップ:
  - 発信の『到達』証明がhard gateとして成立しない(billingと重複): FAX/メール/サービス担当者会議には受領確認の仕組みが無く、何をもって到達と判定しclaimableに効かせるかが未定義。delivery_proof_typeのような証跡型が無い。
  - inboundがオフライン(患家)で参照できない: 双方向の要である『inbound→訪問時還流』が接続前提で、オフライン訪問への事前prefetch設計が無い(mobileと重複)。
  - FAX/紙のinbound取り込み経路が無い: 多くの医師/ケアマネはFAX・紙で返信する。OCR/手入力でのinbound digitization経路が無く、双方向連携がデジタルパートナー前提になっている。
  - inbound到着の通知/プッシュが未設計: 訪問前に新着inboundがあることを薬剤師が知る手段が無い。must_check_today集約はあるが、アラート/配信のトリガ設計が欠落。
  - inbound PHI取込・転送のAPPI法的根拠が未整理: 他職種からの情報受領、およびinbound由来情報の更なる第三者提供(onward sharing)時の同意/利用目的が未設計。同意連動はoutbound側に偏っている。
  - resolved_visit_record_idの1:1モデルが硬直的: inbound1件が複数訪問にまたがる/訪問外でクローズされる/どの訪問にも紐づかないケースを表現できない。多対多+解決ステータスの方が実態に合う。
  - 発信に対する受領確認/既読ループ(outboundのクローズ)が未モデル化: 往復構造はinbound→対処→クローズを扱うが、自薬局発信が相手に受領・対応されたかの戻りループが無い。
