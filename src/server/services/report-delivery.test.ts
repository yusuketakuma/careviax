import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getLabelDictionaryValuesMock, sendEmailMock } = vi.hoisted(() => ({
  getLabelDictionaryValuesMock: vi.fn(),
  sendEmailMock: vi.fn(),
}));

vi.mock('@/server/services/label-dictionary', () => ({
  getLabelDictionaryValues: getLabelDictionaryValuesMock,
}));

vi.mock('@/server/services/email', () => ({
  sendEmail: sendEmailMock,
}));

vi.mock('@/lib/constants/status-labels', () => ({
  REPORT_TYPE_LABELS: {
    physician_report: '医師向け報告書',
    care_manager_report: 'ケアマネ向け情報提供書',
  },
}));

import { sendCareReportEmail } from './report-delivery';

describe('sendCareReportEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLabelDictionaryValuesMock.mockResolvedValue({
      'mail.care_report.subject': '【PH-OS】{{reportType}}をお送りします',
      'mail.care_report.intro':
        '{{recipientName}} 様\n\nPH-OSより {{reportType}} をお送りします。報告書ID: {{reportId}}',
      'mail.care_report.pdf_line': 'PDF参照: {{pdfUrl}}',
      'mail.care_report.footer':
        '本メールは PH-OS から自動送信されています。ご不明点があれば送信元薬局へご連絡ください。',
    });
    sendEmailMock.mockResolvedValue({ messageId: 'msg-1' });
  });

  it('sends email with correct subject using report type label', async () => {
    await sendCareReportEmail({
      to: 'doctor@example.com',
      recipientName: '山田医師',
      reportType: 'physician_report',
      reportId: 'report-1',
      pdfUrl: 'https://example.com/report.pdf',
    });

    expect(sendEmailMock).toHaveBeenCalledOnce();
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe('doctor@example.com');
    expect(call.subject).toBe('【PH-OS】医師向け報告書をお送りします');
    expect(call.textBody).toContain('山田医師 様');
    expect(call.textBody).toContain('report-1');
    expect(call.textBody).toContain('https://example.com/report.pdf');
  });

  it('omits pdf line when pdfUrl is not provided', async () => {
    await sendCareReportEmail({
      to: 'cm@example.com',
      recipientName: 'ケアマネ太郎',
      reportType: 'care_manager_report',
      reportId: 'report-2',
    });

    const call = sendEmailMock.mock.calls[0][0];
    expect(call.textBody).not.toContain('PDF参照');
    expect(call.htmlBody).not.toContain('<a href=');
  });

  it('omits internal file urls from external email bodies', async () => {
    await sendCareReportEmail({
      to: 'cm@example.com',
      recipientName: 'ケアマネ太郎',
      reportType: 'care_manager_report',
      reportId: 'report-2',
      pdfUrl: '/api/files/file_1/download',
    });

    const call = sendEmailMock.mock.calls[0][0];
    expect(call.textBody).not.toContain('PDF参照');
    expect(call.textBody).not.toContain('/api/files/file_1/download');
    expect(call.htmlBody).not.toContain('<a href=');
  });

  it('escapes HTML in html body', async () => {
    await sendCareReportEmail({
      to: 'test@example.com',
      recipientName: '<script>alert("xss")</script>',
      reportType: 'physician_report',
      reportId: 'report-3',
      pdfUrl: 'https://example.com/report.pdf',
    });

    const call = sendEmailMock.mock.calls[0][0];
    expect(call.htmlBody).not.toContain('<script>');
    expect(call.htmlBody).toContain('&lt;script&gt;');
  });

  it('falls back to raw report type when no label mapping exists', async () => {
    await sendCareReportEmail({
      to: 'test@example.com',
      recipientName: '受信者',
      reportType: 'unknown_type',
      reportId: 'report-4',
    });

    const call = sendEmailMock.mock.calls[0][0];
    expect(call.subject).toBe('【PH-OS】unknown_typeをお送りします');
  });
});
