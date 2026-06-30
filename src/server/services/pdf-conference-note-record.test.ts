import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConferenceNoteRecord } from '@/server/services/pdf-conference-note-record';
import { PdfNotFoundError } from './pdf-errors';

const { careCaseFindFirstMock, conferenceNoteFindFirstMock, patientFindFirstMock } = vi.hoisted(
  () => ({
    careCaseFindFirstMock: vi.fn(),
    conferenceNoteFindFirstMock: vi.fn(),
    patientFindFirstMock: vi.fn(),
  }),
);

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    conferenceNote: {
      findFirst: conferenceNoteFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
  },
}));

const baseNote = {
  id: 'note_1',
  case_id: 'case_1',
  patient_id: 'patient_1',
  note_type: 'regular',
  title: '退院前カンファレンス',
  content: '共有内容',
  structured_content: {
    sections: [{ key: 'summary', label: '概要', body: '退院後の服薬支援' }],
  },
  metadata: { source: 'meeting' },
  participants: [
    {
      name: '山田 太郎',
      role: 'patient',
      attended: true,
      is_report_recipient: false,
      email: 'ignore@example.com',
    },
  ],
  conference_date: new Date(2026, 3, 1),
  action_items: [{ title: '服薬確認', assignee: '薬剤師' }],
};

const careCase = {
  patient: {
    id: 'patient_1',
    name: '山田 太郎',
    birth_date: new Date(1940, 0, 1),
    gender: 'male',
    archived_at: null,
    residences: [
      {
        unit_name: '2A',
        facility: {
          name: 'ケアホーム',
        },
      },
    ],
  },
};

describe('getConferenceNoteRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conferenceNoteFindFirstMock.mockResolvedValue(baseNote);
    careCaseFindFirstMock.mockResolvedValue(careCase);
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
  });

  it('throws a PDF-safe not-found error when the note is unavailable', async () => {
    conferenceNoteFindFirstMock.mockResolvedValue(null);

    await expect(getConferenceNoteRecord('org_1', 'note_1')).rejects.toBeInstanceOf(
      PdfNotFoundError,
    );

    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
  });

  it('rejects unscoped notes for non-bypass (scoped) users', async () => {
    // 新ポリシー: driver / external_viewer のみが assignment スコープ対象。
    // case_id も patient_id も無いノートはスコープを満たせないため拒否される。
    conferenceNoteFindFirstMock.mockResolvedValue({
      ...baseNote,
      case_id: null,
      patient_id: null,
    });

    await expect(
      getConferenceNoteRecord('org_1', 'note_1', {
        userId: 'driver_1',
        role: 'driver',
      }),
    ).rejects.toBeInstanceOf(PdfNotFoundError);

    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
  });

  it('grants org-wide access (no assignment scope) before returning a note', async () => {
    await expect(
      getConferenceNoteRecord('org_1', 'note_1', {
        userId: 'pharmacist_1',
        role: 'pharmacist',
      }),
    ).resolves.toMatchObject({
      id: 'note_1',
      title: '退院前カンファレンス',
      participants: [
        {
          name: '山田 太郎',
          role: 'patient',
          attended: true,
          is_report_recipient: false,
          email: 'ignore@example.com',
        },
      ],
      structured_sections: [{ key: 'summary', label: '概要', body: '退院後の服薬支援' }],
      action_items: [{ title: '服薬確認', assignee: '薬剤師' }],
      metadata: { source: 'meeting' },
      patient: {
        id: 'patient_1',
        name: '山田 太郎',
        archive: { status: 'active', archived: false, archived_at: null },
      },
      facility_name: 'ケアホーム',
      unit_name: '2A',
    });

    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_1',
        org_id: 'org_1',
      },
      select: { id: true },
    });
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
      },
      select: expect.any(Object),
    });
  });
});
