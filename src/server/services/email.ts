import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

import { awsClientConfig, withAwsClientTimeout } from '@/lib/aws/client-timeout';

type SendEmailParams = {
  to: string | string[];
  subject: string;
  htmlBody: string;
  textBody?: string;
};

const DEFAULT_AWS_REGION = 'ap-northeast-1';
const sesClients = new Map<string, SESClient>();

function getClient(region = process.env.AWS_REGION ?? DEFAULT_AWS_REGION): SESClient {
  const cached = sesClients.get(region);
  if (cached) return cached;

  const client = withAwsClientTimeout(new SESClient({ region, ...awsClientConfig() }));
  sesClients.set(region, client);
  return client;
}

export async function sendEmail({ to, subject, htmlBody, textBody }: SendEmailParams) {
  const toAddresses = Array.isArray(to) ? to : [to];
  const fromEmail = process.env.SES_FROM_EMAIL;

  if (!fromEmail) {
    throw new Error(
      'SES_FROM_EMAIL is not configured. Set the environment variable to enable email sending.',
    );
  }

  const client = getClient();
  const command = new SendEmailCommand({
    Source: fromEmail,
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
