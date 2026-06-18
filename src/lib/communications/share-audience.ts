export type ShareAudienceKey =
  | 'physician'
  | 'care_manager'
  | 'visiting_nurse'
  | 'facility'
  | 'family';

export type ShareAudience = {
  key: ShareAudienceKey;
  label: string;
  /** CareTeamLink.role(physician/nurse/care_manager/...)との対応 */
  careTeamRoles: readonly string[];
  /** ContactParty.relation(child/facility_staff/...)との対応 */
  contactRelations: readonly string[];
};

export const SHARE_AUDIENCES: readonly ShareAudience[] = [
  {
    key: 'physician',
    label: '主治医',
    careTeamRoles: ['physician'],
    contactRelations: ['physician'],
  },
  {
    key: 'care_manager',
    label: 'ケアマネ',
    careTeamRoles: ['care_manager'],
    contactRelations: ['care_manager'],
  },
  {
    key: 'visiting_nurse',
    label: '訪問看護',
    careTeamRoles: ['nurse', 'visiting_nurse'],
    contactRelations: ['nurse'],
  },
  {
    key: 'facility',
    label: '施設',
    careTeamRoles: ['facility', 'facility_staff'],
    contactRelations: ['facility_staff'],
  },
  {
    key: 'family',
    label: '家族',
    careTeamRoles: ['family'],
    contactRelations: ['spouse', 'child', 'parent', 'sibling'],
  },
] as const;

export function shareAudienceLabel(key: ShareAudienceKey): string {
  return SHARE_AUDIENCES.find((audience) => audience.key === key)?.label ?? key;
}

/** 報告書タイプ → 初期選択する相手(デザインはケアマネ選択中) */
export function defaultAudienceForReportType(reportType: string | null): ShareAudienceKey {
  const table: Record<string, ShareAudienceKey> = {
    physician_report: 'physician',
    care_manager_report: 'care_manager',
    nurse_share: 'visiting_nurse',
    facility_handoff: 'facility',
    family_share: 'family',
  };
  return (reportType && table[reportType]) || 'care_manager';
}

/** CommunicationRequest.recipient_role(自由文字列)→ 相手 5 区分 */
export function audienceKeyFromRecipientRole(role: string | null): ShareAudienceKey | null {
  if (!role) return null;
  const normalized = role.trim().toLowerCase();
  const table: Record<string, ShareAudienceKey> = {
    physician: 'physician',
    doctor: 'physician',
    主治医: 'physician',
    医師: 'physician',
    処方元医療機関: 'physician',
    care_manager: 'care_manager',
    ケアマネ: 'care_manager',
    ケアマネジャー: 'care_manager',
    nurse: 'visiting_nurse',
    visiting_nurse: 'visiting_nurse',
    訪問看護: 'visiting_nurse',
    看護師: 'visiting_nurse',
    facility: 'facility',
    facility_staff: 'facility',
    施設: 'facility',
    family: 'family',
    家族: 'family',
    // 後方互換: 旧 visit-schedule-communication 等が永続化した ReportType 由来の
    // suffixed タクソノミー。新規データは正規値(上記)を書き込むが、既存行も宛先列に
    // 突合できるよう正規区分へマップする(意図は template_key/request_type 側が保持)。
    // mcs_collaboration / internal は返信を表示しない区分のため意図的に未登録(=null)。
    family_share: 'family',
    facility_handoff: 'facility',
    nurse_share: 'visiting_nurse',
    care_manager_report: 'care_manager',
  };
  return table[normalized] ?? null;
}
