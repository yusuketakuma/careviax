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
        "INTERNAL_ERROR": {
          "httpStatus": 500,
          "logLevel": "error",
          "messageLabel": "api.error.internal",
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
        "VALIDATION_ERROR": {
          "httpStatus": 400,
          "logLevel": "info",
          "messageLabel": "api.error.validation.generic",
          "recoveryAction": "correct_input",
          "retryable": false,
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
      }
    `);
  });

  it('resolves registered definitions and rejects unknown codes', () => {
    expect(isRegisteredApiErrorCode('WORKFLOW_CONFLICT')).toBe(true);
    expect(getApiErrorDefinition('WORKFLOW_CONFLICT')).toMatchObject({
      httpStatus: 409,
      recoveryAction: 'reload',
    });
    expect(isRegisteredApiErrorCode('UNREGISTERED_ERROR')).toBe(false);
    expect(() => getApiErrorDefinition('UNREGISTERED_ERROR')).toThrow(
      new RangeError('Unknown API error code: UNREGISTERED_ERROR'),
    );
  });
});
