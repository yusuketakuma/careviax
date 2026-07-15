import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODE_REGISTRY,
  getApiErrorDefinition,
  isRegisteredApiErrorCode,
} from './error-codes';

describe('API error code registry', () => {
  it('keeps the shared error contract as an explicit snapshot', () => {
    expect(API_ERROR_CODE_REGISTRY).toMatchInlineSnapshot(`
      {
        "AUTH_FORBIDDEN": {
          "httpStatus": 403,
          "logLevel": "warn",
          "messageLabel": "api.error.auth.forbidden",
          "recoveryAction": "request_access",
          "retryable": false,
        },
        "AUTH_NO_ORG": {
          "httpStatus": 400,
          "logLevel": "warn",
          "messageLabel": "api.error.auth.no_org",
          "recoveryAction": "select_organization",
          "retryable": false,
        },
        "AUTH_RECOVERY_CODE_INVALID": {
          "httpStatus": 400,
          "logLevel": "warn",
          "messageLabel": "api.error.auth.recovery_code_invalid",
          "recoveryAction": "correct_input",
          "retryable": false,
        },
        "AUTH_UNAUTHENTICATED": {
          "httpStatus": 401,
          "logLevel": "warn",
          "messageLabel": "api.error.auth.unauthenticated",
          "recoveryAction": "sign_in",
          "retryable": false,
        },
        "BILLING_DOCUMENT_PDF_EXPORT_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.billing_document.pdf_export_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "BILLING_EXPORT_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.billing.export_audit_failed",
          "recoveryAction": "return_to_previous",
          "retryable": false,
        },
        "CARE_REPORT_PDF_EXPORT_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.care_report.pdf_export_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "COMMUNICATION_REQUEST_EXPORT_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.communication_request.export_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "COMMUNICATION_REQUEST_EXPORT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.communication_request.export_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "CONFERENCE_NOTE_PDF_EXPORT_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.conference_note.pdf_export_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "ENDPOINT_REMOVED": {
          "httpStatus": 410,
          "logLevel": "info",
          "messageLabel": "api.error.endpoint.removed",
          "recoveryAction": "return_to_previous",
          "retryable": false,
        },
        "EPRESCRIPTION_NOT_ENABLED": {
          "httpStatus": 501,
          "logLevel": "info",
          "messageLabel": "api.error.e_prescription.not_enabled",
          "recoveryAction": "return_to_previous",
          "retryable": false,
        },
        "EXTERNAL_ACCESS_VIEW_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.external_access.view_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "EXTERNAL_FILE_COMPLETE_FAILED": {
          "httpStatus": 502,
          "logLevel": "error",
          "messageLabel": "api.error.external.file_complete_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "EXTERNAL_FILE_DOWNLOAD_FAILED": {
          "httpStatus": 502,
          "logLevel": "error",
          "messageLabel": "api.error.external.file_download_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "EXTERNAL_FILE_UPLOAD_FAILED": {
          "httpStatus": 502,
          "logLevel": "error",
          "messageLabel": "api.error.external.file_upload_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "EXTERNAL_JOB_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.external.job_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "EXTERNAL_PDF_RENDER_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.external.pdf_render_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "FILE_DOWNLOAD_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.file.download_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "FILE_PRESIGNED_DOWNLOAD_JSON_DISABLED": {
          "httpStatus": 410,
          "logLevel": "info",
          "messageLabel": "api.error.file.presigned_download_json_disabled",
          "recoveryAction": "return_to_previous",
          "retryable": false,
        },
        "IDEMPOTENCY_CONFLICT": {
          "httpStatus": 409,
          "logLevel": "warn",
          "messageLabel": "api.error.idempotency_conflict",
          "recoveryAction": "correct_input",
          "retryable": false,
        },
        "INTERNAL_ERROR": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.internal",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "MANAGEMENT_PLAN_PDF_EXPORT_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.management_plan.pdf_export_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "MEDICATION_CALENDAR_PDF_EXPORT_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.medication_calendar.pdf_export_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "MEDICATION_HISTORY_PDF_EXPORT_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.medication_history.pdf_export_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "MEDICATION_STOCK_OBSERVATION_DISABLED": {
          "httpStatus": 503,
          "logLevel": "info",
          "messageLabel": "api.error.medication_stock_observation.disabled",
          "recoveryAction": "return_to_previous",
          "retryable": false,
        },
        "MEDICATION_STOCK_OBSERVATION_UNAVAILABLE": {
          "httpStatus": 503,
          "logLevel": "warn",
          "messageLabel": "api.error.medication_stock_observation.unavailable",
          "recoveryAction": "return_to_previous",
          "retryable": false,
        },
        "OQC_NOT_ENABLED": {
          "httpStatus": 501,
          "logLevel": "info",
          "messageLabel": "api.error.qualification_check.not_enabled",
          "recoveryAction": "return_to_previous",
          "retryable": false,
        },
        "OQC_UNAUTHORIZED": {
          "httpStatus": 502,
          "logLevel": "error",
          "messageLabel": "api.error.qualification_check.unauthorized",
          "recoveryAction": "return_to_previous",
          "retryable": false,
        },
        "OQC_UPSTREAM_FAILURE": {
          "httpStatus": 502,
          "logLevel": "error",
          "messageLabel": "api.error.qualification_check.upstream_failure",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "PATIENT_MCS_SYNC_FAILED": {
          "httpStatus": 502,
          "logLevel": "error",
          "messageLabel": "api.error.patient.mcs_sync_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "PHARMACY_DRUG_STOCK_EXPORT_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.pharmacy_drug_stock.export_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "PHARMACY_DRUG_STOCK_EXPORT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.pharmacy_drug_stock.export_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "PHARMACY_INVOICE_PDF_EXPORT_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.pharmacy_invoice.pdf_export_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "PRINT_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.care_report.print_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "RATE_LIMIT_EXCEEDED": {
          "httpStatus": 429,
          "logLevel": "warn",
          "messageLabel": "api.error.rate_limited",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "TRACING_REPORT_PDF_EXPORT_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.tracing_report.pdf_export_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "VALIDATION_ERROR": {
          "httpStatus": 400,
          "logLevel": "info",
          "messageLabel": "api.error.validation.generic",
          "recoveryAction": "correct_input",
          "retryable": false,
        },
        "VISIT_RECORD_LIST_PDF_EXPORT_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.visit_record_list.pdf_export_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "VISIT_RECORD_PDF_EXPORT_AUDIT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.visit_record.pdf_export_audit_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "WORKFLOW_CONFLICT": {
          "httpStatus": 409,
          "logLevel": "warn",
          "messageLabel": "api.error.workflow.conflict",
          "recoveryAction": "reload",
          "retryable": true,
        },
        "WORKFLOW_NOT_FOUND": {
          "httpStatus": 404,
          "logLevel": "info",
          "messageLabel": "api.error.workflow.not_found",
          "recoveryAction": "return_to_previous",
          "retryable": false,
        },
        "YRESE_WEBHOOK_IMPORT_FAILED": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.webhook.yrese_import_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "YRESE_WEBHOOK_PAYLOAD_TOO_LARGE": {
          "httpStatus": 413,
          "logLevel": "warn",
          "messageLabel": "api.error.webhook.yrese_payload_too_large",
          "recoveryAction": "correct_input",
          "retryable": false,
        },
        "YRESE_WEBHOOK_SECRET_UNAVAILABLE": {
          "httpStatus": 503,
          "logLevel": "error",
          "messageLabel": "api.error.webhook.yrese_secret_unavailable",
          "recoveryAction": "return_to_previous",
          "retryable": false,
        },
        "YRESE_WEBHOOK_SIGNATURE_INVALID": {
          "httpStatus": 401,
          "logLevel": "warn",
          "messageLabel": "api.error.webhook.yrese_signature_invalid",
          "recoveryAction": "correct_input",
          "retryable": false,
        },
        "extraction_failed": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.visit_handoff.extraction_failed",
          "recoveryAction": "retry",
          "retryable": true,
        },
        "internal_error": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.visit_handoff.internal_error",
          "recoveryAction": "retry",
          "retryable": true,
        },
      }
    `);
  });

  it('resolves registered definitions and rejects unknown codes', () => {
    expect(isRegisteredApiErrorCode('WORKFLOW_CONFLICT')).toBe(true);
    expect(getApiErrorDefinition('WORKFLOW_CONFLICT')).toMatchObject({
      httpStatus: 409,
      recoveryAction: 'reload',
    });
    expect(getApiErrorDefinition('IDEMPOTENCY_CONFLICT')).toMatchObject({
      httpStatus: 409,
      retryable: false,
      recoveryAction: 'correct_input',
      messageLabel: 'api.error.idempotency_conflict',
    });
    expect(getApiErrorDefinition('MEDICATION_STOCK_OBSERVATION_DISABLED')).toMatchObject({
      httpStatus: 503,
      logLevel: 'info',
      retryable: false,
      recoveryAction: 'return_to_previous',
    });
    expect(getApiErrorDefinition('MEDICATION_STOCK_OBSERVATION_UNAVAILABLE')).toMatchObject({
      httpStatus: 503,
      logLevel: 'warn',
      retryable: false,
      recoveryAction: 'return_to_previous',
    });
    expect(getApiErrorDefinition('extraction_failed')).toMatchObject({
      httpStatus: 500,
      retryable: true,
      recoveryAction: 'retry',
      messageLabel: 'api.error.visit_handoff.extraction_failed',
    });
    expect(getApiErrorDefinition('internal_error')).toMatchObject({
      httpStatus: 500,
      retryable: true,
      recoveryAction: 'retry',
      messageLabel: 'api.error.visit_handoff.internal_error',
    });
    expect(isRegisteredApiErrorCode('UNREGISTERED_ERROR')).toBe(false);
    expect(() => getApiErrorDefinition('UNREGISTERED_ERROR')).toThrow(
      new RangeError('Unknown API error code: UNREGISTERED_ERROR'),
    );
  });
});
