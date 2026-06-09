import type { PrismaClient } from '@prisma/client';
import {
  ADMIN_MASTER_READINESS_GROUPS,
  type AdminMasterReadinessGroupSummary,
  type AdminMasterReadinessItem,
  type AdminMasterReadinessItemSummary,
  type AdminMasterReadinessSnapshot,
  type AdminMasterReadinessStatus,
} from '@/lib/admin/master-readiness';

type CountDelegate<T extends keyof PrismaClient> = Pick<
  Extract<PrismaClient[T], { count: unknown }>,
  'count'
>;

type DbClient = {
  auditLog: CountDelegate<'auditLog'>;
  billingRule: CountDelegate<'billingRule'>;
  businessHoliday: CountDelegate<'businessHoliday'>;
  documentDeliveryRule: CountDelegate<'documentDeliveryRule'>;
  drugAlertRule: CountDelegate<'drugAlertRule'>;
  drugInteraction: CountDelegate<'drugInteraction'>;
  drugMaster: CountDelegate<'drugMaster'>;
  drugMasterImportLog: CountDelegate<'drugMasterImportLog'>;
  drugPackageInsert: CountDelegate<'drugPackageInsert'>;
  escalationRule: CountDelegate<'escalationRule'>;
  externalProfessional: CountDelegate<'externalProfessional'>;
  facility: CountDelegate<'facility'>;
  facilityContact: CountDelegate<'facilityContact'>;
  facilityStandardRegistration: CountDelegate<'facilityStandardRegistration'>;
  facilityUnit: CountDelegate<'facilityUnit'>;
  membership: CountDelegate<'membership'>;
  notificationRule: CountDelegate<'notificationRule'>;
  packagingMethodMaster: CountDelegate<'packagingMethodMaster'>;
  pcaPump: CountDelegate<'pcaPump'>;
  pharmacistCredential: CountDelegate<'pharmacistCredential'>;
  pharmacistShift: CountDelegate<'pharmacistShift'>;
  pharmacistShiftTemplate: CountDelegate<'pharmacistShiftTemplate'>;
  pharmacyDrugStock: CountDelegate<'pharmacyDrugStock'>;
  pharmacySite: CountDelegate<'pharmacySite'>;
  pharmacySiteInsuranceConfig: CountDelegate<'pharmacySiteInsuranceConfig'>;
  prescriberInstitution: CountDelegate<'prescriberInstitution'>;
  serviceArea: CountDelegate<'serviceArea'>;
  setting: CountDelegate<'setting'>;
  template: CountDelegate<'template'>;
  user: CountDelegate<'user'>;
};

type CountMap = Record<string, number>;
type IssueMap = Record<string, string[]>;

type CountResolver = (db: DbClient, orgId: string) => Promise<number>;
type IssueResolver = (db: DbClient, orgId: string, counts: CountMap) => Promise<string[]>;

const countResolvers: Record<string, CountResolver> = {
  '/admin/settings': (db, orgId) =>
    db.setting.count({
      where: {
        OR: [{ scope_id: orgId }, { scope_id: null }],
      },
    }),
  '/admin/pharmacy-sites': (db, orgId) => db.pharmacySite.count({ where: { org_id: orgId } }),
  '/admin/business-holidays': (db, orgId) => db.businessHoliday.count({ where: { org_id: orgId } }),
  '/admin/notification-settings': async (db, orgId) => {
    const [notificationRules, escalationRules] = await Promise.all([
      db.notificationRule.count({ where: { org_id: orgId } }),
      db.escalationRule.count({ where: { org_id: orgId } }),
    ]);

    return notificationRules + escalationRules;
  },
  '/admin/facilities': (db, orgId) => db.facility.count({ where: { org_id: orgId } }),
  '/admin/service-areas': (db, orgId) => db.serviceArea.count({ where: { org_id: orgId } }),
  '/admin/facility-standards': (db, orgId) =>
    db.facilityStandardRegistration.count({ where: { org_id: orgId } }),
  '/admin/institutions': (db, orgId) =>
    db.prescriberInstitution.count({ where: { org_id: orgId } }),
  '/admin/pca-pumps': (db, orgId) => db.pcaPump.count({ where: { org_id: orgId } }),
  '/admin/external-professionals': (db, orgId) =>
    db.externalProfessional.count({ where: { org_id: orgId } }),
  '/admin/contact-profiles': async (db, orgId) => {
    const [facilityContacts, externalProfessionals, prescriberInstitutions] = await Promise.all([
      db.facilityContact.count({ where: { org_id: orgId } }),
      db.externalProfessional.count({ where: { org_id: orgId } }),
      db.prescriberInstitution.count({ where: { org_id: orgId } }),
    ]);

    return facilityContacts + externalProfessionals + prescriberInstitutions;
  },
  '/admin/document-templates': async (db, orgId) => {
    const [templates, deliveryRules] = await Promise.all([
      db.template.count({ where: { org_id: orgId } }),
      db.documentDeliveryRule.count({ where: { org_id: orgId, is_active: true } }),
    ]);

    return templates + deliveryRules;
  },
  '/admin/formulary': (db, orgId) => db.pharmacyDrugStock.count({ where: { org_id: orgId } }),
  '/admin/packaging-methods': (db, orgId) =>
    db.packagingMethodMaster.count({ where: { org_id: orgId, is_active: true } }),
  '/admin/drug-masters': (db) => db.drugMaster.count(),
  '/admin/alert-rules': (db) => db.drugAlertRule.count({ where: { is_active: true } }),
  '/admin/staff': (db, orgId) => db.membership.count({ where: { org_id: orgId, is_active: true } }),
  '/admin/users': (db, orgId) => db.user.count({ where: { org_id: orgId } }),
  '/admin/shifts': (db, orgId) => db.pharmacistShift.count({ where: { org_id: orgId } }),
  '/admin/pharmacist-credentials': (db, orgId) =>
    db.pharmacistCredential.count({ where: { org_id: orgId } }),
  '/admin/billing-rules': (db, orgId) =>
    db.billingRule.count({ where: { org_id: orgId, is_active: true } }),
  '/admin/audit-logs': (db, orgId) => db.auditLog.count({ where: { org_id: orgId } }),
};

const issueResolvers: Partial<Record<string, IssueResolver>> = {
  '/admin/pharmacy-sites': async (db, orgId, counts) => {
    if ((counts['/admin/pharmacy-sites'] ?? 0) === 0) return [];
    const [medicalConfigCount, careConfigCount] = await Promise.all([
      db.pharmacySiteInsuranceConfig.count({
        where: { org_id: orgId, insurance_type: 'medical' },
      }),
      db.pharmacySiteInsuranceConfig.count({
        where: { org_id: orgId, insurance_type: 'care' },
      }),
    ]);

    if (medicalConfigCount === 0 && careConfigCount === 0) {
      return ['薬局別の医療/介護保険算定設定が未登録です。'];
    }

    return [
      ...(medicalConfigCount === 0 ? ['医療保険の薬局別算定設定が未登録です。'] : []),
      ...(careConfigCount === 0 ? ['介護保険の薬局別算定設定が未登録です。'] : []),
    ];
  },
  '/admin/facilities': async (db, orgId, counts) => {
    if ((counts['/admin/facilities'] ?? 0) === 0) return [];
    const [unitCount, contactCount, addressMissingCount] = await Promise.all([
      db.facilityUnit.count({ where: { org_id: orgId } }),
      db.facilityContact.count({ where: { org_id: orgId } }),
      db.facility.count({
        where: {
          org_id: orgId,
          address: null,
        },
      }),
    ]);
    return [
      ...(unitCount === 0
        ? ['施設ユニットが未登録です。複数名同時訪問の順路確認に影響します。']
        : []),
      ...(contactCount === 0 ? ['施設連絡先が未登録です。訪問前後の連絡導線に影響します。'] : []),
      ...(addressMissingCount > 0 ? [`住所未登録の施設が${addressMissingCount}件あります。`] : []),
    ];
  },
  '/admin/external-professionals': async (db, orgId, counts) => {
    if ((counts['/admin/external-professionals'] ?? 0) === 0) return [];
    const noContactCount = await db.externalProfessional.count({
      where: {
        org_id: orgId,
        phone: null,
        email: null,
        fax: null,
        address: null,
      },
    });
    return noContactCount > 0 ? [`連絡先未登録の他職種が${noContactCount}件あります。`] : [];
  },
  '/admin/institutions': async (db, orgId, counts) => {
    if ((counts['/admin/institutions'] ?? 0) === 0) return [];
    const noContactCount = await db.prescriberInstitution.count({
      where: {
        org_id: orgId,
        phone: null,
        fax: null,
        address: null,
      },
    });
    return noContactCount > 0 ? [`連絡先未登録の医療機関が${noContactCount}件あります。`] : [];
  },
  '/admin/contact-profiles': async (db, orgId, counts) => {
    if ((counts['/admin/contact-profiles'] ?? 0) === 0) return [];
    const [facilityContactsNoContact, professionalsNoContact, institutionsNoContact] =
      await Promise.all([
        db.facilityContact.count({
          where: { org_id: orgId, phone: null, email: null, fax: null },
        }),
        db.externalProfessional.count({
          where: { org_id: orgId, phone: null, email: null, fax: null, address: null },
        }),
        db.prescriberInstitution.count({
          where: { org_id: orgId, phone: null, fax: null, address: null },
        }),
      ]);
    const total = facilityContactsNoContact + professionalsNoContact + institutionsNoContact;
    return total > 0 ? [`送付先候補のうち連絡手段未登録が${total}件あります。`] : [];
  },
  '/admin/document-templates': async (db, orgId, counts) => {
    if ((counts['/admin/document-templates'] ?? 0) === 0) return [];
    const [
      careReportTemplateCount,
      consentTemplateCount,
      physicianRuleCount,
      careManagerRuleCount,
    ] = await Promise.all([
      db.template.count({ where: { org_id: orgId, template_type: 'care_report' } }),
      db.template.count({ where: { org_id: orgId, template_type: 'consent_form' } }),
      db.documentDeliveryRule.count({
        where: {
          org_id: orgId,
          document_type: 'care_report',
          target_role: 'physician',
          is_active: true,
        },
      }),
      db.documentDeliveryRule.count({
        where: {
          org_id: orgId,
          document_type: 'care_report',
          target_role: 'care_manager',
          is_active: true,
        },
      }),
    ]);
    return [
      ...(careReportTemplateCount === 0 ? ['報告書テンプレートが未登録です。'] : []),
      ...(consentTemplateCount === 0 ? ['同意書テンプレートが未登録です。'] : []),
      ...(physicianRuleCount === 0 ? ['医師向け報告書の送達ルールが未設定です。'] : []),
      ...(careManagerRuleCount === 0 ? ['ケアマネ向け報告書の送達ルールが未設定です。'] : []),
    ];
  },
  '/admin/formulary': async (db, orgId, counts) => {
    if ((counts['/admin/formulary'] ?? 0) === 0) return [];
    const reorderPointMissingCount = await db.pharmacyDrugStock.count({
      where: {
        org_id: orgId,
        is_stocked: true,
        reorder_point: null,
      },
    });
    return reorderPointMissingCount > 0
      ? [`在庫下限未設定の採用薬が${reorderPointMissingCount}件あります。`]
      : [];
  },
  '/admin/drug-masters': async (db, _orgId, counts) => {
    if ((counts['/admin/drug-masters'] ?? 0) === 0) return [];
    const [packageInsertCount, interactionCount, completedImportCount] = await Promise.all([
      db.drugPackageInsert.count(),
      db.drugInteraction.count(),
      db.drugMasterImportLog.count({ where: { status: 'completed' } }),
    ]);
    return [
      ...(packageInsertCount === 0
        ? ['添付文書情報が未取込です。監査・訪問前確認に影響します。']
        : []),
      ...(interactionCount === 0 ? ['相互作用マスターが未取込です。処方監査に影響します。'] : []),
      ...(completedImportCount === 0
        ? ['医薬品マスターの取込完了履歴がありません。最新性を確認してください。']
        : []),
    ];
  },
  '/admin/notification-settings': async (db, orgId, counts) => {
    if ((counts['/admin/notification-settings'] ?? 0) === 0) return [];
    const [notificationRuleCount, escalationRuleCount] = await Promise.all([
      db.notificationRule.count({ where: { org_id: orgId } }),
      db.escalationRule.count({ where: { org_id: orgId, is_active: true } }),
    ]);
    return [
      ...(notificationRuleCount === 0
        ? ['通知ルールが未登録です。訪問・報告の滞留通知に影響します。']
        : []),
      ...(escalationRuleCount === 0
        ? ['エスカレーションルールが未登録です。滞留時の管理者通知に影響します。']
        : []),
    ];
  },
  '/admin/shifts': async (db, orgId, counts) => {
    if ((counts['/admin/shifts'] ?? 0) === 0) return [];
    const templateCount = await db.pharmacistShiftTemplate.count({ where: { org_id: orgId } });
    return templateCount === 0
      ? ['定型シフトが未登録です。翌月以降の訪問担当枠作成に影響します。']
      : [];
  },
};

function statusFromCountAndIssues(
  item: AdminMasterReadinessItem,
  count: number,
  issues: string[],
): AdminMasterReadinessStatus {
  if (count > 0) return issues.length > 0 ? 'warning' : 'ready';

  if (
    item.href === '/admin/business-holidays' ||
    item.href === '/admin/notification-settings' ||
    item.href === '/admin/facility-standards' ||
    item.href === '/admin/pharmacist-credentials' ||
    item.href === '/admin/audit-logs'
  ) {
    return 'warning';
  }

  return 'missing';
}

function detailFromStatus(status: AdminMasterReadinessStatus, count: number) {
  if (status === 'ready') return `${count}件登録済み`;
  if (status === 'warning') return '未登録または任意設定です。運用開始前に要確認。';
  return '未登録です。運用前に登録してください。';
}

function detailFromStatusAndIssues(
  status: AdminMasterReadinessStatus,
  count: number,
  issues: string[],
) {
  if (issues.length > 0) return issues.join(' / ');
  return detailFromStatus(status, count);
}

function aggregateStatus(items: AdminMasterReadinessItemSummary[]): AdminMasterReadinessStatus {
  if (items.some((item) => item.status === 'missing')) return 'missing';
  if (items.some((item) => item.status === 'warning')) return 'warning';
  return 'ready';
}

async function buildCountMap(db: DbClient, orgId: string): Promise<CountMap> {
  const entries = await Promise.all(
    Object.entries(countResolvers).map(
      async ([href, resolver]) => [href, await resolver(db, orgId)] as const,
    ),
  );

  return Object.fromEntries(entries);
}

async function buildIssueMap(db: DbClient, orgId: string, counts: CountMap): Promise<IssueMap> {
  const resolvers = Object.entries(issueResolvers).filter(
    (entry): entry is [string, IssueResolver] => typeof entry[1] === 'function',
  );
  const entries = await Promise.all(
    resolvers.map(async ([href, resolver]) => [href, await resolver(db, orgId, counts)] as const),
  );

  return Object.fromEntries(entries);
}

export async function buildAdminMasterReadinessSnapshot(
  db: DbClient,
  orgId: string,
): Promise<AdminMasterReadinessSnapshot> {
  const countMap = await buildCountMap(db, orgId);
  const issueMap = await buildIssueMap(db, orgId, countMap);

  const groups: AdminMasterReadinessGroupSummary[] = ADMIN_MASTER_READINESS_GROUPS.map((group) => {
    const items = group.items.map((item) => {
      const count = countMap[item.href] ?? 0;
      const issues = issueMap[item.href] ?? [];
      const status = statusFromCountAndIssues(item, count, issues);
      return {
        ...item,
        count,
        status,
        detail: detailFromStatusAndIssues(status, count, issues),
        issues,
      };
    });

    return {
      key: group.key,
      title: group.title,
      description: group.description,
      status: aggregateStatus(items),
      ready_count: items.filter((item) => item.status === 'ready').length,
      warning_count: items.filter((item) => item.status === 'warning').length,
      missing_count: items.filter((item) => item.status === 'missing').length,
      items,
    };
  });

  return {
    generated_at: new Date().toISOString(),
    summary: {
      ready_count: groups.reduce((sum, group) => sum + group.ready_count, 0),
      warning_count: groups.reduce((sum, group) => sum + group.warning_count, 0),
      missing_count: groups.reduce((sum, group) => sum + group.missing_count, 0),
    },
    groups,
  };
}
