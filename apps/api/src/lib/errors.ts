/**
 * Error model. Business errors carry a stable machine code plus an HTTP
 * status. The human readable message is localised server side (fr/en) so that
 * API consumers (and PDF exports) always get a usable text, while the web UI
 * can translate the code itself.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'REGISTRATION_DISABLED'
  | 'EMAIL_TAKEN'
  | 'LAST_LOGIN_TOO_MANY'
  | 'COMPANY_NOT_FOUND'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_CODE_TAKEN'
  | 'ACCOUNT_IN_USE'
  | 'ACCOUNT_PARENT_INVALID'
  | 'JOURNAL_NOT_FOUND'
  | 'ENTRY_NOT_FOUND'
  | 'ENTRY_UNBALANCED'
  | 'ENTRY_TOO_FEW_LINES'
  | 'ENTRY_POSTED_IMMUTABLE'
  | 'ENTRY_NOT_DRAFT'
  | 'ENTRY_ALREADY_REVERSED'
  | 'REFERENCE_TAKEN'
  | 'AMOUNT_TOO_SMALL'
  | 'PERIOD_CLOSED'
  | 'PERIOD_OVERLAP'
  | 'EXCHANGE_RATE_REQUIRED'
  | 'INVALID_CURRENCY'
  | 'CURRENCY_MISMATCH'
  | 'ATTACHMENT_TOO_LARGE'
  | 'ATTACHMENT_TYPE_NOT_ALLOWED'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_DATE_RANGE'
  | 'MODULE_FORBIDDEN'
  | 'COMPANY_ARCHIVED'
  | 'TASK_NOT_FOUND'
  | 'MEMBER_NOT_FOUND'
  | 'ASSIGNEE_NOT_MEMBER'
  | 'INVALID_ROLE'
  | 'INVALID_MODULE'
  | 'NOT_IMPLEMENTED';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, status: number, message?: string, details?: unknown) {
    super(message ?? code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (code: ErrorCode, message?: string, details?: unknown) =>
  new AppError(code, 400, message, details);
export const unauthorized = (message?: string) => new AppError('UNAUTHORIZED', 401, message);
export const forbidden = (message?: string, code: ErrorCode = 'FORBIDDEN') =>
  new AppError(code, 403, message);
export const notFound = (code: ErrorCode, message?: string) =>
  new AppError(code, 404, message);
export const conflict = (code: ErrorCode, message?: string) => new AppError(code, 409, message);
export const notImplemented = (code: ErrorCode, message?: string) =>
  new AppError(code, 501, message);

/** Maps raw PostgreSQL error codes/messages to business errors. */
export function mapDatabaseError(err: unknown): AppError | null {
  const e = err as { code?: string; message?: string; constraint?: string } | undefined;
  if (!e) return null;

  if (e.code === '23505') {
    // Name the business rule that was violated when the constraint is known.
    if (e.constraint === 'journal_entries_reference_unique_idx') {
      return conflict('REFERENCE_TAKEN', 'This reference is already used in the company');
    }
    if (e.constraint === 'journal_entries_one_reversal_idx') {
      return conflict('ENTRY_ALREADY_REVERSED', 'This entry has already been reversed');
    }
    return conflict('CONFLICT', 'Duplicate value');
  }
  if (e.code === '23503') {
    return badRequest('VALIDATION_ERROR', 'Referenced record does not exist');
  }
  if (e.code === '23514' || e.code === 'check_violation' || e.message?.includes('check_violation')) {
    const msg = e.message ?? '';
    if (msg.includes('POSTED_ENTRY_IMMUTABLE')) {
      return conflict('ENTRY_POSTED_IMMUTABLE', 'A posted entry cannot be modified');
    }
    if (msg.includes('ENTRY_UNBALANCED')) {
      return badRequest('ENTRY_UNBALANCED', 'Debit and credit totals must be equal');
    }
    if (msg.includes('ACCOUNT_IN_USE')) {
      return conflict('ACCOUNT_IN_USE', 'Account is used by journal entries');
    }
    if (msg.includes('CROSS_COMPANY_REFERENCE')) {
      return forbidden('Cross-company reference is not allowed');
    }
    if (msg.includes('AUDIT_LOG_APPEND_ONLY')) {
      return forbidden('The audit log is append-only');
    }
    if (msg.includes('INVALID_REVERSAL')) {
      return badRequest('ENTRY_NOT_DRAFT', 'Only a posted entry can be reversed');
    }
    if (msg.includes('ENTRY_TOO_FEW_LINES')) {
      return badRequest('ENTRY_TOO_FEW_LINES', 'At least two lines are required');
    }
    return badRequest('VALIDATION_ERROR', 'Constraint violation');
  }
  return null;
}
