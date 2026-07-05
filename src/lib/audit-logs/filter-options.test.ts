import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_ACTION_LABEL_MAP, AUDIT_LOG_TARGET_TYPE_OPTIONS } from './filter-options';

describe('audit log filter options', () => {
  it('includes the v0.2 pharmacy partnership audit target/action vocabulary', () => {
    expect(AUDIT_LOG_TARGET_TYPE_OPTIONS.map((option) => option.value)).toEqual(
      expect.arrayContaining([
        'patient',
        'break_glass_session',
        'break_glass_audit',
        'consent_record',
        'PatientShareCase',
        'PatientShareConsent',
        'patient_share_consent',
        'PatientLink',
        'patient_link',
        'PharmacyInvoice',
        'file_asset',
        'care_report',
        'audit_log',
      ]),
    );

    expect(Object.keys(AUDIT_LOG_ACTION_LABEL_MAP)).toEqual(
      expect.arrayContaining([
        'consent_records_viewed',
        'consent_record_viewed',
        'consent_record_created',
        'consent_record_updated',
        'consent_record_revoked',
        'patient_share_cases_viewed',
        'patient_share_case_created',
        'patient_share_case_activated',
        'patient_share_consents_viewed',
        'patient_share_consent_registered',
        'patient_share_consent_revoked',
        'patient_link_base_approved',
        'patient_link_accepted',
        'patient_link_declined',
        'pharmacy_invoice_issued',
        'pharmacy_invoice_payment_recorded',
        'pharmacy_invoice_cancelled',
        'pharmacy_invoice_reissued',
        'file_download',
        'care_report_print_requested',
      ]),
    );
  });

  it('localizes high-risk audit actions instead of exposing raw action ids', () => {
    expect(AUDIT_LOG_ACTION_LABEL_MAP.break_glass_access).toBe('ブレークグラスアクセス');
    expect(AUDIT_LOG_ACTION_LABEL_MAP.break_glass_activate).toBe('ブレークグラス開始');
    expect(AUDIT_LOG_ACTION_LABEL_MAP.break_glass_revoke).toBe('ブレークグラス終了');
    expect(AUDIT_LOG_ACTION_LABEL_MAP.break_glass_read).toBe('ブレークグラス閲覧');
    expect(AUDIT_LOG_ACTION_LABEL_MAP.break_glass_write).toBe('ブレークグラス変更');
    expect(AUDIT_LOG_ACTION_LABEL_MAP.patient_details_viewed).toBe('患者詳細閲覧');
  });

  it('uses the canonical singular patient-share consent mutation action names', () => {
    expect(AUDIT_LOG_ACTION_LABEL_MAP).toHaveProperty('patient_share_consent_registered');
    expect(AUDIT_LOG_ACTION_LABEL_MAP).toHaveProperty('patient_share_consent_revoked');
    expect(AUDIT_LOG_ACTION_LABEL_MAP).not.toHaveProperty('patient_share_consents_registered');
    expect(AUDIT_LOG_ACTION_LABEL_MAP).not.toHaveProperty('patient_share_consents_revoked');
  });
});
