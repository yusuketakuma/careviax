import type {
  DashboardCockpitCommentsResponse,
  DashboardCockpitDetailsResponse,
  DashboardCockpitInboundResponse,
  DashboardCockpitResponse,
  DashboardCockpitSummaryResponse,
  DashboardCockpitTeamResponse,
  DashboardUrgentItem,
} from '@/types/dashboard-cockpit';

export function localIso(hours: number, minutes = 0) {
  return new Date(2026, 5, 12, hours, minutes).toISOString();
}

function buildUrgentFixture(): DashboardUrgentItem[] {
  return [
    {
      id: 'audit:task_1',
      source: 'audit',
      source_id: 'task_1',
      source_label: '麻薬監査',
      reference_label: 'RX-2024-0500',
      severity: 'blocking',
      patient_id: null,
      patient_name: '田中 一郎',
      title: '麻薬を含む監査待ち',
      summary: '麻薬を含む監査待ちです。完了しないと訪問の持参準備が始まりません。',
      due_at: localIso(12, 0),
      waiting_since: localIso(8, 0),
      badges: [
        { label: '麻薬', tone: 'danger' },
        { label: '冷所', tone: 'warning' },
      ],
      action_href: '/audit',
      action_label: '監査を開始する',
    },
    {
      id: 'inbound:event_1',
      source: 'inbound',
      source_id: 'event_1',
      source_label: 'MCS',
      reference_label: 'nurse',
      severity: 'urgent',
      patient_id: 'patient_1',
      patient_name: '田中 一郎',
      title: 'MCS受信: 安全確認が必要',
      summary: '湿布 / 4sheet',
      due_at: localIso(9, 18),
      waiting_since: localIso(9, 18),
      badges: [
        { label: '安全確認', tone: 'danger' },
        { label: '確認待ち', tone: 'warning' },
      ],
      action_href: '/patients/patient_1#inbound-communications',
      action_label: '受信情報を確認',
    },
    {
      id: 'task:exception_1',
      source: 'task',
      source_id: 'exception_1',
      source_label: '止まっている理由',
      reference_label: '患者',
      severity: 'blocking',
      patient_id: null,
      patient_name: null,
      title: 'ご家族の同意待ち(新規契約)',
      summary: '患者: ご家族の同意待ち(新規契約)',
      due_at: null,
      waiting_since: localIso(8, 42),
      badges: [
        { label: '患者', tone: 'warning' },
        { label: '重大', tone: 'danger' },
      ],
      action_href: '/patients',
      action_label: '再連絡する',
    },
    {
      id: 'audit:task_2',
      source: 'audit',
      source_id: 'task_2',
      source_label: '調剤監査',
      reference_label: 'RX-2024-0473',
      severity: 'warning',
      patient_id: null,
      patient_name: '佐々木 ハル',
      title: '調剤監査待ち',
      summary: '調剤済みの監査待ちです。完了でセット・訪問準備に進めます。',
      due_at: null,
      waiting_since: localIso(7, 42),
      badges: [{ label: '安全タグなし', tone: 'neutral' }],
      action_href: '/audit',
      action_label: '監査を開始する',
    },
  ];
}

export function buildFixture(): DashboardCockpitResponse {
  const urgentItems = buildUrgentFixture();
  return {
    generated_at: localIso(9, 42),
    cycle_status_counts: {
      intake_received: 4,
      structuring: 7,
      inquiry_pending: 18,
      ready_to_dispense: 9,
      dispensed: 10,
      audit_pending: 14,
      setting: 21,
      visit_ready: 6,
      visit_completed: 11,
      reported: 9,
    },
    audit_pending_count: 6,
    narcotic_audit_count: 1,
    audit_queue: [
      {
        task_id: 'task_1',
        cycle_id: 'cycle_1',
        patient_name: '田中 一郎',
        priority: 'urgent',
        due_at: localIso(12, 0),
        intake_id: 'intake_0500',
        prescribed_date: '2024-05-01',
        handling_tags: ['narcotic', 'cold_storage'],
        has_narcotic: true,
        waiting_since: localIso(8, 0),
      },
      {
        task_id: 'task_2',
        cycle_id: 'cycle_2',
        patient_name: '佐々木 ハル',
        priority: 'normal',
        due_at: null,
        intake_id: 'intake_0473',
        prescribed_date: '2024-04-20',
        handling_tags: [],
        has_narcotic: false,
        waiting_since: localIso(7, 42),
      },
    ],
    urgent_items: urgentItems,
    urgent_source_links: [
      {
        source: 'audit',
        label: '監査待ち',
        total_count: 4,
        count_basis: 'source_total',
        visible_count: 2,
        hidden_count: 2,
        href: '/audit?filter=dashboard_urgent',
      },
      {
        source: 'inbound',
        label: '他職種受信',
        total_count: 1,
        count_basis: 'source_total',
        visible_count: 1,
        hidden_count: 0,
        href: '/communications/inbound?status=needs_review',
      },
      {
        source: 'task',
        label: 'タスク',
        total_count: 3,
        count_basis: 'source_total',
        visible_count: 1,
        hidden_count: 2,
        href: '/tasks?status=open&context=dashboard_home',
      },
    ],
    urgent_total_count: 8,
    urgent_visible_count: urgentItems.length,
    urgent_hidden_count: 4,
    today_visits: [
      {
        id: 'visit_1',
        patient_name: '伊藤',
        visit_type: 'regular',
        schedule_status: 'planned',
        time_start: '10:30',
        time_end: '11:30',
        facility_batch_id: null,
      },
      {
        id: 'visit_2',
        patient_name: '田中',
        visit_type: 'regular',
        schedule_status: 'planned',
        time_start: '14:00',
        time_end: '15:00',
        facility_batch_id: null,
      },
    ],
    blocked_reasons: [
      {
        id: 'exception_1',
        label: 'ご家族の同意待ち(新規契約)',
        severity: 'warning',
        category: '患者',
        age_minutes: 24 * 60,
        action_label: '再連絡する →',
        action_href: '/patients',
      },
      {
        id: 'exception_2',
        label: '送付先の確認(やまもと内科)',
        severity: 'warning',
        category: '事務',
        age_minutes: 30,
        action_label: '状況を見る →',
        action_href: '/workflow',
      },
    ],
    carryover_count: 2,
    team_capacity: [
      {
        user_id: 'user_1',
        name: '山田 太郎',
        role_label: '薬',
        status: 'working',
        slack_minutes: 11,
        busy_ratio: 0.94,
      },
      {
        user_id: 'user_2',
        name: '佐藤 恵',
        role_label: '薬',
        status: 'working',
        slack_minutes: 70,
        busy_ratio: 0.6,
      },
      {
        user_id: 'user_3',
        name: '鈴木 さくら',
        role_label: '事務',
        status: 'working',
        slack_minutes: 120,
        busy_ratio: 0.2,
      },
      {
        user_id: 'user_4',
        name: '田中 真',
        role_label: '事務',
        status: 'off',
        slack_minutes: null,
        busy_ratio: null,
      },
    ],
  };
}

export function buildSummaryFixture(data = buildFixture()): DashboardCockpitSummaryResponse {
  return {
    generated_at: data.generated_at,
    scope: data.scope,
    cycle_status_counts: data.cycle_status_counts,
    audit_queue_total_count: data.audit_queue_total_count,
    audit_pending_count: data.audit_pending_count,
    narcotic_audit_count: data.narcotic_audit_count,
    earliest_audit_due_at:
      data.audit_queue
        .map((item) => item.due_at)
        .filter((dueAt): dueAt is string => dueAt != null)
        .sort()[0] ?? null,
    today_visit_count: data.today_visits.length,
    today_visit_times: data.today_visits
      .filter((visit) => visit.time_start != null)
      .map((visit) => visit.time_start as string),
  };
}

export function buildDetailsFixture(data = buildFixture()): DashboardCockpitDetailsResponse {
  return {
    generated_at: data.generated_at,
    scope: data.scope,
    audit_queue_total_count: data.audit_queue_total_count,
    audit_queue_visible_count: data.audit_queue_visible_count,
    audit_queue_hidden_count: data.audit_queue_hidden_count,
    audit_queue: data.audit_queue,
    urgent_items: data.urgent_items ?? buildUrgentFixture(),
    urgent_source_links: data.urgent_source_links ?? [],
    urgent_total_count: data.urgent_total_count ?? 0,
    urgent_visible_count: data.urgent_visible_count ?? 0,
    urgent_hidden_count: data.urgent_hidden_count ?? 0,
    today_visits: data.today_visits,
    blocked_reasons: data.blocked_reasons,
    carryover_count: data.carryover_count,
  };
}

export function buildTeamFixture(data = buildFixture()): DashboardCockpitTeamResponse {
  return {
    generated_at: data.generated_at,
    scope: data.scope,
    team_capacity: data.team_capacity,
  };
}

export function buildCommentsFixture(data = buildFixture()): DashboardCockpitCommentsResponse {
  return {
    generated_at: data.generated_at,
    scope: data.scope,
    comments: [
      {
        id: 'comment_1',
        entity_type: 'medication_cycle',
        entity_id: 'cycle_1',
        entity_label: '処方サイクル',
        author_id: 'user_2',
        author_name: '鈴木 さくら',
        content_excerpt: '監査前に家族連絡の結果だけ確認してください。',
        mentions_me: true,
        authored_by_me: false,
        created_at: localIso(9, 20),
        href: '/patients/patient_1',
      },
      {
        id: 'comment_2',
        entity_type: 'care_report',
        entity_id: 'report_1',
        entity_label: '報告書',
        author_id: 'user_1',
        author_name: '山田 太郎',
        content_excerpt: '報告書の送付先を確認済みです。',
        mentions_me: false,
        authored_by_me: true,
        created_at: localIso(9, 10),
        href: '/reports/report_1',
      },
    ],
    comments_count_basis: 'database_total',
    comments_scope_complete: true,
    comments_scanned_count: 4,
    comments_total_count: 4,
    comments_visible_count: 2,
    comments_hidden_count: 2,
  };
}

export function buildInboundFixture(data = buildFixture()): DashboardCockpitInboundResponse {
  return {
    generated_at: data.generated_at,
    scope: data.scope,
    inbound_items: [
      {
        id: 'inbound_communication:event_1',
        event_id: 'event_1',
        channel: 'mcs',
        channel_label: 'MCS',
        event_type: 'medication_stock_report',
        processing_status: 'signals_extracted',
        status: 'needs_review',
        priority: 'urgent',
        patient_id: 'patient_1',
        patient_name: '田中 一郎',
        sender_name: '山田 花子',
        sender_role: 'nurse',
        sender_organization_name: '訪問看護ステーションA',
        title: 'MCS受信: 安全確認が必要',
        summary: '湿布残数4枚と使用増加の報告',
        normalized_summary: '湿布残数4枚と使用増加の報告',
        received_at: localIso(9, 18),
        occurred_at: localIso(9, 10),
        due_at: localIso(9, 18),
        attachment_count: 1,
        has_medication_stock_signal: true,
        has_patient_safety_signal: true,
        has_schedule_signal: false,
        has_report_signal: true,
        action_href: '/patients/patient_1#inbound-communications',
        action_label: '受信情報を確認',
        signals: [
          {
            id: 'signal_1',
            signal_domain: 'medication_stock',
            signal_type: 'observed_quantity',
            extracted_medication_name: '湿布',
            extracted_quantity: 4,
            extracted_unit: 'sheet',
            review_status: 'needs_review',
            action_status: 'not_linked',
            source_confidence: 'text_parsed_high',
          },
        ],
      },
    ],
    inbound_total_count: 3,
    inbound_visible_count: 1,
    inbound_hidden_count: 2,
    inbound_needs_review_count: 1,
    inbound_reviewed_pending_action_count: 0,
    inbound_urgent_count: 1,
    inbound_medication_stock_signal_count: 1,
    inbound_safety_signal_count: 1,
  };
}
