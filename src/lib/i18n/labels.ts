// ---------------------------------------------------------------------------
// MedicationCycle overall_status (14 stages)
// ---------------------------------------------------------------------------
export const medicationCycleStatusLabels: Record<string, string> = {
  prescribed: '処方済み',
  intake_confirmed: '受付確認済み',
  dispensing: '調剤中',
  dispensed: '調剤済み',
  auditing: '監査中',
  audited: '監査済み',
  setting: 'セット中',
  set_complete: 'セット完了',
  set_audited: 'セット監査済み',
  visit_ready: '訪問準備完了',
  visited: '訪問済み',
  reported: '報告済み',
  completed: '完了',
  cancelled: 'キャンセル',
};

// ---------------------------------------------------------------------------
// VisitSchedule schedule_status (10 stages)
// ---------------------------------------------------------------------------
export const visitScheduleStatusLabels: Record<string, string> = {
  planned: '予定',
  in_preparation: '準備中',
  ready: '準備完了',
  departed: '出発済み',
  in_progress: '訪問中',
  completed: '完了',
  cancelled: 'キャンセル',
  postponed: '延期',
  rescheduled: '再調整',
  no_show: '不在',
};

// ---------------------------------------------------------------------------
// CaseStatus
// ---------------------------------------------------------------------------
export const caseStatusLabels: Record<string, string> = {
  referral_received: '紹介受領',
  intake_in_progress: 'インテーク中',
  active: '稼働中',
  on_hold: '保留',
  discharged: '退会',
  cancelled: 'キャンセル',
};

// ---------------------------------------------------------------------------
// TaskStatus
// ---------------------------------------------------------------------------
export const taskStatusLabels: Record<string, string> = {
  open: '未着手',
  in_progress: '対応中',
  resolved: '解決済み',
  cancelled: 'キャンセル',
};

// ---------------------------------------------------------------------------
// Common error messages
// ---------------------------------------------------------------------------
export const errorMessages = {
  generic: 'エラーが発生しました。しばらく経ってからもう一度お試しください。',
  network: 'ネットワークエラーが発生しました。接続を確認してください。',
  unauthorized: '認証情報が無効です。再度ログインしてください。',
  forbidden: 'この操作を行う権限がありません。',
  notFound: '指定されたリソースが見つかりません。',
  validation: '入力内容に誤りがあります。修正してください。',
  conflict: '他のユーザーにより変更されています。ページを更新してください。',
  timeout: 'リクエストがタイムアウトしました。もう一度お試しください。',
  fileTooLarge: 'ファイルサイズが上限を超えています。',
  unsupportedFormat: 'サポートされていないファイル形式です。',
} as const;

// ---------------------------------------------------------------------------
// Confirmation dialog messages
// ---------------------------------------------------------------------------
export const confirmMessages = {
  delete: {
    title: '削除の確認',
    description: 'この操作は取り消せません。本当に削除しますか？',
    confirm: '削除する',
    cancel: 'キャンセル',
  },
  cancel: {
    title: 'キャンセルの確認',
    description: '入力内容は保存されません。キャンセルしますか？',
    confirm: 'キャンセルする',
    cancel: '戻る',
  },
  discard: {
    title: '変更の破棄',
    description: '保存されていない変更があります。破棄しますか？',
    confirm: '破棄する',
    cancel: '編集を続ける',
  },
  statusChange: {
    title: 'ステータス変更の確認',
    description: 'ステータスを変更します。よろしいですか？',
    confirm: '変更する',
    cancel: 'キャンセル',
  },
  submit: {
    title: '送信の確認',
    description: '送信後は編集できません。送信しますか？',
    confirm: '送信する',
    cancel: 'キャンセル',
  },
} as const;
