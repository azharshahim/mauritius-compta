import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, downloadExport } from '../../api';
import { demoEnabled } from '../../demo';
import { moneyExact, dateTime } from '../../format';
import { useI18n } from '../../i18n';
import { errorMessage } from '../../store';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';

type Any = Record<string, any>;

const COPY = {
  fr: {
    intro: 'Proposition comptable préparée depuis les derniers calculs de paie. Aucune écriture n’est créée automatiquement : la comptabilisation définitive reste bloquée tant que les règles de paie ne sont pas validées par un expert et la période finalisée.',
    company: 'Société', period: 'Période de paie', employees: 'Salariés', gross: 'Total brut',
    deductions: 'Retenues salariales', employer: 'Charges patronales', net: 'Net arithmétique',
    cost: 'Coût employeur', currency: 'Devise', mapping: 'Correspondances comptables',
    mappingHelp: 'Chaque rubrique de paie est reliée à un compte du plan comptable de la société. Aucun numéro de compte n’est imposé.',
    configure: 'Configurer les correspondances', version: 'Version', validatedBy: 'Validée par',
    journal: 'Journal', account: 'Compte', required: 'obligatoire', optional: 'facultatif',
    note: 'Note de validation', saveMapping: 'Valider ces correspondances',
    confirmMapping: 'Je confirme avoir vérifié chaque compte avec le plan comptable de la société.',
    mappingSaved: 'Correspondances validées. Une nouvelle version a été créée ; l’ancienne reste dans l’historique.',
    preview: 'Prévisualisation de la proposition', generate: 'Générer une proposition',
    refresh: 'Actualiser', lines: 'Lignes débit / crédit', line: 'Ligne', category: 'Rubrique',
    accountCol: 'Compte', description: 'Description', debit: 'Débit', credit: 'Crédit',
    totals: 'Totaux de contrôle', difference: 'Écart', balanced: 'Équilibrée',
    checks: 'Contrôles et anomalies', severity: 'Gravité', code: 'Code', detail: 'Détail',
    blocking: 'bloquant', warning: 'avertissement', ok: 'conforme',
    missingMapping: 'Aucune correspondance validée. Générez d’abord les correspondances.',
    noPeriod: 'Aucune période de paie disponible.', noPreview: 'Aucune prévisualisation.',
    history: 'Historique des propositions', noHistory: 'Aucune proposition pour cette période.',
    createdAt: 'Créée le', decidedBy: 'Décision par', decisionNote: 'Note de décision',
    rejectionReason: 'Motif de rejet', fingerprint: 'Empreinte des calculs',
    approve: 'Approuver pour test', reject: 'Rejeter', post: 'Comptabiliser',
    postBlocked: 'Comptabilisation définitive bloquée : règles de paie non validées par un expert et période non finalisée.',
    export: 'Exporter le CSV interne', approved: 'Proposition approuvée pour test. Aucune écriture comptable n’a été créée.',
    rejected: 'Proposition rejetée avec motif. Une nouvelle proposition peut être générée.',
    generated: 'Proposition générée. Vérifiez l’équilibre et les contrôles avant toute décision.',
    approveTitle: 'Approuver pour test', rejectTitle: 'Rejeter la proposition',
    approveHelp: 'Cette approbation reste une préparation de test : elle ne crée aucune dette réelle ni écriture définitive.',
    rejectHelp: 'Un motif d’au moins 10 caractères est obligatoire.',
    noteLabel: 'Note de décision (10 caractères minimum)', reasonLabel: 'Motif de rejet (10 caractères minimum)',
    confirmDecision: 'Je confirme cette décision humaine et j’ai vérifié les totaux et les comptes.',
    save: 'Confirmer', cancel: 'Annuler', close: 'Fermer', empty: 'Aucune proposition sélectionnée.',
    simulation: 'Simulation interne', accountInactive: 'compte inactif', noAccount: 'non mappé',
    sourceRules: 'Règles source', calculations: 'Calculs source', status: 'Statut',
    linesHelp: 'Les montants sont repris sans arrondi silencieux ; quatre décimales restent visibles.',
    noPosting: 'Aucune écriture n’est créée par cette interface.', decisionRequired: 'Décision humaine explicite requise.',
    allPeriods: 'Toutes les périodes', filterPeriod: 'Filtrer par période',
  },
  en: {
    intro: 'Accounting proposal built from the latest payroll calculations. No entry is created automatically: definitive posting stays blocked while payroll rules are not expert-validated and the period is not finalised.',
    company: 'Company', period: 'Payroll period', employees: 'Employees', gross: 'Gross total',
    deductions: 'Employee deductions', employer: 'Employer contributions', net: 'Arithmetic net',
    cost: 'Employer cost', currency: 'Currency', mapping: 'Accounting mappings',
    mappingHelp: 'Each payroll item is linked to an account from the company chart of accounts. No account number is imposed.',
    configure: 'Configure mappings', version: 'Version', validatedBy: 'Validated by',
    journal: 'Journal', account: 'Account', required: 'required', optional: 'optional',
    note: 'Validation note', saveMapping: 'Validate these mappings',
    confirmMapping: 'I confirm that I checked each account against the company chart of accounts.',
    mappingSaved: 'Mappings validated. A new version was created; the previous one remains in history.',
    preview: 'Proposal preview', generate: 'Generate a proposal',
    refresh: 'Refresh', lines: 'Debit / credit lines', line: 'Line', category: 'Category',
    accountCol: 'Account', description: 'Description', debit: 'Debit', credit: 'Credit',
    totals: 'Control totals', difference: 'Difference', balanced: 'Balanced',
    checks: 'Controls and exceptions', severity: 'Severity', code: 'Code', detail: 'Detail',
    blocking: 'blocking', warning: 'warning', ok: 'ok',
    missingMapping: 'No validated mapping. Validate mappings first.',
    noPeriod: 'No payroll period available.', noPreview: 'No preview.',
    history: 'Proposal history', noHistory: 'No proposal for this period.',
    createdAt: 'Created', decidedBy: 'Decided by', decisionNote: 'Decision note',
    rejectionReason: 'Rejection reason', fingerprint: 'Calculations fingerprint',
    approve: 'Approve for test', reject: 'Reject', post: 'Post entry',
    postBlocked: 'Definitive posting blocked: payroll rules are not expert-validated and the period is not finalised.',
    export: 'Export internal CSV', approved: 'Proposal approved for test. No accounting entry was created.',
    rejected: 'Proposal rejected with a reason. A new proposal may be generated.',
    generated: 'Proposal generated. Check the balance and controls before any decision.',
    approveTitle: 'Approve for test', rejectTitle: 'Reject proposal',
    approveHelp: 'This approval remains a test preparation: it creates no real liability and no definitive entry.',
    rejectHelp: 'A reason of at least 10 characters is required.',
    noteLabel: 'Decision note (at least 10 characters)', reasonLabel: 'Rejection reason (at least 10 characters)',
    confirmDecision: 'I confirm this human decision and that I checked the totals and accounts.',
    save: 'Confirm', cancel: 'Cancel', close: 'Close', empty: 'No proposal selected.',
    simulation: 'Internal simulation', accountInactive: 'inactive account', noAccount: 'not mapped',
    sourceRules: 'Source rules', calculations: 'Source calculations', status: 'Status',
    linesHelp: 'Amounts are carried over without silent rounding; four decimals remain visible.',
    noPosting: 'No accounting entry is created by this screen.', decisionRequired: 'Explicit human decision required.',
    allPeriods: 'All periods', filterPeriod: 'Filter by period',
  },
};

const statusKind = (status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'APPROVED_FOR_TEST') return 'warning';
  if (status === 'POSTED') return 'success';
  if (status === 'REJECTED' || status === 'BLOCKED') return 'danger';
  if (status === 'REVIEW_REQUIRED') return 'info';
  return 'neutral';
};

const statusLabel = (status: string) => ({
  DRAFT: 'Brouillon', BLOCKED: 'Bloqué', REVIEW_REQUIRED: 'À vérifier',
  APPROVED_FOR_TEST: 'Approuvé pour test', REJECTED: 'Rejeté', POSTED: 'Comptabilisé',
}[status] ?? status);

const severityKind = (severity: string): 'success' | 'warning' | 'danger' => {
  if (severity === 'block') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'success';
};

export default function AccountingTransferPanel({
  company, periods, selectedPeriod, onSelectPeriod,
}: {
  company: { id: string; name: string };
  periods: Any[];
  selectedPeriod: Any | null;
  onSelectPeriod: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const c = COPY[locale];
  const [config, setConfig] = useState<Any | null>(null);
  const [preview, setPreview] = useState<Any | null>(null);
  const [transfers, setTransfers] = useState<Any[]>([]);
  const [selection, setSelection] = useState<Any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const [form, setForm] = useState<Any>({});
  const [decisionForm, setDecisionForm] = useState({ note: '', reason: '', confirm: false });

  const base = `/companies/${company.id}/payroll`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mappingConfig, list] = await Promise.all([
        api.get<Any>(`${base}/accounting/mapping`),
        api.get<Any>(`${base}/accounting-transfers${selectedPeriod ? `?periodId=${selectedPeriod.id}` : ''}`),
      ]);
      setConfig(mappingConfig);
      setTransfers(list.transfers ?? []);
      if (selectedPeriod) {
        setPreview(await api.get<Any>(`${base}/periods/${selectedPeriod.id}/accounting-transfer`));
      } else {
        setPreview(null);
      }
    } catch (err) {
      setError(errorMessage(err, 'Erreur').message);
    } finally {
      setLoading(false);
    }
  }, [base, selectedPeriod?.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setSelection((current) => current && transfers.some((t) => t.id === current.id)
      ? transfers.find((t) => t.id === current.id) ?? current
      : null);
  }, [transfers]);

  const openMapping = () => {
    const accounts = config?.mapping?.accounts ?? {};
    setForm({
      journalId: config?.mapping?.journal?.id ?? config?.journals?.[0]?.id ?? '',
      ...Object.fromEntries(Object.entries(accounts).map(([key, value]: [string, any]) => [`${key}AccountId`, value?.id ?? ''])),
      note: config?.mapping?.note ?? '',
      confirm: false,
    });
    setError(null);
    setMappingOpen(true);
  };

  const saveMapping = async () => {
    setBusy(true);
    setError(null);
    try {
      const accounts = config?.mapping?.accounts ?? {};
      const payload: Any = {
        confirm: form.confirm === true,
        journalId: form.journalId,
        note: form.note?.trim() || null,
      };
      for (const key of Object.keys(accounts)) payload[`${key}AccountId`] = form[`${key}AccountId`] || null;
      await api.put<Any>(`${base}/accounting/mapping`, payload);
      setNotice(c.mappingSaved);
      setMappingOpen(false);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Erreur').message);
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!selectedPeriod) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<Any>(`${base}/periods/${selectedPeriod.id}/accounting-transfer`, {
        note: 'Proposition générée depuis l’interface de démonstration',
      });
      setSelection(result.transfer);
      setNotice(c.generated);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Erreur').message);
    } finally {
      setBusy(false);
    }
  };

  const decide = async () => {
    if (!selection || !decision) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (decision === 'approve') {
        const result = await api.post<Any>(`${base}/accounting-transfers/${selection.id}/approve`, {
          confirm: decisionForm.confirm, note: decisionForm.note.trim(),
        });
        setSelection(result.transfer);
        setNotice(c.approved);
      } else {
        const result = await api.post<Any>(`${base}/accounting-transfers/${selection.id}/reject`, {
          reason: decisionForm.reason.trim(),
        });
        setSelection(result.transfer);
        setNotice(c.rejected);
      }
      setDecision(null);
      setDecisionForm({ note: '', reason: '', confirm: false });
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Erreur').message);
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    if (!selection) return;
    setError(null);
    try {
      await downloadExport(
        `${base}/accounting-transfers/${selection.id}/csv`,
        `payroll-accounting-transfer-${selection.version}.csv`,
        'csv',
      );
      if (!demoEnabled) setNotice(c.export);
    } catch (err) {
      setError(errorMessage(err, 'Erreur').message);
    }
  };

  const accounts = config?.accounts ?? [];
  const requiredFields: Any[] = config?.requiredFields ?? [];
  const detail = selection;
  const label = (entry: Any) => (locale === 'fr' ? entry.labelFr : entry.labelEn);

  const mappingSummary = useMemo(() => {
    if (!config?.mapping) return c.missingMapping;
    return `${c.version} ${config.mapping.version} · ${config.mapping.journal?.code ?? '—'} · ${config.mapping.validatedByName ?? c.validatedBy}`;
  }, [config, c]);

  if (loading && !config) return <Spinner />;

  return (
    <>
      {error && <ErrorBanner message={error} />}
      {notice && <div className="alert alert-info">{notice}</div>}
      <Card title={c.preview} actions={<Button variant="ghost" onClick={() => void load()}>{c.refresh}</Button>}>
        <div className="alert alert-warning">{c.intro}</div>
        <div className="field">
          <label className="field-label" htmlFor="acc-period">{c.period}</label>
          <select id="acc-period" value={selectedPeriod?.id ?? ''} onChange={(e) => onSelectPeriod(e.target.value)}>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {String(period.period_month).padStart(2, '0')}/{period.period_year} — {period.status}
              </option>
            ))}
          </select>
        </div>
        {!selectedPeriod && <EmptyState title={c.noPeriod} />}
        {selectedPeriod && !preview && <EmptyState title={c.noPreview} />}
        {preview && (
          <>
            <div className="payroll-summary">
              {[
                [c.company, preview.company?.name],
                [c.period, preview.period?.label],
                [c.employees, preview.employees],
                [c.currency, preview.currency],
                [c.gross, moneyExact(preview.totals?.gross, locale, 'MUR')],
                [c.deductions, moneyExact(preview.totals?.employeeDeductions, locale, 'MUR')],
                [c.employer, moneyExact(preview.totals?.employerContributions, locale, 'MUR')],
                [c.net, moneyExact(preview.totals?.netAfterStatutory, locale, 'MUR')],
                [c.cost, moneyExact(preview.totals?.employerCost, locale, 'MUR')],
              ].map(([key, value]) => (
                <div className="payroll-stat" key={String(key)}>
                  <span>{key}</span><strong>{value ?? '—'}</strong>
                </div>
              ))}
            </div>

            <div className="alert alert-info">{c.linesHelp}</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{c.line}</th><th>{c.category}</th><th>{c.accountCol}</th><th>{c.description}</th>
                    <th className="num">{c.debit}</th><th className="num">{c.credit}</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.lines ?? []).map((line: Any) => (
                    <tr key={line.lineNo}>
                      <td>{line.lineNo}</td>
                      <td>{line.category}</td>
                      <td>
                        {line.accountCode
                          ? `${line.accountCode} — ${line.accountName}`
                          : <Badge kind="danger">{c.noAccount}</Badge>}
                      </td>
                      <td>{label(line)}</td>
                      <td className="num">{line.debit === '0.0000' ? '—' : moneyExact(line.debit, locale)}</td>
                      <td className="num">{line.credit === '0.0000' ? '—' : moneyExact(line.credit, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="payroll-summary">
              <div className="payroll-stat"><span>{c.debit}</span><strong>{moneyExact(preview.totals?.debitTotal, locale, 'MUR')}</strong></div>
              <div className="payroll-stat"><span>{c.credit}</span><strong>{moneyExact(preview.totals?.creditTotal, locale, 'MUR')}</strong></div>
              <div className="payroll-stat"><span>{c.difference}</span><strong>{moneyExact(preview.totals?.difference, locale, 'MUR')}</strong></div>
              <div className="payroll-stat"><span>{c.balanced}</span><strong>{preview.totals?.difference === '0.0000' ? '✓' : '✗'}</strong></div>
            </div>

            <Card title={c.checks}>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{c.severity}</th><th>{c.code}</th><th>{c.detail}</th></tr></thead>
                  <tbody>
                    {[...(preview.checks ?? [])].map((check: Any) => (
                      <tr key={`${check.code}-${check.scope}`}>
                        <td><Badge kind={severityKind(check.severity)}>{check.severity === 'block' ? c.blocking : check.severity === 'warning' ? c.warning : c.ok}</Badge></td>
                        <td>{check.code}</td>
                        <td className="small">{locale === 'fr' ? check.messageFr : check.messageEn}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.blockers?.length > 0 && <div className="alert alert-danger">{preview.blockers.map((b: Any) => b.code).join(' · ')}</div>}
            </Card>

            <div className="actions">
              <Button variant="primary" disabled={busy || preview.canApprove === false} onClick={() => void generate()}>{c.generate}</Button>
              {preview.canApprove === false && <span className="small">{c.missingMapping}</span>}
            </div>
          </>
        )}
      </Card>

      <Card title={c.mapping} actions={<Button variant="ghost" onClick={openMapping}>{c.configure}</Button>}>
        <p className="small">{c.mappingHelp}</p>
        <p>
          {config?.mapping
            ? <Badge kind="success">{config.mapping.status}</Badge>
            : <Badge kind="danger">MISSING</Badge>}
          {' '}{mappingSummary}
        </p>
        {config?.mapping && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{c.category}</th><th>{c.account}</th><th>{c.journal}</th></tr></thead>
              <tbody>
                {Object.entries(config?.mapping?.accounts ?? {}).map(([key, account]: [string, any]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>
                      {account
                        ? <>{account.code} — {account.name} {account.isActive === false && <Badge kind="danger">{c.accountInactive}</Badge>}</>
                        : <Badge kind="neutral">{c.noAccount}</Badge>}
                    </td>
                    <td>{config.mapping.journal?.code ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {config?.mappingHistory?.length > 0 && config?.mappingHistory && (
          <p className="small">{config.mappingHistory.map((entry: Any) => `v${entry.version} ${entry.status}`).join(' · ')}</p>
        )}
      </Card>

      <Card title={c.history}>
        {transfers.length === 0 ? <EmptyState title={c.noHistory} /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{c.version}</th><th>{c.status}</th><th>{c.createdAt}</th><th className="num">{c.cost}</th><th /></tr></thead>
              <tbody>
                {transfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <td>v{transfer.version}</td>
                    <td><Badge kind={statusKind(transfer.status)}>{statusLabel(transfer.status)}</Badge></td>
                    <td>{dateTime(transfer.createdAt, locale)}</td>
                    <td className="num">{moneyExact(transfer.totals?.employerCost, locale, 'MUR')}</td>
                    <td><Button variant="link" onClick={() => { setSelection(transfer); setError(null); setNotice(null); }}>{c.detail}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {detail && (
        <Card title={`${c.preview} v${detail.version}`} actions={<Button variant="ghost" onClick={() => setSelection(null)}>{c.close}</Button>}>
          <p>
            <Badge kind={statusKind(detail.status)}>{statusLabel(detail.status)}</Badge>{' '}
            <Badge kind="info">{c.simulation}</Badge>
          </p>
          <div className="payroll-summary">
            <div className="payroll-stat"><span>{c.period}</span><strong>{preview?.period?.label ?? '—'}</strong></div>
            <div className="payroll-stat"><span>{c.currency}</span><strong>{detail.currency}</strong></div>
            <div className="payroll-stat"><span>{c.createdAt}</span><strong>{dateTime(detail.createdAt, locale)}</strong></div>
            <div className="payroll-stat"><span>{c.fingerprint}</span><strong className="small">{detail.sourceFingerprint}</strong></div>
            <div className="payroll-stat"><span>{c.lines}</span><strong>{detail.lines?.length ?? 0}</strong></div>
            <div className="payroll-stat"><span>{c.cost}</span><strong>{moneyExact(detail.totals?.employerCost, locale, 'MUR')}</strong></div>
          </div>
          {detail.decidedBy && <p className="small">{c.decidedBy}: {detail.decidedBy} — {detail.decidedAt ? dateTime(detail.decidedAt, locale) : '—'}</p>}
          {detail.decisionNote && <p className="small">{c.decisionNote}: {detail.decisionNote}</p>}
          {detail.rejectionReason && <p className="small">{c.rejectionReason}: {detail.rejectionReason}</p>}

          <div className="table-wrap">
            <table>
              <thead><tr><th>{c.line}</th><th>{c.accountCol}</th><th>{c.description}</th><th className="num">{c.debit}</th><th className="num">{c.credit}</th></tr></thead>
              <tbody>
                {(detail.lines ?? []).map((line: Any) => (
                  <tr key={line.lineNo}>
                    <td>{line.lineNo}</td>
                    <td>{line.accountCode ? `${line.accountCode} — ${line.accountName}` : '—'}</td>
                    <td>{label(line)}</td>
                    <td className="num">{line.debit === '0.0000' ? '—' : moneyExact(line.debit, locale)}</td>
                    <td className="num">{line.credit === '0.0000' ? '—' : moneyExact(line.credit, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="alert alert-warning">{c.postBlocked}</div>
          <p className="small">{c.noPosting}</p>
          <div className="actions">
            <Button variant="primary" disabled={busy || !['DRAFT', 'REVIEW_REQUIRED'].includes(detail.status)}
              onClick={() => { setDecision('approve'); setDecisionForm({ note: '', reason: '', confirm: false }); }}>
              {c.approve}
            </Button>
            <Button variant="danger" disabled={busy || !['DRAFT', 'REVIEW_REQUIRED', 'APPROVED_FOR_TEST'].includes(detail.status)}
              onClick={() => { setDecision('reject'); setDecisionForm({ note: '', reason: '', confirm: false }); }}>
              {c.reject}
            </Button>
            <Button variant="ghost" disabled>{c.post}</Button>
            <Button variant="ghost" onClick={() => void exportCsv()}>{c.export}</Button>
          </div>
          <p className="small">{c.postBlocked}</p>
        </Card>
      )}

      <Modal open={mappingOpen} title={c.mapping} onClose={() => setMappingOpen(false)} wide>
        <p className="small">{c.mappingHelp}</p>
        <Field label={c.journal}>
          <select value={form.journalId ?? ''} onChange={(e) => setForm({ ...form, journalId: e.target.value })}>
            {(config?.journals ?? []).map((journal: Any) => (
              <option key={journal.id} value={journal.id} disabled={journal.isActive === false}>
                {journal.code} — {journal.name}{journal.isActive === false ? ` (${c.accountInactive})` : ''}
              </option>
            ))}
          </select>
        </Field>
        {requiredFields.map((field) => {
          const key = `${field.key}AccountId`;
          return (
            <Field key={field.key} label={`${locale === 'fr' ? field.labelFr : field.labelEn} (${field.required ? c.required : c.optional})`}>
              <select value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
                <option value="">— {c.noAccount} —</option>
                {accounts.map((account: Any) => (
                  <option key={account.id} value={account.id} disabled={account.isActive === false}>
                    {account.code} — {account.name}{account.isActive === false ? ` (${c.accountInactive})` : ''}
                  </option>
                ))}
              </select>
            </Field>
          );
        })}
        <Field label={c.note}>
          <input value={form.note ?? ''} maxLength={500} onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder={t('payroll.verificationRef')} />
        </Field>
        <label className="check"><input type="checkbox" checked={form.confirm === true}
          onChange={(e) => setForm({ ...form, confirm: e.target.checked })} /> {c.confirmMapping}</label>
        <div className="actions">
          <Button variant="primary" disabled={busy || form.confirm !== true} onClick={() => void saveMapping()}>{c.saveMapping}</Button>
          <Button variant="ghost" onClick={() => setMappingOpen(false)}>{c.cancel}</Button>
        </div>
      </Modal>

      <Modal open={decision !== null} title={decision === 'approve' ? c.approveTitle : c.rejectTitle} onClose={() => setDecision(null)}>
        <p className="small">{decision === 'approve' ? c.approveHelp : c.rejectHelp}</p>
        {decision === 'approve' ? (
          <Field label={c.noteLabel}>
            <textarea rows={3} value={decisionForm.note}
              onChange={(e) => setDecisionForm({ ...decisionForm, note: e.target.value })} />
          </Field>
        ) : (
          <Field label={c.reasonLabel}>
            <textarea rows={3} value={decisionForm.reason}
              onChange={(e) => setDecisionForm({ ...decisionForm, reason: e.target.value })} />
          </Field>
        )}
        <label className="check"><input type="checkbox" checked={decisionForm.confirm}
          onChange={(e) => setDecisionForm({ ...decisionForm, confirm: e.target.checked })} /> {c.confirmDecision}</label>
        <div className="actions">
          <Button variant="primary" disabled={busy || !decisionForm.confirm ||
            (decision === 'approve' ? decisionForm.note.trim().length < 10 : decisionForm.reason.trim().length < 10)}
            onClick={() => void decide()}>{c.save}</Button>
          <Button variant="ghost" onClick={() => setDecision(null)}>{c.cancel}</Button>
        </div>
      </Modal>
    </>
  );
}
