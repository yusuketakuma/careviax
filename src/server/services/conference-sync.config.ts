import type { ReportType } from './conference-sync.types';

export const CONFERENCE_OPERATION_REPORT_TYPES = new Set<ReportType>([
  'physician_report',
  'care_manager_report',
  'facility_handoff',
  'nurse_share',
  'family_share',
  'internal_record',
]);

/**
 * Billing configuration per conference note_type.
 * billing_code follows the receipt-computer code standard.
 */
export const CONFERENCE_BILLING_CONFIG = {
  pre_discharge: {
    billing_code: 'B011-6',
    billing_name: '退院時共同指導料（薬局）',
    ssot_key: 'medical.discharge_joint_guidance',
    points: 600,
    ssot_ref: '調剤報酬点数表 B011-6 退院時共同指導料',
  },
  service_manager: {
    billing_code: 'MED_INFO_PROVISION_2_HA',
    billing_name: '服薬情報等提供料2 ハ',
    ssot_key: 'medical.information_provision.2_care_manager',
    points: 20,
    ssot_ref: '調剤報酬点数表 区分15の5 服薬情報等提供料2 ハ',
  },
  death_conference: {
    billing_code: 'C013',
    billing_name: 'ターミナルケア管理料（在宅ターミナルケア加算）',
    ssot_key: 'medical.addition.terminal_care',
    points: 2500,
    ssot_ref: '調剤報酬点数表 C013 在宅患者訪問薬剤管理指導料 ターミナルケア加算',
  },
} as const;

export type SupportedBillingNoteType = keyof typeof CONFERENCE_BILLING_CONFIG;

/** Maps note_type to CareReport report_type(s) per SSOT section 7-1. */
export const REPORT_TYPE_MAP: Record<string, string[]> = {
  pre_discharge: ['physician_report'],
  service_manager: ['care_manager_report'],
  death_conference: ['internal_record'],
  care_team: ['internal_record'],
  emergency: ['physician_report', 'internal_record'],
  regular: ['internal_record'],
};

export const NOTE_TYPE_LABEL: Record<string, string> = {
  pre_discharge: '退院前カンファレンス',
  service_manager: 'サービス担当者会議',
  death_conference: 'デスカンファレンス',
  care_team: '薬剤師間カンファレンス',
  emergency: '緊急カンファレンス',
  regular: '定例会議',
};
