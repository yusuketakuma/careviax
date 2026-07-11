/**
 * Returns the caller-provided recovery copy for client-visible errors.
 *
 * API and provider errors can contain patient data, credentials, or other
 * untrusted detail. Surface the fixed fallback in UI; callers that need
 * observability must record the original error through `clientLog` instead.
 */
export type FixedRecoveryCopy<T extends string> = string extends T ? never : T;

export function messageFromError<const Fallback extends string>(
  error: unknown,
  fallback: FixedRecoveryCopy<Fallback>,
): string {
  if (error instanceof SafeClientMessageError) {
    return error.message;
  }

  return fallback;
}

/**
 * Marks recovery copy that was selected from a local, reviewed allowlist.
 *
 * Never construct this class from a server, provider, or user supplied value.
 * Its message is the only exception that `messageFromError` may render.
 */
export class SafeClientMessageError extends Error {
  private constructor(message: string) {
    super(message);
    this.name = 'SafeClientMessageError';
  }

  static fromReviewed<const Message extends string>(
    message: FixedRecoveryCopy<Message>,
  ): SafeClientMessageError {
    return new SafeClientMessageError(message);
  }
}
