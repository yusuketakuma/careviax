import type { HomeLinkContext } from '@/lib/dashboard/home-link-builders';
import { buildConferencesHref, buildExternalHref } from '@/lib/dashboard/home-link-builders';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import { buildScheduleFocusHref } from '@/lib/schedules/navigation';
import { buildVisitHref } from '@/lib/visits/navigation';

export type CommunicationEntityLink = {
  href: string;
  label: string;
};

type CommunicationFilterInput = {
  status?: string | null;
  patientId?: string | null;
  requestId?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  context?: HomeLinkContext | null;
};

export function buildCommunicationRequestsHref(input: CommunicationFilterInput) {
  const params = new URLSearchParams();
  if (input.status) params.set('status', input.status);
  if (input.patientId) params.set('patient_id', input.patientId);
  if (input.requestId) params.set('request_id', input.requestId);
  if (input.relatedEntityType) params.set('related_entity_type', input.relatedEntityType);
  if (input.relatedEntityId) params.set('related_entity_id', input.relatedEntityId);
  if (input.context) params.set('context', input.context);

  const query = params.toString();
  return query ? `/communications/requests?${query}` : '/communications/requests';
}

export function resolveCommunicationEntityLink(input: {
  entityType: string | null;
  entityId: string | null;
}): CommunicationEntityLink | null {
  if (!input.entityType || !input.entityId) {
    return null;
  }

  // この関数は UI のクエリ境界(requests-content.tsx)。entityId はクエリ由来で
  // '.'/'..' 等の不正値があり得るため、共有ヘルパーの dot-segment RangeError は
  // ここで握って null(リンク非表示)に縮退させる。RangeError 以外は再 throw。
  // static 宛先(tracing_report 等)は throw しないので switch 全体を囲んでも等価。
  try {
    switch (input.entityType) {
      case 'patient':
        return {
          href: buildPatientHref(input.entityId),
          label: '患者詳細',
        };
      case 'care_report':
        return {
          href: buildReportHref(input.entityId),
          label: '報告書詳細',
        };
      case 'tracing_report':
        return {
          href: '/reports#tracing-reports',
          label: 'トレーシング一覧',
        };
      case 'visit_record':
        return {
          href: buildVisitHref(input.entityId),
          label: '訪問詳細',
        };
      case 'visit_schedule':
        return {
          href: buildScheduleFocusHref(input.entityId),
          label: 'スケジュール',
        };
      case 'conference_note':
        return {
          href: buildConferencesHref({ focus: 'notes' }),
          label: 'カンファレンス',
        };
      case 'patient_self_report':
        return {
          href: buildExternalHref({ focus: 'self_reports' }),
          label: '自己申告',
        };
      default:
        return null;
    }
  } catch (error) {
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }
}
