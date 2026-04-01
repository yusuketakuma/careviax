type ConferenceNoteType =
  | 'regular'
  | 'pre_discharge'
  | 'service_manager'
  | 'care_team'
  | 'emergency'
  | 'death_conference';

export type StructuredSectionDraft = {
  key: string;
  label: string;
  body: string;
  placeholder?: string;
  rows?: number;
};

export const SECTION_TEMPLATES: Record<ConferenceNoteType, StructuredSectionDraft[]> = {
  pre_discharge: [
    {
      key: 'discharge_background',
      label: '退院背景',
      body: '',
      placeholder: '退院予定日、入院経過、在宅移行時の留意点',
      rows: 3,
    },
    {
      key: 'target_discharge_date',
      label: '退院予定日',
      body: '',
      placeholder: 'YYYY-MM-DD 形式で入力',
      rows: 2,
    },
    {
      key: 'medication_changes_on_discharge',
      label: '退院時薬剤変更',
      body: '',
      placeholder: '1行1変更で入力すると MedicationIssue に反映されます',
      rows: 4,
    },
    {
      key: 'next_visit_plan',
      label: '次回訪問計画',
      body: '',
      placeholder: '初回訪問候補日、初回確認事項、必要準備',
      rows: 3,
    },
    {
      key: 'team_roles',
      label: '退院後の役割分担',
      body: '',
      placeholder: '薬局・訪看・主治医・家族の役割整理',
      rows: 3,
    },
  ],
  service_manager: [
    {
      key: 'meeting_purpose',
      label: '会議目的',
      body: '',
      placeholder: 'ケアプラン見直し、服薬支援強化など',
      rows: 3,
    },
    {
      key: 'care_plan_changes',
      label: 'ケアプラン変更点',
      body: '',
      placeholder: '変更前後の要約、背景、判断理由',
      rows: 3,
    },
    {
      key: 'visit_schedule_adjustment',
      label: '訪問スケジュール調整',
      body: '',
      placeholder: '例: 訪問薬剤管理 月2回→月4回 / 理由: 服薬支援強化',
      rows: 4,
    },
    {
      key: 'medication_review',
      label: '服薬レビュー',
      body: '',
      placeholder: '1行1項目で入力すると MedicationIssue に反映されます',
      rows: 4,
    },
    {
      key: 'coordination_items',
      label: '連携共有事項',
      body: '',
      placeholder: 'ケアマネ共有に乗せたいポイントを整理',
      rows: 3,
    },
    {
      key: 'agreed_actions',
      label: '合意アクション',
      body: '',
      placeholder: '1行1アクションで入力するとフォローアップ Task を生成します',
      rows: 4,
    },
    {
      key: 'next_meeting_date',
      label: '次回会議日',
      body: '',
      placeholder: 'YYYY-MM-DD 形式で入力',
      rows: 2,
    },
  ],
  care_team: [
    {
      key: 'case_review',
      label: '症例レビュー',
      body: '',
      placeholder: '訪問前に引き継ぎたいリスクや観察ポイントを整理',
      rows: 3,
    },
    {
      key: 'medication_issues',
      label: '薬学課題',
      body: '',
      placeholder: '1行1課題で入力すると MedicationIssue に反映されます',
      rows: 4,
    },
    {
      key: 'intervention_outcomes',
      label: '介入結果',
      body: '',
      placeholder: '実施した介入と結果を記録',
      rows: 3,
    },
  ],
  death_conference: [
    {
      key: 'billing_confirmation',
      label: '算定根拠確認',
      body: '',
      placeholder: '死亡前14日以内の訪問実績、記録の確認内容',
      rows: 3,
    },
    {
      key: 'terminal_process',
      label: 'ターミナル経過',
      body: '',
      placeholder: '導入から看取りまでの経過を時系列で記録',
      rows: 4,
    },
    {
      key: 'improvement_actions',
      label: '改善アクション',
      body: '',
      placeholder: '再発防止や運用改善を1行ずつ記録',
      rows: 4,
    },
    {
      key: 'quality_indicators',
      label: '品質指標',
      body: '',
      placeholder: '1行1指標で入力すると月次集計対象になります',
      rows: 3,
    },
  ],
  emergency: [
    {
      key: 'incident_summary',
      label: 'インシデント概要',
      body: '',
      placeholder: '急変内容、発生時刻、背景を記録',
      rows: 3,
    },
    {
      key: 'root_cause',
      label: '原因分析',
      body: '',
      placeholder: '薬剤要因・環境要因・連携不足などを整理',
      rows: 3,
    },
    {
      key: 'immediate_actions',
      label: '即時対応内容',
      body: '',
      placeholder: '当日中の対応を1行ずつ入力すると urgent Task を起票します',
      rows: 4,
    },
    {
      key: 'risk_mitigation',
      label: '再発防止',
      body: '',
      placeholder: '次回訪問までの再発防止策を記録',
      rows: 3,
    },
  ],
  regular: [
    {
      key: 'summary',
      label: '会議要約',
      body: '',
      placeholder: '共有事項、決定事項、次回までの宿題',
      rows: 4,
    },
  ],
};

export function sectionTemplatesFor(noteType: ConferenceNoteType): StructuredSectionDraft[] {
  return SECTION_TEMPLATES[noteType] ?? SECTION_TEMPLATES.regular;
}
