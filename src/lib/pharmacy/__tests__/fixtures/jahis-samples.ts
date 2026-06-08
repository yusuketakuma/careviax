/**
 * JAHIS QR テストフィクスチャ (JAHISTC08, ver.2.6 準拠)
 *
 * 正しいフィールド位置:
 *   Record 1:   1,<name>,<gender>,<birthdate>,<zip>,<address>,<phone>,<emergency>,<blood_type>,<weight>,<name_kana>
 *   Record 5:   5,<date>,<creator>                              ← 調剤日
 *   Record 11:  11,<name>,<pref>,<score>,<code7>,<zip>,<addr>,<phone>,<creator>  ← 調剤薬局
 *   Record 15:  15,<name>,<contact>,<creator>                  ← 調剤薬剤師
 *   Record 51:  51,<name>,<pref>,<score>,<code7>,<creator>     ← 処方医療機関
 *   Record 55:  55,<doctor_name>,<department>,<creator>        ← 処方医師
 *   Record 201: 201,<rp>,<drug_name>,<dose>,<unit>,<code_type>,<drug_code>,<creator>,<generic_name>,<generic_code_type>,<generic_code>
 *   Record 281: 281,<rp>,<supplement>,<creator>
 *   Record 301: 301,<rp>,<usage_name>,<quantity>,<unit>,<form_code>,<usage_code_type>,<usage_code>,<creator>
 *   Record 3:   3,<otc_drug_name>,<start_date>,<end_date>,<creator>,<sequence>,<jan_code>
 *   Record 31:  31,<otc_sequence>,<ingredient_name>,<code_type>,<ingredient_code>,<creator>
 *   Record 4:   4,<memo>,<input_date>,<creator>
 *   Record 411: 411,<content>,<info_type>,<creator>
 *   Record 421: 421,<residual_content>,<creator>
 *   Record 401: 401,<content>,<creator>
 *   Record 601: 601,<patient_note>,<input_date>
 *   Record 701: 701,<pharmacist_name>,<pharmacy_name>,<contact>,<start_date>,<end_date>,<creator>
 *   Record 911: 911,<data_id_14digits>,<split_count_3digits>,<seq_number_3digits>
 */

// 基本的な単一QR（1薬品）
export const SIMPLE_QR = `JAHISTC08,1
1,山田太郎,1,19500315,,,,,,, ヤマダタロウ
5,20260401,1
11,株式会社テスト薬局,13,4,1234567,,,, 1
15,鈴木薬剤師,,1
51,テスト医院,13,1,9876543,1
55,鈴木医師,内科,1
201,1,アムロジピン錠5mg,5,mg,2,612170709,1,,,
301,1,1日1回朝食後服用,14,日分,1,,,1`;

// 複数薬品のQR
export const MULTI_MED_QR = `JAHISTC08,1
1,田中花子,2,19650820,,,,,,, タナカハナコ
5,20260401,1
11,大学病院薬局,13,4,9876543,,,, 1
51,大学病院,13,1,7654321,1
55,佐藤医師,糖尿病内科,1
201,1,アムロジピン錠5mg,5,mg,2,612170709,1,,,
301,1,1日1回朝食後服用,14,日分,1,,,1
201,2,メトホルミン錠500mg,500,mg,2,612160501,1,,,
301,2,1日2回朝夕食後服用,28,日分,1,,,1
201,3,ワーファリン錠1mg,1,mg,2,621070401,1,,,
301,3,1日1回朝食後服用,14,日分,1,,,1`;

// 同一RP内に複数薬品があるQR
export const SAME_RP_MULTI_DRUG_QR = `JAHISTC08,1
1,同一RP患者,1,19500315,,,,,,, ドウイツアールピーカンジャ
5,20260401,1
51,テスト医院,13,1,9876543,1
55,鈴木医師,内科,1
201,1,配合薬A錠,1,錠,2,111111111,1,,,
201,1,配合薬B錠,2,錠,2,222222222,1,,,
301,1,1日1回朝食後服用,14,日分,1,,,1
311,1,同一RP用法補足,1
391,1,同一RP服用注意,1`;

// パース失敗を含むQR（不正なレコード）
export const QR_WITH_ERRORS = `JAHISTC08,1
1,テスト患者,1,
999,不明なレコード
201,1,不明薬剤名,,,,, 1,,,
301,1,,,,, ,,,1
5,invalid_date,1`;

// 空の薬剤情報
export const EMPTY_MEDS_QR = `JAHISTC08,1
1,患者名,1,20000101,,,,,,, カンジャメイ
5,20260401,1
51,テストクリニック,13,1,1111111,1`;

// 備考付きQR
export const QR_WITH_REMARKS = `JAHISTC08,1
1,鈴木一郎,1,19801225,,,,,,, スズキイチロウ
5,20260401,1
51,中央病院,13,1,5555555,1
55,高橋医師,整形外科,1
201,1,ロキソニン錠60mg,60,mg,2,111111111AA,1,,,
301,1,1日3回毎食後服用,5,日分,1,,,1
401,頓服指示あり,1`;

// 回分（times）パターン
export const TIMES_PATTERN_QR = `JAHISTC08,1
1,回分テスト,1,19900101,,,,,,, カイブンテスト
201,1,テスト薬,1,錠,1,,1,,,
301,1,発熱時服用,5,回分,3,,,1`;

// 頓服パターン
export const PRN_PATTERN_QR = `JAHISTC08,1
1,頓服テスト,2,19850515,,,,,,, トンプクテスト
201,1,カロナール錠500mg,500,mg,2,222222222BB,1,,,
301,1,頭痛時服用,頓服,,3,,,1`;

// マルチQR分割（Record 911 使用）
export const MULTI_QR_PART1 = `JAHISTC08,1
1,分割テスト,1,19700601,,,,,,, ブンカツテスト
51,テスト病院,13,1,1234567,1
55,テスト医師,内科,1
201,1,アムロジピン錠5mg,5,mg,2,612170709,1,,,
301,1,1日1回朝食後服用,14,日分,1,,,1
911,12345678901234,002,001`;

export const MULTI_QR_PART2 = `JAHISTC08,1
201,2,メトホルミン錠500mg,500,mg,2,612160501,1,,,
301,2,1日2回朝夕食後服用,28,日分,1,,,1
911,12345678901234,002,002`;

// 昭和生まれ（元号フォーマット）
export const ERA_DATE_QR = `JAHISTC08,1
1,元号テスト,1,S330303,,,,,,, ゲンゴウテスト
5,20260401,1`;

// JAHIS Ver.2.6 補足レコード付きQR
export const SUPPLEMENTAL_RECORDS_QR = `JAHISTC08,1
1,補足患者,1,19500315,,,,,,, ホソクカンジャ
5,20260401,1
3,バファリンA,20260401,20260403,2,1,4987107618160
31,1,アスピリン,2,1143001,2
4,市販薬服用中は胃部不快感に注意,R080401,2
411,嚥下困難のため錠剤は粉砕して投与する。,31,1
421,アムロジピンが10錠残薬。症状改善による自己判断で服用中断。,1
601,飲み始めてから昼に眠くなるようになった。,R080401
701,工業会 次郎,工業会薬局 駅前店,03-3506-8010,R080401,,1
201,1,アムロジピン錠5mg,5,mg,2,612170709,1,,,
301,1,1日1回朝食後服用,14,日分,1,,,1`;

// JAHIS院外処方箋2次元シンボル Ver.1.11（JAHIS11）
export const OUTPATIENT_PRESCRIPTION_QR_V11 = `JAHIS11
1,1,9876543,13,在宅テストクリニック
2,105-0004,東京都港区新橋1丁目11番
3,03-3506-8010,,
4,2,1,内科
5,,ｻﾞｲﾀｸ ｲﾁﾛｳ,在宅 一郎
11,,山田 太郎,ﾔﾏﾀﾞ ﾀﾛｳ
12,1
13,19500315
21,1
22,06012345
23,記号A,1234567,1,05
24,30,70
27,54123456,7654321
51,20260608
52,20260612
81,麻薬処方せん。PCAポンプ使用中。
101,1,1,,7
111,1,1,1,1日1回朝食後服用,,,
181,1,1,2,一包化,,
201,1,1,1,2,799940101,自己注射対象確認済み注射液,1,1,キット
281,1,1,冷所保管`;
