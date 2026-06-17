import { describe, expect, it } from 'vitest';
import {
  buildCareTeamContactChannelReadiness,
  buildCareTeamReliabilitySummary,
  buildPatientContactReadiness,
  careTeamContactBadges,
  formatCareTeamContactChannels,
  normalizeCareTeamPrimaryByRole,
  normalizePatientPrimaryContacts,
  pickPrimaryCareTeamLink,
  selectPrimaryCareTeamCase,
} from './care-team-contact';

describe('care-team-contact helpers', () => {
  it('warns when a document-channel role is missing a fax number', () => {
    expect(
      careTeamContactBadges({ role: 'care_manager', fax: '', email: '', phone: '03-0000-0000' }),
    ).toEqual([
      { label: 'FAX未登録', tone: 'alert' },
      { label: '電話のみ', tone: 'muted' },
    ]);
  });

  it('marks registered fax and email channels as ok', () => {
    expect(
      careTeamContactBadges({
        role: 'physician',
        fax: '03-1234-5678',
        email: 'doctor@example.jp',
        phone: '',
      }),
    ).toEqual([
      { label: 'FAX登録済', tone: 'ok' },
      { label: 'メールOK', tone: 'ok' },
    ]);
  });

  it('shows phone-only for family-like contacts without fax warning', () => {
    expect(
      careTeamContactBadges({ role: 'other', fax: '', email: '', phone: '090-0000-0000' }),
    ).toEqual([{ label: '電話のみ', tone: 'muted' }]);
  });

  it('alerts when no contact channel is registered at all', () => {
    expect(careTeamContactBadges({ role: 'other', fax: '', email: '', phone: '' })).toEqual([
      { label: '連絡先未登録', tone: 'alert' },
    ]);
  });

  it('picks the primary link using normalized role aliases', () => {
    const result = pickPrimaryCareTeamLink(
      [
        { role: 'doctor', name: '非主担当', is_primary: false },
        { role: 'prescriber', name: '主担当', is_primary: true },
        { role: 'cm', name: 'ケアマネ', is_primary: true },
      ],
      'physician',
    );

    expect(result?.name).toBe('主担当');
  });

  it('formats contact channels without exposing empty labels', () => {
    expect(
      formatCareTeamContactChannels({
        phone: ' 03-0000-0000 ',
        fax: '',
        email: ' doctor@example.jp ',
      }),
    ).toBe('TEL 03-0000-0000 / doctor@example.jp');
  });

  it('summarizes required care-team contact channel readiness for a single recipient', () => {
    expect(
      buildCareTeamContactChannelReadiness({
        role: 'care_manager',
        phone: '03-0000-0000',
        email: null,
        fax: null,
      }),
    ).toEqual({
      ready: false,
      warnings: ['FAX未確認'],
      missing_channel_labels: ['FAX'],
    });
  });

  it('selects the active care-team case before the first ordered case', () => {
    expect(
      selectPrimaryCareTeamCase([
        { id: 'case_newer_on_hold', status: 'on_hold' },
        { id: 'case_active', status: 'active' },
      ])?.id,
    ).toBe('case_active');
  });

  it('normalizes patient contacts to one primary contact', () => {
    expect(
      normalizePatientPrimaryContacts([
        { id: 'contact_1', is_primary: true },
        { id: 'contact_2', is_primary: true },
        { id: 'contact_3', is_primary: false },
      ]),
    ).toEqual([
      { id: 'contact_1', is_primary: true },
      { id: 'contact_2', is_primary: false },
      { id: 'contact_3', is_primary: false },
    ]);
  });

  it('assigns the first contact as primary when no patient contact is marked primary', () => {
    expect(
      normalizePatientPrimaryContacts([
        { id: 'contact_1', is_primary: false },
        { id: 'contact_2', is_primary: false },
      ]),
    ).toEqual([
      { id: 'contact_1', is_primary: true },
      { id: 'contact_2', is_primary: false },
    ]);
  });

  it('normalizes care-team primary flags independently per normalized role', () => {
    expect(
      normalizeCareTeamPrimaryByRole([
        { id: 'doctor_1', role: 'doctor', is_primary: true },
        { id: 'physician_2', role: 'physician', is_primary: true },
        { id: 'nurse_1', role: 'nurse', is_primary: false },
        { id: 'nurse_2', role: 'visiting_nurse', is_primary: false },
      ]),
    ).toEqual([
      { id: 'doctor_1', role: 'doctor', is_primary: true },
      { id: 'physician_2', role: 'physician', is_primary: false },
      { id: 'nurse_1', role: 'nurse', is_primary: true },
      { id: 'nurse_2', role: 'visiting_nurse', is_primary: false },
    ]);
  });

  it('does not mark a preferred contact name without a channel as ready', () => {
    expect(
      buildPatientContactReadiness({
        contacts: [],
        preferredContactName: '長男',
        preferredContactPhone: null,
        visitBeforeContactRequired: false,
      }),
    ).toEqual({
      ready: false,
      detail: '連絡先名はありますが連絡手段が未確認です。',
    });
  });

  it('marks emergency contact phone as patient contact ready', () => {
    expect(
      buildPatientContactReadiness({
        contacts: [
          {
            is_primary: false,
            is_emergency_contact: true,
            phone: '090-0000-0000',
            email: null,
            fax: null,
          },
        ],
        preferredContactName: null,
        preferredContactPhone: null,
        visitBeforeContactRequired: true,
      }).ready,
    ).toBe(true);
  });

  it('requires a phone-capable primary or emergency contact when pre-visit call is required', () => {
    expect(
      buildPatientContactReadiness({
        contacts: [
          {
            is_primary: true,
            is_emergency_contact: false,
            phone: null,
            email: 'family@example.jp',
            fax: null,
          },
        ],
        preferredContactName: '長男',
        preferredContactPhone: null,
        visitBeforeContactRequired: true,
      }),
    ).toEqual({
      ready: false,
      detail: '訪問前連絡が必要ですが電話可能な連絡先が未確認です。',
    });
  });

  it('summarizes missing emergency contact and required care-team channels', () => {
    expect(
      buildCareTeamReliabilitySummary({
        contacts: [],
        careTeamLinks: [
          {
            role: 'doctor',
            phone: '03-0000-0000',
            fax: null,
            email: null,
            is_primary: true,
          },
        ],
      }),
    ).toMatchObject({
      needs_confirmation: true,
      alert_count: 1,
      detail: '緊急連絡先未設定 / 不足: 訪看、ケアマネ / 報告FAX未登録: 医師',
      missing_role_labels: ['訪看', 'ケアマネ'],
      phone_missing_role_labels: [],
      fax_missing_role_labels: ['医師'],
    });
  });

  it('uses primary care-team links for role reliability instead of secondary incomplete links', () => {
    expect(
      buildCareTeamReliabilitySummary({
        contacts: [{ is_emergency_contact: true, phone: '090-0000-0000' }],
        careTeamLinks: [
          {
            role: 'physician',
            phone: '03-0000-0000',
            fax: '03-0000-0001',
            email: null,
            is_primary: true,
          },
          {
            role: 'physician',
            phone: null,
            fax: null,
            email: null,
            is_primary: false,
          },
          {
            role: 'nurse',
            phone: '03-0000-0002',
            fax: '03-0000-0003',
            email: null,
            is_primary: true,
          },
          {
            role: 'care_manager',
            phone: '03-0000-0004',
            fax: '03-0000-0005',
            email: null,
            is_primary: true,
          },
        ],
      }).needs_confirmation,
    ).toBe(false);
  });

  it('keeps primary care-team link failures even when a secondary link is complete', () => {
    expect(
      buildCareTeamReliabilitySummary({
        contacts: [{ is_emergency_contact: true, phone: '090-0000-0000' }],
        careTeamLinks: [
          {
            role: 'physician',
            phone: null,
            fax: null,
            email: null,
            is_primary: true,
          },
          {
            role: 'physician',
            phone: '03-0000-0000',
            fax: '03-0000-0001',
            email: null,
            is_primary: false,
          },
          {
            role: 'nurse',
            phone: '03-0000-0002',
            fax: '03-0000-0003',
            email: null,
            is_primary: true,
          },
          {
            role: 'care_manager',
            phone: '03-0000-0004',
            fax: '03-0000-0005',
            email: null,
            is_primary: true,
          },
        ],
      }),
    ).toMatchObject({
      needs_confirmation: true,
      phone_missing_role_labels: ['医師'],
      fax_missing_role_labels: ['医師'],
    });
  });
});
