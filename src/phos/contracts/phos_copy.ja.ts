import {
  ActionCode,
  BoardDensity,
  BoardSortKey,
  BoardQuickFilter,
  ButtonState,
  CurrentStep,
  DisplayStatus,
  HandoffStatus,
  HandoffUrgency,
  RejectReason,
  SourceRefKind,
  TriageLane,
  UserRole,
  VisitArrivalOutcome,
  VisitStep,
} from './phos_contracts';
import type {
  ClaimWarning,
  ClinicalSignal,
  CommunicationRecommendation,
  DeliveryTargetView,
  PharmacistDecisionRequired,
  SupportTaskView,
} from './phos_contracts';

export const PhosActionLabel = {
  [ActionCode.REGISTER_PRESCRIPTION]: '処方を登録する',
  [ActionCode.CONFIRM_PRESCRIPTION_DIFF]: '処方差分を確認する',
  [ActionCode.START_DISPENSING]: '調剤を開始する',
  [ActionCode.COMPLETE_DISPENSING]: '調剤を完了する',
  [ActionCode.START_DISPENSING_AUDIT]: '調剤監査を開始する',
  [ActionCode.APPROVE_DISPENSING_AUDIT]: '調剤監査を承認する',
  [ActionCode.REJECT_DISPENSING_AUDIT]: '調剤監査を差し戻す',
  [ActionCode.CREATE_SET_INSTRUCTION]: 'セット指示を作成する',
  [ActionCode.COMPLETE_SET]: 'セットを完了する',
  [ActionCode.START_SET_AUDIT]: 'セット監査を開始する',
  [ActionCode.APPROVE_SET_AUDIT]: 'セット監査を承認する',
  [ActionCode.REJECT_SET_AUDIT]: 'セット監査を差し戻す',
  [ActionCode.ASSIGN_TO_VISIT_PACKET]: '訪問便へ割り当てる',
  [ActionCode.SCHEDULE_VISIT_PACKET]: '訪問便を予定する',
  [ActionCode.CONFIRM_VISIT_READY]: '訪問準備を確認する',
  [ActionCode.START_VISIT]: '訪問を開始する',
  [ActionCode.COMPLETE_VISIT]: '訪問を完了する',
  [ActionCode.CREATE_REPORT_DRAFT]: '報告書下書きを作成する',
  [ActionCode.APPROVE_REPORT]: '報告書を承認する',
  [ActionCode.SEND_REPORT]: '報告書を送付する',
  [ActionCode.MARK_REPORT_WAITING_REPLY]: '返信待ちにする',
  [ActionCode.REGISTER_REPORT_REPLY]: '返信を登録する',
  [ActionCode.MARK_REPORT_ACTION_DONE]: '返信対応を完了する',
  [ActionCode.REVIEW_CLAIM_CANDIDATES]: '算定候補を確認する',
  [ActionCode.EXCLUDE_CLAIM_CANDIDATE]: '算定候補を除外する',
  [ActionCode.CLOSE_CARD]: 'カードをクローズする',
  [ActionCode.REOPEN_CARD]: 'カードを再開する',
  [ActionCode.CANCEL_CARD]: 'カードをキャンセルする',
  [ActionCode.UPLOAD_EVIDENCE]: '証跡を添付する',
  [ActionCode.CREATE_HANDOFF_TO_PHARMACIST]: '薬剤師へ確認依頼する',
  [ActionCode.RESOLVE_CLERK_BLOCKER]: '事務対応の不足を解消する',
} as const satisfies Record<ActionCode, string>;

export const PhosDisabledReason = {
  OFFLINE_NOT_ALLOWED: 'オフライン中はこの操作を実行できません。',
  READONLY_CLOSED: 'クローズまたはキャンセル済みのカードは編集できません。',
  NO_PERMISSION: 'この操作を実行する権限がありません。',
  FOREIGN_BLOCKER: '他の担当者による確認が必要です。',
  GUARD_FAILED: '必要な情報が不足しています。',
} as const;

export const PhosButtonStateCopy = {
  [ButtonState.ACTIONABLE]: '実行できます。',
  [ButtonState.RESOLVABLE_BLOCK]: '自分が解消できる不足があります。',
  [ButtonState.FOREIGN_BLOCK]: '他の担当者による確認が必要です。',
  [ButtonState.NO_PERMISSION]: 'この操作は薬剤師確認が必要です。',
  [ButtonState.READONLY_CLOSED]: 'クローズまたはキャンセル済みです。',
  [ButtonState.OFFLINE_BLOCKED]: '同期後に再試行してください。',
} as const satisfies Record<ButtonState, string>;

export const PhosUserRoleLabel = {
  [UserRole.PHARMACIST]: '薬剤師',
  [UserRole.PHARMACY_CLERK]: '薬局事務員',
  [UserRole.DISPENSE_ASSISTANT]: '調剤補助',
  [UserRole.MANAGER]: '管理薬剤師',
  [UserRole.ADMIN]: '管理者',
} as const satisfies Record<UserRole, string>;

export const PhosBlockerMessageLabel: Readonly<Record<string, string>> = {
  'blocker.missing_evidence': '証跡が不足しています。',
  'blocker.need_pharmacist': '薬剤師の判断が必要です。',
  'blocker.pharmacist_review': '薬剤師の確認が必要です。',
  'blocker.visit_absent_followup': '不在後のフォローが必要です。',
} as const;

export const PhosSourceRefKindLabel = {
  [SourceRefKind.PRESCRIPTION]: '処方原文',
  [SourceRefKind.PREVIOUS_VISIT]: '前回訪問記録',
  [SourceRefKind.MEDICATION_HISTORY]: '薬歴・服薬履歴',
  [SourceRefKind.OTHER_PRO_MESSAGE]: '他職種メッセージ',
  [SourceRefKind.RULE_DOCUMENT]: '算定・制度資料',
  [SourceRefKind.EVIDENCE_FILE]: '写真・証跡',
  [SourceRefKind.CARE_PLAN]: 'ケアプラン',
} as const satisfies Record<SourceRefKind, string>;

export const PhosSourceDrawerCopy = {
  TITLE: '参照情報',
  OPEN: '参照情報を開く',
  EMPTY: '参照情報はありません。',
  DESCRIPTION: '処方原文、前回訪問記録、写真証跡などの根拠を確認します。',
  CAPTURED_AT: '取得日時',
  COUNT_SUFFIX: '件',
  ORIGINAL: '原文',
  WORKSPACE_SECTION_HEADING: '参照情報',
} as const;

export const PhosShortcutHelpCopy = {
  TITLE: 'ショートカット',
  DESCRIPTION: '現在の画面で使えるキーボード操作です。',
} as const;

export const PhosShortcutHelpRows = [
  { keys: '/', label: 'Board検索へ移動' },
  { keys: 'j / k', label: '次/前のカードへ移動' },
  { keys: 'Enter', label: 'カードを開く' },
  { keys: 'Space', label: '主アクションを実行' },
  { keys: 'Esc', label: 'Workspaceを閉じる' },
  { keys: 'g then 1..5', label: 'Workspaceタブを切替' },
  { keys: '[ / ]', label: '開いているカードを前後移動' },
  { keys: '?', label: 'ショートカットを表示' },
] as const;

export const PhosClinicalSignalCodeLabel = {
  DOSE_INCREASE: '増量',
  NEW_HIGH_RISK: '高リスク薬',
  DISCONTINUATION: '中止',
  INTERACTION_SUSPECT: '相互作用疑い',
  ADHERENCE_DROP: '服薬状況低下',
  ADR_SUSPECT: '副作用疑い',
  RESIDUAL_EXCESS: '残薬過多',
  RENAL_HEPATIC_WATCH: '腎肝機能注意',
} as const satisfies Record<ClinicalSignal['code'], string>;

export const PhosDecisionReasonLabel = {
  DIFF_REVIEW: '処方差分',
  RESIDUAL_ADJUSTMENT: '残薬調整',
  ADVERSE_EVENT: '副作用確認',
  CLAIM_JUDGE: '算定判断',
  VISIT_SAFETY: '訪問安全',
} as const satisfies Record<PharmacistDecisionRequired['reason_code'], string>;

export const PhosCommunicationIntentLabel = {
  ASK_PRESCRIBER: '医師確認',
  SHARE_CARE_TEAM: '他職種共有',
  REPORT_DELIVERY: '報告送付',
  REPLY_FOLLOWUP: '返信対応',
  FAMILY_CONFIRMATION: '家族確認',
} as const satisfies Record<CommunicationRecommendation['intent'], string>;

export const PhosCommunicationTargetTypeLabel = {
  DOCTOR: '医師',
  CARE_MANAGER: 'ケアマネ',
  VISITING_NURSE: '訪問看護',
  FACILITY: '施設',
  FAMILY: '家族',
} as const satisfies Record<CommunicationRecommendation['target_type'], string>;

export const PhosClaimCandidateStatusLabel = {
  CANDIDATE: '候補',
  MISSING_EVIDENCE: '証跡不足',
  READY: '確認可能',
  EXCLUDED: '除外',
  APPROVED: '確認済み',
} as const satisfies Record<ClaimWarning['status'], string>;

export const PhosPharmacistBriefCopy = {
  TITLE: '薬剤師判断',
  EMPTY: '薬剤師判断に必要な追加情報はありません。',
  DECISIONS_HEADING: '判断してください',
  CLINICAL_SIGNALS_HEADING: '臨床シグナル',
  COMMUNICATION_HEADING: '発信候補',
  CLAIM_WARNINGS_HEADING: '算定・証跡警告',
  SOURCE_REFS_HEADING: '根拠',
  WHY_PREFIX: '理由',
  RECOMMENDED_ACTION_PREFIX: '推奨操作',
  TARGET_PREFIX: '宛先',
  RATIONALE_PREFIX: '根拠',
  MISSING_EVIDENCE_PREFIX: '不足証跡',
  MISSING_EVIDENCE_SUFFIX: '件',
  NOTE_LABEL: '補足',
  NOTE_PLACEHOLDER: '必要な補足を入力してください',
  OPTION_NOT_ACTIONABLE: 'この選択は記録のみです',
  ACTION_REQUIRED: '実行する操作があります',
} as const;

export const PhosSupportTaskCodeLabel = {
  INTAKE: '処方受付情報の整理',
  CONTACT_SETUP: '連絡先の確認',
  SCHEDULE_INPUT: '訪問候補日時の入力',
  DOCUMENT_RECORD: '文書交付記録',
  REPORT_PREP: '報告書送付準備',
  REPLY_FOLLOWUP: '返信待ち確認',
  EVIDENCE_ATTACH: '証跡添付',
} as const satisfies Record<SupportTaskView['task_code'], string>;

export const PhosDeliveryMethodLabel = {
  FAX: 'FAX',
  EMAIL: 'メール',
  PHONE: '電話',
  HAND_DELIVERY: '手渡し',
  MCS: 'MCS',
} as const satisfies Record<DeliveryTargetView['delivery_method'], string>;

export const PhosHandoffReturnReasonLabel: Readonly<Record<string, string>> = {
  NEED_MORE_INFO: '情報の追加が必要です',
  MISSING_SOURCE: '根拠の追加が必要です',
  WRONG_TARGET: '確認先の見直しが必要です',
  NEED_CONTACT: '連絡先の確認が必要です',
  NEED_EVIDENCE: '証跡の追加が必要です',
  OTHER: '追加確認が必要です',
} as const;

export const PhosHandoffCreateReasonLabel: Readonly<Record<string, string>> = {
  SEND_CONFIRMATION: '送付前確認',
  DIFF_REVIEW: '処方差分',
  RESIDUAL: '残薬',
  REPORT_TEXT: '報告文面',
  OTHER: 'その他',
} as const;

export const PhosHandoffPanelCopy = {
  TITLE: '薬剤師確認依頼',
  COUNT_SUFFIX: '件',
  EMPTY: '確認依頼はありません。',
  CREATE_BUTTON: '確認依頼を作成',
  CREATE_REASON_LABEL: '理由',
  CREATE_SUMMARY_LABEL: '要約',
  URGENCY_LABEL: '緊急度',
  REQUESTED_ACTION_LABEL: '希望対応',
  REQUESTED_ACTION_REVIEW_ONLY: '確認のみ',
  CREATE_SUBMIT: '作成する',
  CREATE_REQUIRED_ERROR: '理由と要約を入力してください。',
  SOURCE_REQUIRED_ERROR: '確認元の参照が必要です。',
  START_REVIEW: '確認を開始',
  RESOLVE_ARIA: '確認依頼を解決する',
  RESOLVE_UNCONFIGURED_ARIA: '確認依頼を解決する（操作未指定）',
  NO_RESOLVE_ACTION: '解決操作なし',
  RETURN_BUTTON: '事務へ戻す',
  RETURN_REASON_LABEL: '差し戻し理由',
  RETURN_NOTE_LABEL: '差し戻しメモ',
  RETURN_REQUIRED_ERROR: '差し戻し理由とメモを入力してください。',
  RETURN_SUBMIT: '差し戻す',
  SOURCE_COUNT_SUFFIX: '参照',
} as const;

export const PhosSupportBriefCopy = {
  TITLE: '事務サポート',
  EMPTY: 'いま事務で処理できる作業はありません。',
  COUNT_SUFFIX: '件',
  TASKS_HEADING: '事務でできること',
  MISSING_CONTACTS_HEADING: '不足連絡先',
  DELIVERY_TARGETS_HEADING: '送付先準備',
  SCHEDULE_CANDIDATES_HEADING: '訪問候補時間',
  MISSING_EVIDENCES_HEADING: '不足証跡',
  WAITING_REPLIES_HEADING: '返信待ち',
  PHARMACIST_REVIEW_HEADING: '薬剤師確認が必要なこと',
  ENABLED: '対応できます',
  BLOCKED: '確認が必要です',
  READY: '準備済み',
  NOT_READY: '未準備',
  REQUIRED: '必須',
  OPTIONAL: '任意',
  TARGET_PREFIX: '宛先',
  MISSING_FIELDS_PREFIX: '不足項目',
  MISSING_FIELDS_SUFFIX: '件',
  METHOD_PREFIX: '方法',
  SCHEDULE_PREFIX: '候補',
  STALE_MINUTES_SUFFIX: '分経過',
  RETURNED_HEADING: '差し戻し',
  RETURNED_DETAIL_PREFIX: '追加すること',
} as const;

export const PhosReportComposerCopy = {
  TITLE: '報告書作成',
  TARGET_TABS_LABEL: '宛先タブ',
  DELIVERY_METHOD: '送付方法',
  TARGET_READY: '送付先準備済み',
  TARGET_NOT_READY: '送付先未設定',
  BODY_LABEL: '報告本文',
  TEMPLATE_SECTIONS: 'テンプレート',
  SOURCE_CHIPS: '根拠',
  APPROVAL_PANEL: '薬剤師承認',
  APPROVAL_REQUIRED: '送付前に薬剤師承認が必要です',
  MISSING_TARGET_PANEL: '送付先確認',
  DELIVERY_HISTORY: '送付履歴',
  NO_DELIVERY_HISTORY: '送付履歴はありません',
  EMPTY_TARGETS: '送付先がありません',
  EMPTY_SOURCES: '根拠はありません',
} as const;

export const PhosReportsPageCopy = {
  LOADING: 'PH-OS 返信待ちを読み込み中',
  API_BASE_URL_MISSING: 'PH-OS API Gateway base URL is not configured.',
  ACCESS_TOKEN_MISSING: 'PH-OS access token provider is not configured.',
  LOAD_FAILED: 'PH-OS report delivery load failed.',
  ACTION_FAILED: 'PH-OS report delivery action failed.',
} as const;

export const PhosReportComposerTemplateLabel = {
  DOCTOR: {
    ASSESSMENT: '薬学的評価',
    ADVERSE_EVENT: '副作用疑い',
    PROPOSAL: '処方提案',
    RESIDUAL: '残薬',
    URGENCY: '緊急性',
  },
  CARE_MANAGER: {
    SUPPORT: '服薬支援方法',
    REQUEST: '家族・ヘルパー依頼',
    LIFE: '生活課題',
    NEXT: '次回確認',
  },
  VISITING_NURSE: {
    OBSERVATION: '観察依頼',
    CHANGE: '症状変化',
    ADHERENCE: '服薬状況',
    VOICE: '声かけポイント',
  },
  FACILITY: {
    SET_CHANGE: 'セット変更',
    MANAGEMENT: '管理方法',
    ROOM: '部屋番号',
    LOCATION: '設置場所',
    HANDOFF: '申し送り',
  },
  FAMILY: {
    HOW_TO_TAKE: '服薬方法',
    WARNING: '注意症状',
    NEXT_CHECK: '次回までの確認事項',
  },
} as const satisfies Record<CommunicationRecommendation['target_type'], Record<string, string>>;

export const PhosToast = {
  REPORT_SENT_OK: '報告書を送付しました。',
  HANDOFF_CREATED_OK: '薬剤師への確認依頼を作成しました。',
  CLAIM_CANDIDATE_EXCLUDED_OK: '算定候補を除外しました。',
  SYNC_DONE: '同期が完了しました。',
  SYNC_CONFLICT_FOUND: '更新の競合があります。',
  PHOTO_QUEUED: '写真を未同期として保存しました。',
  NET_ERROR_RETRY: '通信できません。再試行してください。',
} as const;

export const PhosToastMessageByKey: Readonly<Record<string, string>> = {
  'toast.handoff.created': PhosToast.HANDOFF_CREATED_OK,
  'toast.claim_candidate_excluded': PhosToast.CLAIM_CANDIDATE_EXCLUDED_OK,
  'toast.action.error': PhosToast.NET_ERROR_RETRY,
} as const;

export const PhosEmptyState = {
  EMPTY_TODAY_NONE: '本日対応予定のカードはありません。',
  CARD_EMPTY_TITLE: '条件に一致するカードはありません。',
  CARD_EMPTY_BODY: '検索条件を変更してください。',
  EMPTY_CLERK_NONE: 'いま事務で処理できる作業はありません。',
  EMPTY_PHARMACIST_QUEUE: '判断待ちのカードはありません。',
  EMPTY_CAPACITY_NO_AVAIL: 'スタッフ可処分時間が未登録です。',
  BRIEF_NO_SIGNAL: '特記すべき臨床シグナルはありません。',
  VISIT_NO_RESIDUAL: '今回確認すべき残薬はありません。',
  EMPTY_HANDOFF: '確認依頼はありません。',
  EMPTY_WAITING_REPLY: '返信待ちはありません。',
} as const;

export const PhosBoardCopy = {
  SEARCH_PLACEHOLDER: '患者名・施設名・薬剤名・担当者で検索',
  SEARCH_LABEL: 'Board検索',
  SORT_LABEL: '並び順',
  DENSITY_LABEL: '表示密度',
  RESET_FILTERS: '検索条件を解除',
} as const;

export const PhosBoardDensityLabel = {
  [BoardDensity.COMFORTABLE]: '標準',
  [BoardDensity.COMPACT]: 'コンパクト',
} as const satisfies Record<BoardDensity, string>;

export const PhosBoardQuickFilterLabel = {
  [BoardQuickFilter.ALL]: 'すべて',
  [BoardQuickFilter.TODAY]: '本日',
  [BoardQuickFilter.MY_ASSIGNED]: '自分の担当',
  [BoardQuickFilter.INCOMPLETE]: '未完了',
  [BoardQuickFilter.PHARMACIST_REVIEW]: '薬剤師判断待ち',
  [BoardQuickFilter.CLERK_READY]: '事務対応可',
  [BoardQuickFilter.SET_AUDIT_WAITING]: 'セット監査待ち',
  [BoardQuickFilter.VISIT_READY_CHECK]: '訪問前確認',
  [BoardQuickFilter.REPORT_UNSENT]: '報告未送付',
  [BoardQuickFilter.WAITING_REPLY]: '返信待ち',
  [BoardQuickFilter.MISSING_EVIDENCE]: '証跡不足',
  [BoardQuickFilter.URGENT]: '緊急',
} as const satisfies Record<BoardQuickFilter, string>;

export const PhosTriageLaneLabel = {
  [TriageLane.TODAY_VISIT]: '本日訪問',
  [TriageLane.PHARMACIST_REVIEW]: '薬剤師判断待ち',
  [TriageLane.CLERK_READY]: '事務対応可',
  [TriageLane.REPORT_UNSENT]: '報告未送付',
  [TriageLane.WAITING_REPLY]: '返信待ち',
  [TriageLane.MISSING_EVIDENCE]: '証跡不足',
} as const satisfies Record<TriageLane, string>;

export const PhosBoardSortLabel = {
  [BoardSortKey.VISIT_TIME]: '訪問時間順',
  [BoardSortKey.URGENCY]: '緊急度順',
  [BoardSortKey.STALE_TIME]: '滞留時間順',
  [BoardSortKey.CURRENT_STEP]: '現在工程順',
  [BoardSortKey.ASSIGNEE]: '担当者順',
  [BoardSortKey.FACILITY]: '施設順',
  [BoardSortKey.UPDATED]: '更新順',
} as const satisfies Record<BoardSortKey, string>;

export const PhosVisitStepLabel = {
  [VisitStep.ARRIVAL_CONFIRM]: '到着確認',
  [VisitStep.TODAY_BRIEF_ACK]: '本日の要点確認',
  [VisitStep.DELIVERY_AND_SET]: '交付・セット',
  [VisitStep.RESIDUAL_CHECK]: '残薬確認',
  [VisitStep.ADHERENCE_ADR_CHECK]: '服薬・副作用確認',
  [VisitStep.EXPLANATION]: '説明',
  [VisitStep.NEXT_SCHEDULE]: '次回予定',
  [VisitStep.EVIDENCE_UPLOAD]: '証跡添付',
  [VisitStep.REPORT_SEED]: '報告下書き',
  [VisitStep.COMPLETE_CHECK]: '完了確認',
} as const satisfies Record<VisitStep, string>;

export const PhosVisitArrivalOutcomeLabel = {
  [VisitArrivalOutcome.PRESENT]: '在宅',
  [VisitArrivalOutcome.ABSENT]: '不在',
  [VisitArrivalOutcome.POSTPONED]: '延期',
  [VisitArrivalOutcome.CANCELED]: 'キャンセル',
} as const satisfies Record<VisitArrivalOutcome, string>;

export const PhosVisitStepStateLabel = {
  NOT_STARTED: '未入力',
  IN_PROGRESS: '入力中',
  COMPLETED: '完了',
  OPTIONAL: '任意',
} as const;

export const PhosVisitFooterCopy = {
  PREVIOUS: '前へ',
  SAVE_DRAFT: '一時保存',
  NEXT: '次へ',
  SAVED_LOCAL: '一時保存しました',
  SAVED_SERVER: '一時保存しました。同期済みです',
} as const;

export const PhosVisitModePageCopy = {
  EYEBROW: 'PH-OS VisitMode',
  TITLE: 'VisitMode',
  DESCRIPTION: '訪問中の確認、記録、証跡同期、完了前チェックを訪問パケット単位で処理します。',
  LOADING: '訪問モードを読み込み中',
  API_BASE_URL_MISSING: 'PH-OS API Gateway base URL is not configured.',
  ACCESS_TOKEN_MISSING: 'PH-OS access token provider is not configured.',
  ACTION_FAILED: 'PH-OS visit-mode action failed.',
  CARD_ID_MISSING: 'この訪問パケットには証跡を紐づけるカードIDがありません。',
} as const;

export const PhosHandoffStatusLabel = {
  [HandoffStatus.OPEN]: '未着手',
  [HandoffStatus.IN_REVIEW]: '確認中',
  [HandoffStatus.RESOLVED]: '解決済み',
  [HandoffStatus.RETURNED]: '差し戻し',
} as const satisfies Record<HandoffStatus, string>;

export const PhosHandoffUrgencyLabel = {
  [HandoffUrgency.LOW]: '低',
  [HandoffUrgency.NORMAL]: '通常',
  [HandoffUrgency.HIGH]: '高',
  [HandoffUrgency.URGENT]: '至急',
} as const satisfies Record<HandoffUrgency, string>;

export const PhosRejectReasonLabel = {
  [RejectReason.WRONG_DRUG]: '薬剤が違う',
  [RejectReason.WRONG_DOSE]: '用量が違う',
  [RejectReason.WRONG_TIMING]: '用法・タイミングが違う',
  [RejectReason.WRONG_QUANTITY]: '数量が違う',
  [RejectReason.DISCONTINUED_NOT_REMOVED]: '中止薬が残っている',
  [RejectReason.PHOTO_INSUFFICIENT]: '写真証跡が不足している',
  [RejectReason.OTHER]: 'その他',
} as const satisfies Record<RejectReason, string>;

export const PhosDisplayStatusLabel = {
  [DisplayStatus.READY]: '対応可',
  [DisplayStatus.WAITING]: '待機中',
  [DisplayStatus.IN_PROGRESS]: '対応中',
  [DisplayStatus.BLOCKED]: '不足あり',
  [DisplayStatus.REVIEW_REQUIRED]: '薬剤師判断待ち',
  [DisplayStatus.REJECTED]: '差し戻し',
  [DisplayStatus.CLOSED]: 'クローズ',
  [DisplayStatus.CANCELED]: 'キャンセル',
} as const satisfies Record<DisplayStatus, string>;

export const PhosCurrentStepLabel = {
  [CurrentStep.INTAKE]: '処方受付',
  [CurrentStep.DIFF_REVIEW]: '差分確認',
  [CurrentStep.DISPENSING]: '調剤',
  [CurrentStep.DISPENSING_AUDIT]: '調剤監査',
  [CurrentStep.SET_PREP]: 'セット準備',
  [CurrentStep.SETTING]: 'セット',
  [CurrentStep.SET_AUDIT]: 'セット監査',
  [CurrentStep.VISIT_ASSIGNMENT]: '訪問割当',
  [CurrentStep.VISIT_READY_CHECK]: '訪問準備確認',
  [CurrentStep.VISIT_READY]: '訪問準備完了',
  [CurrentStep.VISIT_IN_PROGRESS]: '訪問中',
  [CurrentStep.REPORT]: '報告',
  [CurrentStep.REPORT_SEND]: '報告送付',
  [CurrentStep.CLAIM_REVIEW]: '算定確認',
  [CurrentStep.CLOSING]: 'クローズ確認',
  [CurrentStep.CLOSED]: 'クローズ済み',
} as const satisfies Record<CurrentStep, string>;
