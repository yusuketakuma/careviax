import { addDays } from 'date-fns';
import { deriveFacilityLabel } from '@/lib/utils/facility';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { prisma } from '@/lib/db/client';
import { buildPatientHref } from '@/lib/patient/navigation';
import { runJob } from '../runner';
import {
  buildDosageSupportTaskKey,
  buildEmergencyContactReviewTaskKey,
  buildFacilityBatchTrackerTaskKey,
  buildInquiryWorkbenchTaskKey,
  buildMobileVisitModeTaskKey,
  buildPatientFoundationReviewTaskKey,
  formatDateKey,
  hasAnyKeyword,
  startOfDay,
  syncGeneratedOperationalTasks,
  type GeneratedTaskSpec,
} from '../daily-helpers';
import {
  buildCareTeamReliabilitySummary,
  buildPatientContactReadiness,
} from '@/lib/patient/care-team-contact';
import { DOSAGE_SUPPORT_KEYWORDS } from './shared';

export async function syncVisitSupportFeatureTasks() {
  return runJob('visit_support_feature_task_sync', async () => {
    // scheduled_date(@db.Date)比較用: ローカル日付の UTC 深夜境界
    const today = utcDateFromLocalKey(localDateKey());
    const sevenDaysFromNow = addUtcDays(today, 7);
    const twoDaysFromNow = addUtcDays(today, 2);

    const [activeCases, firstVisitDocs, openSelfReports, unresolvedInquiries, upcomingSchedules] =
      await Promise.all([
        prisma.careCase.findMany({
          where: {
            status: { in: ['assessment', 'active', 'on_hold'] },
          },
          select: {
            id: true,
            org_id: true,
            patient_id: true,
            status: true,
            primary_pharmacist_id: true,
            patient: {
              select: {
                name: true,
                contacts: {
                  select: {
                    relation: true,
                    is_primary: true,
                    is_emergency_contact: true,
                    phone: true,
                    email: true,
                    fax: true,
                  },
                },
                scheduling_preference: {
                  select: {
                    preferred_contact_name: true,
                    preferred_contact_phone: true,
                    visit_before_contact_required: true,
                    parking_available: true,
                    care_level: true,
                  },
                },
              },
            },
            care_team_links: {
              select: {
                role: true,
                is_primary: true,
                phone: true,
                email: true,
                fax: true,
              },
            },
          },
        }),
        prisma.firstVisitDocument.findMany({
          select: {
            case_id: true,
          },
        }),
        prisma.patientSelfReport.findMany({
          where: {
            status: { in: ['submitted', 'triaged', 'converted_to_task'] },
          },
          select: {
            id: true,
            org_id: true,
            patient_id: true,
            subject: true,
            category: true,
            content: true,
            created_at: true,
          },
        }),
        prisma.inquiryRecord.findMany({
          where: {
            OR: [{ result: null }, { result: 'pending' }],
          },
          select: {
            id: true,
            org_id: true,
            reason: true,
            created_at: true,
            cycle: {
              select: {
                id: true,
                case_: {
                  select: {
                    id: true,
                    patient_id: true,
                    primary_pharmacist_id: true,
                    patient: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        prisma.visitSchedule.findMany({
          where: {
            scheduled_date: {
              gte: today,
              lte: sevenDaysFromNow,
            },
            schedule_status: {
              in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
            },
          },
          select: {
            id: true,
            org_id: true,
            pharmacist_id: true,
            site_id: true,
            scheduled_date: true,
            priority: true,
            schedule_status: true,
            preparation: {
              select: {
                offline_synced: true,
              },
            },
            case_: {
              select: {
                id: true,
                patient_id: true,
                patient: {
                  select: {
                    name: true,
                    residences: {
                      where: { is_primary: true },
                      take: 1,
                      select: {
                        building_id: true,
                        address: true,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);

    const firstVisitCaseIds = new Set(firstVisitDocs.map((item) => item.case_id));
    const patientCaseMap = new Map(activeCases.map((careCase) => [careCase.patient_id, careCase]));
    const taskSpecs: GeneratedTaskSpec[] = [];

    for (const careCase of activeCases) {
      const hasEmergencyContact = careCase.patient.contacts.some(
        (contact) => contact.is_emergency_contact || contact.relation === 'facility_staff',
      );
      const hasFirstVisitDoc = firstVisitCaseIds.has(careCase.id);
      if (hasEmergencyContact && hasFirstVisitDoc) continue;

      // due_date / sla_due_at(DateTime, 表示・SLA 用)は従来どおりローカル深夜基準
      const dueAt = addDays(startOfDay(), 1);
      const missingItems = [
        !hasEmergencyContact ? '緊急連絡先' : null,
        !hasFirstVisitDoc ? '初回文書' : null,
      ].filter((value): value is string => Boolean(value));

      taskSpecs.push({
        orgId: careCase.org_id,
        taskType: 'emergency_contact_review',
        dedupeKey: buildEmergencyContactReviewTaskKey(careCase.id),
        title: `${careCase.patient.name} の緊急連絡先・初回文書確認`,
        description: `${missingItems.join(' / ')} が不足しています。`,
        priority: 'high',
        assignedTo: careCase.primary_pharmacist_id ?? null,
        dueDate: dueAt,
        slaDueAt: dueAt,
        relatedEntityType: 'case',
        relatedEntityId: careCase.id,
        metadata: {
          case_id: careCase.id,
          patient_id: careCase.patient_id,
          patient_name: careCase.patient.name,
          missing_items: missingItems,
        },
      });
    }

    for (const careCase of activeCases) {
      if (careCase.status === 'on_hold') continue;

      const preference = careCase.patient.scheduling_preference;
      const contactReadiness = buildPatientContactReadiness({
        contacts: careCase.patient.contacts,
        preferredContactName: preference?.preferred_contact_name,
        preferredContactPhone: preference?.preferred_contact_phone,
        visitBeforeContactRequired: preference?.visit_before_contact_required,
      });
      const careTeamReliability = buildCareTeamReliabilitySummary({
        contacts: careCase.patient.contacts,
        careTeamLinks: careCase.care_team_links,
      });
      const missingItems = [
        contactReadiness.ready ? null : contactReadiness.detail,
        preference?.parking_available == null ? '駐車可否が未確認です。' : null,
        preference?.care_level ? null : '介護度が未確認です。',
        careTeamReliability.needs_confirmation ? careTeamReliability.detail : null,
      ].filter((value): value is string => Boolean(value));

      if (missingItems.length === 0) continue;

      const dueAt = addDays(startOfDay(), 2);
      taskSpecs.push({
        orgId: careCase.org_id,
        taskType: 'patient_foundation_review',
        dedupeKey: buildPatientFoundationReviewTaskKey(careCase.patient_id),
        title: `${careCase.patient.name} の患者基盤を整備`,
        description: missingItems.slice(0, 4).join(' / '),
        priority: missingItems.length >= 3 ? 'high' : 'normal',
        assignedTo: careCase.primary_pharmacist_id ?? null,
        dueDate: dueAt,
        slaDueAt: dueAt,
        relatedEntityType: 'patient',
        relatedEntityId: careCase.patient_id,
        metadata: {
          case_id: careCase.id,
          patient_id: careCase.patient_id,
          patient_name: careCase.patient.name,
          missing_items: missingItems,
          action_href: buildPatientHref(careCase.patient_id, '#patient-foundation'),
          action_label: '患者基盤を整備',
        },
      });
    }

    for (const report of openSelfReports) {
      if (
        !hasAnyKeyword([report.category, report.subject, report.content], DOSAGE_SUPPORT_KEYWORDS)
      ) {
        continue;
      }

      const careCase = patientCaseMap.get(report.patient_id);
      const dueAt = addDays(new Date(report.created_at), 1);

      taskSpecs.push({
        orgId: report.org_id,
        taskType: 'dosage_form_support',
        dedupeKey: buildDosageSupportTaskKey(report.id),
        title: `${careCase?.patient.name ?? '患者'} の剤形・服用支援確認`,
        description: `${report.subject} に対して剤形調整や一包化の検討が必要です。`,
        priority: 'high',
        assignedTo: careCase?.primary_pharmacist_id ?? null,
        dueDate: dueAt,
        slaDueAt: dueAt,
        relatedEntityType: 'patient_self_report',
        relatedEntityId: report.id,
        metadata: {
          patient_id: report.patient_id,
          case_id: careCase?.id ?? null,
          patient_name: careCase?.patient.name ?? null,
          report_subject: report.subject,
        },
      });
    }

    for (const inquiry of unresolvedInquiries) {
      const careCase = inquiry.cycle?.case_;
      if (!careCase) continue;

      const dueAt = addDays(new Date(inquiry.created_at), 1);
      taskSpecs.push({
        orgId: inquiry.org_id,
        taskType: 'inquiry_workbench',
        dedupeKey: buildInquiryWorkbenchTaskKey(inquiry.id),
        title: `${careCase.patient.name} の疑義照会確認`,
        description: inquiry.reason || '未解決の疑義照会または処方提案があります。',
        priority: 'high',
        assignedTo: careCase.primary_pharmacist_id ?? null,
        dueDate: dueAt,
        slaDueAt: dueAt,
        relatedEntityType: 'inquiry_record',
        relatedEntityId: inquiry.id,
        metadata: {
          cycle_id: inquiry.cycle.id,
          case_id: careCase.id,
          patient_id: careCase.patient_id,
          patient_name: careCase.patient.name,
        },
      });
    }

    const facilityGroups = new Map<
      string,
      {
        orgId: string;
        dateKey: string;
        pharmacistId: string;
        groupLabel: string;
        patientNames: string[];
        dueDate: Date;
      }
    >();

    for (const schedule of upcomingSchedules) {
      const residence = schedule.case_.patient.residences[0] ?? null;
      const locationKey = deriveFacilityLabel(residence ?? null);
      if (!locationKey) continue;

      const dateKey = formatDateKey(schedule.scheduled_date);
      const groupId = [
        dateKey,
        schedule.site_id ?? 'site:none',
        schedule.pharmacist_id,
        locationKey,
      ].join(':');
      const existing = facilityGroups.get(groupId);
      if (existing) {
        existing.patientNames.push(schedule.case_.patient.name);
        continue;
      }

      facilityGroups.set(groupId, {
        orgId: schedule.org_id,
        dateKey,
        pharmacistId: schedule.pharmacist_id,
        groupLabel: locationKey,
        patientNames: [schedule.case_.patient.name],
        dueDate: schedule.scheduled_date,
      });
    }

    for (const [groupId, group] of facilityGroups) {
      if (group.patientNames.length <= 1) continue;
      taskSpecs.push({
        orgId: group.orgId,
        taskType: 'facility_batch_tracker',
        dedupeKey: buildFacilityBatchTrackerTaskKey(groupId),
        title: `${group.dateKey} の施設訪問バッチ確認`,
        description: `${group.patientNames.join('、')} を同一ルートで束ねられる可能性があります。`,
        priority: group.patientNames.length >= 3 ? 'high' : 'normal',
        assignedTo: group.pharmacistId,
        dueDate: group.dueDate,
        slaDueAt: group.dueDate,
        relatedEntityType: 'visit_schedule_group',
        relatedEntityId: groupId,
        metadata: {
          facility_label: group.groupLabel,
          patient_names: group.patientNames,
          patient_count: group.patientNames.length,
        },
      });
    }

    for (const schedule of upcomingSchedules) {
      const needsOfflineSync =
        schedule.scheduled_date <= twoDaysFromNow && !schedule.preparation?.offline_synced;
      if (!needsOfflineSync) continue;

      taskSpecs.push({
        orgId: schedule.org_id,
        taskType: 'mobile_visit_mode',
        dedupeKey: buildMobileVisitModeTaskKey(schedule.id),
        title: `${schedule.case_.patient.name} のオフライン同期確認`,
        description: '訪問前に端末同期とモバイル準備を完了してください。',
        priority:
          schedule.priority === 'emergency' || schedule.priority === 'urgent' ? 'urgent' : 'high',
        assignedTo: schedule.pharmacist_id,
        dueDate: schedule.scheduled_date,
        slaDueAt: schedule.scheduled_date,
        relatedEntityType: 'visit_schedule',
        relatedEntityId: schedule.id,
        metadata: {
          patient_id: schedule.case_.patient_id,
          case_id: schedule.case_.id,
          patient_name: schedule.case_.patient.name,
          schedule_status: schedule.schedule_status,
        },
      });
    }

    await syncGeneratedOperationalTasks(taskSpecs, [
      'emergency_contact_review',
      'patient_foundation_review',
      'dosage_form_support',
      'inquiry_workbench',
      'facility_batch_tracker',
      'mobile_visit_mode',
    ]);

    return { processedCount: taskSpecs.length };
  });
}
