import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

type SendEmailParams = {
  to: string | string[];
  subject: string;
  htmlBody: string;
  textBody?: string;
};

const FROM_EMAIL = process.env.SES_FROM_EMAIL;
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

let sesClient: SESClient | null = null;

function getClient(): SESClient {
  if (!sesClient) {
    sesClient = new SESClient({ region: REGION });
  }
  return sesClient;
}

export async function sendEmail({ to, subject, htmlBody, textBody }: SendEmailParams) {
  const toAddresses = Array.isArray(to) ? to : [to];

  if (!FROM_EMAIL) {
    throw new Error(
      'SES_FROM_EMAIL is not configured. Set the environment variable to enable email sending.'
    );
  }

  const client = getClient();
  const command = new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: { ToAddresses: toAddresses },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: htmlBody, Charset: 'UTF-8' },
        ...(textBody ? { Text: { Data: textBody, Charset: 'UTF-8' } } : {}),
      },
    },
  });

  const response = await client.send(command);
  return { messageId: response.MessageId, stub: false };
}
