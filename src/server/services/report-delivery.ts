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

function isExternalShareableUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const allowedOrigin = getConfiguredAppOrigin();
    if (!allowedOrigin) return false;
    if (url.protocol !== 'https:' || url.origin !== allowedOrigin) return false;
    if (url.username || url.password || url.search || url.hash) return false;
    const pathSegments = url.pathname.split('/').filter(Boolean);
    return pathSegments.length === 2 && pathSegments[0] === 'shared' && pathSegments[1].length > 0;
  } catch {
    return false;
  }
}

function getConfiguredAppOrigin() {
  const rawUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
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
      fallback: '【PH-OS】{{reportType}}をお送りします',
    },
    {
      key: 'mail.care_report.intro',
      fallback:
        '{{recipientName}} 様\n\nPH-OSより {{reportType}} をお送りします。報告書ID: {{reportId}}',
    },
    {
      key: 'mail.care_report.pdf_line',
      fallback: 'PDF参照: {{pdfUrl}}',
    },
    {
      key: 'mail.care_report.footer',
      fallback:
        '本メールは PH-OS から自動送信されています。ご不明点があれば送信元薬局へご連絡ください。',
    },
  ]);

  const reportTypeLabel = REPORT_TYPE_LABELS[reportType] ?? reportType;
  const subject = labels['mail.care_report.subject'].replaceAll('{{reportType}}', reportTypeLabel);
  const introText = labels['mail.care_report.intro']
    .replaceAll('{{recipientName}}', recipientName)
    .replaceAll('{{reportType}}', reportTypeLabel)
    .replaceAll('{{reportId}}', reportId);
  const shareablePdfUrl = isExternalShareableUrl(pdfUrl) ? pdfUrl : null;
  const pdfText = shareablePdfUrl
    ? labels['mail.care_report.pdf_line'].replaceAll('{{pdfUrl}}', shareablePdfUrl)
    : '';
  const footerText = labels['mail.care_report.footer'];

  const textBody = [introText, pdfText, footerText].filter(Boolean).join('\n\n');
  const htmlBody = [
    `<p>${escapeHtml(introText).replaceAll('\n', '<br />')}</p>`,
    shareablePdfUrl
      ? `<p><a href="${escapeHtml(shareablePdfUrl)}" target="_blank" rel="noreferrer">${escapeHtml(
          pdfText,
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
