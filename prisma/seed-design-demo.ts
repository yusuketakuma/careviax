import type { PrismaClient } from '@prisma/client';

/**
 * design/images/new(新 14 画面)検証ループ用デモシナリオ seed(冪等 upsert)。
 *
 * デザイン PNG の登場状態を撮影で再現する:
 * - 01_dashboard: 当日 14:00 の田中一郎訪問(持参薬として携行)・未読通知 6 件
 * - 02_patient_list: 田中一郎(麻薬/冷所・本日14:00・監査工程)を含む患者カード
 * - 06_card: 田中一郎 RX-YYYY-0500 のカード作業台
 *   - セーフティボード: アレルギー(セフェム系/発疹 2019)・eGFR 38(約10日前)・
 *     取扱(麻薬/冷所/一包化)・嚥下(錠剤OK・大きい錠は半割)・注意(ふらつき 〜経過観察)
 *   - 今回処方 4 行: アムロジピン / オキシコドン(麻薬) / ランソプラゾール / インスリン グラルギン(冷所)
 *   - 直近の動き: 調剤 完了(約3時間前)・残薬調整の疑義照会(回答待ち)・定期処方 取込(やまもと内科)
 * - サイドバー監査バッジ 6: overall_status='dispensed' のサイクル 6 件
 *   (既存 seed 患者 5 名 + 田中)+ status='completed' の DispenseTask 6 件
 * - サイドバーハンドオフバッジ 3: 当日 HandoffBoard に自分(seed user)が渡した 3 件
 *
 * Phase2b 拡張(全 14 画面の主要セクションが空にならない最小十分):
 * - 02_patient_list: 追加患者 12 名(佐々木=待ち解除 / 鈴木=受入判断 / 伊藤=本日10:30 /
 *   高橋=外部待ち2日 / 渡辺・松本=セット / 小林=報告 / 加藤=返信待ち / 吉田=入院休止 /
 *   施設グリーンヒル入居 3 名)でフィルタチップに分布
 * - 04_visit: 田中・伊藤の VisitPreparation、施設一括バッチ(12名)、車両(軽バン1号)、前回訪問記録
 * - 05_import: 取込キュー(fax/e_prescription/paper 混在・重複疑いペア)+ QrScanDraft(確定1/破棄2)
 * - 07_dispense: 佐々木ハル=照会回答済(09:31)の調剤再開 1 件(DispenseTask pending)
 * - 08_audit: 田中タスクに調剤実績 4 行(調剤者=佐藤・09:30)→ 二人制バナー
 * - 09_set: 施設グリーンヒル(101 小川/102 山口/103 中村)の SetPlan/SetBatch + 本日15:30 訪問
 *   + 入居 104〜112 の 9 名(患者+居室のみ)で FacilityVisitBatch.patient_ids 12 名を全実在化
 * - 10_report: 報告下書き(伊藤)+ 返信待ち(加藤・高橋)+ 今日解決(佐々木 09:31)
 * - 11_billing: 当月の自動チェック合格 3 件(小林・加藤・松本の完了訪問 + BillingEvidence)
 *   + 疑義 1 件(高橋・同意書旧版の BillingCandidate)+ 算定ルール版(令和8年改定)
 * - 12_handoff: 既存ハンドオフ 3 件に責任移動の構造化フィールドを付与
 *
 * 日付は実行日基準の相対値(静止画原則: 比較対象は状態・文言形式であり日付値ではない)。
 */

export const DEMO_SEED_IDS = {
  patientTanaka: 'cmnhdemopt001amq9ph-os',
  residenceTanaka: 'cmnhdemores001amq9ph-os',
  schedulePreferenceTanaka: 'cmnhdemopref001amq9ph-os',
  conditionHeartFailure: 'cmnhdemocond001amq9ph-os',
  conditionDiabetes: 'cmnhdemocond002amq9ph-os',
  /** 注意: ふらつき(noted_at 〜経過観察) — セーフティボード「注意」行 */
  conditionDizziness: 'cmnhdemocond003amq9ph-os',
  /** 腎機能: eGFR 38(約10日前) — セーフティボード「腎機能」行 */
  labEgfrTanaka: 'cmnhdemolab001amq9ph-os',
  caseTanaka: 'cmnhdemocase001amq9ph-os',
  cycleTanaka: 'cmnhdemocyc001amq9ph-os',
  intakePrevious: 'cmnhdemointk001amq9ph-os',
  /**
   * RX 番号は formatPrescriptionCardNumber(id, prescribed_date, 'rx_year') が
   * id 末尾 4 文字から連番を作るため、末尾を数字 0500 にして RX-YYYY-0500 を再現する。
   */
  intakeCurrent: 'cmnhdemointk002amq0500',
  linesPrevious: [
    'cmnhdemoline101amq9ph-os',
    'cmnhdemoline102amq9ph-os',
    'cmnhdemoline103amq9ph-os',
  ],
  linesCurrent: [
    'cmnhdemoline201amq9ph-os',
    'cmnhdemoline202amq9ph-os',
    'cmnhdemoline203amq9ph-os',
    'cmnhdemoline204amq9ph-os',
  ],
  setPlan: 'cmnhdemosetpl001amq9ph-os',
  visitUpcoming: 'cmnhdemovis001amq9ph-os',
  visitFollowing: 'cmnhdemovis002amq9ph-os',
  exceptionCollectionBag: 'cmnhdemoexc001amq9ph-os',
  exceptionSetPhoto: 'cmnhdemoexc002amq9ph-os',
  /** 直近の動き: ready_to_dispense → dispensing(調剤 開始) */
  transitionLogDispensing: 'cmnhdemotrn001amq9ph-os',
  /** 直近の動き: dispensing → dispensed(調剤 完了・約3時間前) */
  transitionLogDispensed: 'cmnhdemotrn002amq9ph-os',
  /** 直近の動き: 残薬調整 → 疑義照会(result=null=回答待ち) */
  inquiryResidualAdjustment: 'cmnhdemoinq001amq9ph-os',
  /** 田中の監査キュー項目(completed=調剤完了・監査待ち、期限 12:00) */
  dispenseTaskTanaka: 'cmnhdemodtask001amq9ph-os',
  /** 監査キュー残り 5 件(既存 seed 患者 5 名)。intake 末尾 4 桁は RX 連番表示用 */
  auditQueueCycles: [
    'cmnhdemoaudcyc01amq9ph-os',
    'cmnhdemoaudcyc02amq9ph-os',
    'cmnhdemoaudcyc03amq9ph-os',
    'cmnhdemoaudcyc04amq9ph-os',
    'cmnhdemoaudcyc05amq9ph-os',
  ],
  auditQueueIntakes: [
    'cmnhdemoaudintk01a0471',
    'cmnhdemoaudintk02a0472',
    'cmnhdemoaudintk03a0473',
    'cmnhdemoaudintk04a0474',
    'cmnhdemoaudintk05a0475',
  ],
  auditQueueLines: [
    'cmnhdemoaudline01amq9ph-os',
    'cmnhdemoaudline02amq9ph-os',
    'cmnhdemoaudline03amq9ph-os',
    'cmnhdemoaudline04amq9ph-os',
    'cmnhdemoaudline05amq9ph-os',
  ],
  auditQueueTasks: [
    'cmnhdemoaudtask01amq9ph-os',
    'cmnhdemoaudtask02amq9ph-os',
    'cmnhdemoaudtask03amq9ph-os',
    'cmnhdemoaudtask04amq9ph-os',
    'cmnhdemoaudtask05amq9ph-os',
  ],
  /** 当日 HandoffBoard の「私が渡した」3 件(ハンドオフバッジ = 3) */
  handoffItems: [
    'cmnhdemohand001amq9ph-os',
    'cmnhdemohand002amq9ph-os',
    'cmnhdemohand003amq9ph-os',
  ],

  /* ── Phase2b: 全 14 画面撮影用の拡張(02/03/04/05/07/08/09/10/12)──── */

  /** 08: 田中タスクの調剤実績 4 行(調剤者=佐藤・09:30 → 二人制バナー) */
  dispenseResultsTanaka: [
    'cmnhdemodres001amq9ph-os',
    'cmnhdemodres002amq9ph-os',
    'cmnhdemodres003amq9ph-os',
    'cmnhdemodres004amq9ph-os',
  ],
  /** 04: 田中(本日14:00)の出発前準備 3/4 + 前回訪問記録 + 車両 */
  preparationTanaka: 'cmnhdemoprep001amq9ph-os',
  visitTanakaPast: 'cmnhdemovis013amq9ph-os',
  visitRecordTanakaPast: 'cmnhdemovrec001amq9ph-os',
  vehicleKeiVan: 'cmnhdemoveh001amq9ph-os',
  /** 10: 田中の宛先「医師(山本先生)+ケアマネ」 */
  careTeamTanakaPhysician: 'cmnhdemoctl001amq9ph-os',
  careTeamTanakaCareManager: 'cmnhdemoctl002amq9ph-os',

  /** 02/05/07/10: 佐々木ハル — 照会回答 09:31 で待ち解除(調剤キュー「いまの1件」) */
  patientSasaki: 'cmnhdemopt002amq9ph-os',
  caseSasaki: 'cmnhdemocase002amq9ph-os',
  cycleSasaki: 'cmnhdemocyc002amq9ph-os',
  labEgfrSasaki: 'cmnhdemolab002amq9ph-os',
  intakeSasakiPrevious: 'cmnhdemointk003amq9ph-os',
  /** 末尾 0473 → RX-YYYY-0473(ダッシュボード カード2 の表記に整合) */
  intakeSasakiCurrent: 'cmnhdemointk004amq0473',
  linesSasakiPrevious: [
    'cmnhdemoline301amq9ph-os',
    'cmnhdemoline302amq9ph-os',
    'cmnhdemoline303amq9ph-os',
  ],
  linesSasakiCurrent: [
    'cmnhdemoline401amq9ph-os',
    'cmnhdemoline402amq9ph-os',
    'cmnhdemoline403amq9ph-os',
  ],
  inquirySasakiDoseChange: 'cmnhdemoinq002amq9ph-os',
  dispenseTaskSasaki: 'cmnhdemodtask002amq9ph-os',
  visitSasaki: 'cmnhdemovis006amq9ph-os',
  commRequestSasaki: 'cmnhdemocreq001amq9ph-os',
  commResponseSasaki: 'cmnhdemocres001amq9ph-os',

  /** 02/03/05: 鈴木(新規)— 受入判断(返答期限 17:00)+ 明日 10:00 仮枠の未確定提案 */
  patientSuzukiNew: 'cmnhdemopt003amq9ph-os',
  caseSuzukiNew: 'cmnhdemocase003amq9ph-os',
  cycleSuzukiNew: 'cmnhdemocyc003amq9ph-os',
  intakeSuzukiNew: 'cmnhdemointk005amq9ph-os',
  lineSuzukiNew: 'cmnhdemoline501amq9ph-os',
  proposalSuzukiNew: 'cmnhdemoprop001amq9ph-os',
  contactLogSuzukiNew: 'cmnhdemoclog001amq9ph-os',

  /** 02/04/10: 伊藤キヨ — 本日10:30 訪問・準備4/4・報告下書き(ケアマネ 中島宛) */
  patientIto: 'cmnhdemopt004amq9ph-os',
  caseIto: 'cmnhdemocase004amq9ph-os',
  cycleIto: 'cmnhdemocyc004amq9ph-os',
  schedulePreferenceIto: 'cmnhdemopref002amq9ph-os',
  visitIto: 'cmnhdemovis003amq9ph-os',
  preparationIto: 'cmnhdemoprep002amq9ph-os',
  visitRecordIto: 'cmnhdemovrec002amq9ph-os',
  reportDraftIto: 'cmnhdemorep002amq9ph-os',
  careTeamItoCareManager: 'cmnhdemoctl003amq9ph-os',

  /** 02/05/10: 高橋茂 — 医師回答待ち2日 + FAX 重複疑い(3日前取込分とペア) */
  patientTakahashi: 'cmnhdemopt005amq9ph-os',
  caseTakahashi: 'cmnhdemocase005amq9ph-os',
  cycleTakahashi: 'cmnhdemocyc005amq9ph-os',
  intakeTakahashiOld: 'cmnhdemointk006amq9ph-os',
  intakeTakahashiNew: 'cmnhdemointk007amq9ph-os',
  lineTakahashiOld: 'cmnhdemoline601amq9ph-os',
  lineTakahashiNew: 'cmnhdemoline701amq9ph-os',
  inquiryTakahashiPending: 'cmnhdemoinq003amq9ph-os',
  commRequestTakahashi: 'cmnhdemocreq002amq9ph-os',
  visitTakahashi: 'cmnhdemovis007amq9ph-os',

  /** 02/05/09: 渡辺フミ(冷所)— 監査済サイクル + 明日訪問(余白で先行可) */
  patientWatanabe: 'cmnhdemopt006amq9ph-os',
  caseWatanabe: 'cmnhdemocase006amq9ph-os',
  cycleWatanabe: 'cmnhdemocyc006amq9ph-os',
  intakeWatanabe: 'cmnhdemointk008amq9ph-os',
  linesWatanabe: ['cmnhdemoline801amq9ph-os', 'cmnhdemoline802amq9ph-os'],
  visitWatanabe: 'cmnhdemovis004amq9ph-os',

  /** 02/09: 松本トヨ — 監査済サイクル + 明日訪問(渡辺とセットの先行可ペア) */
  patientMatsumoto: 'cmnhdemopt007amq9ph-os',
  caseMatsumoto: 'cmnhdemocase007amq9ph-os',
  cycleMatsumoto: 'cmnhdemocyc007amq9ph-os',
  intakeMatsumoto: 'cmnhdemointk009amq9ph-os',
  lineMatsumoto: 'cmnhdemoline901amq9ph-os',
  visitMatsumoto: 'cmnhdemovis005amq9ph-os',

  /** 02: 小林勝 — 訪問完了(報告工程) */
  patientKobayashi: 'cmnhdemopt008amq9ph-os',
  caseKobayashi: 'cmnhdemocase008amq9ph-os',
  cycleKobayashi: 'cmnhdemocyc008amq9ph-os',
  visitKobayashi: 'cmnhdemovis009amq9ph-os',

  /** 02/10: 加藤ミサ — ケアマネ返信待ち3日(再送できます) */
  patientKato: 'cmnhdemopt009amq9ph-os',
  caseKato: 'cmnhdemocase009amq9ph-os',
  cycleKato: 'cmnhdemocyc009amq9ph-os',
  reportKato: 'cmnhdemorep001amq9ph-os',
  deliveryKato: 'cmnhdemodel001amq9ph-os',
  visitKato: 'cmnhdemovis008amq9ph-os',

  /** 02: 吉田進 — 入院中(休止チップ) */
  patientYoshida: 'cmnhdemopt010amq9ph-os',
  caseYoshida: 'cmnhdemocase010amq9ph-os',
  cycleYoshida: 'cmnhdemocyc010amq9ph-os',

  /** 09: 施設グリーンヒル(101 小川 / 102 山口 / 103 中村)+ 本日15:30 一括訪問 */
  facilityGreenHill: 'cmnhdemofac001amq9ph-os',
  facilityUnitGreenHill: 'cmnhdemofacu001amq9ph-os',
  facilityBatchGreenHill: 'cmnhdemofvb001amq9ph-os',
  facilityStandardHomeCare: 'cmnhdemofsr001amq9ph-os',
  patientOgawa: 'cmnhdemopt011amq9ph-os',
  caseOgawa: 'cmnhdemocase011amq9ph-os',
  cycleOgawa: 'cmnhdemocyc011amq9ph-os',
  residenceOgawa: 'cmnhdemores002amq9ph-os',
  intakeOgawa: 'cmnhdemointk010amq9ph-os',
  linesOgawa: ['cmnhdemoline1001amq9ph-os', 'cmnhdemoline1002amq9ph-os'],
  visitOgawa: 'cmnhdemovis010amq9ph-os',
  setPlanOgawa: 'cmnhdemosetpl002amq9ph-os',
  setAuditOgawa: 'cmnhdemoseta001amq9ph-os',
  setBatchesOgawa: [
    'cmnhdemosetb101amq9ph-os',
    'cmnhdemosetb102amq9ph-os',
    'cmnhdemosetb103amq9ph-os',
    'cmnhdemosetb104amq9ph-os',
    'cmnhdemosetb105amq9ph-os',
    'cmnhdemosetb106amq9ph-os',
  ],
  patientYamaguchi: 'cmnhdemopt012amq9ph-os',
  caseYamaguchi: 'cmnhdemocase012amq9ph-os',
  cycleYamaguchi: 'cmnhdemocyc012amq9ph-os',
  residenceYamaguchi: 'cmnhdemores003amq9ph-os',
  intakeYamaguchi: 'cmnhdemointk011amq9ph-os',
  linesYamaguchi: ['cmnhdemoline1101amq9ph-os', 'cmnhdemoline1102amq9ph-os'],
  visitYamaguchi: 'cmnhdemovis011amq9ph-os',
  setPlanYamaguchi: 'cmnhdemosetpl003amq9ph-os',
  setAuditYamaguchi: 'cmnhdemoseta002amq9ph-os',
  setBatchesYamaguchi: [
    'cmnhdemosetb201amq9ph-os',
    'cmnhdemosetb202amq9ph-os',
    'cmnhdemosetb203amq9ph-os',
    'cmnhdemosetb204amq9ph-os',
  ],
  patientNakamura: 'cmnhdemopt013amq9ph-os',
  caseNakamura: 'cmnhdemocase013amq9ph-os',
  cycleNakamura: 'cmnhdemocyc013amq9ph-os',
  residenceNakamura: 'cmnhdemores004amq9ph-os',
  intakeNakamura: 'cmnhdemointk012amq9ph-os',
  linesNakamura: ['cmnhdemoline1201amq9ph-os', 'cmnhdemoline1202amq9ph-os'],
  visitNakamura: 'cmnhdemovis012amq9ph-os',
  setPlanNakamura: 'cmnhdemosetpl004amq9ph-os',
  setBatchesNakamura: [
    'cmnhdemosetb301amq9ph-os',
    'cmnhdemosetb302amq9ph-os',
    'cmnhdemosetb303amq9ph-os',
    'cmnhdemosetb304amq9ph-os',
  ],
  setChangeLogs: [
    'cmnhdemosetc001amq9ph-os',
    'cmnhdemosetc002amq9ph-os',
    'cmnhdemosetc003amq9ph-os',
  ],

  /** 05: QR 取込ドラフト(確定1=読取98% / 破棄2=破棄ログ今月2件) */
  qrDraftConfirmed: 'cmnhdemoqr001amq9ph-os',
  qrDraftsDiscarded: ['cmnhdemoqr002amq9ph-os', 'cmnhdemoqr003amq9ph-os'],
  /** 10: 宛先別テンプレート(医師/ケアマネ/施設) */
  reportTemplates: [
    'cmnhdemotmpl001amq9ph-os',
    'cmnhdemotmpl002amq9ph-os',
    'cmnhdemotmpl003amq9ph-os',
  ],
  /** 08: 棚卸しメタ(在庫更新日)用の在庫 1 行 */
  drugStockSample: 'cmnhdemostock001amq9ph-os',

  /**
   * 04/09/10: グリーンヒル入居 104〜112 の 9 名(patient_ids 全実在化)。
   * 患者+居室(Residence)のみ upsert し、ケース/サイクル/訪問は作らない
   * (02 患者一覧・09 セットの行数を変えずに名前解決だけ 12 名成立させる)。
   */
  greenHillRosterPatients: [
    'cmnhdemopt014amq9ph-os',
    'cmnhdemopt015amq9ph-os',
    'cmnhdemopt016amq9ph-os',
    'cmnhdemopt017amq9ph-os',
    'cmnhdemopt018amq9ph-os',
    'cmnhdemopt019amq9ph-os',
    'cmnhdemopt020amq9ph-os',
    'cmnhdemopt021amq9ph-os',
    'cmnhdemopt022amq9ph-os',
  ],
  greenHillRosterResidences: [
    'cmnhdemores005amq9ph-os',
    'cmnhdemores006amq9ph-os',
    'cmnhdemores007amq9ph-os',
    'cmnhdemores008amq9ph-os',
    'cmnhdemores009amq9ph-os',
    'cmnhdemores010amq9ph-os',
    'cmnhdemores011amq9ph-os',
    'cmnhdemores012amq9ph-os',
    'cmnhdemores013amq9ph-os',
  ],

  /** 11_billing: 自動チェック合格 3 件(当月の完了訪問 + 訪問記録 + BillingEvidence) */
  visitKobayashiDone: 'cmnhdemovis014amq9ph-os',
  visitRecordKobayashiDone: 'cmnhdemovrec003amq9ph-os',
  visitMatsumotoDone: 'cmnhdemovis015amq9ph-os',
  visitRecordMatsumotoDone: 'cmnhdemovrec004amq9ph-os',
  visitKatoDone: 'cmnhdemovis016amq9ph-os',
  visitRecordKatoDone: 'cmnhdemovrec005amq9ph-os',
  billingEvidencePassed: [
    'cmnhdemobev001amq9ph-os',
    'cmnhdemobev002amq9ph-os',
    'cmnhdemobev003amq9ph-os',
  ],
  /** 11_billing: 疑義 1 件(根拠 pill 用の算定ルール + 人の確認待ち候補) */
  billingRuleHomeVisitSsot: 'cmnhdemobrul001amq9ph-os',
  billingCandidateConsentReview: 'cmnhdemobcan001amq9ph-os',
} as const;

/**
 * RX 連番化(intakeCurrent 改番)前の旧 ID。再 seed 時に明細を新 intake へ
 * 付け替えた後、残骸の空 intake を削除して重複を防ぐ。
 */
const LEGACY_INTAKE_CURRENT_ID = 'cmnhdemointk002amq9ph-os';

/**
 * 監査キュー 6 件のうち田中以外の 5 件。prisma/seed.ts の SEED_IDS.patients /
 * SEED_IDS.careCases の固定 ID を参照する(seed.ts → 本 seed の順で実行される)。
 */
const AUDIT_QUEUE_BASE_TARGETS = [
  {
    patientId: 'cmnhseedpt001amq9ph-os',
    caseId: 'cmnhseedcase001amq9ph-os',
    drugName: 'アトルバスタチン 5mg',
    dose: '1錠',
    frequency: '朝',
    days: 28,
    quantity: 28,
    unit: '錠',
  },
  {
    patientId: 'cmnhseedpt002amq9ph-os',
    caseId: 'cmnhseedcase002amq9ph-os',
    drugName: 'ファモチジン 10mg',
    dose: '1錠',
    frequency: '朝夕',
    days: 14,
    quantity: 28,
    unit: '錠',
  },
  {
    patientId: 'cmnhseedpt003amq9ph-os',
    caseId: 'cmnhseedcase003amq9ph-os',
    drugName: 'マグミット 330mg',
    dose: '1錠',
    frequency: '毎食後',
    days: 28,
    quantity: 84,
    unit: '錠',
  },
  {
    patientId: 'cmnhseedpt004amq9ph-os',
    caseId: 'cmnhseedcase004amq9ph-os',
    drugName: 'カンデサルタン 8mg',
    dose: '1錠',
    frequency: '朝',
    days: 28,
    quantity: 28,
    unit: '錠',
  },
  {
    patientId: 'cmnhseedpt005amq9ph-os',
    caseId: 'cmnhseedcase005amq9ph-os',
    drugName: 'ロスバスタチン 2.5mg',
    dose: '1錠',
    frequency: '朝',
    days: 28,
    quantity: 28,
    unit: '錠',
  },
] as const;

const NOTIFICATION_DEDUPE_PREFIX = 'design-demo';

type DemoSeedContext = {
  orgId: string;
  siteId: string;
  userId: string;
  /** 第2薬剤師「佐藤」(prisma/seed.ts の SEED_IDS.userSato)。二人制監査の調剤者。 */
  dispenserUserId: string;
};

/** PrescriptionLine.packaging_instruction_tags に投入する値(PackagingInstructionTag のサブセット) */
type DemoPackagingTag = 'narcotic' | 'cold_storage' | 'separate_pack';

/**
 * @db.Date カラムは UTC の日付部分で保存されるため、ローカル日付を
 * UTC midnight に正規化してから渡す(JST midnight のままだと 1 日前にズレる)。
 */
function atMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** 実行日のローカル時刻(HH:mm)を持つ Date。期限 12:00 / 訪問 14:00 などに使う。 */
function atLocalTimeToday(hours: number, minutes: number): Date {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 実行日から daysAgo 日前のローカル日付。前月へはみ出すと当月の算定 KPI に
 * 乗らないため、当月 1 日を下限にクランプする(11_billing の完了訪問用)。
 */
function daysAgoClampedToCurrentMonth(now: Date, daysAgo: number): Date {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  return candidate < monthStart ? monthStart : candidate;
}

/** ローカル日付 date の hours:minutes を指す Date(完了訪問の visit_date 用)。 */
function atTimeOn(date: Date, hours: number, minutes: number): Date {
  const d = new Date(date);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/**
 * BillingEvidence / BillingCandidate.billing_month(@db.Date)用の JST 当月 1 日。
 * /api/billing-evidence/check が使う billingMonthForJapanTimestamp と同じ正規化
 * (seed から src を import しない方針のためローカルに再実装)。
 */
function billingMonthStartFor(now: Date): Date {
  const jst = new Date(now.getTime() + 9 * 3_600_000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1));
}

/* ── Phase2b 拡張用ヘルパー(患者・取込・訪問の冪等 upsert)──────────── */

type DemoCaseStatus = 'active' | 'referral_received' | 'on_hold';

type DemoCycleStatus =
  | 'intake_received'
  | 'structuring'
  | 'inquiry_pending'
  | 'inquiry_resolved'
  | 'ready_to_dispense'
  | 'dispensing'
  | 'dispensed'
  | 'audit_pending'
  | 'audited'
  | 'setting'
  | 'set_audited'
  | 'visit_ready'
  | 'visit_completed'
  | 'reported'
  | 'on_hold';

type DemoBoardPatientSpec = {
  patientId: string;
  caseId: string;
  /** null = 処方サイクルなし(新規依頼など) */
  cycleId: string | null;
  name: string;
  nameKana: string;
  age: number;
  gender: 'male' | 'female';
  caseStatus?: DemoCaseStatus;
  cycleStatus?: DemoCycleStatus;
  /** awaiting_reply / hospitalized 等(02 の返信待ち・入院表示) */
  exceptionStatus?: string | null;
  /** 返信待ち N日 表示用に cycle.updated_at を固定したいとき */
  cycleUpdatedAt?: Date;
  allergyInfo?: Array<Record<string, string | number>>;
  referralSource?: string;
};

/** 患者 + ケース + サイクルの基本セット(02 患者カードの最小単位)。 */
async function upsertDemoBoardPatient(
  prisma: PrismaClient,
  ctx: DemoSeedContext,
  spec: DemoBoardPatientSpec,
): Promise<void> {
  const baseDate = atMidnight(new Date());
  const birthDate = new Date(`${baseDate.getFullYear() - spec.age}-01-15`);
  const patientData = {
    name: spec.name,
    name_kana: spec.nameKana,
    birth_date: birthDate,
    gender: spec.gender,
    allergy_info: spec.allergyInfo ?? [],
  };
  await prisma.patient.upsert({
    where: { id: spec.patientId },
    create: { id: spec.patientId, org_id: ctx.orgId, ...patientData },
    update: patientData,
  });

  const caseData = {
    status: spec.caseStatus ?? ('active' as const),
    referral_source: spec.referralSource ?? 'やまもと内科',
    referral_date: addDays(baseDate, -90),
    start_date: spec.caseStatus === 'referral_received' ? null : addDays(baseDate, -90),
    primary_pharmacist_id: ctx.userId,
  };
  await prisma.careCase.upsert({
    where: { id: spec.caseId },
    create: {
      id: spec.caseId,
      org_id: ctx.orgId,
      patient_id: spec.patientId,
      ...caseData,
    },
    update: caseData,
  });

  if (spec.cycleId) {
    const cycleData = {
      overall_status: spec.cycleStatus ?? ('intake_received' as const),
      exception_status: spec.exceptionStatus ?? null,
      ...(spec.cycleUpdatedAt ? { updated_at: spec.cycleUpdatedAt } : {}),
    };
    await prisma.medicationCycle.upsert({
      where: { id: spec.cycleId },
      create: {
        id: spec.cycleId,
        org_id: ctx.orgId,
        case_id: spec.caseId,
        patient_id: spec.patientId,
        ...cycleData,
      },
      update: cycleData,
    });
  }
}

type DemoLineSpec = {
  id: string;
  lineNumber: number;
  drugName: string;
  dose: string;
  frequency: string;
  days: number;
  quantity: number;
  unit: string;
  packagingInstructionTags?: DemoPackagingTag[];
  dispensingMethod?: string;
};

type DemoIntakeSpec = {
  id: string;
  cycleId: string;
  sourceType: 'paper' | 'fax' | 'e_prescription';
  prescribedDate: Date;
  createdAt: Date;
  prescriberName?: string;
  prescriberInstitution?: string;
  /** 05 右レール「元FAX画像」件数のソース(FAX 行のみ設定) */
  originalDocumentUrl?: string;
  lines: DemoLineSpec[];
};

/** 処方取込 + 明細行(05 取込キュー 1 行 + 処方比較のソース)。 */
async function upsertDemoIntake(
  prisma: PrismaClient,
  ctx: DemoSeedContext,
  spec: DemoIntakeSpec,
): Promise<void> {
  const intakeData = {
    cycle_id: spec.cycleId,
    source_type: spec.sourceType,
    prescribed_date: spec.prescribedDate,
    prescriber_name: spec.prescriberName ?? null,
    prescriber_institution: spec.prescriberInstitution ?? null,
    original_document_url: spec.originalDocumentUrl ?? null,
    created_at: spec.createdAt,
  };
  await prisma.prescriptionIntake.upsert({
    where: { id: spec.id },
    create: { id: spec.id, org_id: ctx.orgId, ...intakeData },
    update: intakeData,
  });

  for (const line of spec.lines) {
    const lineData = {
      intake_id: spec.id,
      line_number: line.lineNumber,
      drug_name: line.drugName,
      dose: line.dose,
      frequency: line.frequency,
      days: line.days,
      quantity: line.quantity,
      unit: line.unit,
      route: 'internal',
      dosage_form: '錠剤',
      dispensing_method: line.dispensingMethod ?? 'standard',
      packaging_instruction_tags: line.packagingInstructionTags ?? [],
    };
    await prisma.prescriptionLine.upsert({
      where: { id: line.id },
      create: { id: line.id, org_id: ctx.orgId, ...lineData },
      update: lineData,
    });
  }
}

type DemoVisitSpec = {
  id: string;
  caseId: string;
  cycleId?: string | null;
  /** atMidnight 済の @db.Date 値 */
  scheduledDate: Date;
  /** [hours, minutes](@db.Time は時刻部分のみ保存される) */
  startTime?: [number, number];
  durationMinutes?: number;
  visitType?: 'regular' | 'initial';
  scheduleStatus?: 'planned' | 'completed';
  routeOrder?: number;
  facilityBatchId?: string;
  facilityUnitId?: string;
  vehicleResourceId?: string;
  preVisitChecklistCompleted?: boolean;
  /** 03 の確定🔒表示(confirmed_at/by) */
  confirmed?: boolean;
};

/** 訪問予定(02 次回訪問 / 03 ガント / 04 準備カード / 09 施設グループ)。 */
async function upsertDemoVisit(
  prisma: PrismaClient,
  ctx: DemoSeedContext,
  spec: DemoVisitSpec,
): Promise<void> {
  const start = spec.startTime ? atLocalTimeToday(spec.startTime[0], spec.startTime[1]) : null;
  const end = start ? addMinutes(start, spec.durationMinutes ?? 30) : null;
  const visitData = {
    case_id: spec.caseId,
    cycle_id: spec.cycleId ?? null,
    site_id: ctx.siteId,
    visit_type: spec.visitType ?? ('regular' as const),
    schedule_status: spec.scheduleStatus ?? ('planned' as const),
    scheduled_date: spec.scheduledDate,
    time_window_start: start,
    time_window_end: end,
    pharmacist_id: ctx.userId,
    route_order: spec.routeOrder ?? null,
    facility_batch_id: spec.facilityBatchId ?? null,
    facility_unit_id: spec.facilityUnitId ?? null,
    vehicle_resource_id: spec.vehicleResourceId ?? null,
    pre_visit_checklist_completed: spec.preVisitChecklistCompleted ?? false,
    confirmed_at: spec.confirmed ? addDays(spec.scheduledDate, -1) : null,
    confirmed_by: spec.confirmed ? ctx.userId : null,
  };
  await prisma.visitSchedule.upsert({
    where: { id: spec.id },
    create: { id: spec.id, org_id: ctx.orgId, ...visitData },
    update: visitData,
  });
}

export async function seedDesignFidelityDemo(
  prisma: PrismaClient,
  ctx: DemoSeedContext,
): Promise<void> {
  const now = new Date();
  const today = atMidnight(now);
  const tomorrow = addDays(today, 1);
  // 前回処方: 28日前に処方、服用は昨日まで
  const previousPrescribedDate = addDays(today, -28);
  const previousStart = addDays(today, -28);
  const previousEnd = addDays(today, -1);
  // 今回処方: 3日前に処方(取込は昨日 17:20 FAX)、服用は明日から 28 日分
  const currentPrescribedDate = addDays(today, -3);
  const currentIntakeReceivedAt = addDays(atLocalTimeToday(17, 20), -1);
  const currentStart = tomorrow;
  const currentEnd = addDays(tomorrow, 27);
  // 次回訪問: 今回服用期間の終盤
  const followingVisitDate = addDays(tomorrow, 26);

  // ── 患者: 田中 一郎(84歳/男性/自宅)──────────────────────────
  const birthYear = today.getFullYear() - 84;
  // セーフティボード「アレルギー」行。既存 AllergyEntry 型
  // (src/lib/validations/patient-allergy.ts: drug_name/category/severity が必須)に
  // 合わせつつ、表示用の reaction / noted_year(発疹 2019)も保持する。
  const allergyInfo = [
    {
      drug_name: 'セフェム系',
      substance: 'セフェム系',
      category: 'drug',
      severity: 'severe',
      reaction: '発疹',
      noted_year: 2019,
      confirmed_at: '2019-01-01',
    },
  ];
  await prisma.patient.upsert({
    where: { id: DEMO_SEED_IDS.patientTanaka },
    create: {
      id: DEMO_SEED_IDS.patientTanaka,
      org_id: ctx.orgId,
      name: '田中 一郎',
      name_kana: 'タナカ イチロウ',
      birth_date: new Date(`${birthYear}-04-12`),
      gender: 'male',
      phone: '090-2222-1111',
      allergy_info: allergyInfo,
    },
    update: {
      name: '田中 一郎',
      name_kana: 'タナカ イチロウ',
      birth_date: new Date(`${birthYear}-04-12`),
      gender: 'male',
      phone: '090-2222-1111',
      allergy_info: allergyInfo,
    },
  });

  await prisma.residence.upsert({
    where: { id: DEMO_SEED_IDS.residenceTanaka },
    create: {
      id: DEMO_SEED_IDS.residenceTanaka,
      org_id: ctx.orgId,
      patient_id: DEMO_SEED_IDS.patientTanaka,
      address: '東京都千代田区丸の内1-1-1',
      is_primary: true,
    },
    update: {
      address: '東京都千代田区丸の内1-1-1',
      is_primary: true,
    },
  });

  // セーフティボード「嚥下」行(patient.scheduling_preference.swallowing_route)
  await prisma.patientSchedulePreference.upsert({
    where: { patient_id: DEMO_SEED_IDS.patientTanaka },
    create: {
      id: DEMO_SEED_IDS.schedulePreferenceTanaka,
      org_id: ctx.orgId,
      patient_id: DEMO_SEED_IDS.patientTanaka,
      swallowing_route: '錠剤OK・大きい錠は半割',
    },
    update: {
      swallowing_route: '錠剤OK・大きい錠は半割',
    },
  });

  await prisma.patientCondition.upsert({
    where: { id: DEMO_SEED_IDS.conditionHeartFailure },
    create: {
      id: DEMO_SEED_IDS.conditionHeartFailure,
      org_id: ctx.orgId,
      patient_id: DEMO_SEED_IDS.patientTanaka,
      condition_type: 'disease',
      name: '心不全',
      is_primary: true,
      is_active: true,
    },
    update: { name: '心不全', is_primary: true, is_active: true },
  });

  await prisma.patientCondition.upsert({
    where: { id: DEMO_SEED_IDS.conditionDiabetes },
    create: {
      id: DEMO_SEED_IDS.conditionDiabetes,
      org_id: ctx.orgId,
      patient_id: DEMO_SEED_IDS.patientTanaka,
      condition_type: 'disease',
      name: '糖尿病',
      is_active: true,
    },
    update: { name: '糖尿病', is_active: true },
  });

  // セーフティボード「注意」行: ふらつき(M/d〜経過観察)
  const dizzinessNotedAt = atMidnight(addDays(today, -6));
  await prisma.patientCondition.upsert({
    where: { id: DEMO_SEED_IDS.conditionDizziness },
    create: {
      id: DEMO_SEED_IDS.conditionDizziness,
      org_id: ctx.orgId,
      patient_id: DEMO_SEED_IDS.patientTanaka,
      condition_type: 'problem',
      name: 'ふらつき',
      is_active: true,
      noted_at: dizzinessNotedAt,
      notes: '経過観察',
    },
    update: {
      condition_type: 'problem',
      name: 'ふらつき',
      is_active: true,
      noted_at: dizzinessNotedAt,
      notes: '経過観察',
    },
  });

  // セーフティボード「腎機能」行: eGFR 38(約10日前)要減量
  const egfrMeasuredAt = addDays(today, -10);
  await prisma.patientLabObservation.upsert({
    where: { id: DEMO_SEED_IDS.labEgfrTanaka },
    create: {
      id: DEMO_SEED_IDS.labEgfrTanaka,
      org_id: ctx.orgId,
      patient_id: DEMO_SEED_IDS.patientTanaka,
      analyte_code: 'egfr',
      measured_at: egfrMeasuredAt,
      value_numeric: 38,
      unit: 'mL/min/1.73m²',
      abnormal_flag: 'L',
      reference_low: 60,
      source_type: 'manual',
      note: '要減量',
    },
    update: {
      analyte_code: 'egfr',
      measured_at: egfrMeasuredAt,
      value_numeric: 38,
      unit: 'mL/min/1.73m²',
      abnormal_flag: 'L',
      reference_low: 60,
      source_type: 'manual',
      note: '要減量',
    },
  });

  await prisma.careCase.upsert({
    where: { id: DEMO_SEED_IDS.caseTanaka },
    create: {
      id: DEMO_SEED_IDS.caseTanaka,
      org_id: ctx.orgId,
      patient_id: DEMO_SEED_IDS.patientTanaka,
      status: 'active',
      referral_source: 'やまもと内科',
      referral_date: addDays(today, -120),
      start_date: addDays(today, -120),
      primary_pharmacist_id: ctx.userId,
      required_visit_support: {
        home_visit_intake: { care_level: 'care_2' },
      },
    },
    update: {
      status: 'active',
      primary_pharmacist_id: ctx.userId,
    },
  });

  // ── MedicationCycle: 調剤完了・監査待ち(工程: 監査(いまここ))──────
  await prisma.medicationCycle.upsert({
    where: { id: DEMO_SEED_IDS.cycleTanaka },
    create: {
      id: DEMO_SEED_IDS.cycleTanaka,
      org_id: ctx.orgId,
      case_id: DEMO_SEED_IDS.caseTanaka,
      patient_id: DEMO_SEED_IDS.patientTanaka,
      overall_status: 'dispensed',
    },
    update: {
      overall_status: 'dispensed',
      exception_status: null,
    },
  });

  // ── 直近の動き: 調剤 開始 → 調剤 完了(約3時間前・実行者 = seed user)────
  const dispensingStartedAt = addHours(now, -4);
  const dispensedAt = addHours(now, -3);
  await prisma.cycleTransitionLog.upsert({
    where: { id: DEMO_SEED_IDS.transitionLogDispensing },
    create: {
      id: DEMO_SEED_IDS.transitionLogDispensing,
      org_id: ctx.orgId,
      cycle_id: DEMO_SEED_IDS.cycleTanaka,
      from_status: 'ready_to_dispense',
      to_status: 'dispensing',
      actor_id: ctx.userId,
      note: '調剤を開始',
      created_at: dispensingStartedAt,
    },
    update: {
      from_status: 'ready_to_dispense',
      to_status: 'dispensing',
      actor_id: ctx.userId,
      note: '調剤を開始',
      created_at: dispensingStartedAt,
    },
  });

  await prisma.cycleTransitionLog.upsert({
    where: { id: DEMO_SEED_IDS.transitionLogDispensed },
    create: {
      id: DEMO_SEED_IDS.transitionLogDispensed,
      org_id: ctx.orgId,
      cycle_id: DEMO_SEED_IDS.cycleTanaka,
      from_status: 'dispensing',
      to_status: 'dispensed',
      actor_id: ctx.userId,
      note: '調剤 完了',
      created_at: dispensedAt,
    },
    update: {
      from_status: 'dispensing',
      to_status: 'dispensed',
      actor_id: ctx.userId,
      note: '調剤 完了',
      created_at: dispensedAt,
    },
  });

  // ── 直近の動き: 残薬調整 → 疑義照会(今朝送信・result=null=回答待ち)────
  await prisma.inquiryRecord.upsert({
    where: { id: DEMO_SEED_IDS.inquiryResidualAdjustment },
    create: {
      id: DEMO_SEED_IDS.inquiryResidualAdjustment,
      org_id: ctx.orgId,
      cycle_id: DEMO_SEED_IDS.cycleTanaka,
      reason: '残薬調整',
      inquiry_to_physician: 'やまもと内科 山本 健',
      inquiry_content: '在宅残薬を確認したため、次回処方日数の調整可否を照会',
      result: null,
      residual_adjustment: true,
      inquired_at: atLocalTimeToday(9, 31),
      resolved_at: null,
    },
    update: {
      reason: '残薬調整',
      inquiry_to_physician: 'やまもと内科 山本 健',
      inquiry_content: '在宅残薬を確認したため、次回処方日数の調整可否を照会',
      result: null,
      residual_adjustment: true,
      inquired_at: atLocalTimeToday(9, 31),
      resolved_at: null,
    },
  });

  // ── 処方: 前回(メトホルミンあり)/ 今回(オキシコドン・インスリン開始)──
  await prisma.prescriptionIntake.upsert({
    where: { id: DEMO_SEED_IDS.intakePrevious },
    create: {
      id: DEMO_SEED_IDS.intakePrevious,
      org_id: ctx.orgId,
      cycle_id: DEMO_SEED_IDS.cycleTanaka,
      source_type: 'paper',
      prescribed_date: previousPrescribedDate,
      prescriber_name: '山本 健',
      prescriber_institution: 'やまもと内科',
      created_at: previousPrescribedDate,
    },
    update: {
      prescribed_date: previousPrescribedDate,
      prescriber_institution: 'やまもと内科',
      created_at: previousPrescribedDate,
    },
  });

  const previousLines = [
    {
      id: DEMO_SEED_IDS.linesPrevious[0],
      line_number: 1,
      drug_name: 'アムロジピン 5mg',
      dose: '1錠',
      frequency: '朝',
      days: 28,
    },
    {
      id: DEMO_SEED_IDS.linesPrevious[1],
      line_number: 2,
      drug_name: 'メトホルミン 250mg',
      dose: '2錠',
      frequency: '朝夕',
      days: 28,
    },
    {
      id: DEMO_SEED_IDS.linesPrevious[2],
      line_number: 3,
      drug_name: 'ランソプラゾール 15mg',
      dose: '1錠',
      frequency: '朝',
      days: 28,
    },
  ];
  for (const line of previousLines) {
    await prisma.prescriptionLine.upsert({
      where: { id: line.id },
      create: {
        ...line,
        org_id: ctx.orgId,
        intake_id: DEMO_SEED_IDS.intakePrevious,
        route: 'internal',
        dispensing_method: 'unit_dose',
        start_date: previousStart,
        end_date: previousEnd,
      },
      update: {
        line_number: line.line_number,
        drug_name: line.drug_name,
        dose: line.dose,
        frequency: line.frequency,
        days: line.days,
        start_date: previousStart,
        end_date: previousEnd,
      },
    });
  }

  // 05_import 行4: FAX・昨日17:20 受信・入力済→監査中(RX-YYYY-0500)
  await prisma.prescriptionIntake.upsert({
    where: { id: DEMO_SEED_IDS.intakeCurrent },
    create: {
      id: DEMO_SEED_IDS.intakeCurrent,
      org_id: ctx.orgId,
      cycle_id: DEMO_SEED_IDS.cycleTanaka,
      source_type: 'fax',
      prescribed_date: currentPrescribedDate,
      prescriber_name: '山本 健',
      prescriber_institution: 'やまもと内科',
      original_document_url: 's3://ph-os-demo/fax/tanaka-rx-0500.pdf',
      created_at: currentIntakeReceivedAt,
    },
    update: {
      source_type: 'fax',
      prescribed_date: currentPrescribedDate,
      prescriber_institution: 'やまもと内科',
      original_document_url: 's3://ph-os-demo/fax/tanaka-rx-0500.pdf',
      created_at: currentIntakeReceivedAt,
    },
  });

  // 06_card の処方テーブル 4 行(薬剤 / 用法 / 数量 / 安全)
  const currentLines: Array<{
    id: string;
    line_number: number;
    drug_name: string;
    dose: string;
    frequency: string;
    days: number;
    quantity: number;
    unit: string;
    route: string;
    dosage_form: string;
    dispensing_method: string;
    packaging_instruction_tags: DemoPackagingTag[];
    notes?: string;
  }> = [
    {
      id: DEMO_SEED_IDS.linesCurrent[0],
      line_number: 1,
      drug_name: 'アムロジピン 5mg',
      dose: '1錠',
      frequency: '朝',
      days: 28,
      quantity: 28,
      unit: '錠',
      route: 'internal',
      dosage_form: '錠剤',
      dispensing_method: 'unit_dose',
      packaging_instruction_tags: [],
    },
    {
      id: DEMO_SEED_IDS.linesCurrent[1],
      line_number: 2,
      drug_name: 'オキシコドン 5mg',
      dose: '1錠(1日2回まで)',
      frequency: '疼痛時',
      days: 14,
      quantity: 14,
      unit: '錠',
      route: 'internal',
      dosage_form: '錠剤',
      dispensing_method: 'standard',
      packaging_instruction_tags: ['narcotic'],
      notes: '疼痛時頓用。1日2回まで',
    },
    {
      id: DEMO_SEED_IDS.linesCurrent[2],
      line_number: 3,
      drug_name: 'ランソプラゾール 15mg',
      dose: '1錠',
      frequency: '朝',
      days: 28,
      quantity: 28,
      unit: '錠',
      route: 'internal',
      dosage_form: '錠剤',
      dispensing_method: 'unit_dose',
      packaging_instruction_tags: [],
    },
    {
      id: DEMO_SEED_IDS.linesCurrent[3],
      line_number: 4,
      drug_name: 'インスリン グラルギン',
      dose: '8単位',
      frequency: '夕',
      days: 28,
      quantity: 1,
      unit: '本',
      route: 'injection',
      dosage_form: '注射剤',
      dispensing_method: 'standard',
      packaging_instruction_tags: ['cold_storage'],
    },
  ];
  for (const line of currentLines) {
    await prisma.prescriptionLine.upsert({
      where: { id: line.id },
      create: {
        ...line,
        org_id: ctx.orgId,
        intake_id: DEMO_SEED_IDS.intakeCurrent,
        start_date: currentStart,
        end_date: currentEnd,
      },
      update: {
        intake_id: DEMO_SEED_IDS.intakeCurrent,
        line_number: line.line_number,
        drug_name: line.drug_name,
        dose: line.dose,
        frequency: line.frequency,
        days: line.days,
        quantity: line.quantity,
        unit: line.unit,
        route: line.route,
        dosage_form: line.dosage_form,
        dispensing_method: line.dispensing_method,
        packaging_instruction_tags: line.packaging_instruction_tags,
        notes: line.notes ?? null,
        start_date: currentStart,
        end_date: currentEnd,
      },
    });
  }

  // intakeCurrent 改番(RX-YYYY-0500)前の旧 intake が残っていれば削除する
  // (明細は上の upsert で新 intake へ付け替え済みのため、安全に消せる)。
  await prisma.prescriptionIntake.deleteMany({
    where: { id: LEGACY_INTAKE_CURRENT_ID, org_id: ctx.orgId },
  });

  // ── 監査キュー: 田中の DispenseTask(completed=調剤完了・監査待ち)────
  // GET /api/dispense-audits は status='completed' かつ未監査(or hold)を列挙する。
  const auditDueAt = atLocalTimeToday(12, 0);
  await prisma.dispenseTask.upsert({
    where: { id: DEMO_SEED_IDS.dispenseTaskTanaka },
    create: {
      id: DEMO_SEED_IDS.dispenseTaskTanaka,
      org_id: ctx.orgId,
      cycle_id: DEMO_SEED_IDS.cycleTanaka,
      priority: 'urgent',
      due_date: auditDueAt,
      status: 'completed',
    },
    update: {
      priority: 'urgent',
      due_date: auditDueAt,
      status: 'completed',
    },
  });

  // ── 監査キュー: 既存 seed 患者 5 名の dispensed サイクル(計 6 件 = バッジ 6)──
  const auditQueuePrescribedDate = addDays(today, -2);
  for (const [index, target] of AUDIT_QUEUE_BASE_TARGETS.entries()) {
    const cycleId = DEMO_SEED_IDS.auditQueueCycles[index];
    const intakeId = DEMO_SEED_IDS.auditQueueIntakes[index];
    const lineId = DEMO_SEED_IDS.auditQueueLines[index];
    const taskId = DEMO_SEED_IDS.auditQueueTasks[index];

    await prisma.medicationCycle.upsert({
      where: { id: cycleId },
      create: {
        id: cycleId,
        org_id: ctx.orgId,
        case_id: target.caseId,
        patient_id: target.patientId,
        overall_status: 'dispensed',
      },
      update: {
        overall_status: 'dispensed',
        exception_status: null,
      },
    });

    await prisma.prescriptionIntake.upsert({
      where: { id: intakeId },
      create: {
        id: intakeId,
        org_id: ctx.orgId,
        cycle_id: cycleId,
        source_type: 'paper',
        prescribed_date: auditQueuePrescribedDate,
        prescriber_name: 'サンプル医師',
        prescriber_institution: 'サンプル在宅クリニック',
        created_at: auditQueuePrescribedDate,
      },
      update: {
        prescribed_date: auditQueuePrescribedDate,
        created_at: auditQueuePrescribedDate,
      },
    });

    await prisma.prescriptionLine.upsert({
      where: { id: lineId },
      create: {
        id: lineId,
        org_id: ctx.orgId,
        intake_id: intakeId,
        line_number: 1,
        drug_name: target.drugName,
        dose: target.dose,
        frequency: target.frequency,
        days: target.days,
        quantity: target.quantity,
        unit: target.unit,
        route: 'internal',
        dosage_form: '錠剤',
        dispensing_method: 'standard',
      },
      update: {
        drug_name: target.drugName,
        dose: target.dose,
        frequency: target.frequency,
        days: target.days,
        quantity: target.quantity,
        unit: target.unit,
      },
    });

    await prisma.dispenseTask.upsert({
      where: { id: taskId },
      create: {
        id: taskId,
        org_id: ctx.orgId,
        cycle_id: cycleId,
        priority: 'normal',
        status: 'completed',
      },
      update: {
        priority: 'normal',
        due_date: null,
        status: 'completed',
      },
    });
  }

  // 手動デモ等で監査済みになった残骸を消し、監査キュー 6 件(バッジ 6)を復元する。
  await prisma.dispenseAudit.deleteMany({
    where: {
      org_id: ctx.orgId,
      task_id: {
        in: [DEMO_SEED_IDS.dispenseTaskTanaka, ...DEMO_SEED_IDS.auditQueueTasks],
      },
    },
  });

  // ── 08_audit: 田中タスクの調剤実績 4 行(調剤者=佐藤・09:30 完了)─────
  // /api/dispense-tasks/[id]/workbench が「二人制✓ 調剤: 佐藤(09:30) → 監査:
  // 山田(あなた)」バナーと計数(調剤者)列を出すためのデータ源。
  const tanakaDispensedAt = atLocalTimeToday(9, 30);
  for (const [index, line] of currentLines.entries()) {
    const resultId = DEMO_SEED_IDS.dispenseResultsTanaka[index];
    const resultData = {
      task_id: DEMO_SEED_IDS.dispenseTaskTanaka,
      line_id: line.id,
      actual_drug_name: line.drug_name,
      actual_quantity: line.quantity,
      actual_unit: line.unit,
      carry_type: 'carry',
      special_notes: line.packaging_instruction_tags.includes('narcotic')
        ? '麻薬(施錠保管から払い出し)'
        : line.packaging_instruction_tags.includes('cold_storage')
          ? '冷所(保冷バッグで携行)'
          : null,
      dispensed_by: ctx.dispenserUserId,
      dispensed_at: tanakaDispensedAt,
    };
    await prisma.dispenseResult.upsert({
      where: { id: resultId },
      create: { id: resultId, org_id: ctx.orgId, ...resultData },
      update: resultData,
    });
  }

  // ── SetPlan: お薬カレンダー・一包化・残薬充当・中止薬回収 ────────────
  await prisma.setPlan.upsert({
    where: { id: DEMO_SEED_IDS.setPlan },
    create: {
      id: DEMO_SEED_IDS.setPlan,
      org_id: ctx.orgId,
      cycle_id: DEMO_SEED_IDS.cycleTanaka,
      target_period_start: currentStart,
      target_period_end: currentEnd,
      set_method: 'facility_calendar',
      notes: '残薬充当あり / 中止薬回収あり',
    },
    update: {
      target_period_start: currentStart,
      target_period_end: currentEnd,
      set_method: 'facility_calendar',
      notes: '残薬充当あり / 中止薬回収あり',
    },
  });

  // ── 車両: 軽バン1号(04 根拠・記録 / 13 車両マスターの点検期限接近)────
  const vehicleInspectionDue = formatMonthDay(addDays(today, 8));
  await prisma.visitVehicleResource.upsert({
    where: {
      org_id_vehicle_code: { org_id: ctx.orgId, vehicle_code: 'VEH-DEMO-001' },
    },
    create: {
      id: DEMO_SEED_IDS.vehicleKeiVan,
      org_id: ctx.orgId,
      site_id: ctx.siteId,
      label: '軽バン1号',
      vehicle_code: 'VEH-DEMO-001',
      travel_mode: 'DRIVE',
      max_stops: 8,
      available: true,
      notes: `点検期限 ${vehicleInspectionDue}`,
    },
    update: {
      site_id: ctx.siteId,
      label: '軽バン1号',
      travel_mode: 'DRIVE',
      max_stops: 8,
      available: true,
      notes: `点検期限 ${vehicleInspectionDue}`,
    },
  });

  // ── 訪問予定: 当日 14:00(持参薬として携行)+ 次回訪問 ────────────────
  // 01_dashboard「14:00 訪問」/ 06_card「14:00 訪問(持参薬として携行)」に整合。
  const timeWindowStart = atLocalTimeToday(14, 0);
  const timeWindowEnd = atLocalTimeToday(14, 30);

  await prisma.visitSchedule.upsert({
    where: { id: DEMO_SEED_IDS.visitUpcoming },
    create: {
      id: DEMO_SEED_IDS.visitUpcoming,
      org_id: ctx.orgId,
      cycle_id: DEMO_SEED_IDS.cycleTanaka,
      case_id: DEMO_SEED_IDS.caseTanaka,
      site_id: ctx.siteId,
      visit_type: 'regular',
      schedule_status: 'planned',
      scheduled_date: today,
      time_window_start: timeWindowStart,
      time_window_end: timeWindowEnd,
      pharmacist_id: ctx.userId,
      carry_items_status: 'partial',
      vehicle_resource_id: DEMO_SEED_IDS.vehicleKeiVan,
      medication_start_date: currentStart,
      medication_end_date: currentEnd,
      confirmed_at: addDays(today, -2),
      confirmed_by: ctx.userId,
    },
    update: {
      scheduled_date: today,
      time_window_start: timeWindowStart,
      time_window_end: timeWindowEnd,
      visit_type: 'regular',
      schedule_status: 'planned',
      carry_items_status: 'partial',
      vehicle_resource_id: DEMO_SEED_IDS.vehicleKeiVan,
      medication_start_date: currentStart,
      medication_end_date: currentEnd,
      confirmed_at: addDays(today, -2),
      confirmed_by: ctx.userId,
    },
  });

  // ── 04_visit: 田中の出発前準備 3/4(パケット✓ / ルート✓ / 麻薬監査待ち!)──
  await prisma.visitPreparation.upsert({
    where: { schedule_id: DEMO_SEED_IDS.visitUpcoming },
    create: {
      id: DEMO_SEED_IDS.preparationTanaka,
      org_id: ctx.orgId,
      schedule_id: DEMO_SEED_IDS.visitUpcoming,
      checklist: [],
      medication_changes_reviewed: false,
      carry_items_confirmed: true,
      previous_issues_reviewed: false,
      route_confirmed: true,
      prepared_by: ctx.userId,
      prepared_at: null,
    },
    update: {
      medication_changes_reviewed: false,
      carry_items_confirmed: true,
      previous_issues_reviewed: false,
      route_confirmed: true,
      prepared_by: ctx.userId,
      prepared_at: null,
    },
  });

  // ── 04 根拠・記録「前回訪問記録」: 28日前の完了訪問 + 記録 ─────────────
  await upsertDemoVisit(prisma, ctx, {
    id: DEMO_SEED_IDS.visitTanakaPast,
    caseId: DEMO_SEED_IDS.caseTanaka,
    cycleId: null,
    scheduledDate: atMidnight(addDays(today, -28)),
    startTime: [14, 0],
    scheduleStatus: 'completed',
  });
  const tanakaPastVisitDate = addDays(atLocalTimeToday(14, 0), -28);
  await prisma.visitRecord.upsert({
    where: { schedule_id: DEMO_SEED_IDS.visitTanakaPast },
    create: {
      id: DEMO_SEED_IDS.visitRecordTanakaPast,
      org_id: ctx.orgId,
      schedule_id: DEMO_SEED_IDS.visitTanakaPast,
      patient_id: DEMO_SEED_IDS.patientTanaka,
      pharmacist_id: ctx.userId,
      visit_date: tanakaPastVisitDate,
      outcome_status: 'completed',
      soap_subjective: 'ふらつきの訴えあり。疼痛は安定。',
      soap_plan: '次回訪問時に残薬を確認する。',
    },
    update: {
      patient_id: DEMO_SEED_IDS.patientTanaka,
      pharmacist_id: ctx.userId,
      visit_date: tanakaPastVisitDate,
      outcome_status: 'completed',
    },
  });

  // ── 10_report: 田中の宛先「医師(山本先生)+ケアマネ」(CareTeamLink)────
  const tanakaCareTeam = [
    {
      id: DEMO_SEED_IDS.careTeamTanakaPhysician,
      role: 'physician',
      name: '山本 健',
      organization_name: 'やまもと内科',
      is_primary: true,
    },
    {
      id: DEMO_SEED_IDS.careTeamTanakaCareManager,
      role: 'care_manager',
      name: '高橋 みどり',
      organization_name: 'きたきゅうケアプラン',
      is_primary: false,
    },
  ];
  for (const member of tanakaCareTeam) {
    await prisma.careTeamLink.upsert({
      where: { id: member.id },
      create: {
        id: member.id,
        org_id: ctx.orgId,
        case_id: DEMO_SEED_IDS.caseTanaka,
        role: member.role,
        name: member.name,
        organization_name: member.organization_name,
        is_primary: member.is_primary,
      },
      update: {
        role: member.role,
        name: member.name,
        organization_name: member.organization_name,
        is_primary: member.is_primary,
      },
    });
  }

  await prisma.visitSchedule.upsert({
    where: { id: DEMO_SEED_IDS.visitFollowing },
    create: {
      id: DEMO_SEED_IDS.visitFollowing,
      org_id: ctx.orgId,
      case_id: DEMO_SEED_IDS.caseTanaka,
      site_id: ctx.siteId,
      visit_type: 'regular',
      schedule_status: 'planned',
      scheduled_date: followingVisitDate,
      pharmacist_id: ctx.userId,
    },
    update: {
      scheduled_date: followingVisitDate,
      schedule_status: 'planned',
    },
  });

  // ── 止まっている理由(WorkflowException)──────────────────────────
  // 06_card 右レール: 患者「ご家族の同意待ち(新規契約)」(約1日前)/
  // 事務「送付先の確認(やまもと内科)」(約30分前)
  await prisma.workflowException.upsert({
    where: { id: DEMO_SEED_IDS.exceptionCollectionBag },
    create: {
      id: DEMO_SEED_IDS.exceptionCollectionBag,
      org_id: ctx.orgId,
      cycle_id: DEMO_SEED_IDS.cycleTanaka,
      exception_type: 'family_consent_pending',
      description: 'ご家族の同意待ち(新規契約)',
      severity: 'critical',
      status: 'open',
      created_at: addHours(now, -25),
    },
    update: {
      exception_type: 'family_consent_pending',
      description: 'ご家族の同意待ち(新規契約)',
      severity: 'critical',
      status: 'open',
      resolved_by: null,
      resolved_at: null,
      created_at: addHours(now, -25),
    },
  });

  await prisma.workflowException.upsert({
    where: { id: DEMO_SEED_IDS.exceptionSetPhoto },
    create: {
      id: DEMO_SEED_IDS.exceptionSetPhoto,
      org_id: ctx.orgId,
      cycle_id: DEMO_SEED_IDS.cycleTanaka,
      exception_type: 'delivery_target_confirmation',
      description: '送付先の確認(やまもと内科)',
      severity: 'warning',
      status: 'open',
      created_at: addMinutes(now, -30),
    },
    update: {
      exception_type: 'delivery_target_confirmation',
      description: '送付先の確認(やまもと内科)',
      severity: 'warning',
      status: 'open',
      resolved_by: null,
      resolved_at: null,
      created_at: addMinutes(now, -30),
    },
  });

  /* ════ Phase2b: 全 14 画面撮影用の拡張 ════════════════════════════ */

  // ── 02/05/07/10: 佐々木 ハル(79歳)— 照会回答 09:31 で待ち解除 ────────
  await upsertDemoBoardPatient(prisma, ctx, {
    patientId: DEMO_SEED_IDS.patientSasaki,
    caseId: DEMO_SEED_IDS.caseSasaki,
    cycleId: DEMO_SEED_IDS.cycleSasaki,
    name: '佐々木 ハル',
    nameKana: 'ササキ ハル',
    age: 79,
    gender: 'female',
    cycleStatus: 'inquiry_resolved',
    allergyInfo: [{ drug_name: 'なし', confirmed_at: `${today.getFullYear()}-06-01` }],
  });

  // 腎機能タグ + 07 セーフティボード「eGFR 41 — 用量に注意」
  const sasakiEgfrMeasuredAt = addDays(today, -7);
  await prisma.patientLabObservation.upsert({
    where: { id: DEMO_SEED_IDS.labEgfrSasaki },
    create: {
      id: DEMO_SEED_IDS.labEgfrSasaki,
      org_id: ctx.orgId,
      patient_id: DEMO_SEED_IDS.patientSasaki,
      analyte_code: 'egfr',
      measured_at: sasakiEgfrMeasuredAt,
      value_numeric: 41,
      unit: 'mL/min/1.73m²',
      abnormal_flag: 'L',
      reference_low: 60,
      source_type: 'manual',
      note: '用量に注意',
    },
    update: {
      measured_at: sasakiEgfrMeasuredAt,
      value_numeric: 41,
      abnormal_flag: 'L',
      source_type: 'manual',
      note: '用量に注意',
    },
  });

  // 前回処方(約4週前): ファモチジン 20mg 朝夕 ほか
  await upsertDemoIntake(prisma, ctx, {
    id: DEMO_SEED_IDS.intakeSasakiPrevious,
    cycleId: DEMO_SEED_IDS.cycleSasaki,
    sourceType: 'paper',
    prescribedDate: addDays(today, -28),
    createdAt: addDays(today, -28),
    prescriberName: '山本 健',
    prescriberInstitution: 'やまもと内科',
    lines: [
      {
        id: DEMO_SEED_IDS.linesSasakiPrevious[0],
        lineNumber: 1,
        drugName: 'ファモチジン',
        dose: '20mg',
        frequency: '朝夕',
        days: 14,
        quantity: 28,
        unit: '錠',
      },
      {
        id: DEMO_SEED_IDS.linesSasakiPrevious[1],
        lineNumber: 2,
        drugName: 'マグミット 330mg',
        dose: '1錠',
        frequency: '毎食後',
        days: 28,
        quantity: 84,
        unit: '錠',
      },
      {
        id: DEMO_SEED_IDS.linesSasakiPrevious[2],
        lineNumber: 3,
        drugName: 'アトルバスタチン 5mg',
        dose: '1錠',
        frequency: '朝',
        days: 28,
        quantity: 28,
        unit: '錠',
      },
    ],
  });

  // 今回処方(本日 09:35 FAX 受信): ファモチジン 10mg へ減量(照会回答の反映)
  await upsertDemoIntake(prisma, ctx, {
    id: DEMO_SEED_IDS.intakeSasakiCurrent,
    cycleId: DEMO_SEED_IDS.cycleSasaki,
    sourceType: 'fax',
    prescribedDate: today,
    createdAt: atLocalTimeToday(9, 35),
    prescriberName: '山本 健',
    prescriberInstitution: 'やまもと内科',
    originalDocumentUrl: 's3://ph-os-demo/fax/sasaki-rx-0473.pdf',
    lines: [
      {
        id: DEMO_SEED_IDS.linesSasakiCurrent[0],
        lineNumber: 1,
        drugName: 'ファモチジン',
        dose: '10mg',
        frequency: '朝夕',
        days: 14,
        quantity: 28,
        unit: '錠',
      },
      {
        id: DEMO_SEED_IDS.linesSasakiCurrent[1],
        lineNumber: 2,
        drugName: 'マグミット 330mg',
        dose: '1錠',
        frequency: '毎食後',
        days: 28,
        quantity: 84,
        unit: '錠',
      },
      {
        id: DEMO_SEED_IDS.linesSasakiCurrent[2],
        lineNumber: 3,
        drugName: 'アトルバスタチン 5mg',
        dose: '1錠',
        frequency: '朝',
        days: 28,
        quantity: 28,
        unit: '錠',
      },
    ],
  });

  // 照会(回答 09:31・減量 changed)→ 02「待ち解除」/ 07「照会回答による変更」
  await prisma.inquiryRecord.upsert({
    where: { id: DEMO_SEED_IDS.inquirySasakiDoseChange },
    create: {
      id: DEMO_SEED_IDS.inquirySasakiDoseChange,
      org_id: ctx.orgId,
      cycle_id: DEMO_SEED_IDS.cycleSasaki,
      line_id: DEMO_SEED_IDS.linesSasakiCurrent[0],
      reason: '用量疑義',
      inquiry_to_physician: 'やまもと内科 山本 健',
      inquiry_content: 'eGFR 41 のためファモチジンの減量可否を照会',
      result: 'changed',
      proposal_origin: 'post_inquiry',
      change_detail: 'ファモチジン 20mg → 10mg 朝夕(減量)',
      inquired_at: atLocalTimeToday(8, 40),
      resolved_at: atLocalTimeToday(9, 31),
    },
    update: {
      line_id: DEMO_SEED_IDS.linesSasakiCurrent[0],
      reason: '用量疑義',
      inquiry_to_physician: 'やまもと内科 山本 健',
      result: 'changed',
      proposal_origin: 'post_inquiry',
      change_detail: 'ファモチジン 20mg → 10mg 朝夕(減量)',
      inquired_at: atLocalTimeToday(8, 40),
      resolved_at: atLocalTimeToday(9, 31),
    },
  });

  // 07_dispense「いまの1件」: 調剤キュー(pending)の再開タスク
  await prisma.dispenseTask.upsert({
    where: { id: DEMO_SEED_IDS.dispenseTaskSasaki },
    create: {
      id: DEMO_SEED_IDS.dispenseTaskSasaki,
      org_id: ctx.orgId,
      cycle_id: DEMO_SEED_IDS.cycleSasaki,
      priority: 'normal',
      status: 'pending',
    },
    update: {
      priority: 'normal',
      due_date: null,
      status: 'pending',
    },
  });

  await upsertDemoVisit(prisma, ctx, {
    id: DEMO_SEED_IDS.visitSasaki,
    caseId: DEMO_SEED_IDS.caseSasaki,
    cycleId: DEMO_SEED_IDS.cycleSasaki,
    scheduledDate: addDays(today, 2),
    startTime: [10, 0],
  });

  // 10_report「今日解決した待ち」: 残薬照会(やまもと内科)が 09:31 に回答受領
  await prisma.communicationRequest.upsert({
    where: { id: DEMO_SEED_IDS.commRequestSasaki },
    create: {
      id: DEMO_SEED_IDS.commRequestSasaki,
      org_id: ctx.orgId,
      patient_id: DEMO_SEED_IDS.patientSasaki,
      case_id: DEMO_SEED_IDS.caseSasaki,
      request_type: 'inquiry',
      recipient_name: 'やまもと内科 山本 健',
      recipient_role: 'physician',
      status: 'responded',
      subject: '残薬照会(やまもと内科)',
      content: '残薬調整に伴う処方日数変更の可否を照会',
      requested_by: ctx.userId,
      requested_at: addDays(atLocalTimeToday(15, 0), -1),
    },
    update: {
      status: 'responded',
      subject: '残薬照会(やまもと内科)',
      requested_at: addDays(atLocalTimeToday(15, 0), -1),
    },
  });
  await prisma.communicationResponse.upsert({
    where: { id: DEMO_SEED_IDS.commResponseSasaki },
    create: {
      id: DEMO_SEED_IDS.commResponseSasaki,
      org_id: ctx.orgId,
      request_id: DEMO_SEED_IDS.commRequestSasaki,
      responder_name: 'やまもと内科 山本 健',
      content: 'ファモチジンは 10mg へ減量で調整してください。',
      responded_at: atLocalTimeToday(9, 31),
    },
    update: {
      responder_name: 'やまもと内科 山本 健',
      responded_at: atLocalTimeToday(9, 31),
    },
  });

  // ── 02/03/05: 鈴木(新規・受入判断)+ 明日 10:00 仮枠の未確定提案 ──────
  await upsertDemoBoardPatient(prisma, ctx, {
    patientId: DEMO_SEED_IDS.patientSuzukiNew,
    caseId: DEMO_SEED_IDS.caseSuzukiNew,
    cycleId: DEMO_SEED_IDS.cycleSuzukiNew,
    name: '鈴木 修',
    nameKana: 'スズキ オサム',
    age: 81,
    gender: 'male',
    caseStatus: 'referral_received',
    cycleStatus: 'intake_received',
    referralSource: 'きたきゅうケアプラン',
  });

  // 05_import 行2: オンライン(電子処方箋)・本日 09:12 受信・受入判断待ち
  await upsertDemoIntake(prisma, ctx, {
    id: DEMO_SEED_IDS.intakeSuzukiNew,
    cycleId: DEMO_SEED_IDS.cycleSuzukiNew,
    sourceType: 'e_prescription',
    prescribedDate: today,
    createdAt: atLocalTimeToday(9, 12),
    prescriberInstitution: 'きたきゅうケアプラン',
    lines: [
      {
        id: DEMO_SEED_IDS.lineSuzukiNew,
        lineNumber: 1,
        drugName: 'アムロジピン 5mg',
        dose: '1錠',
        frequency: '朝',
        days: 28,
        quantity: 28,
        unit: '錠',
      },
    ],
  });

  // 03_schedule「未確定」: 明日 10:00 仮枠(佐藤)・返答期限 本日17:00
  await prisma.visitScheduleProposal.upsert({
    where: { id: DEMO_SEED_IDS.proposalSuzukiNew },
    create: {
      id: DEMO_SEED_IDS.proposalSuzukiNew,
      org_id: ctx.orgId,
      case_id: DEMO_SEED_IDS.caseSuzukiNew,
      cycle_id: DEMO_SEED_IDS.cycleSuzukiNew,
      site_id: ctx.siteId,
      visit_type: 'initial',
      priority: 'normal',
      proposal_status: 'proposed',
      patient_contact_status: 'attempted',
      proposed_date: tomorrow,
      time_window_start: atLocalTimeToday(10, 0),
      time_window_end: atLocalTimeToday(10, 30),
      proposed_pharmacist_id: ctx.dispenserUserId,
      proposal_reason: '新規受入(きたきゅうケアプラン経由)— 受入判断待ち',
    },
    update: {
      proposal_status: 'proposed',
      patient_contact_status: 'attempted',
      proposed_date: tomorrow,
      time_window_start: atLocalTimeToday(10, 0),
      time_window_end: atLocalTimeToday(10, 30),
      proposed_pharmacist_id: ctx.dispenserUserId,
      proposal_reason: '新規受入(きたきゅうケアプラン経由)— 受入判断待ち',
      confirmed_at: null,
      confirmed_by: null,
    },
  });
  await prisma.visitScheduleContactLog.upsert({
    where: { id: DEMO_SEED_IDS.contactLogSuzukiNew },
    create: {
      id: DEMO_SEED_IDS.contactLogSuzukiNew,
      org_id: ctx.orgId,
      proposal_id: DEMO_SEED_IDS.proposalSuzukiNew,
      patient_id: DEMO_SEED_IDS.patientSuzukiNew,
      case_id: DEMO_SEED_IDS.caseSuzukiNew,
      outcome: 'attempted',
      contact_method: 'phone',
      contact_name: '鈴木 様(ご家族)',
      note: '受入可否の返答期限 本日17:00',
      callback_due_at: atLocalTimeToday(17, 0),
      called_at: atLocalTimeToday(9, 5),
      called_by: ctx.userId,
    },
    update: {
      outcome: 'attempted',
      note: '受入可否の返答期限 本日17:00',
      callback_due_at: atLocalTimeToday(17, 0),
      called_at: atLocalTimeToday(9, 5),
      called_by: ctx.userId,
    },
  });

  // ── 02/04/10: 伊藤 キヨ(88歳)— 本日 10:30 訪問・準備 4/4 完了 ────────
  await upsertDemoBoardPatient(prisma, ctx, {
    patientId: DEMO_SEED_IDS.patientIto,
    caseId: DEMO_SEED_IDS.caseIto,
    cycleId: DEMO_SEED_IDS.cycleIto,
    name: '伊藤 キヨ',
    nameKana: 'イトウ キヨ',
    age: 88,
    gender: 'female',
    cycleStatus: 'set_audited',
  });

  // 嚥下タグ(02 患者カード / 04 区分タグ)
  await prisma.patientSchedulePreference.upsert({
    where: { patient_id: DEMO_SEED_IDS.patientIto },
    create: {
      id: DEMO_SEED_IDS.schedulePreferenceIto,
      org_id: ctx.orgId,
      patient_id: DEMO_SEED_IDS.patientIto,
      swallowing_route: '錠剤OK・とろみは不要',
    },
    update: {
      swallowing_route: '錠剤OK・とろみは不要',
    },
  });

  await upsertDemoVisit(prisma, ctx, {
    id: DEMO_SEED_IDS.visitIto,
    caseId: DEMO_SEED_IDS.caseIto,
    cycleId: DEMO_SEED_IDS.cycleIto,
    scheduledDate: today,
    startTime: [10, 30],
    vehicleResourceId: DEMO_SEED_IDS.vehicleKeiVan,
    preVisitChecklistCompleted: true,
    confirmed: true,
  });

  // 準備 4/4(パケット✓ / ルート✓ / セット✓ / 前回からの変化✓)
  const itoPreparedAt = atLocalTimeToday(8, 50);
  await prisma.visitPreparation.upsert({
    where: { schedule_id: DEMO_SEED_IDS.visitIto },
    create: {
      id: DEMO_SEED_IDS.preparationIto,
      org_id: ctx.orgId,
      schedule_id: DEMO_SEED_IDS.visitIto,
      checklist: [],
      medication_changes_reviewed: true,
      carry_items_confirmed: true,
      previous_issues_reviewed: true,
      route_confirmed: true,
      prepared_by: ctx.userId,
      prepared_at: itoPreparedAt,
    },
    update: {
      medication_changes_reviewed: true,
      carry_items_confirmed: true,
      previous_issues_reviewed: true,
      route_confirmed: true,
      prepared_by: ctx.userId,
      prepared_at: itoPreparedAt,
    },
  });

  // 10_report: 訪問記録 + 報告下書き(ケアマネ 中島宛)
  const itoVisitDate = atLocalTimeToday(10, 30);
  await prisma.visitRecord.upsert({
    where: { schedule_id: DEMO_SEED_IDS.visitIto },
    create: {
      id: DEMO_SEED_IDS.visitRecordIto,
      org_id: ctx.orgId,
      schedule_id: DEMO_SEED_IDS.visitIto,
      patient_id: DEMO_SEED_IDS.patientIto,
      pharmacist_id: ctx.userId,
      visit_date: itoVisitDate,
      outcome_status: 'completed',
      soap_subjective: '服薬は自己管理できている。むせ込みなし。',
      soap_plan: 'ケアマネへ服薬状況を報告する。',
    },
    update: {
      patient_id: DEMO_SEED_IDS.patientIto,
      pharmacist_id: ctx.userId,
      visit_date: itoVisitDate,
      outcome_status: 'completed',
    },
  });
  await prisma.careReport.upsert({
    where: { id: DEMO_SEED_IDS.reportDraftIto },
    create: {
      id: DEMO_SEED_IDS.reportDraftIto,
      org_id: ctx.orgId,
      visit_record_id: DEMO_SEED_IDS.visitRecordIto,
      patient_id: DEMO_SEED_IDS.patientIto,
      case_id: DEMO_SEED_IDS.caseIto,
      report_type: 'care_manager_report',
      status: 'draft',
      content: {
        title: 'ケアマネへの訪問報告(下書き)',
        body: '実施したこと → 観察したこと → 提案 の順に記載。',
      },
      created_by: ctx.userId,
    },
    update: {
      visit_record_id: DEMO_SEED_IDS.visitRecordIto,
      report_type: 'care_manager_report',
      status: 'draft',
      created_by: ctx.userId,
    },
  });
  await prisma.careTeamLink.upsert({
    where: { id: DEMO_SEED_IDS.careTeamItoCareManager },
    create: {
      id: DEMO_SEED_IDS.careTeamItoCareManager,
      org_id: ctx.orgId,
      case_id: DEMO_SEED_IDS.caseIto,
      role: 'care_manager',
      name: '中島 桜',
      organization_name: 'きたきゅうケアプラン',
      is_primary: true,
    },
    update: {
      role: 'care_manager',
      name: '中島 桜',
      organization_name: 'きたきゅうケアプラン',
      is_primary: true,
    },
  });

  // ── 02/05/10: 高橋 茂(76歳)— 医師回答待ち2日 + FAX 重複疑い ─────────
  await upsertDemoBoardPatient(prisma, ctx, {
    patientId: DEMO_SEED_IDS.patientTakahashi,
    caseId: DEMO_SEED_IDS.caseTakahashi,
    cycleId: DEMO_SEED_IDS.cycleTakahashi,
    name: '高橋 茂',
    nameKana: 'タカハシ シゲル',
    age: 76,
    gender: 'male',
    cycleStatus: 'inquiry_pending',
    referralSource: 'みどり医院',
  });

  // 重複ペア: 3日前取込分(旧)と本日 08:55 受信分(新)が発行日・Rp構成一致
  const takahashiPrescribedDate = addDays(today, -3);
  const takahashiLine = {
    drugName: 'オキシコドン 5mg',
    dose: '1錠',
    frequency: '朝夕',
    days: 28,
    quantity: 56,
    unit: '錠',
    packagingInstructionTags: ['narcotic'] as DemoPackagingTag[],
  };
  await upsertDemoIntake(prisma, ctx, {
    id: DEMO_SEED_IDS.intakeTakahashiOld,
    cycleId: DEMO_SEED_IDS.cycleTakahashi,
    sourceType: 'fax',
    prescribedDate: takahashiPrescribedDate,
    createdAt: addDays(atLocalTimeToday(11, 0), -3),
    prescriberInstitution: 'みどり医院',
    lines: [{ id: DEMO_SEED_IDS.lineTakahashiOld, lineNumber: 1, ...takahashiLine }],
  });
  await upsertDemoIntake(prisma, ctx, {
    id: DEMO_SEED_IDS.intakeTakahashiNew,
    cycleId: DEMO_SEED_IDS.cycleTakahashi,
    sourceType: 'fax',
    prescribedDate: takahashiPrescribedDate,
    createdAt: atLocalTimeToday(8, 55),
    prescriberInstitution: 'みどり医院',
    originalDocumentUrl: 's3://ph-os-demo/fax/takahashi-regular.pdf',
    lines: [{ id: DEMO_SEED_IDS.lineTakahashiNew, lineNumber: 1, ...takahashiLine }],
  });

  // 医師回答待ち(2日経過・再照会を検討)
  const takahashiInquiredAt = addDays(atLocalTimeToday(10, 15), -2);
  await prisma.inquiryRecord.upsert({
    where: { id: DEMO_SEED_IDS.inquiryTakahashiPending },
    create: {
      id: DEMO_SEED_IDS.inquiryTakahashiPending,
      org_id: ctx.orgId,
      cycle_id: DEMO_SEED_IDS.cycleTakahashi,
      reason: '用量疑義',
      inquiry_to_physician: 'みどり医院',
      inquiry_content: 'オキシコドンの増量に伴う副作用リスクを照会',
      result: null,
      inquired_at: takahashiInquiredAt,
      resolved_at: null,
    },
    update: {
      result: null,
      inquired_at: takahashiInquiredAt,
      resolved_at: null,
    },
  });

  // 10_report「返信待ち」行2: みどり医院への疑義照会(2日経過)
  await prisma.communicationRequest.upsert({
    where: { id: DEMO_SEED_IDS.commRequestTakahashi },
    create: {
      id: DEMO_SEED_IDS.commRequestTakahashi,
      org_id: ctx.orgId,
      patient_id: DEMO_SEED_IDS.patientTakahashi,
      case_id: DEMO_SEED_IDS.caseTakahashi,
      request_type: 'inquiry',
      recipient_name: 'みどり医院',
      recipient_role: 'physician',
      status: 'sent',
      subject: 'みどり医院への疑義照会',
      content: 'オキシコドンの用量について回答待ち',
      requested_by: ctx.userId,
      requested_at: addDays(atLocalTimeToday(10, 30), -2),
    },
    update: {
      status: 'sent',
      subject: 'みどり医院への疑義照会',
      requested_at: addDays(atLocalTimeToday(10, 30), -2),
    },
  });

  await upsertDemoVisit(prisma, ctx, {
    id: DEMO_SEED_IDS.visitTakahashi,
    caseId: DEMO_SEED_IDS.caseTakahashi,
    cycleId: DEMO_SEED_IDS.cycleTakahashi,
    scheduledDate: addDays(today, 4),
    startTime: [14, 0],
  });

  // ── 02/05/09: 渡辺 フミ(91歳・冷所)— 監査済 → 明日訪問(先行可)──────
  await upsertDemoBoardPatient(prisma, ctx, {
    patientId: DEMO_SEED_IDS.patientWatanabe,
    caseId: DEMO_SEED_IDS.caseWatanabe,
    cycleId: DEMO_SEED_IDS.cycleWatanabe,
    name: '渡辺 フミ',
    nameKana: 'ワタナベ フミ',
    age: 91,
    gender: 'female',
    cycleStatus: 'audited',
  });
  await upsertDemoIntake(prisma, ctx, {
    id: DEMO_SEED_IDS.intakeWatanabe,
    cycleId: DEMO_SEED_IDS.cycleWatanabe,
    sourceType: 'paper',
    prescribedDate: addDays(today, -1),
    createdAt: addDays(atLocalTimeToday(16, 5), -1),
    prescriberInstitution: 'ご家族',
    lines: [
      {
        id: DEMO_SEED_IDS.linesWatanabe[0],
        lineNumber: 1,
        drugName: 'ランソプラゾール 15mg',
        dose: '1錠',
        frequency: '朝',
        days: 28,
        quantity: 28,
        unit: '錠',
      },
      {
        id: DEMO_SEED_IDS.linesWatanabe[1],
        lineNumber: 2,
        drugName: 'インスリン グラルギン',
        dose: '6単位',
        frequency: '夕',
        days: 28,
        quantity: 1,
        unit: '本',
        packagingInstructionTags: ['cold_storage'],
      },
    ],
  });
  await upsertDemoVisit(prisma, ctx, {
    id: DEMO_SEED_IDS.visitWatanabe,
    caseId: DEMO_SEED_IDS.caseWatanabe,
    cycleId: DEMO_SEED_IDS.cycleWatanabe,
    scheduledDate: tomorrow,
    startTime: [11, 0],
  });

  // ── 02/09: 松本 トヨ(89歳)— 監査済 → 明日訪問(渡辺との先行可ペア)────
  await upsertDemoBoardPatient(prisma, ctx, {
    patientId: DEMO_SEED_IDS.patientMatsumoto,
    caseId: DEMO_SEED_IDS.caseMatsumoto,
    cycleId: DEMO_SEED_IDS.cycleMatsumoto,
    name: '松本 トヨ',
    nameKana: 'マツモト トヨ',
    age: 89,
    gender: 'female',
    cycleStatus: 'audited',
  });
  await upsertDemoIntake(prisma, ctx, {
    id: DEMO_SEED_IDS.intakeMatsumoto,
    cycleId: DEMO_SEED_IDS.cycleMatsumoto,
    sourceType: 'paper',
    prescribedDate: addDays(today, -5),
    createdAt: addDays(atLocalTimeToday(13, 0), -5),
    prescriberInstitution: 'サンプル在宅クリニック',
    lines: [
      {
        id: DEMO_SEED_IDS.lineMatsumoto,
        lineNumber: 1,
        drugName: 'カンデサルタン 8mg',
        dose: '1錠',
        frequency: '朝',
        days: 28,
        quantity: 28,
        unit: '錠',
      },
    ],
  });
  await upsertDemoVisit(prisma, ctx, {
    id: DEMO_SEED_IDS.visitMatsumoto,
    caseId: DEMO_SEED_IDS.caseMatsumoto,
    cycleId: DEMO_SEED_IDS.cycleMatsumoto,
    scheduledDate: tomorrow,
    startTime: [14, 0],
  });

  // ── 02: 小林 勝(72歳)— 訪問完了(報告工程)─────────────────────────
  await upsertDemoBoardPatient(prisma, ctx, {
    patientId: DEMO_SEED_IDS.patientKobayashi,
    caseId: DEMO_SEED_IDS.caseKobayashi,
    cycleId: DEMO_SEED_IDS.cycleKobayashi,
    name: '小林 勝',
    nameKana: 'コバヤシ マサル',
    age: 72,
    gender: 'male',
    cycleStatus: 'visit_completed',
  });
  await upsertDemoVisit(prisma, ctx, {
    id: DEMO_SEED_IDS.visitKobayashi,
    caseId: DEMO_SEED_IDS.caseKobayashi,
    cycleId: DEMO_SEED_IDS.cycleKobayashi,
    scheduledDate: addDays(today, 6),
    startTime: [10, 0],
  });

  // ── 02/10: 加藤 ミサ(85歳)— ケアマネ返信待ち3日(再送できます)────────
  await upsertDemoBoardPatient(prisma, ctx, {
    patientId: DEMO_SEED_IDS.patientKato,
    caseId: DEMO_SEED_IDS.caseKato,
    cycleId: DEMO_SEED_IDS.cycleKato,
    name: '加藤 ミサ',
    nameKana: 'カトウ ミサ',
    age: 85,
    gender: 'female',
    cycleStatus: 'reported',
    exceptionStatus: 'awaiting_reply',
    cycleUpdatedAt: addDays(now, -3),
  });
  const katoSentAt = addDays(atLocalTimeToday(15, 30), -3);
  await prisma.careReport.upsert({
    where: { id: DEMO_SEED_IDS.reportKato },
    create: {
      id: DEMO_SEED_IDS.reportKato,
      org_id: ctx.orgId,
      patient_id: DEMO_SEED_IDS.patientKato,
      case_id: DEMO_SEED_IDS.caseKato,
      report_type: 'care_manager_report',
      status: 'sent',
      content: { title: 'ケアマネへの服薬状況報告' },
      created_by: ctx.userId,
    },
    update: {
      report_type: 'care_manager_report',
      status: 'sent',
      content: { title: 'ケアマネへの服薬状況報告' },
      created_by: ctx.userId,
    },
  });
  await prisma.deliveryRecord.upsert({
    where: { id: DEMO_SEED_IDS.deliveryKato },
    create: {
      id: DEMO_SEED_IDS.deliveryKato,
      org_id: ctx.orgId,
      report_id: DEMO_SEED_IDS.reportKato,
      channel: 'fax',
      recipient_name: 'ケアマネ 中島 桜',
      recipient_contact: '093-000-0000',
      status: 'response_waiting',
      sent_at: katoSentAt,
    },
    update: {
      status: 'response_waiting',
      sent_at: katoSentAt,
      confirmed_at: null,
    },
  });
  await upsertDemoVisit(prisma, ctx, {
    id: DEMO_SEED_IDS.visitKato,
    caseId: DEMO_SEED_IDS.caseKato,
    cycleId: DEMO_SEED_IDS.cycleKato,
    scheduledDate: addDays(today, 5),
    startTime: [11, 0],
  });

  // ── 02: 吉田 進(80歳)— 入院中(休止チップ・退院連絡待ち)──────────────
  await upsertDemoBoardPatient(prisma, ctx, {
    patientId: DEMO_SEED_IDS.patientYoshida,
    caseId: DEMO_SEED_IDS.caseYoshida,
    cycleId: DEMO_SEED_IDS.cycleYoshida,
    name: '吉田 進',
    nameKana: 'ヨシダ ススム',
    age: 80,
    gender: 'male',
    cycleStatus: 'on_hold',
    exceptionStatus: 'hospitalized',
  });

  // ── 09_set: 施設グリーンヒル(101 小川 / 102 山口 / 103 中村)────────────
  await prisma.facility.upsert({
    where: { id: DEMO_SEED_IDS.facilityGreenHill },
    create: {
      id: DEMO_SEED_IDS.facilityGreenHill,
      org_id: ctx.orgId,
      name: 'グリーンヒル',
      facility_type: 'nursing_home',
      address: '東京都千代田区丸の内2-2-2',
      total_units: 12,
    },
    update: {
      name: 'グリーンヒル',
      facility_type: 'nursing_home',
      total_units: 12,
    },
  });
  await prisma.facilityUnit.upsert({
    where: { id: DEMO_SEED_IDS.facilityUnitGreenHill },
    create: {
      id: DEMO_SEED_IDS.facilityUnitGreenHill,
      org_id: ctx.orgId,
      facility_id: DEMO_SEED_IDS.facilityGreenHill,
      name: '1F',
      floor: '1F',
      unit_type: 'floor',
      capacity: 12,
    },
    update: {
      name: '1F',
      floor: '1F',
      unit_type: 'floor',
      capacity: 12,
    },
  });

  // 施設一括訪問(本日15:30・12名): patient_ids は 12 名全員を実在患者で構成する。
  // 居室 101〜103 はセット工程の 3 名(SetPlan/SetBatch あり)、104〜112 の 9 名は
  // 患者+居室(Residence)のみの入居者として upsert する。ケース/サイクル/訪問を
  // 作らないため 02 患者一覧(cases 必須)・09 セット(本日訪問由来)の行数は不変で、
  // 「3＋施設12名」「12名分を1通に集約」の件数と patient_ids の名前解決が両立する。
  const greenHillRosterProfiles: Array<{
    name: string;
    nameKana: string;
    age: number;
    gender: 'male' | 'female';
    unitName: string;
  }> = [
    { name: '斎藤 ハツ', nameKana: 'サイトウ ハツ', age: 88, gender: 'female', unitName: '104' },
    { name: '井上 正雄', nameKana: 'イノウエ マサオ', age: 84, gender: 'male', unitName: '105' },
    { name: '木村 シゲ', nameKana: 'キムラ シゲ', age: 91, gender: 'female', unitName: '106' },
    { name: '林 武夫', nameKana: 'ハヤシ タケオ', age: 79, gender: 'male', unitName: '107' },
    { name: '清水 トミ', nameKana: 'シミズ トミ', age: 93, gender: 'female', unitName: '108' },
    { name: '山崎 茂雄', nameKana: 'ヤマザキ シゲオ', age: 86, gender: 'male', unitName: '109' },
    { name: '森 キヨ', nameKana: 'モリ キヨ', age: 90, gender: 'female', unitName: '110' },
    { name: '池田 静江', nameKana: 'イケダ シズエ', age: 82, gender: 'female', unitName: '111' },
    { name: '橋本 勇', nameKana: 'ハシモト イサム', age: 85, gender: 'male', unitName: '112' },
  ];
  for (const [index, profile] of greenHillRosterProfiles.entries()) {
    const rosterPatientId = DEMO_SEED_IDS.greenHillRosterPatients[index];
    const rosterResidenceId = DEMO_SEED_IDS.greenHillRosterResidences[index];
    const rosterPatientData = {
      name: profile.name,
      name_kana: profile.nameKana,
      birth_date: new Date(`${today.getFullYear() - profile.age}-01-15`),
      gender: profile.gender,
      allergy_info: [],
    };
    await prisma.patient.upsert({
      where: { id: rosterPatientId },
      create: { id: rosterPatientId, org_id: ctx.orgId, ...rosterPatientData },
      update: rosterPatientData,
    });
    const rosterResidenceData = {
      address: '東京都千代田区丸の内2-2-2 グリーンヒル',
      facility_id: DEMO_SEED_IDS.facilityGreenHill,
      facility_unit_id: DEMO_SEED_IDS.facilityUnitGreenHill,
      unit_name: profile.unitName,
      is_primary: true,
    };
    await prisma.residence.upsert({
      where: { id: rosterResidenceId },
      create: {
        id: rosterResidenceId,
        org_id: ctx.orgId,
        patient_id: rosterPatientId,
        ...rosterResidenceData,
      },
      update: rosterResidenceData,
    });
  }
  const greenHillPatientIds = [
    DEMO_SEED_IDS.patientOgawa,
    DEMO_SEED_IDS.patientYamaguchi,
    DEMO_SEED_IDS.patientNakamura,
    ...DEMO_SEED_IDS.greenHillRosterPatients,
  ];
  await prisma.facilityVisitBatch.upsert({
    where: { id: DEMO_SEED_IDS.facilityBatchGreenHill },
    create: {
      id: DEMO_SEED_IDS.facilityBatchGreenHill,
      org_id: ctx.orgId,
      facility_id: DEMO_SEED_IDS.facilityGreenHill,
      facility_unit_id: DEMO_SEED_IDS.facilityUnitGreenHill,
      scheduled_date: today,
      pharmacist_id: ctx.userId,
      patient_ids: greenHillPatientIds,
      estimated_duration: 90,
      notes: '居室順 101 → 102 → 103 …(配薬カートで巡回)',
    },
    update: {
      scheduled_date: today,
      pharmacist_id: ctx.userId,
      patient_ids: greenHillPatientIds,
      estimated_duration: 90,
    },
  });

  // p1_08: 施設基準チェック用の届出(研修記録のみ不足、電子的連携は未評価=確認中)
  const facilityStandardRequirements = {
    home_visit_record: true,
    emergency_response: true,
    training_record: false,
    document_delivery: true,
  };
  await prisma.facilityStandardRegistration.upsert({
    where: { id: DEMO_SEED_IDS.facilityStandardHomeCare },
    create: {
      id: DEMO_SEED_IDS.facilityStandardHomeCare,
      org_id: ctx.orgId,
      site_id: ctx.siteId,
      standard_type: '在宅薬学総合体制加算1',
      filed_date: new Date('2026-04-01T00:00:00+09:00'),
      effective_date: new Date('2026-04-01T00:00:00+09:00'),
      expiry_date: new Date('2027-03-31T00:00:00+09:00'),
      requirements_status: facilityStandardRequirements,
    },
    update: {
      requirements_status: facilityStandardRequirements,
    },
  });

  type GreenHillResidentSpec = {
    patientId: string;
    caseId: string;
    cycleId: string;
    residenceId: string;
    intakeId: string;
    visitId: string;
    planId: string;
    auditId: string | null;
    changeLogId: string;
    batchIds: readonly string[];
    name: string;
    nameKana: string;
    age: number;
    gender: 'male' | 'female';
    unitName: string;
    routeOrder: number;
    cycleStatus: DemoCycleStatus;
    allergyInfo?: Array<Record<string, string | number>>;
    lines: DemoLineSpec[];
    /** line index → セット済みスロット(全日分 day_number=1) */
    batchSlots: Array<{ lineIndex: number; slots: Array<'morning' | 'noon' | 'evening'> }>;
  };

  const greenHillResidents: GreenHillResidentSpec[] = [
    {
      patientId: DEMO_SEED_IDS.patientOgawa,
      caseId: DEMO_SEED_IDS.caseOgawa,
      cycleId: DEMO_SEED_IDS.cycleOgawa,
      residenceId: DEMO_SEED_IDS.residenceOgawa,
      intakeId: DEMO_SEED_IDS.intakeOgawa,
      visitId: DEMO_SEED_IDS.visitOgawa,
      planId: DEMO_SEED_IDS.setPlanOgawa,
      auditId: DEMO_SEED_IDS.setAuditOgawa,
      changeLogId: DEMO_SEED_IDS.setChangeLogs[0],
      batchIds: DEMO_SEED_IDS.setBatchesOgawa,
      name: '小川 タケ',
      nameKana: 'オガワ タケ',
      age: 90,
      gender: 'female',
      unitName: '101',
      routeOrder: 1,
      cycleStatus: 'set_audited',
      lines: [
        {
          id: DEMO_SEED_IDS.linesOgawa[0],
          lineNumber: 1,
          drugName: 'アムロジピン 5mg',
          dose: '1錠',
          frequency: '朝',
          days: 28,
          quantity: 28,
          unit: '錠',
        },
        {
          id: DEMO_SEED_IDS.linesOgawa[1],
          lineNumber: 2,
          drugName: 'マグミット 330mg',
          dose: '1錠',
          frequency: '毎食後',
          days: 28,
          quantity: 84,
          unit: '錠',
        },
      ],
      batchSlots: [
        { lineIndex: 0, slots: ['morning', 'noon', 'evening'] },
        { lineIndex: 1, slots: ['morning', 'noon', 'evening'] },
      ],
    },
    {
      patientId: DEMO_SEED_IDS.patientYamaguchi,
      caseId: DEMO_SEED_IDS.caseYamaguchi,
      cycleId: DEMO_SEED_IDS.cycleYamaguchi,
      residenceId: DEMO_SEED_IDS.residenceYamaguchi,
      intakeId: DEMO_SEED_IDS.intakeYamaguchi,
      visitId: DEMO_SEED_IDS.visitYamaguchi,
      planId: DEMO_SEED_IDS.setPlanYamaguchi,
      auditId: DEMO_SEED_IDS.setAuditYamaguchi,
      changeLogId: DEMO_SEED_IDS.setChangeLogs[1],
      batchIds: DEMO_SEED_IDS.setBatchesYamaguchi,
      name: '山口 清',
      nameKana: 'ヤマグチ キヨシ',
      age: 83,
      gender: 'male',
      unitName: '102',
      routeOrder: 2,
      cycleStatus: 'set_audited',
      lines: [
        {
          id: DEMO_SEED_IDS.linesYamaguchi[0],
          lineNumber: 1,
          drugName: 'ランソプラゾール 15mg',
          dose: '1錠',
          frequency: '朝',
          days: 28,
          quantity: 28,
          unit: '錠',
        },
        {
          id: DEMO_SEED_IDS.linesYamaguchi[1],
          lineNumber: 2,
          drugName: 'インスリン グラルギン',
          dose: '6単位',
          frequency: '夕',
          days: 28,
          quantity: 1,
          unit: '本',
          packagingInstructionTags: ['cold_storage'],
        },
      ],
      batchSlots: [
        { lineIndex: 0, slots: ['morning', 'noon', 'evening'] },
        { lineIndex: 1, slots: ['evening'] },
      ],
    },
    {
      patientId: DEMO_SEED_IDS.patientNakamura,
      caseId: DEMO_SEED_IDS.caseNakamura,
      cycleId: DEMO_SEED_IDS.cycleNakamura,
      residenceId: DEMO_SEED_IDS.residenceNakamura,
      intakeId: DEMO_SEED_IDS.intakeNakamura,
      visitId: DEMO_SEED_IDS.visitNakamura,
      planId: DEMO_SEED_IDS.setPlanNakamura,
      auditId: null,
      changeLogId: DEMO_SEED_IDS.setChangeLogs[2],
      batchIds: DEMO_SEED_IDS.setBatchesNakamura,
      name: '中村 ヨシ',
      nameKana: 'ナカムラ ヨシ',
      age: 87,
      gender: 'female',
      unitName: '103',
      routeOrder: 3,
      cycleStatus: 'setting',
      allergyInfo: [
        { drug_name: 'ペニシリン系', category: 'drug', severity: 'moderate', reaction: '発疹' },
      ],
      lines: [
        {
          id: DEMO_SEED_IDS.linesNakamura[0],
          lineNumber: 1,
          drugName: 'オキシコドン 5mg',
          dose: '1錠',
          frequency: '朝夕',
          days: 14,
          quantity: 28,
          unit: '錠',
          packagingInstructionTags: ['narcotic'],
        },
        {
          id: DEMO_SEED_IDS.linesNakamura[1],
          lineNumber: 2,
          drugName: 'ロスバスタチン 2.5mg',
          dose: '1錠',
          frequency: '朝',
          days: 28,
          quantity: 28,
          unit: '錠',
        },
      ],
      // 朝・昼のみセット済(夕は未) → 状態「数量確認中」/ スロット ✓✓—
      batchSlots: [
        { lineIndex: 0, slots: ['morning', 'noon'] },
        { lineIndex: 1, slots: ['morning', 'noon'] },
      ],
    },
  ];

  for (const resident of greenHillResidents) {
    await upsertDemoBoardPatient(prisma, ctx, {
      patientId: resident.patientId,
      caseId: resident.caseId,
      cycleId: resident.cycleId,
      name: resident.name,
      nameKana: resident.nameKana,
      age: resident.age,
      gender: resident.gender,
      cycleStatus: resident.cycleStatus,
      allergyInfo: resident.allergyInfo,
      referralSource: 'サンプル在宅クリニック',
    });

    await prisma.residence.upsert({
      where: { id: resident.residenceId },
      create: {
        id: resident.residenceId,
        org_id: ctx.orgId,
        patient_id: resident.patientId,
        address: '東京都千代田区丸の内2-2-2 グリーンヒル',
        facility_id: DEMO_SEED_IDS.facilityGreenHill,
        facility_unit_id: DEMO_SEED_IDS.facilityUnitGreenHill,
        unit_name: resident.unitName,
        is_primary: true,
      },
      update: {
        facility_id: DEMO_SEED_IDS.facilityGreenHill,
        facility_unit_id: DEMO_SEED_IDS.facilityUnitGreenHill,
        unit_name: resident.unitName,
        is_primary: true,
      },
    });

    await upsertDemoIntake(prisma, ctx, {
      id: resident.intakeId,
      cycleId: resident.cycleId,
      sourceType: 'paper',
      prescribedDate: addDays(today, -3),
      createdAt: addDays(atLocalTimeToday(10, 0), -3),
      prescriberInstitution: 'サンプル在宅クリニック',
      lines: resident.lines,
    });

    await upsertDemoVisit(prisma, ctx, {
      id: resident.visitId,
      caseId: resident.caseId,
      cycleId: resident.cycleId,
      scheduledDate: today,
      startTime: [15, 30],
      durationMinutes: 90,
      routeOrder: resident.routeOrder,
      facilityBatchId: DEMO_SEED_IDS.facilityBatchGreenHill,
      facilityUnitId: DEMO_SEED_IDS.facilityUnitGreenHill,
      preVisitChecklistCompleted: true,
      confirmed: true,
    });

    // SetPlan(対象期間=本日1日分)+ SetBatch(スロット充足)+ 監査
    await prisma.setPlan.upsert({
      where: { id: resident.planId },
      create: {
        id: resident.planId,
        org_id: ctx.orgId,
        cycle_id: resident.cycleId,
        target_period_start: today,
        target_period_end: today,
        set_method: 'facility_calendar',
        notes: '施設グリーンヒル 15:30 訪問分(事務が許可済みの範囲で先行準備)',
      },
      update: {
        target_period_start: today,
        target_period_end: today,
        set_method: 'facility_calendar',
      },
    });

    let batchIndex = 0;
    for (const batchSlot of resident.batchSlots) {
      const line = resident.lines[batchSlot.lineIndex];
      for (const slot of batchSlot.slots) {
        const batchId = resident.batchIds[batchIndex];
        batchIndex += 1;
        const batchData = {
          plan_id: resident.planId,
          line_id: line.id,
          slot,
          day_number: 1,
          quantity: 1,
          carry_type: 'facility_deposit',
          packaging_instruction_tags_snapshot: line.packagingInstructionTags ?? [],
        };
        await prisma.setBatch.upsert({
          where: { id: batchId },
          create: { id: batchId, org_id: ctx.orgId, ...batchData },
          update: batchData,
        });
      }
    }

    if (resident.auditId) {
      const auditedAt = addHours(now, -1);
      await prisma.setAudit.upsert({
        where: { id: resident.auditId },
        create: {
          id: resident.auditId,
          org_id: ctx.orgId,
          plan_id: resident.planId,
          result: 'approved',
          audited_by: ctx.userId,
          audited_at: auditedAt,
        },
        update: {
          result: 'approved',
          audited_by: ctx.userId,
          audited_at: auditedAt,
        },
      });
    } else {
      // 中村行は未監査(=数量確認中)を保つ。残骸の監査があれば消す。
      await prisma.setAudit.deleteMany({
        where: { org_id: ctx.orgId, plan_id: resident.planId },
      });
    }

    // 担当ラベル(事務先行準備の実施者=佐藤)
    await prisma.setBatchChangeLog.upsert({
      where: { id: resident.changeLogId },
      create: {
        id: resident.changeLogId,
        org_id: ctx.orgId,
        plan_id: resident.planId,
        action: 'prework_progress',
        trigger_source: 'manual',
        reason: '事務先行準備(許可済みの範囲: 数量セットまで)',
        before_snapshot: {},
        changed_by: ctx.dispenserUserId,
      },
      update: {
        plan_id: resident.planId,
        action: 'prework_progress',
        changed_by: ctx.dispenserUserId,
      },
    });
  }

  // ── 11_billing: 算定チェック(/api/billing-evidence/check)────────────────
  // KPI「自動チェック合格」: 当月 BillingEvidence(claimable=true)3 件。
  //   完了訪問+訪問記録に紐付ける(小林=昨日 / 加藤=4日前 / 松本=7日前。
  //   月初実行でも当月集計に乗るよう訪問日は当月 1 日でクランプ)。
  // KPI「疑義(人の確認待ち)」: BillingCandidate(status='candidate')1 件。
  //   確認文は exclusion_reason、根拠 pill は rule.source_note『算定要件』→ source_url。
  // KPI「本日訪問の算定候補」: 本日の未完了 VisitSchedule 由来のため追加投入なし
  //   (田中14:00 / 伊藤10:30 / グリーンヒル3名15:30 がソース)。
  // 右レール「算定ルール版」: home_care_ssot + effective_from 2026-04-01(令和8年改定)。
  //   is_system=false のため ensureHomeCareBillingSsot の整理 deleteMany 対象外。
  const billingMonthStart = billingMonthStartFor(now);

  type PassedEvidenceSpec = {
    visitId: string;
    recordId: string;
    evidenceId: string;
    patientId: string;
    caseId: string;
    cycleId: string;
    daysAgo: number;
    startTime: [number, number];
    payerBasis: 'medical' | 'care';
    serviceType: 'medical_home_visit' | 'care_home_management';
    appliedRuleKeys: string[];
    soapSubjective: string;
  };
  const passedEvidenceSpecs: PassedEvidenceSpec[] = [
    {
      // 小林 勝: cycle=visit_completed(02 報告工程)の根拠になる昨日の完了訪問
      visitId: DEMO_SEED_IDS.visitKobayashiDone,
      recordId: DEMO_SEED_IDS.visitRecordKobayashiDone,
      evidenceId: DEMO_SEED_IDS.billingEvidencePassed[0],
      patientId: DEMO_SEED_IDS.patientKobayashi,
      caseId: DEMO_SEED_IDS.caseKobayashi,
      cycleId: DEMO_SEED_IDS.cycleKobayashi,
      daysAgo: 1,
      startTime: [10, 0],
      payerBasis: 'medical',
      serviceType: 'medical_home_visit',
      appliedRuleKeys: ['medical.home_visit.single'],
      soapSubjective: '服薬は自己管理。残薬なし、体調安定。',
    },
    {
      // 加藤 ミサ: 報告送付(3日前)の前提になる 4 日前の完了訪問(介護=居宅療養)
      visitId: DEMO_SEED_IDS.visitKatoDone,
      recordId: DEMO_SEED_IDS.visitRecordKatoDone,
      evidenceId: DEMO_SEED_IDS.billingEvidencePassed[1],
      patientId: DEMO_SEED_IDS.patientKato,
      caseId: DEMO_SEED_IDS.caseKato,
      cycleId: DEMO_SEED_IDS.cycleKato,
      daysAgo: 4,
      startTime: [11, 0],
      payerBasis: 'care',
      serviceType: 'care_home_management',
      appliedRuleKeys: ['care.home_management.pharmacy.single'],
      soapSubjective: '飲み忘れなし。ケアマネへ服薬状況を共有予定。',
    },
    {
      // 松本 トヨ: 明日訪問(週次)の前回にあたる 7 日前の完了訪問
      visitId: DEMO_SEED_IDS.visitMatsumotoDone,
      recordId: DEMO_SEED_IDS.visitRecordMatsumotoDone,
      evidenceId: DEMO_SEED_IDS.billingEvidencePassed[2],
      patientId: DEMO_SEED_IDS.patientMatsumoto,
      caseId: DEMO_SEED_IDS.caseMatsumoto,
      cycleId: DEMO_SEED_IDS.cycleMatsumoto,
      daysAgo: 7,
      startTime: [14, 0],
      payerBasis: 'medical',
      serviceType: 'medical_home_visit',
      appliedRuleKeys: ['medical.home_visit.single'],
      soapSubjective: '血圧安定。次回も同時間帯で訪問予定。',
    },
  ];
  for (const spec of passedEvidenceSpecs) {
    const visitLocalDate = daysAgoClampedToCurrentMonth(now, spec.daysAgo);
    await upsertDemoVisit(prisma, ctx, {
      id: spec.visitId,
      caseId: spec.caseId,
      cycleId: spec.cycleId,
      scheduledDate: atMidnight(visitLocalDate),
      startTime: spec.startTime,
      scheduleStatus: 'completed',
    });
    const visitDate = atTimeOn(visitLocalDate, spec.startTime[0], spec.startTime[1]);
    await prisma.visitRecord.upsert({
      where: { schedule_id: spec.visitId },
      create: {
        id: spec.recordId,
        org_id: ctx.orgId,
        schedule_id: spec.visitId,
        patient_id: spec.patientId,
        pharmacist_id: ctx.userId,
        visit_date: visitDate,
        outcome_status: 'completed',
        soap_subjective: spec.soapSubjective,
      },
      update: {
        patient_id: spec.patientId,
        pharmacist_id: ctx.userId,
        visit_date: visitDate,
        outcome_status: 'completed',
      },
    });
    const evidenceData = {
      patient_id: spec.patientId,
      cycle_id: spec.cycleId,
      billing_month: billingMonthStart,
      payer_basis: spec.payerBasis,
      billing_service_type: spec.serviceType,
      provider_scope: 'pharmacy',
      claimable: true,
      exclusion_reason: null,
      visit_record_ref: spec.recordId,
      building_patient_count: 1,
      monthly_count_snapshot: 1,
      weekly_count_snapshot: 1,
      applied_rule_keys: spec.appliedRuleKeys,
      validation_notes: '自動チェック合格(訪問記録・同意・処方の根拠リンク済み)',
    };
    await prisma.billingEvidence.upsert({
      where: {
        org_id_visit_record_id: {
          org_id: ctx.orgId,
          visit_record_id: spec.recordId,
        },
      },
      create: {
        id: spec.evidenceId,
        org_id: ctx.orgId,
        visit_record_id: spec.recordId,
        ...evidenceData,
      },
      update: evidenceData,
    });
  }

  // 疑義行の根拠 pill(算定要件→)と右レール「算定ルール版 令和8年改定」のソース
  const billingRuleData = {
    billing_scope: 'home_care_ssot',
    rule_type: 'base',
    service_type: 'medical_home_visit',
    payer_basis: 'medical' as const,
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 0,
    name: '在宅患者訪問薬剤管理指導料 単一建物1人',
    code: 'MED_HOME_VISIT_SINGLE',
    source_url: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000188411_00045.html',
    source_note: '算定要件',
    amount: 650,
    effective_from: new Date(Date.UTC(2026, 3, 1)),
    is_system: false,
    is_active: true,
  };
  await prisma.billingRule.upsert({
    where: { id: DEMO_SEED_IDS.billingRuleHomeVisitSsot },
    create: {
      id: DEMO_SEED_IDS.billingRuleHomeVisitSsot,
      org_id: ctx.orgId,
      ...billingRuleData,
    },
    update: billingRuleData,
  });

  // 疑義(人の確認待ち)1 件: 高橋 茂 — 訪問記録はあるが同意書が旧版
  const reviewCandidateDedupeKey = 'design-demo-billing-review-consent';
  const reviewCandidateData = {
    patient_id: DEMO_SEED_IDS.patientTakahashi,
    billing_domain: 'home_care',
    billing_target_type: 'patient',
    billing_target_id: DEMO_SEED_IDS.patientTakahashi,
    billing_target_name: '高橋 茂',
    cycle_id: DEMO_SEED_IDS.cycleTakahashi,
    rule_id: DEMO_SEED_IDS.billingRuleHomeVisitSsot,
    billing_month: billingMonthStart,
    billing_code: 'MED_HOME_VISIT_SINGLE',
    billing_name: '在宅患者訪問薬剤管理指導料',
    points: 650,
    quantity: 1,
    status: 'candidate',
    exclusion_reason: '訪問記録はあるが同意書が改定前の旧版 — ご家族の再同意を確認',
  };
  await prisma.billingCandidate.upsert({
    where: {
      org_id_dedupe_key: {
        org_id: ctx.orgId,
        dedupe_key: reviewCandidateDedupeKey,
      },
    },
    create: {
      id: DEMO_SEED_IDS.billingCandidateConsentReview,
      org_id: ctx.orgId,
      dedupe_key: reviewCandidateDedupeKey,
      ...reviewCandidateData,
    },
    update: reviewCandidateData,
  });

  // ── 05_import: QR 取込ドラフト(確定1=読取98% / 破棄2=今月の破棄ログ)──
  await prisma.qrScanDraft.upsert({
    where: { id: DEMO_SEED_IDS.qrDraftConfirmed },
    create: {
      id: DEMO_SEED_IDS.qrDraftConfirmed,
      org_id: ctx.orgId,
      site_id: ctx.siteId,
      patient_id: DEMO_SEED_IDS.patientSasaki,
      scanned_by: ctx.userId,
      session_id: 'design-demo-qr-session-1',
      status: 'confirmed',
      schema_version: 1,
      raw_qr_texts: ['JAHIS5,デモ用QRテキスト(佐々木 ハル)'],
      qr_payload_hash: 'design-demo-qr-hash-001',
      parsed_data: { patient_name: '佐々木 ハル', source: 'design-demo' },
      parse_errors: [],
      // 解析エラー0件・自動補完2件 → 自動読取 98%
      auto_completed: [
        { field: 'days', reason: 'JAHIS 補完' },
        { field: 'unit', reason: 'JAHIS 補完' },
      ],
      confirmed_intake_id: DEMO_SEED_IDS.intakeSasakiCurrent,
    },
    update: {
      status: 'confirmed',
      parse_errors: [],
      auto_completed: [
        { field: 'days', reason: 'JAHIS 補完' },
        { field: 'unit', reason: 'JAHIS 補完' },
      ],
      confirmed_intake_id: DEMO_SEED_IDS.intakeSasakiCurrent,
    },
  });
  for (const [index, draftId] of DEMO_SEED_IDS.qrDraftsDiscarded.entries()) {
    await prisma.qrScanDraft.upsert({
      where: { id: draftId },
      create: {
        id: draftId,
        org_id: ctx.orgId,
        site_id: ctx.siteId,
        scanned_by: ctx.userId,
        session_id: `design-demo-qr-discard-${index + 1}`,
        status: 'discarded',
        schema_version: 1,
        raw_qr_texts: ['JAHIS5,二重読み取りのため破棄'],
        qr_payload_hash: `design-demo-qr-hash-discard-${index + 1}`,
        parsed_data: { source: 'design-demo', note: '二重読み取りのため破棄' },
        parse_errors: [],
        auto_completed: [],
      },
      update: {
        status: 'discarded',
      },
    });
  }

  // ── 10_report: 宛先別テンプレート(医師 / ケアマネ / 施設)──────────────
  const reportTemplates = [
    { id: DEMO_SEED_IDS.reportTemplates[0], name: '医師向け 訪問報告', target_role: 'physician' },
    {
      id: DEMO_SEED_IDS.reportTemplates[1],
      name: 'ケアマネ向け 訪問報告',
      target_role: 'care_manager',
    },
    {
      id: DEMO_SEED_IDS.reportTemplates[2],
      name: '施設向け 申し送り',
      target_role: 'facility_staff',
    },
  ];
  for (const template of reportTemplates) {
    await prisma.template.upsert({
      where: { id: template.id },
      create: {
        id: template.id,
        org_id: ctx.orgId,
        name: template.name,
        template_type: 'care_report',
        target_role: template.target_role,
        content: { sections: ['実施したこと', '観察したこと', '提案'] },
        is_default: template.target_role === 'care_manager',
      },
      update: {
        name: template.name,
        template_type: 'care_report',
        target_role: template.target_role,
      },
    });
  }

  // ── 08_audit 棚卸しメタ: 在庫 1 行(在庫更新日ラベルのソース)──────────
  await prisma.pharmacyDrugStock.upsert({
    where: {
      site_id_drug_master_id: {
        site_id: ctx.siteId,
        // prisma/seed.ts の SEED_IDS.injectionEligibleDrug(E2E デモ薬剤)
        drug_master_id: 'cmnhseeddrug001amq9ph-os',
      },
    },
    create: {
      id: DEMO_SEED_IDS.drugStockSample,
      org_id: ctx.orgId,
      site_id: ctx.siteId,
      drug_master_id: 'cmnhseeddrug001amq9ph-os',
      is_stocked: true,
      stock_qty: 24,
      last_reviewed_at: addDays(now, -3),
    },
    update: {
      is_stocked: true,
      stock_qty: 24,
      last_reviewed_at: addDays(now, -3),
    },
  });

  // ── ハンドオフ: 当日ボードに「私が渡した」3 件(ハンドオフバッジ = 3)────
  const handoffBoard = await prisma.handoffBoard.upsert({
    where: {
      org_id_shift_date: {
        org_id: ctx.orgId,
        shift_date: today,
      },
    },
    create: {
      org_id: ctx.orgId,
      shift_date: today,
      created_by: ctx.userId,
    },
    update: {},
  });

  // 12_handoff の責任移動ボード(私が渡した)3 枚。提案 → 作業中 → 確認中の
  // ライフサイクルと 3点セット(①scope ②rationale ③deadline)を構造化して持つ。
  const handoffItems = [
    {
      id: DEMO_SEED_IDS.handoffItems[0],
      content: '判断キュー 定型12件',
      priority: 'high',
      recipient_label: '佐藤さん',
      lifecycle_status: 'proposed',
      scope: '定型の判断のみ(非定型はあなたに残ります)',
      rationale: '判断WIP 18/目安12 — あなたの余白11分では捌けないため',
      deadline: atLocalTimeToday(17, 0),
      progress_done: null as number | null,
      progress_total: null as number | null,
      entity_type: 'dashboard',
      entity_id: 'dashboard',
      created_at: atLocalTimeToday(9, 38),
    },
    {
      id: DEMO_SEED_IDS.handoffItems[1],
      content: 'セット先行準備(施設GH)',
      priority: 'normal',
      recipient_label: '鈴木さん(事務)',
      lifecycle_status: 'in_progress',
      scope: '数量セットまで。最終確認は薬剤師(あなた)',
      rationale: null as string | null,
      deadline: null as Date | null,
      progress_done: 9,
      progress_total: 12,
      entity_type: 'medication_set',
      entity_id: DEMO_SEED_IDS.setPlan,
      created_at: addHours(now, -2),
    },
    {
      id: DEMO_SEED_IDS.handoffItems[2],
      content: '送付先の確認(やまもと内科)',
      priority: 'high',
      recipient_label: '事務',
      lifecycle_status: 'confirming',
      scope: null as string | null,
      rationale: '完了しないと田中様の本日報告書が送れません',
      deadline: addMinutes(now, 30),
      progress_done: null as number | null,
      progress_total: null as number | null,
      entity_type: 'reports',
      entity_id: 'reports',
      created_at: addMinutes(now, -30),
    },
  ];
  for (const item of handoffItems) {
    const itemData = {
      board_id: handoffBoard.id,
      content: item.content,
      priority: item.priority,
      recipient_user_id: null,
      recipient_label: item.recipient_label,
      lifecycle_status: item.lifecycle_status,
      scope: item.scope,
      rationale: item.rationale,
      deadline: item.deadline,
      progress_done: item.progress_done,
      progress_total: item.progress_total,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      read_by: [],
      created_by: ctx.userId,
      created_at: item.created_at,
    };
    await prisma.handoffItem.upsert({
      where: { id: item.id },
      create: { id: item.id, ...itemData },
      update: itemData,
    });
  }

  // ── 通知: 未読 6 件(ヘッダー「通知 6」)───────────────────────────
  const notifications = [
    {
      dedupeKey: `${NOTIFICATION_DEDUPE_PREFIX}-run-out`,
      type: 'urgent' as const,
      event_type: 'medication_run_out',
      title: '薬が切れそうです',
      message: `田中 一郎様:前回薬は本日まで。訪問予定を確認してください。`,
      link: `/patients/${DEMO_SEED_IDS.patientTanaka}`,
    },
    {
      dedupeKey: `${NOTIFICATION_DEDUPE_PREFIX}-schedule-confirm`,
      type: 'business' as const,
      event_type: 'schedule_patient_confirmation',
      title: '患者さんへ日程確認が必要です',
      message: `佐藤 花子様:候補日時 ${formatMonthDay(tomorrow)} 10:30 を確認してください。`,
      link: '/schedules/proposals',
    },
    {
      dedupeKey: `${NOTIFICATION_DEDUPE_PREFIX}-prescription-diff`,
      type: 'business' as const,
      event_type: 'prescription_diff_review',
      title: '処方変更があります',
      message: '鈴木 一郎様:追加2件・中止1件。差分確認をお願いします。',
      link: `/patients/${DEMO_SEED_IDS.patientTanaka}/prescriptions`,
    },
    {
      dedupeKey: `${NOTIFICATION_DEDUPE_PREFIX}-reply-waiting`,
      type: 'reminder' as const,
      event_type: 'reply_waiting',
      title: 'ケアマネ返信待ちです',
      message: '報告送付から2日経過しています。',
      link: '/communications/requests',
    },
    {
      dedupeKey: `${NOTIFICATION_DEDUPE_PREFIX}-previsit-checklist`,
      type: 'reminder' as const,
      event_type: 'previsit_checklist_incomplete',
      title: '訪問前チェックが未完了です',
      message: '田中 一郎様:本日14:00 訪問の準備チェックを完了してください。',
      link: '/schedules',
    },
    {
      dedupeKey: `${NOTIFICATION_DEDUPE_PREFIX}-master-updated`,
      type: 'system' as const,
      event_type: 'drug_master_updated',
      title: '医薬品マスタを更新しました',
      message: '最新の薬価データへの更新が完了しています。',
      link: '/admin/drug-masters',
    },
  ];

  for (const notification of notifications) {
    await prisma.notification.upsert({
      where: {
        org_id_user_id_dedupe_key: {
          org_id: ctx.orgId,
          user_id: ctx.userId,
          dedupe_key: notification.dedupeKey,
        },
      },
      create: {
        org_id: ctx.orgId,
        user_id: ctx.userId,
        dedupe_key: notification.dedupeKey,
        type: notification.type,
        event_type: notification.event_type,
        title: notification.title,
        message: notification.message,
        link: notification.link,
        is_read: false,
      },
      update: {
        type: notification.type,
        event_type: notification.event_type,
        title: notification.title,
        message: notification.message,
        link: notification.link,
        is_read: false,
        read_at: null,
      },
    });
  }

  console.log('Design fidelity demo seed created:', {
    patient: '田中 一郎(監査待ちサイクル RX-…-0500・麻薬/冷所/一包化・当日14:00訪問)',
    auditQueueTasks: 1 + AUDIT_QUEUE_BASE_TARGETS.length,
    dispenseQueueTasks: 1,
    dispenseResults: DEMO_SEED_IDS.dispenseResultsTanaka.length,
    boardPatients: 12,
    facilityResidents: greenHillResidents.length,
    facilityRosterPatientIds: greenHillPatientIds.length,
    billingEvidencePassed: passedEvidenceSpecs.length,
    billingReviewCandidates: 1,
    handoffItems: handoffItems.length,
    workflowExceptions: 2,
    notifications: notifications.length,
  });
}
