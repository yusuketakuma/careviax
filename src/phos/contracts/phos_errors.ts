export type PhosDomainErrorCode =
  | 'FORBIDDEN'
  | 'ACTION_GUARD_FAILED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'STALE_VERSION'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export class PhosDomainError extends Error {
  error_code: PhosDomainErrorCode;
  status: number;
  message_key: string;
  details?: Record<string, unknown>;

  constructor(input: {
    status: number;
    error_code: PhosDomainErrorCode;
    message_key: string;
    details?: Record<string, unknown>;
  }) {
    super(input.error_code);
    this.name = 'PhosDomainError';
    this.status = input.status;
    this.error_code = input.error_code;
    this.message_key = input.message_key;
    this.details = input.details;
  }
}
