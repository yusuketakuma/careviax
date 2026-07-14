export type ApiErrorLogLevel = 'info' | 'warn' | 'error';
export type ApiErrorHttpStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502;

export type ApiErrorRecoveryAction =
  | 'correct_input'
  | 'reload'
  | 'request_access'
  | 'retry'
  | 'return_to_previous'
  | 'select_organization'
  | 'sign_in';

export type ApiErrorDefinition = {
  httpStatus: ApiErrorHttpStatus;
  logLevel: ApiErrorLogLevel;
  retryable: boolean;
  recoveryAction: ApiErrorRecoveryAction;
  messageLabel: string;
};

export const API_ERROR_CODE_REGISTRY = Object.freeze({
  AUTH_FORBIDDEN: {
    httpStatus: 403,
    logLevel: 'warn',
    retryable: false,
    recoveryAction: 'request_access',
    messageLabel: 'api.error.auth.forbidden',
  },
  AUTH_NO_ORG: {
    httpStatus: 400,
    logLevel: 'warn',
    retryable: false,
    recoveryAction: 'select_organization',
    messageLabel: 'api.error.auth.no_org',
  },
  AUTH_RECOVERY_CODE_INVALID: {
    httpStatus: 400,
    logLevel: 'warn',
    retryable: false,
    recoveryAction: 'correct_input',
    messageLabel: 'api.error.auth.recovery_code_invalid',
  },
  AUTH_UNAUTHENTICATED: {
    httpStatus: 401,
    logLevel: 'warn',
    retryable: false,
    recoveryAction: 'sign_in',
    messageLabel: 'api.error.auth.unauthenticated',
  },
  COMMUNICATION_REQUEST_EXPORT_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.communication_request.export_audit_failed',
  },
  COMMUNICATION_REQUEST_EXPORT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.communication_request.export_failed',
  },
  EXTERNAL_FILE_UPLOAD_FAILED: {
    httpStatus: 502,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.external.file_upload_failed',
  },
  EXTERNAL_JOB_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.external.job_failed',
  },
  EXTERNAL_PDF_RENDER_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.external.pdf_render_failed',
  },
  INTERNAL_ERROR: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.internal',
  },
  PHARMACY_DRUG_STOCK_EXPORT_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.pharmacy_drug_stock.export_audit_failed',
  },
  PHARMACY_DRUG_STOCK_EXPORT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.pharmacy_drug_stock.export_failed',
  },
  RATE_LIMIT_EXCEEDED: {
    httpStatus: 429,
    logLevel: 'warn',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.rate_limited',
  },
  VALIDATION_ERROR: {
    httpStatus: 400,
    logLevel: 'info',
    retryable: false,
    recoveryAction: 'correct_input',
    messageLabel: 'api.error.validation.generic',
  },
  WORKFLOW_CONFLICT: {
    httpStatus: 409,
    logLevel: 'warn',
    retryable: true,
    recoveryAction: 'reload',
    messageLabel: 'api.error.workflow.conflict',
  },
  WORKFLOW_NOT_FOUND: {
    httpStatus: 404,
    logLevel: 'info',
    retryable: false,
    recoveryAction: 'return_to_previous',
    messageLabel: 'api.error.workflow.not_found',
  },
} as const satisfies Record<string, ApiErrorDefinition>);

export type RegisteredApiErrorCode = keyof typeof API_ERROR_CODE_REGISTRY;

export function isRegisteredApiErrorCode(code: string): code is RegisteredApiErrorCode {
  return Object.prototype.hasOwnProperty.call(API_ERROR_CODE_REGISTRY, code);
}

export function getApiErrorDefinition(code: string): ApiErrorDefinition {
  if (!isRegisteredApiErrorCode(code)) {
    throw new RangeError(`Unknown API error code: ${code}`);
  }

  return API_ERROR_CODE_REGISTRY[code];
}
