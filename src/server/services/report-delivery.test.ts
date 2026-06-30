import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const originalEnv = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  APP_URL: process.env.APP_URL,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  VERCEL_URL: process.env.VERCEL_URL,
};

describe('sendCareReportEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
    delete process.env.APP_URL;
    delete process.env.NEXTAUTH_URL;
    delete process.env.VERCEL_URL;
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

  afterEach(() => {
    if (originalEnv.NEXT_PUBLIC_APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalEnv.NEXT_PUBLIC_APP_URL;
    if (originalEnv.APP_URL === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalEnv.APP_URL;
    if (originalEnv.NEXTAUTH_URL === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = originalEnv.NEXTAUTH_URL;
    if (originalEnv.VERCEL_URL === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = originalEnv.VERCEL_URL;
  });

  it('sends email with correct subject using report type label', async () => {
    await sendCareReportEmail({
      to: 'doctor@example.com',
      recipientName: '山田医師',
      reportType: 'physician_report',
      reportId: 'report-1',
      pdfUrl: 'https://app.example.com/shared/token_1',
    });

    expect(sendEmailMock).toHaveBeenCalledOnce();
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe('doctor@example.com');
    expect(call.subject).toBe('【PH-OS】医師向け報告書をお送りします');
    expect(call.textBody).toContain('山田医師 様');
    expect(call.textBody).toContain('report-1');
    expect(call.textBody).toContain('https://app.example.com/shared/token_1');
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

  it('omits direct absolute PDF urls from external email bodies', async () => {
    await sendCareReportEmail({
      to: 'cm@example.com',
      recipientName: 'ケアマネ太郎',
      reportType: 'care_manager_report',
      reportId: 'report-2',
      pdfUrl: 'https://files.example.com/report.pdf',
    });

    const call = sendEmailMock.mock.calls[0][0];
    expect(call.textBody).not.toContain('PDF参照');
    expect(call.textBody).not.toContain('https://files.example.com/report.pdf');
    expect(call.htmlBody).not.toContain('<a href=');
  });

  it('omits shared urls when the origin, protocol, or URL shape is not the configured app share path', async () => {
    for (const pdfUrl of [
      'https://evil.example.com/shared/token_1',
      'http://app.example.com/shared/token_1',
      'https://app.example.com/shared/token_1?otp=123456',
      'https://app.example.com/api/files/file_1/download',
    ]) {
      vi.clearAllMocks();
      await sendCareReportEmail({
        to: 'cm@example.com',
        recipientName: 'ケアマネ太郎',
        reportType: 'care_manager_report',
        reportId: 'report-2',
        pdfUrl,
      });

      const call = sendEmailMock.mock.calls[0][0];
      expect(call.textBody).not.toContain('PDF参照');
      expect(call.textBody).not.toContain(pdfUrl);
      expect(call.htmlBody).not.toContain('<a href=');
    }
  });

  it('escapes HTML in html body', async () => {
    await sendCareReportEmail({
      to: 'test@example.com',
      recipientName: '<script>alert("xss")</script>',
      reportType: 'physician_report',
      reportId: 'report-3',
      pdfUrl: 'https://app.example.com/shared/token_1',
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
