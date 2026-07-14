export type ApiErrorLogLevel = 'info' | 'warn' | 'error';
export type ApiErrorHttpStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 410
  | 413
  | 429
  | 500
  | 501
  | 502
  | 503;

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
  BILLING_DOCUMENT_PDF_EXPORT_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.billing_document.pdf_export_audit_failed',
  },
  BILLING_EXPORT_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: false,
    recoveryAction: 'return_to_previous',
    messageLabel: 'api.error.billing.export_audit_failed',
  },
  CARE_REPORT_PDF_EXPORT_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.care_report.pdf_export_audit_failed',
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
  CONFERENCE_NOTE_PDF_EXPORT_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.conference_note.pdf_export_audit_failed',
  },
  ENDPOINT_REMOVED: {
    httpStatus: 410,
    logLevel: 'info',
    retryable: false,
    recoveryAction: 'return_to_previous',
    messageLabel: 'api.error.endpoint.removed',
  },
  EXTERNAL_ACCESS_VIEW_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.external_access.view_audit_failed',
  },
  EXTERNAL_FILE_COMPLETE_FAILED: {
    httpStatus: 502,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.external.file_complete_failed',
  },
  EXTERNAL_FILE_DOWNLOAD_FAILED: {
    httpStatus: 502,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.external.file_download_failed',
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
  FILE_DOWNLOAD_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.file.download_audit_failed',
  },
  FILE_PRESIGNED_DOWNLOAD_JSON_DISABLED: {
    httpStatus: 410,
    logLevel: 'info',
    retryable: false,
    recoveryAction: 'return_to_previous',
    messageLabel: 'api.error.file.presigned_download_json_disabled',
  },
  IDEMPOTENCY_CONFLICT: {
    httpStatus: 409,
    logLevel: 'warn',
    retryable: false,
    recoveryAction: 'correct_input',
    messageLabel: 'api.error.idempotency_conflict',
  },
  INTERNAL_ERROR: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.internal',
  },
  MANAGEMENT_PLAN_PDF_EXPORT_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.management_plan.pdf_export_audit_failed',
  },
  MEDICATION_CALENDAR_PDF_EXPORT_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.medication_calendar.pdf_export_audit_failed',
  },
  MEDICATION_HISTORY_PDF_EXPORT_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.medication_history.pdf_export_audit_failed',
  },
  MEDICATION_STOCK_OBSERVATION_DISABLED: {
    httpStatus: 503,
    logLevel: 'info',
    retryable: false,
    recoveryAction: 'return_to_previous',
    messageLabel: 'api.error.medication_stock_observation.disabled',
  },
  MEDICATION_STOCK_OBSERVATION_UNAVAILABLE: {
    httpStatus: 503,
    logLevel: 'warn',
    retryable: false,
    recoveryAction: 'return_to_previous',
    messageLabel: 'api.error.medication_stock_observation.unavailable',
  },
  OQC_NOT_ENABLED: {
    httpStatus: 501,
    logLevel: 'info',
    retryable: false,
    recoveryAction: 'return_to_previous',
    messageLabel: 'api.error.qualification_check.not_enabled',
  },
  OQC_UNAUTHORIZED: {
    httpStatus: 502,
    logLevel: 'error',
    retryable: false,
    recoveryAction: 'return_to_previous',
    messageLabel: 'api.error.qualification_check.unauthorized',
  },
  OQC_UPSTREAM_FAILURE: {
    httpStatus: 502,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.qualification_check.upstream_failure',
  },
  PATIENT_MCS_SYNC_FAILED: {
    httpStatus: 502,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.patient.mcs_sync_failed',
  },
  PHARMACY_INVOICE_PDF_EXPORT_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.pharmacy_invoice.pdf_export_audit_failed',
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
  PRINT_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.care_report.print_audit_failed',
  },
  RATE_LIMIT_EXCEEDED: {
    httpStatus: 429,
    logLevel: 'warn',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.rate_limited',
  },
  TRACING_REPORT_PDF_EXPORT_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.tracing_report.pdf_export_audit_failed',
  },
  VALIDATION_ERROR: {
    httpStatus: 400,
    logLevel: 'info',
    retryable: false,
    recoveryAction: 'correct_input',
    messageLabel: 'api.error.validation.generic',
  },
  VISIT_RECORD_LIST_PDF_EXPORT_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.visit_record_list.pdf_export_audit_failed',
  },
  VISIT_RECORD_PDF_EXPORT_AUDIT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.visit_record.pdf_export_audit_failed',
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
  YRESE_WEBHOOK_IMPORT_FAILED: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.webhook.yrese_import_failed',
  },
  YRESE_WEBHOOK_PAYLOAD_TOO_LARGE: {
    httpStatus: 413,
    logLevel: 'warn',
    retryable: false,
    recoveryAction: 'correct_input',
    messageLabel: 'api.error.webhook.yrese_payload_too_large',
  },
  YRESE_WEBHOOK_SECRET_UNAVAILABLE: {
    httpStatus: 503,
    logLevel: 'error',
    retryable: false,
    recoveryAction: 'return_to_previous',
    messageLabel: 'api.error.webhook.yrese_secret_unavailable',
  },
  YRESE_WEBHOOK_SIGNATURE_INVALID: {
    httpStatus: 401,
    logLevel: 'warn',
    retryable: false,
    recoveryAction: 'correct_input',
    messageLabel: 'api.error.webhook.yrese_signature_invalid',
  },
  extraction_failed: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.visit_handoff.extraction_failed',
  },
  internal_error: {
    httpStatus: 500,
    logLevel: 'error',
    retryable: true,
    recoveryAction: 'retry',
    messageLabel: 'api.error.visit_handoff.internal_error',
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
