import { describe, expect, it } from 'vitest';
import {
  buildConferenceReportDisclosureContent,
  buildExternalConferenceReportLines,
  buildReportableConferenceHighlightsFromStructuredContent,
} from './conference-report-disclosure';

const sections = [
  { key: 'discharge_background', label: '退院背景', body: '退院後の服薬支援が必要' },
  { key: 'medication_changes_on_discharge', label: '退院時変更薬', body: 'ARBを増量' },
  { key: 'team_roles', label: 'チーム内役割', body: '内部確認のみ' },
  { key: 'root_cause', label: '原因分析', body: '内部要因の分析' },
];

describe('conference-report-disclosure', () => {
  it('keeps only allowed structured sections for external physician reports', () => {
    const content = buildConferenceReportDisclosureContent({
      conferenceNoteId: 'conference_1',
      noteType: 'pre_discharge',
      noteTitle: '退院前カンファ',
      reportType: 'physician_report',
      label: '退院前カンファ',
      sections,
      noteContent: 'raw body',
      includeStructuredContent: true,
    });

    expect(content.body).toContain('退院後の服薬支援が必要');
    expect(content.body).toContain('ARBを増量');
    expect(content.body).not.toContain('内部確認のみ');
    expect(content.body).not.toContain('内部要因の分析');
    expect(content.sections).toEqual([]);
    expect(content.disclosure_scope).toMatchObject({
      audience: 'physician_report',
      sanitized: true,
      included_section_keys: ['discharge_background', 'medication_changes_on_discharge'],
      excluded_section_keys: ['team_roles', 'root_cause'],
    });
  });

  it('keeps full structured sections for internal records', () => {
    const content = buildConferenceReportDisclosureContent({
      conferenceNoteId: 'conference_1',
      noteType: 'pre_discharge',
      noteTitle: '退院前カンファ',
      reportType: 'internal_record',
      label: '退院前カンファ',
      sections,
      noteContent: 'raw body',
      includeStructuredContent: true,
    });

    expect(content.body).toContain('内部確認のみ');
    expect(content.body).toContain('内部要因の分析');
    expect(content.sections).toHaveLength(4);
    expect(content.disclosure_scope).toMatchObject({
      audience: 'internal',
      sanitized: false,
    });
  });

  it('does not project action items into external visit report lines', () => {
    expect(
      buildExternalConferenceReportLines(
        [
          {
            id: 'conference_1',
            note_type: 'pre_discharge',
            title: '退院前カンファ',
            conference_date: '2026-04-01T00:00:00.000Z',
            highlights: ['退院時変更薬を確認'],
            action_items: ['内部担当者にだけ共有する事項'],
          },
          {
            id: 'conference_2',
            note_type: 'service_manager',
            title: '担当者会議',
            conference_date: '2026-04-02T00:00:00.000Z',
            highlights: ['ケアプラン変更'],
            action_items: ['ケアマネへ連絡'],
          },
        ],
        'physician_report',
      ),
    ).toEqual(['退院前カンファ: 退院前カンファ / 退院時変更薬を確認']);
  });

  it('does not fall back to raw note body for external reports', () => {
    const content = buildConferenceReportDisclosureContent({
      conferenceNoteId: 'conference_1',
      noteType: 'pre_discharge',
      noteTitle: '退院前カンファ',
      reportType: 'physician_report',
      label: '退院前カンファ',
      sections,
      noteContent: 'raw body should stay internal',
      includeStructuredContent: false,
    });

    expect(content.body).toBe('');
    expect(content.disclosure_scope).toMatchObject({
      sanitized: true,
      included_section_keys: [],
    });
  });

  it('builds external highlights from allowed structured sections only', () => {
    expect(
      buildReportableConferenceHighlightsFromStructuredContent({
        noteType: 'pre_discharge',
        structuredContent: {
          sections: [
            { key: 'discharge_background', label: '退院背景', body: '退院後支援' },
            { key: 'team_roles', label: '役割', body: '内部役割' },
          ],
        },
      }),
    ).toEqual(['退院背景: 退院後支援']);
  });

  it('ignores malformed structured content sections when building external highlights', () => {
    expect(
      buildReportableConferenceHighlightsFromStructuredContent({
        noteType: 'pre_discharge',
        structuredContent: {
          sections: [
            ['unexpected'],
            { key: 'discharge_background', label: '退院背景', body: '退院後支援' },
            { key: 'medication_summary', label: '薬剤要約', body: 123 },
          ],
        },
      }),
    ).toEqual(['退院背景: 退院後支援']);
    expect(
      buildReportableConferenceHighlightsFromStructuredContent({
        noteType: 'pre_discharge',
        structuredContent: ['unexpected'],
      }),
    ).toEqual([]);
  });
});
