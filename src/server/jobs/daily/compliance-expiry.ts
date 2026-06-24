import { addDays } from 'date-fns';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { buildPatientHref } from '@/lib/patient/navigation';
import { runJob } from '../runner';
import {
  buildConsentExpiryTaskKey,
  buildFacilityStandardExpiryTaskKey,
  buildPublicSubsidyExpiryTaskKey,
  formatDateKey,
  syncGeneratedOperationalTasks,
  type GeneratedTaskSpec,
} from '../daily-helpers';
import {
  createManyNotifications,
  findAdminUserIdsByOrg,
  findPrimaryPharmacistIdsForActiveCases,
  orgPatientKey,
  type JobExecutionContext,
} from './shared';

export async function checkFacilityStandardExpiry() {
  return runJob('facility_standard_expiry_check', async () => {
    const now = new Date();
    const in60Days = addDays(now, 60);

    const expiring = await prisma.facilityStandardRegistration.findMany({
      where: {
        expiry_date: { lte: in60Days, gte: now },
      },
      include: {
        site: true,
      },
    });

    const thresholds = [
      { days: 7, priority: 'urgent' as const, label: '7日以内' },
      { days: 30, priority: 'high' as const, label: '30日以内' },
      { days: 60, priority: 'normal' as const, label: '60日以内' },
    ];

    const taskSpecs: GeneratedTaskSpec[] = [];
    const notificationData: Prisma.NotificationCreateManyInput[] = [];
    const adminUserIdsByOrg = await findAdminUserIdsByOrg(expiring.map((reg) => reg.org_id));

    for (const reg of expiring) {
      if (!reg.expiry_date) continue;
      const daysUntilExpiry = Math.ceil(
        (reg.expiry_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      const threshold = thresholds.find((t) => daysUntilExpiry <= t.days);
      if (!threshold) continue;

      for (const adminId of adminUserIdsByOrg.get(reg.org_id) ?? []) {
        notificationData.push({
          org_id: reg.org_id,
          user_id: adminId,
          type: threshold.priority === 'urgent' ? 'urgent' : 'business',
          title: '施設基準の有効期限',
          message: `${reg.standard_type}（${reg.site?.name ?? '不明'}）の有効期限が${threshold.label}に迫っています。`,
          link: '/admin/facility-standards',
          dedupe_key: `facility-std-expiry:${reg.id}:${threshold.days}`,
        });
      }

      taskSpecs.push({
        orgId: reg.org_id,
        taskType: 'facility_standard_expiry',
        dedupeKey: buildFacilityStandardExpiryTaskKey(reg.id),
        title: `施設基準更新: ${reg.standard_type}`,
        description: `${reg.site?.name ?? '不明'} の ${reg.standard_type} が ${formatDateKey(reg.expiry_date)} に期限切れ`,
        priority: threshold.priority,
        dueDate: reg.expiry_date,
        relatedEntityType: 'facility_standard_registration',
        relatedEntityId: reg.id,
      });
    }

    const notificationResult = await createManyNotifications(notificationData);

    if (taskSpecs.length > 0) {
      await syncGeneratedOperationalTasks(taskSpecs, ['facility_standard_expiry']);
    }

    return { processedCount: notificationResult.count };
  });
}

// ---------------------------------------------------------------------------
// Pharmacist credential expiry check
// ---------------------------------------------------------------------------
export async function checkCredentialExpiry() {
  return runJob('credential_expiry_check', async () => {
    const now = new Date();
    const in90Days = addDays(now, 90);

    const expiring = await prisma.pharmacistCredential.findMany({
      where: {
        expiry_date: { lte: in90Days, gte: now },
      },
      include: {
        user: { select: { id: true, org_id: true, name: true } },
      },
    });

    const thresholds = [
      { days: 30, priority: 'urgent' as const, label: '30日以内' },
      { days: 90, priority: 'high' as const, label: '90日以内' },
    ];

    const notificationData: Prisma.NotificationCreateManyInput[] = [];
    const adminUserIdsByOrg = await findAdminUserIdsByOrg(expiring.map((cred) => cred.org_id));

    for (const cred of expiring) {
      if (!cred.expiry_date) continue;
      const daysUntilExpiry = Math.ceil(
        (cred.expiry_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      const threshold = thresholds.find((t) => daysUntilExpiry <= t.days);
      if (!threshold) continue;

      // Notify the pharmacist themselves
      notificationData.push({
        org_id: cred.org_id,
        user_id: cred.user_id,
        type: threshold.priority === 'urgent' ? 'urgent' : 'reminder',
        title: '資格・認定の有効期限',
        message: `${cred.certification_type} の有効期限が${threshold.label}に迫っています。更新手続きを行ってください。`,
        link: '/settings/credentials',
        dedupe_key: `credential-expiry:${cred.id}:${threshold.days}`,
      });

      for (const adminId of adminUserIdsByOrg.get(cred.org_id) ?? []) {
        if (adminId === cred.user_id) continue; // skip if admin is the pharmacist
        notificationData.push({
          org_id: cred.org_id,
          user_id: adminId,
          type: 'business',
          title: '薬剤師資格の有効期限',
          message: `${cred.user?.name ?? '薬剤師'} の ${cred.certification_type} が${threshold.label}に期限切れ。`,
          link: '/admin/staff',
          dedupe_key: `credential-expiry-admin:${cred.id}:${adminId}:${threshold.days}`,
        });
      }
    }

    const notificationResult = await createManyNotifications(notificationData);

    return { processedCount: notificationResult.count };
  });
}

export async function checkConsentExpiry() {
  return runJob('consent_expiry_check', async () => {
    const now = new Date();
    const in30Days = addDays(now, 30);

    const expiring = await prisma.consentRecord.findMany({
      where: {
        is_active: true,
        expiry_date: { lte: in30Days, gte: now },
      },
      include: {
        patient: { select: { id: true, name: true } },
      },
    });

    const taskSpecs: GeneratedTaskSpec[] = [];
    const notificationData: Prisma.NotificationCreateManyInput[] = [];
    const activeCasePharmacists = await findPrimaryPharmacistIdsForActiveCases({
      caseIds: expiring.map((consent) => consent.case_id),
      orgPatientPairs: expiring.map((consent) => ({
        orgId: consent.org_id,
        patientId: consent.patient_id,
      })),
    });

    for (const consent of expiring) {
      if (!consent.expiry_date) continue;
      const daysUntilExpiry = Math.ceil(
        (consent.expiry_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      const priority = daysUntilExpiry <= 7 ? ('urgent' as const) : ('high' as const);
      const patientName = consent.patient?.name ?? '不明';

      const pharmacistId = consent.case_id
        ? activeCasePharmacists.byCaseId.get(consent.case_id)
        : activeCasePharmacists.byOrgPatient.get(orgPatientKey(consent.org_id, consent.patient_id));
      if (pharmacistId) {
        notificationData.push({
          org_id: consent.org_id,
          user_id: pharmacistId,
          type: priority === 'urgent' ? 'urgent' : 'business',
          title: '同意書の有効期限',
          message: `${patientName} さんの ${consent.consent_type} 同意が ${formatDateKey(consent.expiry_date)} に期限切れ。再取得が必要です。`,
          link: buildPatientHref(consent.patient_id),
          dedupe_key: `consent-expiry:${consent.id}:${daysUntilExpiry <= 7 ? '7' : '30'}`,
        });
      }

      taskSpecs.push({
        orgId: consent.org_id,
        taskType: 'consent_expiry',
        dedupeKey: buildConsentExpiryTaskKey(consent.id),
        title: `同意書更新: ${patientName}`,
        description: `${consent.consent_type} の同意が ${formatDateKey(consent.expiry_date)} に期限切れ`,
        priority,
        assignedTo: pharmacistId,
        dueDate: consent.expiry_date,
        relatedEntityType: 'consent_record',
        relatedEntityId: consent.id,
      });
    }

    const notificationResult = await createManyNotifications(notificationData);

    if (taskSpecs.length > 0) {
      await syncGeneratedOperationalTasks(taskSpecs, ['consent_expiry']);
    }

    return { processedCount: notificationResult.count };
  });
}

export async function checkPublicSubsidyExpiry(context: JobExecutionContext = {}) {
  return runJob(
    'public_subsidy_expiry_check',
    async () => {
      // valid_until(@db.Date)は UTC 深夜で保存されるため、当日分を取りこぼさないよう
      // 今日もローカル日付の UTC 深夜で表して比較する(時刻付き now では当日が gte から漏れる)。
      const today = utcDateFromLocalKey(localDateKey());
      const in30Days = addUtcDays(today, 30);

      const expiring = await prisma.patientInsurance.findMany({
        where: {
          ...(context.orgId ? { org_id: context.orgId } : {}),
          insurance_type: 'public_subsidy',
          is_active: true,
          valid_until: { lte: in30Days, gte: today },
        },
        include: {
          patient: { select: { id: true, name: true } },
        },
      });

      const taskSpecs: GeneratedTaskSpec[] = [];
      const notificationData: Prisma.NotificationCreateManyInput[] = [];
      const activeCasePharmacists = await findPrimaryPharmacistIdsForActiveCases({
        orgPatientPairs: expiring.map((insurance) => ({
          orgId: insurance.org_id,
          patientId: insurance.patient_id,
        })),
      });

      for (const insurance of expiring) {
        if (!insurance.valid_until) continue;
        const daysUntilExpiry = Math.ceil(
          (insurance.valid_until.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );
        const priority = daysUntilExpiry <= 7 ? ('urgent' as const) : ('high' as const);
        const patientName = insurance.patient?.name ?? '不明';

        const pharmacistId = activeCasePharmacists.byOrgPatient.get(
          orgPatientKey(insurance.org_id, insurance.patient_id),
        );
        if (pharmacistId) {
          notificationData.push({
            org_id: insurance.org_id,
            user_id: pharmacistId,
            type: priority === 'urgent' ? 'urgent' : 'business',
            title: '公費の有効期限',
            message: `${patientName} さんの公費受給者証が ${formatDateKey(insurance.valid_until)} に期限切れ。証書の確認が必要です。`,
            link: buildPatientHref(insurance.patient_id),
            dedupe_key: `public-subsidy-expiry:${insurance.id}:${daysUntilExpiry <= 7 ? '7' : '30'}`,
          });
        }

        taskSpecs.push({
          orgId: insurance.org_id,
          taskType: 'public_subsidy_expiry',
          dedupeKey: buildPublicSubsidyExpiryTaskKey(insurance.id),
          title: `公費更新: ${patientName}`,
          description: `公費受給者証が ${formatDateKey(insurance.valid_until)} に期限切れ`,
          priority,
          assignedTo: pharmacistId,
          dueDate: insurance.valid_until,
          relatedEntityType: 'patient_insurance',
          relatedEntityId: insurance.id,
        });
      }

      const notificationResult = await createManyNotifications(notificationData);

      await syncGeneratedOperationalTasks(taskSpecs, ['public_subsidy_expiry'], {
        scopeOrgIds: context.orgId ? [context.orgId] : undefined,
      });

      return { processedCount: notificationResult.count };
    },
    context.orgId,
  );
}
