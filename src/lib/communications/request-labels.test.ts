import { describe, expect, it } from 'vitest';
import {
  formatCommunicationRecipientRoleLabel,
  formatCommunicationRequestTypeLabel,
} from './request-labels';

describe('communication request labels', () => {
  it('labels report and patient-share reply request types for queue surfaces', () => {
    expect(formatCommunicationRequestTypeLabel('care_report_reply_request')).toBe('報告書返信依頼');
    expect(formatCommunicationRequestTypeLabel('patient_share_reply_request')).toBe(
      '患者共有返信依頼',
    );
  });

  it('labels existing inquiry and emergency request types', () => {
    expect(formatCommunicationRequestTypeLabel('physician_inquiry')).toBe('疑義照会');
    expect(formatCommunicationRequestTypeLabel('emergency_physician')).toBe('主治医緊急連絡');
  });

  it('keeps unknown request types visible as unregistered instead of a raw standalone enum', () => {
    expect(formatCommunicationRequestTypeLabel('new_custom_request')).toBe(
      '未登録種別: new_custom_request',
    );
  });

  it('normalizes recipient role labels shared by report and patient share screens', () => {
    expect(formatCommunicationRecipientRoleLabel('care_manager')).toBe('ケアマネ');
    expect(formatCommunicationRecipientRoleLabel('visiting_nurse')).toBe('訪問看護');
    expect(formatCommunicationRecipientRoleLabel(null)).toBeNull();
  });
});
