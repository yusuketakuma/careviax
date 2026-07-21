import { vi } from 'vitest';

export const communicationQueueMocks = {
  selfReportFindManyMock: vi.fn(),
  contactLogFindManyMock: vi.fn(),
  communicationRequestFindManyMock: vi.fn(),
  inboundCommunicationEventFindManyMock: vi.fn(),
  inboundCommunicationSignalFindManyMock: vi.fn(),
  deliveryRecordFindManyMock: vi.fn(),
  externalAccessGrantFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  tracingReportFindManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  medicationIssueFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
};

export function makeDb() {
  const mocks = communicationQueueMocks;
  return {
    patientSelfReport: { findMany: mocks.selfReportFindManyMock },
    visitScheduleContactLog: { findMany: mocks.contactLogFindManyMock },
    communicationRequest: { findMany: mocks.communicationRequestFindManyMock },
    inboundCommunicationEvent: { findMany: mocks.inboundCommunicationEventFindManyMock },
    inboundCommunicationSignal: { findMany: mocks.inboundCommunicationSignalFindManyMock },
    deliveryRecord: { findMany: mocks.deliveryRecordFindManyMock },
    externalAccessGrant: { findMany: mocks.externalAccessGrantFindManyMock },
    careReport: { findMany: mocks.careReportFindManyMock },
    tracingReport: { findMany: mocks.tracingReportFindManyMock },
    patient: {
      findFirst: mocks.patientFindFirstMock,
      findMany: mocks.patientFindManyMock,
    },
    medicationIssue: { findMany: mocks.medicationIssueFindManyMock },
    task: { findMany: mocks.taskFindManyMock },
  };
}

export function emptyDbMocks() {
  const mocks = communicationQueueMocks;
  mocks.selfReportFindManyMock.mockResolvedValue([]);
  mocks.contactLogFindManyMock.mockResolvedValue([]);
  mocks.communicationRequestFindManyMock.mockResolvedValue([]);
  mocks.inboundCommunicationEventFindManyMock.mockResolvedValue([]);
  mocks.inboundCommunicationSignalFindManyMock.mockResolvedValue([]);
  mocks.deliveryRecordFindManyMock.mockResolvedValue([]);
  mocks.externalAccessGrantFindManyMock.mockResolvedValue([]);
  mocks.careReportFindManyMock.mockResolvedValue([]);
  mocks.tracingReportFindManyMock.mockResolvedValue([]);
  mocks.patientFindFirstMock.mockResolvedValue(null);
  mocks.patientFindManyMock.mockResolvedValue([]);
  mocks.medicationIssueFindManyMock.mockResolvedValue([]);
  mocks.taskFindManyMock.mockResolvedValue([]);
}

export const selfReportFixture = {
  id: 'sr-1',
  patient_id: 'p-1',
  subject: '体調不良',
  category: 'symptom',
  requested_callback: true,
  preferred_contact_time: '午前中',
  reported_by_name: '家族A',
  status: 'submitted',
  created_at: new Date('2026-04-01T08:00:00Z'),
};

export function callbackFixture(scheduleId: string) {
  return {
    id: 'callback-1',
    patient_id: 'p-1',
    schedule_id: scheduleId,
    outcome: 'unreachable',
    contact_name: '家族A',
    contact_phone: '090-0000-0000',
    note: null,
    callback_due_at: new Date('2026-04-01T09:00:00Z'),
    called_at: new Date('2026-04-01T08:00:00Z'),
  };
}

export const communicationRequestFixture = {
  id: 'cr-1',
  patient_id: 'p-1',
  request_type: 'care_report_reply_request',
  subject: '処方確認',
  content: '用量について確認',
  template_key: null,
  related_entity_type: 'care_report',
  related_entity_id: 'report-1',
  status: 'sent',
  due_date: new Date('2026-04-02'),
  requested_at: new Date('2026-04-01'),
};

export function inboundEventFixture(patientId: string) {
  return {
    id: 'event/1?x=y#frag',
    patient_id: patientId,
    case_id: 'case-1',
    event_type: 'medication_stock_report',
    source_channel: 'phone',
    received_at: new Date('2026-04-02T10:00:00Z'),
    subject: '湿布の残りが少ない',
    content: '湿布は残り4枚です',
    counterpart_name: '訪問看護師A',
    counterpart_contact: '090-0000-0000',
    attachments: [{ name: 'photo.jpg', storage_key: 'secret-key' }],
  };
}

export const minimalInboundEventFixture = {
  id: 'event_1',
  patient_id: 'patient_1',
  source_channel: 'phone',
  received_at: new Date('2026-04-02T10:00:00Z'),
};

export function inboundSignalFixture(
  overrides: Partial<{
    id: string;
    review_status: string;
    action_status: string;
  }> = {},
) {
  return {
    id: overrides.id ?? 'signal_1',
    inbound_event_id: 'event_1',
    review_status: overrides.review_status ?? 'needs_review',
    action_status: overrides.action_status ?? 'not_linked',
  };
}

export function reviewTaskFixture(
  overrides: Partial<{ status: string; priority: string; dedupe_key: string }> = {},
) {
  return {
    id: 'task_1',
    task_type: 'pharmacy.inbound_medication_stock_signal_review_required',
    status: overrides.status ?? 'pending',
    priority: overrides.priority ?? 'urgent',
    dedupe_key:
      overrides.dedupe_key ??
      'inbound:signal_1:pharmacy.inbound_medication_stock_signal_review_required',
  };
}

export const inboundPatientFixture = { id: 'patient_1', name: '佐藤花子' };
