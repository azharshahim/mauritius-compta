import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { demoEnabled } from '../../demo';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { amountInputValue, date, money, normalizeDecimalInput, today } from '../../format';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';

/**
 * Comptabilité → Multidevises (mission 13).
 *
 * Read and explicit human actions only. A rate is never applied silently, a
 * realized difference is proposed before it is posted, and latent revaluation
 * posting stays blocked until an accounting policy is validated. Every screen
 * repeats that rates are entered by the company and are not official.
 */

type Tab = 'config' | 'rates' | 'realized' | 'valuations' | 'transfers' | 'report';

interface Config {
  functionalCurrency: string;
  functionalLocked: boolean;
  functionalLockedAt: string | null;
  ratePolicy: string;
  fxGainAccountId: string | null;
  fxLossAccountId: string | null;
  valuationEnabled: boolean;
  valuationPosting: boolean;
  notes: string | null;
  allowedCurrencies: { currency: string; is_allowed: boolean }[];
  accounts: { id: string; code: string; name: string; type: string }[];
  supportedCurrencies: string[];
}
interface Rate {
  id: string;
  base_currency: string;
  quote_currency: string;
  rate_date: string;
  rate: string;
  source_kind: 'manual' | 'imported' | 'demo';
  source: string;
  reference: string | null;
  status: 'draft' | 'validated' | 'rejected' | 'superseded';
  version: number;
}
interface Adjustment {
  id: string; side: 'customer' | 'supplier'; invoice_no: string | null; payment_no: string | null;
  partner_name: string | null; currency: string; invoice_rate: string; settlement_rate: string;
  settled_txn_amount: string; invoice_functional: string; settlement_functional: string;
  difference: string; direction: 'gain' | 'loss'; status: 'proposed' | 'posted' | 'rejected';
  rationale: string | null; entry_id: string | null;
}
interface Valuation {
  id: string; valuation_date: string; status: string; line_count?: number; note: string | null;
  totalsByCurrency?: Record<string, { gain: string; loss: string; blocked: number }>;
  lines?: { id: string; currency: string; source_type: string; document_no: string | null;
    revalued_functional: string | null; difference: string | null;
    direction: 'gain' | 'loss' | null; blocked_reason: string | null }[];
  postingBlocked?: boolean;
}
interface Transfer {
  id: string; transfer_date: string; from_name: string; to_name: string; from_currency: string;
  to_currency: string; from_amount: string; to_amount: string; rate: string;
  fee_amount: string; fee_currency: string; simulated: boolean;
}
interface BankAccount { id: string; name: string; currency: string }
interface Report {
  functionalCurrency: string; valuationDate: string;
  receivables: { currency: string; amount_txn: string; functional: string; documents: number }[];
  payables: { currency: string; amount_txn: string; functional: string; documents: number }[];
  bankAccounts: { currency: string; name: string; balance: string | null }[];
  realized: { currency: string; direction: string; status: string; count: number; amount: string }[];
  latent?: { valuation: Valuation | null; totals: { currency: string; direction: string; amount: string; count: number; blocked: number }[]; postingBlocked: boolean };
  blockedOperations: { source_type: string; reference: string; currency: string; operation_date?: string; date?: string }[];
  note: string;
}

const L = {
  fr: {
    title: 'Multidevises', intro: 'Factures en devise, taux validés par un humain, écarts réalisés proposés et évaluations latentes simulées. Aucun taux officiel n’est supposé et aucune écriture de change n’est créée automatiquement.',
    demo: 'Mode démonstration : taux et opérations fictifs, stockés uniquement dans ce navigateur. Aucune donnée réelle.', notOfficial: 'Les taux sont saisis par la société et validés par un humain. Ils ne proviennent d’aucune banque centrale dans cette version.',
    tabConfig: 'Configuration', tabRates: 'Taux & conversion', tabRealized: 'Écarts réalisés', tabValuations: 'Évaluations latentes', tabTransfers: 'Virements', tabReport: 'Rapports',
    functional: 'Devise fonctionnelle', locked: 'verrouillée après comptabilisation', notLocked: 'non verrouillée', lock: 'Verrouiller la devise fonctionnelle', lockHint: 'Action irréversible. La procédure de changement après comptabilisation n’est pas implémentée.',
    allowed: 'Devises autorisées', saveConfig: 'Enregistrer la configuration', gain: 'Compte de gain de change', loss: 'Compte de perte de change', noAccount: '— non configuré : la comptabilisation sera bloquée —', valuation: 'Simulation de réévaluation activée', notes: 'Notes internes', saved: 'Configuration enregistrée.', noAccounts: 'Aucun compte de produit ou de charge disponible.',
    newRate: 'Nouveau taux', base: 'Devise de base', quote: 'Devise de cotation', rateDate: 'Date du taux', rate: 'Taux (décimal exact)', sourceKind: 'Origine', manual: 'Saisi', imported: 'Importé (à confirmer)', demoKind: 'Fictif de démonstration', source: 'Provenance', reference: 'Référence', createRate: 'Enregistrer comme brouillon', rateCreated: 'Taux enregistré en brouillon. Il n’est utilisable qu’après validation humaine.',
    history: 'Historique des taux', noRates: 'Aucun taux enregistré.', validate: 'Valider', reject: 'Rejeter', status: 'Statut', draft: 'Brouillon', validated: 'Validé', rejected: 'Rejeté', superseded: 'Remplacé', confirmValidate: 'Je confirme avoir vérifié la provenance, la paire et la date de ce taux.', rateValidated: 'Taux validé.', rejectReason: 'Motif du rejet', confirmReject: 'Confirmer le rejet', rateRejected: 'Taux rejeté.',
    conversion: 'Expliquer une conversion', amount: 'Montant', convert: 'Calculer avec le taux validé', conversionBlocked: 'Aucun taux validé pour cette paire et cette date. La conversion est bloquée ; aucun taux de secours n’est utilisé.', converted: 'Contre-valeur', inverse: 'Taux inverse', identity: 'Devise identique : aucun change.',
    scan: 'Rechercher les écarts réalisés', noAdjustments: 'Aucun écart réalisé proposé ou comptabilisé.', calc: 'Calcul', invoiceFunctional: 'Valeur comptable facture', settlementFunctional: 'Valeur comptable règlement', difference: 'Écart', posted: 'Comptabilisé', proposed: 'Proposé', post: 'Comptabiliser', rejectAdj: 'Rejeter', postTitle: 'Comptabiliser l’écart de change', postHint: 'Une écriture unique sera créée dans le journal des opérations diverses, si les comptes de gain et de perte sont configurés. Aucun compte n’est inventé.', confirmPost: 'Je confirme le calcul et la justification de cet écart.', rationale: 'Justification', postDone: 'Écart comptabilisé.', adjRejected: 'Écart rejeté.',
    valuationDate: 'Date d’évaluation', simulate: 'Simuler l’évaluation', noValuations: 'Aucune évaluation simulée.', blockedReason: 'Blocage', blocked: 'ligne(s) bloquée(s)', validateValuation: 'Valider la simulation', postBlocked: 'Comptabilisation de la réévaluation bloquée : aucune politique comptable n’a été validée. Seule la simulation est disponible.', valuationValidated: 'Simulation validée (aucune écriture créée).', detail: 'Détail',
    transfers: 'Virement inter-devises', from: 'Compte source', to: 'Compte destination', fee: 'Frais bancaires (distincts, même devise que la source)', preview: 'Calculer et enregistrer la simulation', noTransfers: 'Aucun virement simulé.', transferBlocked: 'Comptabilisation du virement bloquée : un virement interne ne doit créer ni produit ni charge, et les frais doivent rester distincts de l’écart de change.', feeDistinct: 'Frais distincts', sameAccount: 'Choisissez deux comptes distincts.',
    customer: 'Client', supplier: 'Fournisseur', gainShort: 'Gain', lossShort: 'Perte', type: 'Type', report: 'Rapports par devise', receivables: 'Créances clients', payables: 'Dettes fournisseurs', bank: 'Soldes bancaires', realized: 'Gains et pertes réalisés', blockedOps: 'Opérations bloquées (taux absent)', txn: 'Montant devise', func: 'Contre-valeur', docs: 'Documents', noRows: 'Aucune ligne.', csv: 'Télécharger le CSV', noTotal: 'Aucun total n’est additionné entre devises.', loadErr: 'Chargement impossible',
  },
  en: {
    title: 'Multi-currency', intro: 'Foreign-currency invoices, human-validated rates, proposed realized differences and simulated latent revaluations. No official rate is assumed and no FX entry is created automatically.',
    demo: 'Demo mode: fictional rates and operations stored only in this browser. No real data.', notOfficial: 'Rates are entered by the company and validated by a human. They do not come from any central bank in this version.',
    tabConfig: 'Configuration', tabRates: 'Rates & conversion', tabRealized: 'Realized differences', tabValuations: 'Latent valuations', tabTransfers: 'Transfers', tabReport: 'Reports',
    functional: 'Functional currency', locked: 'locked after posting', notLocked: 'not locked', lock: 'Lock the functional currency', lockHint: 'Irreversible action. The post-posting change procedure is not implemented.',
    allowed: 'Allowed currencies', saveConfig: 'Save configuration', gain: 'FX gain account', loss: 'FX loss account', noAccount: '— not configured: posting will be blocked —', valuation: 'Revaluation simulation enabled', notes: 'Internal notes', saved: 'Configuration saved.', noAccounts: 'No revenue or expense account available.',
    newRate: 'New rate', base: 'Base currency', quote: 'Quote currency', rateDate: 'Rate date', rate: 'Rate (exact decimal)', sourceKind: 'Origin', manual: 'Entered', imported: 'Imported (to confirm)', demoKind: 'Fictional demo', source: 'Source', reference: 'Reference', createRate: 'Save as draft', rateCreated: 'Rate saved as draft. It can only be used after human validation.',
    history: 'Rate history', noRates: 'No rate recorded.', validate: 'Validate', reject: 'Reject', status: 'Status', draft: 'Draft', validated: 'Validated', rejected: 'Rejected', superseded: 'Superseded', confirmValidate: 'I confirm I checked the source, pair and date of this rate.', rateValidated: 'Rate validated.', rejectReason: 'Rejection reason', confirmReject: 'Confirm rejection', rateRejected: 'Rate rejected.',
    conversion: 'Explain a conversion', amount: 'Amount', convert: 'Compute with the validated rate', conversionBlocked: 'No validated rate exists for this pair and date. The conversion is blocked; no fallback rate is used.', converted: 'Converted value', inverse: 'Inverse rate', identity: 'Same currency: no conversion.',
    scan: 'Find realized differences', noAdjustments: 'No proposed or posted realized difference.', calc: 'Calculation', invoiceFunctional: 'Invoice carrying value', settlementFunctional: 'Settlement carrying value', difference: 'Difference', posted: 'Posted', proposed: 'Proposed', post: 'Post', rejectAdj: 'Reject', postTitle: 'Post the exchange difference', postHint: 'A single entry will be created in the miscellaneous journal when both FX accounts are configured. No account is invented.', confirmPost: 'I confirm the calculation and rationale of this difference.', rationale: 'Rationale', postDone: 'Difference posted.', adjRejected: 'Difference rejected.',
    valuationDate: 'Valuation date', simulate: 'Simulate valuation', noValuations: 'No simulated valuation.', blockedReason: 'Blocked', blocked: 'blocked line(s)', validateValuation: 'Validate simulation', postBlocked: 'Revaluation posting is blocked: no accounting policy has been validated. Only simulation is available.', valuationValidated: 'Simulation validated (no entry created).', detail: 'Detail',
    transfers: 'Cross-currency transfer', from: 'Source account', to: 'Destination account', fee: 'Bank fee (distinct, in the source currency)', preview: 'Compute and save simulation', noTransfers: 'No simulated transfer.', transferBlocked: 'Transfer posting is blocked: an internal transfer must create neither income nor expense, and fees must stay distinct from the exchange difference.', feeDistinct: 'Distinct fee', sameAccount: 'Choose two distinct accounts.',
    customer: 'Customer', supplier: 'Supplier', gainShort: 'Gain', lossShort: 'Loss', type: 'Type', report: 'Reports by currency', receivables: 'Customer receivables', payables: 'Supplier payables', bank: 'Bank balances', realized: 'Realized gains and losses', blockedOps: 'Blocked operations (missing rate)', txn: 'Currency amount', func: 'Functional value', docs: 'Documents', noRows: 'No line.', csv: 'Download CSV', noTotal: 'No total is added across currencies.', loadErr: 'Unable to load',
  },
} as const;

const badge = (status: string): 'success' | 'warning' | 'danger' | 'neutral' =>
  status === 'validated' || status === 'posted' ? 'success' : status === 'rejected' ? 'danger' : status === 'draft' || status === 'proposed' || status === 'simulated' ? 'warning' : 'neutral';

export function MultiCurrencyPage() {
  const { t, locale } = useI18n();
  const tr = L[locale];
  const { company } = useSession();
  const companyId = company?.id ?? '';
  const [tab, setTab] = useState<Tab>('config');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [rates, setRates] = useState<Rate[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [valuations, setValuations] = useState<Valuation[]>([]);
  const [valuation, setValuation] = useState<Valuation | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [report, setReport] = useState<Report | null>(null);

  const [allowed, setAllowed] = useState<string[]>([]);
  const [gainAccount, setGainAccount] = useState('');
  const [lossAccount, setLossAccount] = useState('');
  const [valuationEnabled, setValuationEnabled] = useState(false);
  const [notes, setNotes] = useState('');

  const [rateForm, setRateForm] = useState({ baseCurrency: 'EUR', quoteCurrency: 'MUR', rateDate: today(), rate: '', sourceKind: 'manual', source: '', reference: '' });
  const [conversion, setConversion] = useState({ amount: '1000', from: 'EUR', to: 'MUR', date: today() });
  const [conversionResult, setConversionResult] = useState<any>(null);
  const [conversionBlocked, setConversionBlocked] = useState<string | null>(null);

  const [rateToValidate, setRateToValidate] = useState<Rate | null>(null);
  const [rateReviewed, setRateReviewed] = useState(false);
  const [rateToReject, setRateToReject] = useState<Rate | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [adjustmentToPost, setAdjustmentToPost] = useState<Adjustment | null>(null);
  const [adjustmentReviewed, setAdjustmentReviewed] = useState(false);
  const [adjustmentRationale, setAdjustmentRationale] = useState('');
  const [valuationDate, setValuationDate] = useState(today());
  const [transferForm, setTransferForm] = useState({ fromBankAccountId: '', toBankAccountId: '', transferDate: today(), fromAmount: '', feeAmount: '' });
  const [transferPreview, setTransferPreview] = useState<Transfer | null>(null);

  const loadConfig = useCallback(async () => {
    if (!companyId) return;
    const res = await api.get<Config & { settings?: Config }>(`/companies/${companyId}/fx/config`);
    const value = (res as any).settings ?? res;
    setConfig(value);
    setAllowed(value.allowedCurrencies.filter((c: any) => c.is_allowed).map((c: any) => c.currency));
    setGainAccount(value.fxGainAccountId ?? '');
    setLossAccount(value.fxLossAccountId ?? '');
    setValuationEnabled(value.valuationEnabled);
    setNotes(value.notes ?? '');
  }, [companyId]);
  const loadRates = useCallback(async () => {
    if (!companyId) return;
    const res = await api.get<{ rates: Rate[] }>(`/companies/${companyId}/fx/rates?limit=200`);
    setRates(res.rates);
  }, [companyId]);
  const loadRealized = useCallback(async () => {
    if (!companyId) return;
    const res = await api.get<{ adjustments: Adjustment[] }>(`/companies/${companyId}/fx/realized?limit=200`);
    setAdjustments(res.adjustments);
  }, [companyId]);
  const loadValuations = useCallback(async () => {
    if (!companyId) return;
    const res = await api.get<{ valuations: Valuation[] }>(`/companies/${companyId}/fx/valuations`);
    setValuations(res.valuations);
  }, [companyId]);
  const loadTransfers = useCallback(async () => {
    if (!companyId) return;
    const [t, b] = await Promise.all([
      api.get<{ transfers: Transfer[] }>(`/companies/${companyId}/fx/transfers`),
      api.get<{ accounts: BankAccount[] }>(`/companies/${companyId}/bank/accounts`),
    ]);
    setTransfers(t.transfers);
    setBanks(b.accounts);
    setTransferForm((current) => ({
      ...current,
      fromBankAccountId: current.fromBankAccountId || b.accounts[0]?.id || '',
      toBankAccountId: current.toBankAccountId || b.accounts[1]?.id || '',
    }));
  }, [companyId]);
  const loadReport = useCallback(async () => {
    if (!companyId) return;
    const res = await api.get<{ report: Report }>(`/companies/${companyId}/fx/report`);
    setReport(res.report);
  }, [companyId]);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([loadConfig(), loadRates()])
      .catch((err) => setError(errorMessage(err, tr.loadErr).message))
      .finally(() => setLoading(false));
  }, [companyId, loadConfig, loadRates, tr.loadErr]);

  useEffect(() => {
    if (!companyId) return;
    const run =
      tab === 'realized' ? loadRealized
      : tab === 'valuations' ? loadValuations
      : tab === 'transfers' ? loadTransfers
      : tab === 'report' ? loadReport
      : null;
    if (run) void run().catch((err) => setError(errorMessage(err, tr.loadErr).message));
  }, [tab, companyId, loadRealized, loadValuations, loadTransfers, loadReport, tr.loadErr]);

  const accounts = useMemo(() => config?.accounts ?? [], [config]);
  const display = (value: string | null | undefined, currency?: string) => money(value, locale, currency);

  const act = async (work: () => Promise<void>, success?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      if (success) setNotice(success);
    } catch (err) {
      setError(errorMessage(err, tr.loadErr).message);
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = () => act(async () => {
    await api.patch(`/companies/${companyId}/fx/config`, {
      allowedCurrencies: allowed,
      fxGainAccountId: gainAccount || null,
      fxLossAccountId: lossAccount || null,
      valuationEnabled,
      notes: notes.trim() || null,
    });
    await loadConfig();
  }, tr.saved);

  const lockFunctional = () => {
    if (!window.confirm(tr.lockHint)) return;
    void act(async () => {
      await api.patch(`/companies/${companyId}/fx/config`, { lockFunctional: true });
      await loadConfig();
    }, tr.saved);
  };

  const createRate = () => act(async () => {
    await api.post(`/companies/${companyId}/fx/rates`, {
      ...rateForm,
      quoteCurrency: rateForm.quoteCurrency.toUpperCase(),
      baseCurrency: rateForm.baseCurrency.toUpperCase(),
      rate: normalizeDecimalInput(rateForm.rate),
      reference: rateForm.reference.trim() || null,
    });
    setRateForm((current) => ({ ...current, rate: '', reference: '' }));
    await loadRates();
  }, tr.rateCreated);

  const doValidateRate = () => act(async () => {
    if (!rateToValidate) return;
    await api.post(`/companies/${companyId}/fx/rates/${rateToValidate.id}/validate`, { confirm: true });
    setRateToValidate(null);
    setRateReviewed(false);
    await loadRates();
  }, tr.rateValidated);

  const doRejectRate = () => act(async () => {
    if (!rateToReject || !rejectReason.trim()) return;
    await api.post(`/companies/${companyId}/fx/rates/${rateToReject.id}/reject`, { reason: rejectReason.trim() });
    setRateToReject(null);
    setRejectReason('');
    await loadRates();
  }, tr.rateRejected);

  const runConversion = () => act(async () => {
    setConversionResult(null);
    setConversionBlocked(null);
    const amount = normalizeDecimalInput(conversion.amount);
    try {
      const res = await api.get<any>(`/companies/${companyId}/fx/resolve?amount=${encodeURIComponent(amount)}&from=${conversion.from}&to=${conversion.to}&date=${conversion.date}`);
      setConversionResult(res);
    } catch (err) {
      const info = errorMessage(err, tr.loadErr);
      setConversionBlocked(info.message);
      throw err;
    }
  });

  const scan = () => act(async () => {
    await api.post(`/companies/${companyId}/fx/realized/scan`, {});
    await loadRealized();
  });

  const doPostAdjustment = () => act(async () => {
    if (!adjustmentToPost) return;
    await api.post(`/companies/${companyId}/fx/realized/${adjustmentToPost.id}/post`, { confirm: true });
    setAdjustmentToPost(null);
    setAdjustmentReviewed(false);
    setAdjustmentRationale('');
    await loadRealized();
  }, tr.postDone);

  const simulate = () => act(async () => {
    const res = await api.post<{ valuation: Valuation }>(`/companies/${companyId}/fx/valuations`, { valuationDate });
    setValuation(res.valuation);
    await loadValuations();
  });

  const openValuation = (id: string) => act(async () => {
    const res = await api.get<{ valuation: Valuation }>(`/companies/${companyId}/fx/valuations/${id}`);
    setValuation(res.valuation);
  });

  const validateValuation = () => act(async () => {
    if (!valuation) return;
    const res = await api.post<{ valuation: Valuation }>(`/companies/${companyId}/fx/valuations/${valuation.id}/validate`, { confirm: true });
    setValuation(res.valuation);
    await loadValuations();
  }, tr.valuationValidated);

  const previewTransfer = () => act(async () => {
    if (!transferForm.fromBankAccountId || !transferForm.toBankAccountId || transferForm.fromBankAccountId === transferForm.toBankAccountId) {
      setError(tr.sameAccount);
      return;
    }
    const res = await api.post<{ transfer: Transfer }>(`/companies/${companyId}/fx/transfers`, {
      ...transferForm,
      fromAmount: normalizeDecimalInput(transferForm.fromAmount),
      feeAmount: transferForm.feeAmount ? normalizeDecimalInput(transferForm.feeAmount) : null,
    });
    setTransferPreview((res as any).transfer ?? (res as any));
    await loadTransfers();
  });

  const downloadCsv = () => {
    if (!report) return;
    if (demoEnabled) {
      // Demo values are browser-only: build the same non-totalising CSV locally.
      const lines = [
        ['Rapport multidevise', 'Devise fonctionnelle', report.functionalCurrency, 'Aucun total inter-devises'],
        ['Créances clients', 'Devise', tr.txn, tr.func],
        ...report.receivables.map((r) => [tr.receivables, r.currency, r.amount_txn, r.functional]),
        ['Dettes fournisseurs', 'Devise', tr.txn, tr.func],
        ...report.payables.map((r) => [tr.payables, r.currency, r.amount_txn, r.functional]),
      ];
      const csv = lines.map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\r\n');
      const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'multidevise-rapport-demo.csv';
      link.click();
      URL.revokeObjectURL(url);
      return;
    }
    window.location.assign(`/api/companies/${companyId}/fx/report.csv`);
  };

  if (loading) return <Spinner label={tr.loadErr} />;

  return (
    <div className="stack">
      <header className="page-head">
        <div className="grow">
          <h1>{tr.title}</h1>
          <p className="page-sub">{tr.intro}</p>
        </div>
      </header>
      {demoEnabled && <div className="alert alert-info">{tr.demo}</div>}
      <ErrorBanner message={error} />
      {notice && <div className="alert alert-info">{notice}</div>}

      <div className="purchase-tabs" role="tablist" aria-label={tr.title}>
        {(['config', 'rates', 'realized', 'valuations', 'transfers', 'report'] as Tab[]).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value}
            className={`purchase-tab${tab === value ? ' active' : ''}`} onClick={() => setTab(value)}>
            {value === 'config' ? tr.tabConfig : value === 'rates' ? tr.tabRates : value === 'realized' ? tr.tabRealized : value === 'valuations' ? tr.tabValuations : value === 'transfers' ? tr.tabTransfers : tr.tabReport}
          </button>
        ))}
      </div>

      {tab === 'config' && config && (
        <div className="grid grid-2">
          <Card title={tr.functional}>
            <p><strong>{config.functionalCurrency}</strong> · {config.functionalLocked ? tr.locked : tr.notLocked}</p>
            {config.functionalLockedAt && <p className="muted small">{date(config.functionalLockedAt, locale)}</p>}
            <p className="muted small">{tr.notOfficial}</p>
            {!config.functionalLocked && <Button onClick={lockFunctional} disabled={busy}>{tr.lock}</Button>}
            {!config.functionalLocked && <p className="field-hint">{tr.lockHint}</p>}
          </Card>
          <Card title={tr.allowed}>
            <div className="lettering-currency-grid">
              {config.supportedCurrencies.map((code) => (
                <label key={code} className="checkbox">
                  <input type="checkbox" checked={allowed.includes(code)} disabled={code === config.functionalCurrency}
                    onChange={(e) => setAllowed((current) => e.target.checked ? [...new Set([...current, code])] : current.filter((c) => c !== code))} />
                  <span>{code}{code === config.functionalCurrency ? ' (functional)' : ''}</span>
                </label>
              ))}
            </div>
          </Card>
          <Card title={tr.gain}>
            <div className="form-grid">
              <Field label={tr.gain}>
                <select value={gainAccount} onChange={(e) => setGainAccount(e.target.value)}>
                  <option value="">{tr.noAccount}</option>
                  {accounts.filter((a) => a.type === 'revenue').map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </Field>
              <Field label={tr.loss}>
                <select value={lossAccount} onChange={(e) => setLossAccount(e.target.value)}>
                  <option value="">{tr.noAccount}</option>
                  {accounts.filter((a) => a.type === 'expense').map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </Field>
            </div>
            {accounts.length === 0 && <p className="field-hint">{tr.noAccounts}</p>}
            <label className="checkbox">
              <input type="checkbox" checked={valuationEnabled} onChange={(e) => setValuationEnabled(e.target.checked)} />
              <span>{tr.valuation}</span>
            </label>
            <Field label={tr.notes}><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></Field>
            <Button variant="primary" onClick={saveConfig} disabled={busy}>{tr.saveConfig}</Button>
          </Card>
        </div>
      )}

      {tab === 'rates' && (
        <div className="stack">
          <Card title={tr.newRate}>
            <p className="muted small">{tr.notOfficial}</p>
            <div className="form-grid">
              <Field label={tr.base}><input value={rateForm.baseCurrency} maxLength={3} onChange={(e) => setRateForm({ ...rateForm, baseCurrency: e.target.value.toUpperCase() })} /></Field>
              <Field label={tr.quote}><input value={rateForm.quoteCurrency} maxLength={3} onChange={(e) => setRateForm({ ...rateForm, quoteCurrency: e.target.value.toUpperCase() })} /></Field>
              <Field label={tr.rateDate}><input type="date" value={rateForm.rateDate} onChange={(e) => setRateForm({ ...rateForm, rateDate: e.target.value })} /></Field>
              <Field label={tr.rate}><input inputMode="decimal" value={rateForm.rate} onChange={(e) => setRateForm({ ...rateForm, rate: e.target.value })} placeholder="50,00000000" /></Field>
              <Field label={tr.sourceKind}>
                <select value={rateForm.sourceKind} onChange={(e) => setRateForm({ ...rateForm, sourceKind: e.target.value })}>
                  <option value="manual">{tr.manual}</option><option value="imported">{tr.imported}</option><option value="demo">{tr.demoKind}</option>
                </select>
              </Field>
              <Field label={tr.source}><input value={rateForm.source} onChange={(e) => setRateForm({ ...rateForm, source: e.target.value })} /></Field>
              <Field label={tr.reference}><input value={rateForm.reference} onChange={(e) => setRateForm({ ...rateForm, reference: e.target.value })} /></Field>
            </div>
            <Button variant="primary" onClick={createRate} disabled={busy || !rateForm.rate || !rateForm.source.trim()}>{tr.createRate}</Button>
          </Card>
          <Card title={tr.history} actions={<Button onClick={() => void act(async () => { await loadRates(); })}>{tr.history}</Button>}>
            {rates.length === 0 ? <EmptyState title={tr.noRates} /> : (
              <div className="table-wrap"><table className="table"><thead><tr><th>{tr.base}/{tr.quote}</th><th>{tr.rateDate}</th><th>{tr.rate}</th><th>{tr.sourceKind}</th><th>{tr.source}</th><th>{tr.status}</th><th /></tr></thead>
                <tbody>{rates.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.base_currency}/{r.quote_currency}</strong></td>
                    <td>{r.rate_date}</td><td>{r.rate}</td><td>{r.source_kind === 'manual' ? tr.manual : r.source_kind === 'imported' ? tr.imported : tr.demoKind}</td>
                    <td>{r.source}{r.reference ? ` · ${r.reference}` : ''}</td>
                    <td><Badge kind={badge(r.status)}>{r.status === 'draft' ? tr.draft : r.status === 'validated' ? tr.validated : r.status === 'rejected' ? tr.rejected : tr.superseded}</Badge></td>
                    <td className="row-actions">
                      {r.status === 'draft' && <Button className="btn-sm" onClick={() => { setRateToValidate(r); setRateReviewed(false); }}>{tr.validate}</Button>}
                      {(r.status === 'draft' || r.status === 'validated') && <Button className="btn-sm" variant="ghost" onClick={() => setRateToReject(r)}>{tr.reject}</Button>}
                    </td>
                  </tr>
                ))}</tbody></table></div>
            )}
          </Card>
          <Card title={tr.conversion}>
            <div className="form-grid">
              <Field label={tr.amount}><input inputMode="decimal" value={conversion.amount} onChange={(e) => setConversion({ ...conversion, amount: e.target.value })} /></Field>
              <Field label={tr.base}><input value={conversion.from} maxLength={3} onChange={(e) => setConversion({ ...conversion, from: e.target.value.toUpperCase() })} /></Field>
              <Field label={tr.quote}><input value={conversion.to} maxLength={3} onChange={(e) => setConversion({ ...conversion, to: e.target.value.toUpperCase() })} /></Field>
              <Field label={tr.rateDate}><input type="date" value={conversion.date} onChange={(e) => setConversion({ ...conversion, date: e.target.value })} /></Field>
            </div>
            <Button onClick={runConversion} disabled={busy}>{tr.convert}</Button>
            {conversionBlocked && <div className="alert alert-danger" role="alert"><strong>{tr.conversionBlocked}</strong><div className="small">{conversionBlocked}</div></div>}
            {conversionResult && (
              <div className="verify-box">
                <p><strong>{display(conversionResult.amount)} {conversionResult.from} × {conversionResult.rate} = {display(conversionResult.converted)} {conversionResult.to}</strong></p>
                <p className="muted small">{tr.inverse} : {conversionResult.inverseRate} · {conversionResult.source ?? ''} · {conversionResult.note}</p>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'realized' && (
        <Card title={tr.tabRealized} actions={<Button onClick={scan} disabled={busy}>{tr.scan}</Button>}>
          {adjustments.length === 0 ? <EmptyState title={tr.noAdjustments} /> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>{tr.tabRealized}</th><th>{tr.difference}</th><th>{tr.status}</th><th>{tr.calc}</th><th /></tr></thead>
              <tbody>{adjustments.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.side === 'customer' ? 'Client' : 'Fournisseur'} · {a.partner_name ?? '—'}</strong><div className="muted small">{a.invoice_no} / {a.payment_no} · {a.currency}</div></td>
                  <td><Badge kind={a.direction === 'gain' ? 'success' : 'danger'}>{a.direction === 'gain' ? '+' : '−'}{display(a.difference)} {config?.functionalCurrency}</Badge></td>
                  <td><Badge kind={badge(a.status)}>{a.status === 'posted' ? tr.posted : a.status === 'proposed' ? tr.proposed : tr.rejected}</Badge></td>
                  <td className="small">{a.settled_txn_amount} {a.currency} × ({a.settlement_rate} − {a.invoice_rate})<div className="muted">{tr.invoiceFunctional} {display(a.invoice_functional)} · {tr.settlementFunctional} {display(a.settlement_functional)}</div></td>
                  <td className="row-actions">
                    {a.status === 'proposed' && <Button className="btn-sm" onClick={() => { setAdjustmentToPost(a); setAdjustmentReviewed(false); setAdjustmentRationale(a.rationale ?? ''); }}>{tr.post}</Button>}
                    {a.status === 'proposed' && <Button className="btn-sm" variant="ghost" onClick={() => void act(async () => { await api.post(`/companies/${companyId}/fx/realized/${a.id}/reject`, { reason: tr.rejectAdj }); await loadRealized(); }, tr.adjRejected)}>{tr.rejectAdj}</Button>}
                  </td>
                </tr>
              ))}</tbody></table></div>
          )}
        </Card>
      )}

      {tab === 'valuations' && (
        <div className="stack">
          <Card title={tr.tabValuations}>
            <div className="form-row">
              <Field label={tr.valuationDate}><input type="date" value={valuationDate} onChange={(e) => setValuationDate(e.target.value)} /></Field>
              <Button variant="primary" onClick={simulate} disabled={busy}>{tr.simulate}</Button>
            </div>
            <p className="alert alert-warning">{tr.postBlocked}</p>
            {valuations.length === 0 ? <EmptyState title={tr.noValuations} /> : (
              <div className="table-wrap"><table className="table"><thead><tr><th>{tr.valuationDate}</th><th>{tr.status}</th><th>{tr.docs}</th><th /></tr></thead>
                <tbody>{valuations.map((v) => (
                  <tr key={v.id}><td>{v.valuation_date}</td><td><Badge kind={badge(v.status)}>{v.status}</Badge></td><td>{v.line_count ?? '—'}</td>
                    <td><Button className="btn-sm" onClick={() => openValuation(v.id)}>{tr.detail}</Button></td></tr>
                ))}</tbody></table></div>
            )}
          </Card>
          {valuation && (
            <Card title={`${tr.detail} · ${valuation.valuation_date}`}>
              {valuation.totalsByCurrency && Object.keys(valuation.totalsByCurrency).length > 0 && (
                <div className="lettering-currency-grid">
                  {Object.entries(valuation.totalsByCurrency).map(([code, total]) => (
                    <div className="lettering-currency" key={code}>
                      <strong>{code}</strong>
                      <span>{tr.gainShort} {display(total.gain)} · {tr.lossShort} {display(total.loss)}</span>
                      {total.blocked > 0 && <Badge kind="warning">{total.blocked} {tr.blocked}</Badge>}
                    </div>
                  ))}
                </div>
              )}
              <div className="table-wrap"><table className="table"><thead><tr><th>{tr.type}</th><th>{tr.txn}</th><th>{tr.func}</th><th>{tr.difference}</th><th>{tr.blockedReason}</th></tr></thead>
                <tbody>{(valuation.lines ?? []).map((line) => (
                  <tr key={line.id}><td>{line.source_type} · {line.document_no ?? '—'} · {line.currency}</td>
                    <td>{display(line.revalued_functional)}</td><td>{line.direction ?? '—'}</td>
                    <td>{line.difference ? display(line.difference) : '—'}</td>
                    <td>{line.blocked_reason ?? '—'}</td></tr>
                ))}</tbody></table></div>
              <p className="muted small">{valuation.note}</p>
              {valuation.status === 'simulated' && <Button variant="primary" onClick={validateValuation} disabled={busy}>{tr.validateValuation}</Button>}
            </Card>
          )}
        </div>
      )}

      {tab === 'transfers' && (
        <div className="stack">
          <Card title={tr.transfers}>
            {banks.length < 2 ? <EmptyState title={tr.sameAccount} /> : (
              <>
                <div className="form-grid">
                  <Field label={tr.from}><select value={transferForm.fromBankAccountId} onChange={(e) => setTransferForm({ ...transferForm, fromBankAccountId: e.target.value })}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}</select></Field>
                  <Field label={tr.to}><select value={transferForm.toBankAccountId} onChange={(e) => setTransferForm({ ...transferForm, toBankAccountId: e.target.value })}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}</select></Field>
                  <Field label={tr.amount}><input inputMode="decimal" value={transferForm.fromAmount} onChange={(e) => setTransferForm({ ...transferForm, fromAmount: e.target.value })} /></Field>
                  <Field label={tr.fee}><input inputMode="decimal" value={transferForm.feeAmount} onChange={(e) => setTransferForm({ ...transferForm, feeAmount: e.target.value })} /></Field>
                  <Field label={tr.valuationDate}><input type="date" value={transferForm.transferDate} onChange={(e) => setTransferForm({ ...transferForm, transferDate: e.target.value })} /></Field>
                </div>
                <Button variant="primary" onClick={previewTransfer} disabled={busy || !transferForm.fromAmount}>{tr.preview}</Button>
              </>
            )}
            <p className="alert alert-warning">{tr.transferBlocked}</p>
            {transferPreview && (
              <div className="verify-box">
                <p><strong>{`${transferPreview.from_name} → ${transferPreview.to_name}`}</strong></p>
                <p>{display(transferPreview.from_amount, transferPreview.from_currency)} × {transferPreview.rate} = {display(transferPreview.to_amount, transferPreview.to_currency)}</p>
                <p>{tr.feeDistinct} : {display(transferPreview.fee_amount, transferPreview.fee_currency)}</p>
                <Button disabled title={tr.transferBlocked}>{tr.post}</Button>
              </div>
            )}
          </Card>
          <Card title={tr.history}>
            {transfers.length === 0 ? <EmptyState title={tr.noTransfers} /> : (
              <div className="table-wrap"><table className="table"><thead><tr><th>{tr.valuationDate}</th><th>{tr.from} → {tr.to}</th><th>{tr.amount}</th><th>{tr.rate}</th><th>{tr.fee}</th></tr></thead>
                <tbody>{transfers.map((t) => <tr key={t.id}><td>{t.transfer_date}</td><td>{t.from_name} → {t.to_name}</td><td>{display(t.from_amount, t.from_currency)}</td><td>{t.rate}</td><td>{display(t.fee_amount, t.fee_currency)}</td></tr>)}</tbody></table></div>
            )}
          </Card>
        </div>
      )}

      {tab === 'report' && report && (
        <div className="stack">
          <div className="alert alert-info">{tr.noTotal}</div>
          <div className="page-head"><h2 className="grow">{tr.report} · {report.valuationDate}</h2><Button onClick={downloadCsv}>{tr.csv}</Button></div>
          {([
            [tr.receivables, report.receivables], [tr.payables, report.payables],
          ] as const).map(([title, rows]) => (
            <Card key={title} title={title}>
              {rows.length === 0 ? <p className="muted">{tr.noRows}</p> : (
                <div className="table-wrap"><table className="table"><thead><tr><th>{tr.status}</th><th>{tr.txn}</th><th>{tr.func}</th><th>{tr.docs}</th></tr></thead>
                  <tbody>{rows.map((r) => <tr key={r.currency}><td><strong>{r.currency}</strong></td><td>{display(r.amount_txn)}</td><td>{display(r.functional)} {report.functionalCurrency}</td><td>{r.documents}</td></tr>)}</tbody></table></div>
              )}
            </Card>
          ))}
          <Card title={tr.bank}>
            {report.bankAccounts.length === 0 ? <p className="muted">{tr.noRows}</p> : (
              <div className="table-wrap"><table className="table"><thead><tr><th>{tr.from}</th><th>{tr.status}</th><th>{tr.txn}</th></tr></thead>
                <tbody>{report.bankAccounts.map((b, index) => <tr key={`${b.name}-${index}`}><td>{b.name}</td><td>{b.currency}</td><td>{display(b.balance)}</td></tr>)}</tbody></table></div>
            )}
          </Card>
          <Card title={tr.tabValuations}>
            {!report.latent?.valuation ? <p className="muted">{tr.noValuations}</p> : (
              <div className="stack">
                <p><strong>{report.latent.valuation.valuation_date}</strong> · <Badge kind={badge(report.latent.valuation.status)}>{report.latent.valuation.status}</Badge></p>
                {report.latent.totals.length > 0 && (
                  <div className="table-wrap"><table className="table"><thead><tr><th>{tr.status}</th><th>{tr.difference}</th><th>{tr.txn}</th><th>{tr.blocked}</th></tr></thead>
                    <tbody>{report.latent.totals.map((r, index) => <tr key={`${r.currency}-${r.direction}-${index}`}><td>{r.currency}</td><td>{r.direction}</td><td>{display(r.amount)}</td><td>{r.blocked}</td></tr>)}</tbody></table></div>
                )}
                <p className="alert alert-warning">{tr.postBlocked}</p>
              </div>
            )}
          </Card>
          <Card title={tr.realized}>
            {report.realized.length === 0 ? <p className="muted">{tr.noRows}</p> : (
              <div className="table-wrap"><table className="table"><thead><tr><th>{tr.status}</th><th>{tr.difference}</th><th>{tr.status}</th><th>{tr.docs}</th></tr></thead>
                <tbody>{report.realized.map((r, index) => <tr key={`${r.currency}-${r.direction}-${r.status}-${index}`}><td>{r.currency}</td><td>{r.direction}</td><td>{r.status}</td><td>{display(r.amount)} · {r.count}</td></tr>)}</tbody></table></div>
            )}
          </Card>
          <Card title={tr.blockedOps}>
            {report.blockedOperations.length === 0 ? <p className="muted">{tr.noRows}</p> : (
              <div className="table-wrap"><table className="table"><thead><tr><th>{tr.status}</th><th>{tr.txn}</th><th>{tr.valuationDate}</th></tr></thead>
                <tbody>{report.blockedOperations.map((r, index) => <tr key={`${r.reference}-${index}`}><td>{r.source_type} · {r.reference}</td><td>{r.currency}</td><td>{r.operation_date ?? r.date}</td></tr>)}</tbody></table></div>
            )}
            <p className="muted small">{report.note}</p>
          </Card>
        </div>
      )}

      <Modal open={Boolean(rateToValidate)} title={tr.validate} onClose={() => setRateToValidate(null)}>
        {rateToValidate && (
          <div className="stack">
            <p><strong>{rateToValidate.base_currency}/{rateToValidate.quote_currency}</strong> · {rateToValidate.rate_date} · {rateToValidate.rate}</p>
            <p className="small">{rateToValidate.source_kind} · {rateToValidate.source}{rateToValidate.reference ? ` · ${rateToValidate.reference}` : ''}</p>
            <label className="checkbox"><input type="checkbox" checked={rateReviewed} onChange={(e) => setRateReviewed(e.target.checked)} /><span>{tr.confirmValidate}</span></label>
            <div className="form-row"><Button variant="primary" onClick={doValidateRate} disabled={!rateReviewed || busy}>{tr.validate}</Button><Button variant="ghost" onClick={() => setRateToValidate(null)}>{t('common.cancel')}</Button></div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(rateToReject)} title={tr.reject} onClose={() => setRateToReject(null)}>
        <div className="stack">
          <Field label={tr.rejectReason}><textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} /></Field>
          <div className="form-row"><Button variant="danger" onClick={doRejectRate} disabled={!rejectReason.trim() || busy}>{tr.confirmReject}</Button><Button variant="ghost" onClick={() => setRateToReject(null)}>{t('common.cancel')}</Button></div>
        </div>
      </Modal>

      <Modal open={Boolean(adjustmentToPost)} title={tr.postTitle} onClose={() => setAdjustmentToPost(null)} wide>
        {adjustmentToPost && (
          <div className="stack">
            <p>{adjustmentToPost.side === 'customer' ? tr.customer : tr.supplier} · {adjustmentToPost.partner_name} · {adjustmentToPost.invoice_no} / {adjustmentToPost.payment_no}</p>
            <p><strong>{adjustmentToPost.direction === 'gain' ? '+' : '−'}{display(adjustmentToPost.difference)} {config?.functionalCurrency}</strong></p>
            <p className="small">{adjustmentToPost.settled_txn_amount} {adjustmentToPost.currency} × ({adjustmentToPost.settlement_rate} − {adjustmentToPost.invoice_rate})</p>
            <p className="small">{tr.invoiceFunctional} {display(adjustmentToPost.invoice_functional)} · {tr.settlementFunctional} {display(adjustmentToPost.settlement_functional)}</p>
            <p className="muted small">{tr.postHint}</p>
            <Field label={tr.rationale}><textarea value={adjustmentRationale} onChange={(e) => setAdjustmentRationale(e.target.value)} rows={3} /></Field>
            <label className="checkbox"><input type="checkbox" checked={adjustmentReviewed} onChange={(e) => setAdjustmentReviewed(e.target.checked)} /><span>{tr.confirmPost}</span></label>
            <div className="form-row"><Button variant="primary" onClick={doPostAdjustment} disabled={!adjustmentReviewed || busy}>{tr.post}</Button><Button variant="ghost" onClick={() => setAdjustmentToPost(null)}>{t('common.cancel')}</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default MultiCurrencyPage;
