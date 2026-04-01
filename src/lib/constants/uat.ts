export type UatCheckItem = {
  id: string;
  label: string;
};

export type UatCheckSection = {
  title: string;
  items: UatCheckItem[];
};

export const UAT_CHECKLIST: UatCheckSection[] = [
  {
    title: '基本フロー',
    items: [
      {
        id: 'flow_patient_to_report',
        label:
          '患者登録 → 訪問予定作成 → 訪問 → 記録 → 報告の一連フローが完遂できる',
      },
      {
        id: 'flow_prescription_cycle',
        label:
          '処方箋応需 → 調剤 → 鑑査 → 訪問の完全サイクルが滞りなく回せる',
      },
    ],
  },
  {
    title: '照会・連携フロー',
    items: [
      {
        id: 'flow_inquiry',
        label: '疑義照会の起票・送付・結果反映が一貫して行える',
      },
      {
        id: 'flow_tracing_report',
        label:
          'トレーシングレポートの作成・送付・受領確認が問題なく行える',
      },
    ],
  },
  {
    title: 'セット管理',
    items: [
      {
        id: 'flow_set_audit',
        label:
          'セットプラン作成 → セット鑑査（承認/部分承認/差戻し）→ 持参品目への反映が正しく行える',
      },
    ],
  },
  {
    title: 'データ整合性・表示',
    items: [
      {
        id: 'check_data_consistency',
        label:
          '各画面で表示されるデータが実際の操作と一致している（入力と表示の乖離がない）',
      },
      {
        id: 'check_error_handling',
        label:
          'エラー時に適切なメッセージが表示され、操作を継続できる',
      },
      {
        id: 'check_mobile',
        label:
          'モバイル端末（スマートフォン/タブレット）で主要画面が正常に操作できる',
      },
    ],
  },
];

export const UAT_PRIORITY_OPTIONS = [
  { value: 'critical', label: '重大（即対応）' },
  { value: 'high', label: '高（早期対応）' },
  { value: 'medium', label: '中（次スプリント）' },
  { value: 'low', label: '低（要望）' },
] as const;

export const UAT_STATUS_OPTIONS = [
  { value: 'open', label: '未対応' },
  { value: 'triaged', label: '仕分け済み' },
  { value: 'in_progress', label: '対応中' },
  { value: 'resolved', label: '解決済み' },
  { value: 'deferred', label: '後続送り' },
] as const;

export const UAT_CHECKLIST_LABEL_BY_ID = new Map(
  UAT_CHECKLIST.flatMap((section) => section.items.map((item) => [item.id, item.label] as const))
);
