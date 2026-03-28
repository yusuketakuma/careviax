import { REPORT_TYPE_LABELS } from '@/lib/constants/status-labels';
import { getLabelDictionaryValues } from '@/server/services/label-dictionary';
import { sendEmail } from '@/server/services/email';

type SendCareReportEmailArgs = {
  to: string;
  recipientName: string;
  reportType: string;
  reportId: string;
  pdfUrl?: string | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function sendCareReportEmail({
  to,
  recipientName,
  reportType,
  reportId,
  pdfUrl,
}: SendCareReportEmailArgs) {
  const labels = await getLabelDictionaryValues([
    {
      key: 'mail.care_report.subject',
      fallback: '【CareViaX】{{reportType}}をお送りします',
    },
    {
      key: 'mail.care_report.intro',
      fallback:
        '{{recipientName}} 様\n\nCareViaXより {{reportType}} をお送りします。報告書ID: {{reportId}}',
    },
    {
      key: 'mail.care_report.pdf_line',
      fallback: 'PDF参照: {{pdfUrl}}',
    },
    {
      key: 'mail.care_report.footer',
      fallback:
        '本メールは CareViaX から自動送信されています。ご不明点があれば送信元薬局へご連絡ください。',
    },
  ]);

  const reportTypeLabel = REPORT_TYPE_LABELS[reportType] ?? reportType;
  const subject = labels['mail.care_report.subject'].replaceAll('{{reportType}}', reportTypeLabel);
  const introText = labels['mail.care_report.intro']
    .replaceAll('{{recipientName}}', recipientName)
    .replaceAll('{{reportType}}', reportTypeLabel)
    .replaceAll('{{reportId}}', reportId);
  const pdfText = pdfUrl
    ? labels['mail.care_report.pdf_line'].replaceAll('{{pdfUrl}}', pdfUrl)
    : '';
  const footerText = labels['mail.care_report.footer'];

  const textBody = [introText, pdfText, footerText].filter(Boolean).join('\n\n');
  const htmlBody = [
    `<p>${escapeHtml(introText).replaceAll('\n', '<br />')}</p>`,
    pdfUrl
      ? `<p><a href="${escapeHtml(pdfUrl)}" target="_blank" rel="noreferrer">${escapeHtml(
          pdfText
        )}</a></p>`
      : '',
    `<p>${escapeHtml(footerText)}</p>`,
  ]
    .filter(Boolean)
    .join('');

  return sendEmail({
    to,
    subject,
    htmlBody,
    textBody,
  });
}
