/** Shared types for the financial-year lifecycle (mission 21). */
export interface FinancialYearActor {
  companyId: string;
  userId: string;
  ip?: string | null;
}

export interface Check {
  code: string;
  severity: 'ok' | 'warning' | 'block';
  messageEn: string;
  messageFr: string;
}

/** A checklist item is allowed to be unavailable: it must never be a false pass. */
export interface ChecklistItem {
  code: string;
  module: string;
  labelEn: string;
  labelFr: string;
  state: 'ok' | 'warning' | 'pending' | 'unavailable' | 'block';
  detailEn: string;
  detailFr: string;
  count?: number;
  amount?: string;
}
