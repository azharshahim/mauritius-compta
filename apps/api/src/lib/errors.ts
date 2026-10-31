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
  | 'NOT_IMPLEMENTED'
  // AI engine (mission 5)
  | 'CABINET_NOT_FOUND'
  | 'AI_DISABLED'
  | 'AI_FORBIDDEN'
  | 'AI_NOT_CONFIGURED'
  | 'AI_PROVIDER_NOT_ALLOWED'
  | 'AI_MODEL_NOT_ALLOWED'
  | 'AI_KEY_MISSING'
  | 'AI_ENCRYPTION_NOT_CONFIGURED'
  | 'AI_BASE_URL_INVALID'
  | 'AI_BUDGET_EXCEEDED'
  | 'AI_RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_ERROR'
  | 'AI_INVALID_RESPONSE'
  | 'AI_ROUTING_DISABLED'
  | 'AI_FEATURE_DISABLED'
  | 'AI_FEATURE_UNKNOWN'
  | 'AI_INPUT_TOO_LONG'
  | 'AI_SUGGESTION_NOT_FOUND'
  | 'AI_SUGGESTION_DECIDED'
  | 'AI_ACCOUNT_NOT_IN_CHART'
  | 'AI_ENTRY_FORBIDDEN'
  // Payroll (mission 14)
  | 'PAYROLL_EMPLOYEE_NOT_FOUND'
  | 'PAYROLL_EMPLOYEE_DUPLICATE'
  | 'PAYROLL_EMPLOYEE_NUMBER_TAKEN'
  | 'PAYROLL_CONTRACT_NOT_FOUND'
  | 'PAYROLL_CONTRACT_OVERLAP'
  | 'PAYROLL_CONTRACT_INVALID'
  | 'PAYROLL_PAY_ITEM_NOT_FOUND'
  | 'PAYROLL_PAY_ITEM_CODE_TAKEN'
  | 'PAYROLL_TIME_DUPLICATE'
  | 'PAYROLL_ABSENCE_NOT_FOUND'
  | 'PAYROLL_ABSENCE_DECIDED'
  | 'PAYROLL_LEAVE_RULE_REQUIRED'
  | 'PAYROLL_PERIOD_NOT_FOUND'
  | 'PAYROLL_PERIOD_EXISTS'
  | 'PAYROLL_PERIOD_CLOSED'
  | 'PAYROLL_PERIOD_TRANSITION'
  | 'PAYROLL_ALREADY_CALCULATED'
  | 'PAYROLL_VARIABLE_NOT_FOUND'
  | 'PAYROLL_VARIABLE_DUPLICATE'
  | 'PAYROLL_RULE_NOT_FOUND'
  | 'PAYROLL_RULE_NOT_VALIDATED'
  | 'PAYROLL_RULES_NOT_VALIDATED'
  | 'PAYROLL_STATUTORY_ENGINE_NOT_IMPLEMENTED'
  | 'PAYROLL_CALCULATION_NOT_FOUND'
  | 'PAYROLL_PAYSLIP_NOT_FOUND'
  | 'PAYROLL_PAYSLIP_FINAL_BLOCKED'
  | 'PAYROLL_IMPORT_INVALID'
  // Billing (mission 6)
  | 'CUSTOMER_NOT_FOUND'
  | 'ITEM_NOT_FOUND'
  | 'DOCUMENT_NOT_FOUND'
  | 'DOCUMENT_LOCKED'
  | 'DOCUMENT_NOT_DRAFT'
  | 'DOCUMENT_NOT_ISSUED'
  | 'DOCUMENT_STATUS_INVALID'
  | 'QUOTE_ALREADY_CONVERTED'
  | 'CREDIT_EXCEEDS_INVOICE'
  | 'ALLOCATION_EXCEEDS_INVOICE'
  | 'ALLOCATION_INVALID'
  | 'VAT_NOT_CONFIGURED'
  | 'VAT_RATE_NOT_VERIFIED'
  | 'VAT_RATE_NOT_APPLICABLE'
  | 'VAT_RATE_NOT_FOUND'
  | 'CUSTOMER_DUPLICATE'
  | 'PAYMENT_NOT_FOUND'
  // AI journal proposals V2
  | 'AI_PROPOSAL_NOT_FOUND'
  | 'AI_PROPOSAL_DECIDED'
  | 'AI_PROPOSAL_NOT_VALIDATED'
  | 'AI_PROPOSAL_INVALID'
  | 'AI_HUMAN_REQUIRED'
  | 'AI_RULE_NOT_FOUND'
  | 'AI_RULE_INVALID'
  | 'ACCOUNTING_ALREADY_POSTED'
  // Universal assistant (mission 7)
  | 'AI_CONVERSATION_NOT_FOUND'
  | 'AI_CONVERSATION_CLOSED'
  | 'AI_ASSISTANT_TURN_LIMIT'
  | 'AI_TOOL_UNKNOWN'
  | 'AI_TOOL_ARGUMENTS_INVALID'
  | 'AI_INPUT_INCOMPLETE'
  | 'COMPANY_MISMATCH'
  // Company settings and VAT configuration (mission 7)
  | 'SETTINGS_ACCOUNT_NOT_IN_CHART'
  | 'VAT_RATE_LOCKED'
  | 'VAT_VERIFICATION_FORBIDDEN'
  | 'VAT_SOURCE_REQUIRED'
  | 'SETTINGS_FINANCIAL_YEAR_LOCKED'
  | 'SETTINGS_CURRENCY_LOCKED'
  // Migration assistant (mission 8)
  | 'MIGRATION_JOB_NOT_FOUND'
  | 'MIGRATION_BLOCKED'
  | 'MIGRATION_CONFIRMATION_REQUIRED'
  | 'MIGRATION_FILE_TOO_LARGE'
  | 'MIGRATION_TOO_MANY_ROWS'
  | 'MIGRATION_IMPORT_FAILED'
  | 'MIGRATION_TEMPLATE_EXISTS'
  | 'MIGRATION_TEMPLATE_NOT_FOUND'
  | 'MIGRATION_ALREADY_IMPORTED'
  | 'MIGRATION_INVALID_MAPPING'
  | 'MIGRATION_SHEET_NOT_FOUND'
  // Bank import and reconciliation (mission 9)
  | 'BANK_ACCOUNT_DECISION_REQUIRED'
  | 'BANK_ACCOUNT_EXISTS'
  | 'BANK_ACCOUNT_INACTIVE'
  | 'BANK_ACCOUNT_NOT_FOUND'
  | 'BANK_ALREADY_MATCHED'
  | 'BANK_AMOUNT_EXCEEDS_PAYMENT'
  | 'BANK_AMOUNT_EXCEEDS_TRANSACTION'
  | 'BANK_AMOUNT_MISMATCH'
  | 'BANK_CHART_ACCOUNT_INACTIVE'
  | 'BANK_CHART_ACCOUNT_NOT_ASSET'
  | 'BANK_CHART_ACCOUNT_NOT_FOUND'
  | 'BANK_COMPANY_NOT_IN_CABINET'
  | 'BANK_CONFIRMATION_REQUIRED'
  | 'BANK_CURRENCY_MISMATCH'
  | 'BANK_DIRECTION_MISMATCH'
  | 'BANK_ENTRY_NOT_POSTED'
  | 'BANK_EXCHANGE_RATE_REQUIRED'
  | 'BANK_FILE_INVALID'
  | 'BANK_FILE_REQUIRED'
  | 'BANK_FILE_TOO_LARGE'
  | 'BANK_IMPORT_BLOCKED'
  | 'BANK_INVALID_AMOUNT'
  | 'BANK_INVALID_CURRENCY'
  | 'BANK_JOURNAL_NOT_FOUND'
  | 'BANK_LINES_REQUIRED'
  | 'BANK_LINE_ALREADY_MATCHED'
  | 'BANK_LINK_ALREADY_EXISTS'
  | 'BANK_MATCH_NOT_FOUND'
  | 'BANK_LINE_NOT_FOUND'
  | 'BANK_NO_TABLE'
  | 'BANK_PROPOSAL_CLOSED'
  | 'BANK_PROPOSAL_NOT_FOUND'
  | 'BANK_RULE_NOT_FOUND'
  | 'BANK_RULE_PATTERN_REQUIRED'
  | 'BANK_TOO_MANY_ACCOUNTS'
  | 'BANK_TRANSACTION_CLOSED'
  | 'BANK_TRANSACTION_NOT_FOUND'
  | 'BANK_TRANSACTION_PARTIALLY_ALLOCATED'
  | 'PAYMENT_NOT_ALLOCATED'
  | 'PAYMENT_CANCELLED'
  | 'PAYMENT_RECONCILED'
  // Purchases & suppliers (mission 11)
  | 'SUPPLIER_NOT_FOUND'
  | 'SUPPLIER_INACTIVE'
  | 'SUPPLIER_DUPLICATE'
  | 'ACCOUNT_INACTIVE'
  | 'PURCHASE_ACCOUNT_INVALID'
  | 'PURCHASE_EXCHANGE_RATE_REQUIRED'
  | 'PURCHASE_EXCHANGE_RATE_INVALID'
  | 'PURCHASE_VAT_RECOVERABILITY_REQUIRED'
  | 'PURCHASE_DOCUMENT_NOT_FOUND'
  | 'PURCHASE_DOCUMENT_LOCKED'
  | 'PURCHASE_DOCUMENT_NOT_VALIDATED'
  | 'PURCHASE_DOCUMENT_NOT_NUMBERED'
  | 'PURCHASE_DOCUMENT_EMPTY'
  | 'PURCHASE_DUE_DATE_REQUIRED'
  | 'PURCHASE_DUPLICATE'
  | 'PURCHASE_SUPPLIER_MISMATCH'
  | 'PURCHASE_CURRENCY_MISMATCH'
  | 'PURCHASE_ACCOUNTING_POSTED'
  | 'PURCHASE_BANK_RECONCILED'
  | 'PURCHASE_HAS_ALLOCATIONS'
  | 'PURCHASE_PAYMENT_NOT_FOUND'
  | 'PURCHASE_PAYMENT_CANCELLED'
  | 'PURCHASE_PAYMENT_NOT_NUMBERED'
  | 'PURCHASE_PAYMENT_RECONCILED'
  | 'PURCHASE_ALLOCATION_EXCEEDS_PAYMENT'
  | 'PURCHASE_PAYMENT_UNALLOCATED'
  | 'PURCHASE_ALLOCATION_EXCEEDS_INVOICE'
  | 'PURCHASE_CREDIT_EXCEEDS_AVAILABLE'
  | 'PURCHASE_ALLOCATION_NOT_FOUND'
  | 'BANK_TRANSACTION_ALREADY_ALLOCATED'
  // Ledger lettering (mission 12)
  | 'LETTERING_NOT_FOUND'
  | 'LETTERING_LINE_NOT_FOUND'
  | 'LETTERING_ACCOUNT_NOT_ALLOWED'
  | 'LETTERING_ACCOUNT_CURRENCY_MIXED'
  | 'LETTERING_ENTRY_NOT_POSTED'
  | 'LETTERING_DUPLICATE_LINE'
  | 'LETTERING_SIDE_INVALID'
  | 'LETTERING_TOO_FEW_LINES'
  | 'LETTERING_UNBALANCED'
  | 'LETTERING_AMOUNT_INVALID'
  | 'LETTERING_AMOUNT_NEGATIVE'
  | 'LETTERING_AMOUNT_EXCEEDS_REMAINING'
  | 'LETTERING_NO_DOCUMENT'
  | 'LETTERING_CURRENCY_MISMATCH'
  | 'LETTERING_PERIOD_CLOSED'
  | 'LETTERING_ALREADY_REVERSED'
  | 'LETTERING_REASON_REQUIRED'
  | 'LETTERING_INVALID'
  // Multi-currency and exchange differences (mission 13)
  | 'UNSUPPORTED_CURRENCY'
  | 'FX_FUNCTIONAL_NOT_ALLOWED'
  | 'FX_CURRENCY_NOT_ALLOWED'
  | 'FX_CURRENCY_IN_USE'
  | 'FX_ACCOUNT_INVALID'
  | 'FX_RATE_INVALID'
  | 'FX_RATE_SOURCE_INVALID'
  | 'FX_RATE_SOURCE_REQUIRED'
  | 'FX_RATE_REFERENCE_REQUIRED'
  | 'FX_RATE_NOT_FOUND'
  | 'FX_RATE_CLOSED'
  | 'FX_RATE_ALREADY_VALIDATED'
  | 'FX_RATE_REASON_REQUIRED'
  | 'FX_RATE_NOT_VALIDATED'
  | 'FX_RATE_DIRECTION_MISMATCH'
  | 'FX_RATE_MISSING'
  | 'FX_AMOUNT_INVALID'
  | 'FX_ACCOUNTS_NOT_CONFIGURED'
  | 'FX_TRANSACTION_NOT_POSTED'
  | 'FX_CURRENCY_MISMATCH'
  | 'FX_REALIZED_NOT_FOUND'
  | 'FX_REALIZED_DECIDED'
  | 'FX_REALIZED_CONFIRMATION_REQUIRED'
  | 'FX_REALIZED_SOURCE_MISMATCH'
  | 'FX_VALUATION_NOT_FOUND'
  | 'FX_VALUATION_DECIDED'
  | 'FX_VALUATION_POSTING_BLOCKED'
  | 'FX_VALUATION_RATE_MISSING'
  | 'FX_TRANSFER_NOT_FOUND'
  | 'FX_TRANSFER_POSTING_BLOCKED'
  | 'FX_TRANSFER_RATE_REQUIRED'
  | 'FX_TRANSFER_ACCOUNT_MISMATCH'
  | 'FX_TRANSFER_FEE_ACCOUNT_REQUIRED'
  | 'FUNCTIONAL_CURRENCY_LOCKED';
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
export const conflict = (code: ErrorCode, message?: string, details?: unknown) =>
  new AppError(code, 409, message, details);
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
