import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

type UpsertOperationalTaskInput = {
  orgId: string;
  taskType: string;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  assignedTo?: string | null;
  dueDate?: Date | null;
  slaDueAt?: Date | null;
  dedupeKey?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  status?: TaskStatus;
};

type ResolveOperationalTaskInput = {
  orgId: string;
  dedupeKey?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  taskType?: string | null;
  status?: Extract<TaskStatus, 'completed' | 'cancelled'>;
};

type OperationalTaskPresentation = {
  actionHref: string;
  actionLabel: string;
  queueLabel: string;
};

export async function upsertOperationalTask(
  tx: Tx,
  input: UpsertOperationalTaskInput
) {
  const nextStatus = input.status ?? 'pending';

  if (input.dedupeKey) {
    return tx.task.upsert({
      where: {
        org_id_dedupe_key: {
          org_id: input.orgId,
          dedupe_key: input.dedupeKey,
        },
      },
      create: {
        org_id: input.orgId,
        task_type: input.taskType,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 'normal',
        status: nextStatus,
        assigned_to: input.assignedTo ?? null,
        due_date: input.dueDate ?? null,
        sla_due_at: input.slaDueAt ?? null,
        dedupe_key: input.dedupeKey,
        related_entity_type: input.relatedEntityType ?? null,
        related_entity_id: input.relatedEntityId ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
        ...(nextStatus === 'completed' ? { completed_at: new Date() } : {}),
      },
      update: {
        task_type: input.taskType,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 'normal',
        status: nextStatus,
        assigned_to: input.assignedTo ?? null,
        due_date: input.dueDate ?? null,
        sla_due_at: input.slaDueAt ?? null,
        related_entity_type: input.relatedEntityType ?? null,
        related_entity_id: input.relatedEntityId ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
        completed_at: nextStatus === 'completed' ? new Date() : null,
      },
    });
  }

  return tx.task.create({
    data: {
      org_id: input.orgId,
      task_type: input.taskType,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'normal',
      status: nextStatus,
      assigned_to: input.assignedTo ?? null,
      due_date: input.dueDate ?? null,
      sla_due_at: input.slaDueAt ?? null,
      related_entity_type: input.relatedEntityType ?? null,
      related_entity_id: input.relatedEntityId ?? null,
      metadata: input.metadata ?? Prisma.JsonNull,
      ...(nextStatus === 'completed' ? { completed_at: new Date() } : {}),
    },
  });
}

export async function resolveOperationalTasks(
  tx: Tx,
  input: ResolveOperationalTaskInput
) {
  const nextStatus = input.status ?? 'completed';

  return tx.task.updateMany({
    where: {
      org_id: input.orgId,
      status: {
        in: ['pending', 'in_progress'],
      },
      ...(input.dedupeKey ? { dedupe_key: input.dedupeKey } : {}),
      ...(input.taskType ? { task_type: input.taskType } : {}),
      ...(input.relatedEntityType
        ? { related_entity_type: input.relatedEntityType }
        : {}),
      ...(input.relatedEntityId
        ? { related_entity_id: input.relatedEntityId }
        : {}),
    },
    data: {
      status: nextStatus,
      completed_at: nextStatus === 'completed' ? new Date() : null,
    },
  });
}

export function describeOperationalTask(task: {
  task_type: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
}): OperationalTaskPresentation {
  switch (task.task_type) {
    case 'visit_demand':
      return {
        actionHref: '/schedules',
        actionLabel: '候補を確認',
        queueLabel: '訪問候補',
      };
    case 'visit_contact_followup':
      return {
        actionHref: '/schedules',
        actionLabel: '架電を再開',
        queueLabel: '架電',
      };
    case 'visit_preparation':
      return {
        actionHref: '/schedules',
        actionLabel: '準備を完了',
        queueLabel: '訪問準備',
      };
    case 'initial_home_visit_assessment':
      return {
        actionHref: '/patients',
        actionLabel: '患者記録を確認',
        queueLabel: '初回算定',
      };
    case 'management_plan_review':
      return {
        actionHref: '/workflow',
        actionLabel: '計画を見直す',
        queueLabel: '計画書',
      };
    case 'geocode_review':
      return {
        actionHref: '/workflow',
        actionLabel: '住所確認',
        queueLabel: '住所',
      };
    case 'visit_intake_linkage':
      return {
        actionHref: '/workflow',
        actionLabel: '訪問導線を確認',
        queueLabel: '処方受付',
      };
    case 'visit_schedule_override_approval':
      return {
        actionHref: '/schedules',
        actionLabel: '変更承認',
        queueLabel: '例外変更',
      };
    case 'patient_self_report_followup':
      return {
        actionHref: '/external',
        actionLabel: '自己申告を確認',
        queueLabel: '患者連絡',
      };
    case 'emergency_contact_review':
      return {
        actionHref: '/patients',
        actionLabel: '連絡先と文書を確認',
        queueLabel: '初回整備',
      };
    case 'dosage_form_support':
      return {
        actionHref: '/patients',
        actionLabel: '剤形支援を確認',
        queueLabel: '剤形支援',
      };
    case 'inquiry_workbench':
      return {
        actionHref: '/workflow',
        actionLabel: '疑義照会を確認',
        queueLabel: '照会',
      };
    case 'facility_batch_tracker':
      return {
        actionHref: '/schedules',
        actionLabel: '施設訪問を確認',
        queueLabel: '施設訪問',
      };
    case 'mobile_visit_mode':
      return {
        actionHref: '/schedules',
        actionLabel: '同期状況を確認',
        queueLabel: 'モバイル',
      };
    case 'visit_record_retention':
      return {
        actionHref: '/visits',
        actionLabel: '薬歴を確認',
        queueLabel: '保存期限',
      };
    case 'prescription_original_retention':
      return {
        actionHref: '/workflow',
        actionLabel: '原本保全を確認',
        queueLabel: '原本保存',
      };
    case 'fax_original_followup':
      return {
        actionHref: '/patients',
        actionLabel: '原本回収を記録',
        queueLabel: 'FAX原本',
      };
    case 'community_activity_followup':
      return {
        actionHref: '/external',
        actionLabel: '地域フォローを確認',
        queueLabel: '地域活動',
      };
    case 'report_delivery_followup':
      return {
        actionHref: '/reports',
        actionLabel: '報告送達を確認',
        queueLabel: '報告送達',
      };
    case 'tracing_report_followup':
      return {
        actionHref: '/workflow',
        actionLabel: '減数調整を確認',
        queueLabel: 'Tracing',
      };
    case 'residual_reduction_review':
      return {
        actionHref: '/visits',
        actionLabel: '残薬を確認',
        queueLabel: '残薬調整',
      };
    case 'visit_carry_item_review':
      return {
        actionHref: '/schedules',
        actionLabel: '持参物を確認',
        queueLabel: '持参物',
      };
    case 'first_visit_document_delivery':
      return {
        actionHref: '/patients',
        actionLabel: '文書交付を記録',
        queueLabel: '初回文書',
      };
    case 'emergency_coverage_gap':
      return {
        actionHref: '/admin/shifts',
        actionLabel: 'シフトを確認',
        queueLabel: '当番体制',
      };
    case 'conference_action_item':
      return {
        actionHref: '/conferences',
        actionLabel: '会議アクションを確認',
        queueLabel: 'カンファレンス',
      };
    default:
      if (task.related_entity_type === 'visit_schedule') {
        return {
          actionHref: '/schedules',
          actionLabel: '予定を確認',
          queueLabel: '訪問',
        };
      }
      return {
        actionHref: '/workflow',
        actionLabel: 'ワークフローを開く',
        queueLabel: '運用',
      };
  }
}
