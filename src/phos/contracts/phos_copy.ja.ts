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
  TriageLane,
  UserRole,
  VisitArrivalOutcome,
  VisitStep,
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
