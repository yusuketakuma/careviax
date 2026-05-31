import { describe, expect, it, vi } from 'vitest';
import { buildAdminMasterReadinessSnapshot } from './admin-master-readiness';

function count(value: number) {
  return vi.fn().mockResolvedValue(value);
}

function createDb(overrides: Record<string, number> = {}) {
  const value = (key: string, fallback = 1) => overrides[key] ?? fallback;
  return {
    setting: { count: count(value('setting')) },
    pharmacySite: { count: count(value('pharmacySite')) },
    pharmacySiteInsuranceConfig: { count: count(value('pharmacySiteInsuranceConfig')) },
    businessHoliday: { count: count(value('businessHoliday', 0)) },
    notificationRule: { count: count(value('notificationRule', 0)) },
    escalationRule: { count: count(value('escalationRule', 0)) },
    facility: { count: count(value('facility')) },
    facilityUnit: { count: count(value('facilityUnit')) },
    serviceArea: { count: count(value('serviceArea', 0)) },
    facilityStandardRegistration: { count: count(value('facilityStandardRegistration', 0)) },
    prescriberInstitution: { count: count(value('prescriberInstitution')) },
    externalProfessional: { count: count(value('externalProfessional')) },
    facilityContact: { count: count(value('facilityContact')) },
    template: { count: count(value('template')) },
    documentDeliveryRule: { count: count(value('documentDeliveryRule')) },
    pharmacyDrugStock: { count: count(value('pharmacyDrugStock')) },
    drugPackageInsert: { count: count(value('drugPackageInsert')) },
    drugInteraction: { count: count(value('drugInteraction')) },
    drugMasterImportLog: { count: count(value('drugMasterImportLog')) },
    packagingMethodMaster: { count: count(value('packagingMethodMaster')) },
    drugMaster: { count: count(value('drugMaster')) },
    drugAlertRule: { count: count(value('drugAlertRule')) },
    membership: { count: count(value('membership')) },
    user: { count: count(value('user')) },
    pharmacistShift: { count: count(value('pharmacistShift', 0)) },
    pharmacistShiftTemplate: { count: count(value('pharmacistShiftTemplate', 0)) },
    pharmacistCredential: { count: count(value('pharmacistCredential', 0)) },
    billingRule: { count: count(value('billingRule')) },
    auditLog: { count: count(value('auditLog', 0)) },
  };
}

describe('buildAdminMasterReadinessSnapshot', () => {
  it('summarizes ready, warning, and missing master data', async () => {
    const snapshot = await buildAdminMasterReadinessSnapshot(
      createDb({
        facility: 0,
        externalProfessional: 0,
        prescriberInstitution: 0,
        facilityContact: 0,
      }),
      'org_1',
    );

    expect(snapshot.groups.find((group) => group.key === 'visit-place')).toMatchObject({
      status: 'missing',
      missing_count: 3,
    });
    expect(snapshot.groups.find((group) => group.key === 'collaboration')).toMatchObject({
      status: 'missing',
    });
    expect(snapshot.summary.missing_count).toBeGreaterThan(0);
    expect(snapshot.summary.warning_count).toBeGreaterThan(0);
  });

  it('marks optional operational settings as warnings when empty', async () => {
    const snapshot = await buildAdminMasterReadinessSnapshot(
      createDb({
        businessHoliday: 0,
        notificationRule: 0,
      }),
      'org_1',
    );

    const operations = snapshot.groups.find((group) => group.key === 'operations');
    expect(operations?.items.find((item) => item.href === '/admin/business-holidays')).toMatchObject({
      status: 'warning',
    });
  });

  it('warns when registered masters are missing operational quality details', async () => {
    const snapshot = await buildAdminMasterReadinessSnapshot(
      createDb({
        facility: 2,
        facilityUnit: 0,
        facilityContact: 0,
        serviceArea: 1,
        externalProfessional: 2,
        prescriberInstitution: 1,
        documentDeliveryRule: 0,
        template: 1,
        pharmacySite: 1,
        pharmacySiteInsuranceConfig: 0,
        packagingMethodMaster: 0,
        pharmacistShift: 4,
        pharmacistShiftTemplate: 0,
        notificationRule: 2,
        escalationRule: 0,
        pharmacyDrugStock: 2,
        drugMaster: 10,
        drugPackageInsert: 0,
        drugInteraction: 0,
        drugMasterImportLog: 0,
      }),
      'org_1',
    );

    expect(snapshot.groups.find((group) => group.key === 'visit-place')).toMatchObject({
      status: 'warning',
    });
    expect(snapshot.groups.find((group) => group.key === 'operations')?.items).toContainEqual(
      expect.objectContaining({
        href: '/admin/pharmacy-sites',
        status: 'warning',
        detail: '薬局別の医療/介護保険算定設定が未登録です。',
      }),
    );
    expect(snapshot.groups.find((group) => group.key === 'collaboration')?.items).toContainEqual(
      expect.objectContaining({
        href: '/admin/document-templates',
        status: 'warning',
      }),
    );
    expect(snapshot.groups.find((group) => group.key === 'pharmacy-work')?.items).toContainEqual(
      expect.objectContaining({
        href: '/admin/packaging-methods',
        status: 'missing',
      }),
    );
    expect(snapshot.groups.find((group) => group.key === 'pharmacy-work')?.items).toContainEqual(
      expect.objectContaining({
        href: '/admin/drug-masters',
        status: 'warning',
        issues: expect.arrayContaining([
          '添付文書情報が未取込です。監査・訪問前確認に影響します。',
          '相互作用マスターが未取込です。処方監査に影響します。',
          '医薬品マスターの取込完了履歴がありません。最新性を確認してください。',
        ]),
      }),
    );
    expect(snapshot.groups.find((group) => group.key === 'pharmacy-work')?.items).toContainEqual(
      expect.objectContaining({
        href: '/admin/formulary',
        status: 'warning',
        detail: '在庫下限未設定の採用薬が2件あります。',
      }),
    );
    expect(snapshot.groups.find((group) => group.key === 'staff-billing')?.items).toContainEqual(
      expect.objectContaining({
        href: '/admin/shifts',
        status: 'warning',
        detail: '定型シフトが未登録です。翌月以降の訪問担当枠作成に影響します。',
      }),
    );
    expect(snapshot.groups.find((group) => group.key === 'operations')?.items).toContainEqual(
      expect.objectContaining({
        href: '/admin/notification-settings',
        status: 'warning',
        detail: 'エスカレーションルールが未登録です。滞留時の管理者通知に影響します。',
      }),
    );
  });
});
