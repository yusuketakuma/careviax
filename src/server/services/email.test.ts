import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sesClientMock, sesSendMock, sendEmailCommandMock } = vi.hoisted(() => ({
  sesSendMock: vi.fn(),
  sesClientMock: vi.fn(function MockSesClient() {
    return {
      send: sesSendMock,
    };
  }),
  sendEmailCommandMock: vi.fn(function MockSendEmailCommand(
    this: { input?: unknown },
    input: unknown,
  ) {
    this.input = input;
  }),
}));

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: sesClientMock,
  SendEmailCommand: sendEmailCommandMock,
}));

describe('sendEmail', () => {
  beforeEach(() => {
    sesClientMock.mockClear();
    sesSendMock.mockReset();
    sendEmailCommandMock.mockClear();
    process.env.SES_FROM_EMAIL = 'noreply@example.test';
    process.env.AWS_REGION = 'ap-northeast-1';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.SES_FROM_EMAIL;
    delete process.env.AWS_REGION;
  });

  it('builds an SES message with the runtime sender and reuses the regional client', async () => {
    const { sendEmail } = await import('./email');
    sesSendMock.mockResolvedValue({ MessageId: 'msg_1' });

    await expect(
      sendEmail({
        to: ['patient@example.test', 'care@example.test'],
        subject: '確認',
        htmlBody: '<p>本文</p>',
        textBody: '本文',
      }),
    ).resolves.toEqual({ messageId: 'msg_1', stub: false });
    await sendEmail({
      to: 'patient@example.test',
      subject: '再送',
      htmlBody: '<p>再送</p>',
    });

    expect(sesClientMock).toHaveBeenCalledOnce();
    expect(sesClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(sesSendMock).toHaveBeenCalledTimes(2);
    expect(sesSendMock).toHaveBeenNthCalledWith(1, expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
    expect(sendEmailCommandMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        Source: 'noreply@example.test',
        Destination: { ToAddresses: ['patient@example.test', 'care@example.test'] },
      }),
    );
  });

  it('reads SES_FROM_EMAIL at send time instead of import time', async () => {
    const { sendEmail } = await import('./email');
    sesSendMock.mockResolvedValue({ MessageId: 'msg_2' });
    process.env.SES_FROM_EMAIL = 'runtime@example.test';

    await sendEmail({
      to: 'patient@example.test',
      subject: 'runtime',
      htmlBody: '<p>runtime</p>',
    });

    expect(sendEmailCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ Source: 'runtime@example.test' }),
    );
  });

  it('creates separate SES clients when the runtime AWS region changes', async () => {
    const { sendEmail } = await import('./email');
    sesSendMock.mockResolvedValueOnce({ MessageId: 'msg_eu' }).mockResolvedValueOnce({
      MessageId: 'msg_ca',
    });

    process.env.AWS_REGION = 'eu-central-1';
    await expect(
      sendEmail({
        to: 'patient@example.test',
        subject: 'eu',
        htmlBody: '<p>eu</p>',
      }),
    ).resolves.toEqual({ messageId: 'msg_eu', stub: false });

    process.env.AWS_REGION = 'ca-central-1';
    await expect(
      sendEmail({
        to: 'patient@example.test',
        subject: 'ca',
        htmlBody: '<p>ca</p>',
      }),
    ).resolves.toEqual({ messageId: 'msg_ca', stub: false });

    expect(sesClientMock).toHaveBeenCalledTimes(2);
    expect(sesClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        region: 'eu-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(sesClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        region: 'ca-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(sesSendMock).toHaveBeenCalledTimes(2);
  });

  it('fails before constructing a new client when sender env is missing', async () => {
    const { sendEmail } = await import('./email');
    sesClientMock.mockClear();
    delete process.env.SES_FROM_EMAIL;

    await expect(
      sendEmail({
        to: 'patient@example.test',
        subject: 'missing',
        htmlBody: '<p>missing</p>',
      }),
    ).rejects.toThrow('SES_FROM_EMAIL is not configured');

    expect(sesClientMock).not.toHaveBeenCalled();
    expect(sesSendMock).not.toHaveBeenCalled();
  });
});
