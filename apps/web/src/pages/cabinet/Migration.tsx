import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { demoEnabled } from '../../demo';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { Badge, Button, Card, ErrorBanner, Spinner } from '../../components/ui';
import type { PreviewResult } from '../../../../api/src/modules/migration/validate';
import type {
  FieldDef,
  ImportKind,
  MigrationSource,
  ProfileDef,
} from '../../../../api/src/modules/migration/profiles';

/* ------------------------------------------------------------------ types */

interface Catalogue {
  profiles: ProfileDef[];
  fields: Record<ImportKind, FieldDef[]>;
  kinds: Record<ImportKind, { fr: string; en: string }>;
  limits: { maxBytes: number; maxRows: number; retentionDays: number };
}

interface Suggestion {
  field: string;
  column: string | null;
  confidence: number;
  candidates: { column: string; confidence: number }[];
}

interface JobRow {
  id: string;
  status: string;
  file_name: string;
  source: MigrationSource;
  import_kind: ImportKind;
  row_count: number;
  file_size: number;
  encoding: string | null;
  delimiter: string | null;
  sheet_name: string | null;
  created_at: string;
  report?: ImportReport | null;
}

interface JobView {
  job: JobRow;
  sheets: { name: string; headers: string[]; rowCount: number }[];
  sheet: { name: string; headers: string[]; rows: string[][]; truncated: boolean };
  notes: string[];
  suggestions: Record<string, Suggestion>;
  fields: FieldDef[];
  preview: PreviewResult | null;
  expiresAt: string | null;
}

interface Account {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

interface Journal {
  id: string;
  code: string;
  name: string;
}

interface Template {
  id: string;
  name: string;
  import_kind: ImportKind;
  source: MigrationSource;
  mapping: Record<string, string>;
  account_mapping: Record<string, string>;
  options: Record<string, unknown>;
}

interface ImportReport {
  jobId: string;
  importKind: ImportKind;
  fileName: string;
  importedAt: string;
  idempotencyKey: string;
  counts: {
    created: number;
    skipped: number;
    conflicts: number;
    accounts: number;
    entries: number;
    entryLines: number;
    customers: number;
    companies: number;
    findings: number;
  };
  totals: { debit: string; credit: string; difference: string } | null;
  conflicts: { externalKey: string; rowNumber: number | null; message: string }[];
  createdSamples: string[];
  openingEntryId?: string;
}

interface Options {
  openingDate: string;
  defaultJournalCode: string;
  defaultAccountType: string;
  defaultCurrency: string;
  dateDayFirst: boolean;
  createCompanies: boolean;
  createAccounts: boolean;
}

const EMPTY_OPTIONS: Options = {
  openingDate: '',
  defaultJournalCode: 'OD',
  defaultAccountType: '',
  defaultCurrency: '',
  dateDayFirst: true,
  createCompanies: false,
  createAccounts: false,
};

const SOURCE_GROUPS: { key: string; sources: MigrationSource[]; icon: string; labelKey: string }[] = [
  { key: 'file', sources: ['excel', 'csv'], icon: '📄', labelKey: 'migration.source.file' },
  { key: 'sage', sources: ['sage50', 'sage200', 'sage_accounting'], icon: '📗', labelKey: 'migration.source.sage' },
  { key: 'sap', sources: ['sap'], icon: '🏢', labelKey: 'migration.source.sap' },
  { key: 'other', sources: ['other'], icon: '🧩', labelKey: 'migration.source.other' },
];

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function severityKind(severity: string): 'danger' | 'warning' | 'info' {
  return severity === 'error' ? 'danger' : severity === 'warning' ? 'warning' : 'info';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------- page */

export default function MigrationPage() {
  const { t, locale } = useI18n();
  const { companies, company } = useSession();
  const [targetCompanyId, setTargetCompanyId] = useState(company?.id ?? companies[0]?.id ?? '');

  useEffect(() => {
    if (!targetCompanyId) setTargetCompanyId(company?.id ?? companies[0]?.id ?? '');
  }, [company, companies, targetCompanyId]);

  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);

  const [step, setStep] = useState(1);
  const [source, setSource] = useState<MigrationSource>('csv');
  const [kind, setKind] = useState<ImportKind>('chart_of_accounts');
  const [uploading, setUploading] = useState(false);
  const [view, setView] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [accountMapping, setAccountMapping] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<Options>(EMPTY_OPTIONS);
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const [templateName, setTemplateName] = useState('');
  const fileInput = useRef<HTMLInputElement | null>(null);

  const preview = view?.preview ?? null;
  const sourceLabel = (s: MigrationSource) =>
    catalogue?.profiles.find((p) => p.source === s)?.labelFr && locale === 'fr'
      ? catalogue?.profiles.find((p) => p.source === s)?.labelFr
      : catalogue?.profiles.find((p) => p.source === s)?.labelEn ?? s;

  useEffect(() => {
    if (!targetCompanyId) return;
    let cancelled = false;
    (async () => {
      try {
        const [cat, acc, jrn, tpl, jobList] = await Promise.all([
          api.get<Catalogue>(`/companies/${targetCompanyId}/migration/profiles`),
          api.get<{ accounts: Account[] }>(
            `/companies/${targetCompanyId}/accounts?includeInactive=true`,
          ),
          api.get<{ journals: Journal[] }>(`/companies/${targetCompanyId}/journals`),
          api.get<{ templates: Template[] }>(`/companies/${targetCompanyId}/migration/templates`),
          api.get<{ jobs: JobRow[] }>(`/companies/${targetCompanyId}/migration/jobs`),
        ]);
        if (cancelled) return;
        setCatalogue(cat);
        setAccounts(acc.accounts);
        setJournals(jrn.journals);
        setTemplates(tpl.templates);
        setJobs(jobList.jobs);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, t('common.error')).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetCompanyId]);

  const unknownAccounts = useMemo(() => {
    const found = new Set<string>();
    for (const finding of preview?.findings ?? []) {
      if (finding.code === 'ACCOUNT_NOT_FOUND') {
        const code = (finding.details as { accountCode?: string } | undefined)?.accountCode;
        if (code) found.add(code);
      }
    }
    return [...found].sort();
  }, [preview]);

  const filteredFindings = useMemo(
    () =>
      (preview?.findings ?? []).filter(
        (f) => severityFilter === 'all' || f.severity === severityFilter,
      ),
    [preview, severityFilter],
  );

  const applyView = (next: JobView) => {
    setView(next);
    const job = next.job as unknown as {
      mapping?: Record<string, string>;
      account_mapping?: Record<string, string>;
      options?: Record<string, unknown>;
    };
    setMapping(job.mapping ?? {});
    setAccountMapping(job.account_mapping ?? {});
    setOptions({
      ...EMPTY_OPTIONS,
      ...(job.options as Partial<Options> | undefined),
      openingDate: String((job.options as { openingDate?: string } | undefined)?.openingDate ?? ''),
      defaultJournalCode: String(
        (job.options as { defaultJournalCode?: string } | undefined)?.defaultJournalCode ?? 'OD',
      ),
      defaultAccountType: String(
        (job.options as { defaultAccountType?: string } | undefined)?.defaultAccountType ?? '',
      ),
      defaultCurrency: String(
        (job.options as { defaultCurrency?: string } | undefined)?.defaultCurrency ?? '',
      ),
      dateDayFirst:
        (job.options as { dateDayFirst?: boolean } | undefined)?.dateDayFirst !== false,
      createCompanies:
        (job.options as { createCompanies?: boolean } | undefined)?.createCompanies === true,
      createAccounts: (job.options as { createAccounts?: boolean } | undefined)?.createAccounts === true,
    });
  };

  const refreshJobs = async () => {
    const list = await api.get<{ jobs: JobRow[] }>(
      `/companies/${targetCompanyId}/migration/jobs`,
    );
    setJobs(list.jobs);
  };

  const handleFile = async (file: File) => {
    setError(null);
    setReport(null);
    setUploading(true);
    try {
      if (file.size === 0) throw new Error(t('migration.error.empty'));
      if (file.size > (catalogue?.limits.maxBytes ?? 5 * 1024 * 1024)) {
        throw new Error(t('migration.error.tooLarge'));
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const created = await api.post<JobView>(`/companies/${targetCompanyId}/migration/jobs`, {
        source,
        importKind: kind,
        fileName: file.name,
        contentBase64: bytesToBase64(bytes),
        sheetName: null,
      });
      applyView(created);
      setStep(3);
      await refreshJobs();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const saveMapping = async (nextStep = 4) => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        mapping,
        accountMapping,
        options: {
          openingDate: options.openingDate || null,
          defaultJournalCode: options.defaultJournalCode || 'OD',
          defaultAccountType: options.defaultAccountType || null,
          defaultCurrency: options.defaultCurrency || null,
          dateDayFirst: options.dateDayFirst,
          createCompanies: options.createCompanies,
          createAccounts: options.createAccounts,
        },
      };
      const updated = await api.put<JobView>(
        `/companies/${targetCompanyId}/migration/jobs/${view.job.id}/mapping`,
        payload,
      );
      applyView(updated);
      setStep(nextStep);
      await refreshJobs();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const changeSheet = async (sheetName: string) => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.put<JobView>(
        `/companies/${targetCompanyId}/migration/jobs/${view.job.id}/mapping`,
        { sheetName },
      );
      applyView(updated);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!view || !confirm) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<ImportReport>(
        `/companies/${targetCompanyId}/migration/jobs/${view.job.id}/import`,
        { confirm: true, acknowledgement: t('migration.step6.acknowledgement') },
      );
      setReport(result);
      setStep(6);
      await refreshJobs();
      const refreshed = await api.get<JobView>(
        `/companies/${targetCompanyId}/migration/jobs/${view.job.id}`,
      );
      setView(refreshed);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const downloadReportCsv = async () => {
    if (!view || !report) return;
    // The demo build and the API produce the same report fields: the CSV is
    // generated locally with an injection-safe escaper, so the button works
    // identically with or without a server.
    const escape = (value: string | number | null | undefined): string => {
      if (value === null || value === undefined) return '';
      let text = String(value);
      if (!/^-?\d+(\.\d+)?$/.test(text) && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const rows: (string | number | null)[][] = [
      ['Rapport d’importation / Import report'],
      ['Champ', 'Valeur'],
      ['Fichier / File', view.job.file_name],
      ['Source', view.job.source],
      ['Type', view.job.import_kind],
      ['Société / Company', targetCompanyId],
      ['Clé d’idempotence', report.idempotencyKey],
      ['Date / Date', report.importedAt],
      ['Créés / Created', report.counts.created],
      ['Ignorés / Skipped', report.counts.skipped],
      ['Conflits / Conflicts', report.counts.conflicts],
      ['Comptes / Accounts', report.counts.accounts],
      ['Écritures / Entries', report.counts.entries],
      ['Lignes / Lines', report.counts.entryLines],
      ['Clients / Customers', report.counts.customers],
      ['Sociétés / Companies', report.counts.companies],
    ];
    if (report.totals) {
      rows.push(['Total débit', report.totals.debit], ['Total crédit', report.totals.credit]);
      rows.push(['Écart', report.totals.difference]);
    }
    rows.push([]);
    rows.push(['Détail / Detail']);
    for (const line of report.createdSamples) rows.push(['Créé', line]);
    for (const conflict of report.conflicts) rows.push(['Conflit', conflict.message]);
    const csv =
      '\uFEFF' + rows.map((row) => row.map(escape).join(';')).join('\r\n') + '\r\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `migration-${view.job.id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveTemplate = async () => {
    if (!templateName.trim()) {
      setError(t('migration.templates.nameRequired'));
      return;
    }
    setBusy(true);
    try {
      await api.post(`/companies/${targetCompanyId}/migration/templates`, {
        name: templateName.trim(),
        importKind: kind,
        source,
        mapping,
        accountMapping,
        options: {
          openingDate: options.openingDate || null,
          defaultJournalCode: options.defaultJournalCode || 'OD',
          defaultAccountType: options.defaultAccountType || null,
          dateDayFirst: options.dateDayFirst,
        },
      });
      setTemplateName('');
      const list = await api.get<{ templates: Template[] }>(
        `/companies/${targetCompanyId}/migration/templates`,
      );
      setTemplates(list.templates);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = async (template: Template) => {
    setMapping(template.mapping);
    setAccountMapping(template.account_mapping);
    setOptions((prev) => ({ ...prev, ...(template.options as Partial<Options>) }));
    if (!view) return;
    setBusy(true);
    try {
      const updated = await api.put<JobView>(
        `/companies/${targetCompanyId}/migration/jobs/${view.job.id}/mapping`,
        {
          mapping: template.mapping,
          accountMapping: template.account_mapping,
          options: template.options,
        },
      );
      applyView(updated);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    { n: 1, key: 'migration.step1.title' },
    { n: 2, key: 'migration.step2.title' },
    { n: 3, key: 'migration.step3.title' },
    { n: 4, key: 'migration.step4.title' },
    { n: 5, key: 'migration.step5.title' },
    { n: 6, key: 'migration.step6.title' },
  ];

  return (
    <div className="migration-page">
      <div className="page-head">
        <div>
          <h1>{t('migration.title')}</h1>
          <p className="muted">{t('migration.subtitle')}</p>
        </div>
        <div className="migration-target">
          <label htmlFor="migration-company">{t('migration.targetCompany')}</label>
          <select
            id="migration-company"
            value={targetCompanyId}
            onChange={(event) => {
              setTargetCompanyId(event.target.value);
              setView(null);
              setReport(null);
              setStep(1);
              setConfirm(false);
            }}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {demoEnabled && <div className="demo-notice">{t('migration.demoNotice')}</div>}
      <ErrorBanner message={error} />

      <ol className="migration-steps" aria-label={t('migration.steps')}>
        {steps.map((s) => (
          <li key={s.n} className={step === s.n ? 'active' : step > s.n ? 'done' : ''}>
            <button
              type="button"
              onClick={() => (s.n < step || (s.n === step + 1 && view) ? setStep(s.n) : undefined)}
              disabled={s.n > step + 1 || (s.n >= 3 && !view)}
              aria-current={step === s.n ? 'step' : undefined}
            >
              <span className="migration-step-number">{s.n}</span>
              <span className="migration-step-label">{t(s.key)}</span>
            </button>
          </li>
        ))}
      </ol>

      {!catalogue ? (
        <Spinner label={t('common.loading')} />
      ) : (
        <>
          {/* ------------------------------------------------------ step 1 */}
          {step === 1 && (
            <Card title={t('migration.step1.heading')}>
              <p className="muted">{t('migration.step1.intro')}</p>
              <div className="migration-source-grid">
                {SOURCE_GROUPS.map((group) => (
                  <div key={group.key} className="migration-source-group">
                    <h3>
                      <span aria-hidden="true">{group.icon}</span> {t(group.labelKey)}
                    </h3>
                    {group.sources.map((src) => {
                      const prof = catalogue.profiles.find((p) => p.source === src);
                      if (!prof) return null;
                      return (
                        <button
                          key={src}
                          type="button"
                          className={`migration-source-card ${source === src ? 'selected' : ''}`}
                          onClick={() => setSource(src)}
                          aria-pressed={source === src}
                        >
                          <strong>{locale === 'fr' ? prof.labelFr : prof.labelEn}</strong>
                          <span className="migration-source-kind">
                            <Badge kind={prof.status === 'supported' ? 'success' : 'warning'}>
                              {prof.status === 'supported'
                                ? t('migration.status.supported')
                                : t('migration.status.experimental')}
                            </Badge>
                          </span>
                          <small>{locale === 'fr' ? prof.notesFr : prof.notesEn}</small>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="migration-kind-grid">
                <h3>{t('migration.step1.kindHeading')}</h3>
                {(Object.keys(catalogue.kinds) as ImportKind[]).map((k) => (
                  <label key={k} className={`migration-kind ${kind === k ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="migration-kind"
                      value={k}
                      checked={kind === k}
                      onChange={() => setKind(k)}
                    />
                    <span>{locale === 'fr' ? catalogue.kinds[k].fr : catalogue.kinds[k].en}</span>
                  </label>
                ))}
              </div>

              <div className="migration-actions">
                <Button variant="primary" onClick={() => setStep(2)}>
                  {t('migration.next')}
                </Button>
              </div>
            </Card>
          )}

          {/* ------------------------------------------------------ step 2 */}
          {step === 2 && (
            <Card title={t('migration.step2.heading')}>
              <p className="muted">
                {t('migration.step2.intro')} {formatBytes(catalogue.limits.maxBytes)} ·{' '}
                {catalogue.limits.maxRows} {t('migration.rows')}
              </p>
              <div className="migration-upload">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,.tsv,.xlsx,text/csv"
                  className="migration-file-input"
                  aria-label={t('migration.step2.chooseFile')}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
                <Button variant="primary" onClick={() => fileInput.current?.click()} disabled={uploading}>
                  {uploading ? t('common.loading') : t('migration.step2.chooseFile')}
                </Button>
                <span className="muted">
                  {t('migration.step2.selectedSource')} : {sourceLabel(source)} ·{' '}
                  {locale === 'fr' ? catalogue.kinds[kind].fr : catalogue.kinds[kind].en}
                </span>
              </div>

              <div className="migration-samples">
                <strong>{t('migration.samples.title')}</strong>
                <ul>
                  {[
                    ['plan-comptable-fictif.csv', 'migration.samples.chart'],
                    ['balance-ouverture-fictive.csv', 'migration.samples.opening'],
                    ['journal-fictif.csv', 'migration.samples.journal'],
                    ['export-sage-fictif.csv', 'migration.samples.sage'],
                    ['export-sap-fictif.csv', 'migration.samples.sap'],
                    ['fichier-incorrect.csv', 'migration.samples.invalid'],
                    ['plan-comptable-fictif.xlsx', 'migration.samples.excel'],
                  ].map(([file, key]) => (
                    <li key={file}>
                      <a href={`${import.meta.env.BASE_URL}samples/${file}`} download>
                        {t(key!)} — {file}
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="muted small">{t('migration.samples.note')}</p>
              </div>

              <div className="migration-actions">
                <Button onClick={() => setStep(1)}>{t('migration.back')}</Button>
              </div>
            </Card>
          )}

          {/* ------------------------------------------------------ step 3 */}
          {step === 3 && view && (
            <Card
              title={t('migration.step3.heading')}
              actions={
                <Button variant="ghost" onClick={() => setStep(2)}>
                  {t('migration.step2.otherFile')}
                </Button>
              }
            >
              <div className="migration-file-summary">
                <div>
                  <strong>{view.job.file_name}</strong>
                  <span className="muted">
                    {' '}
                    · {formatBytes(view.job.file_size)} · {view.job.row_count} {t('migration.rows')} ·{' '}
                    {view.job.encoding ?? '—'}
                    {view.job.delimiter ? ` · « ${view.job.delimiter === '\t' ? 'TAB' : view.job.delimiter} »` : ''}
                  </span>
                </div>
                {view.sheets.length > 1 && (
                  <label className="migration-sheet">
                    {t('migration.step2.sheet')}
                    <select
                      value={view.sheet.name}
                      onChange={(event) => void changeSheet(event.target.value)}
                    >
                      {view.sheets.map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.name} ({s.rowCount})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {view.notes.length > 0 && (
                <ul className="migration-notes">
                  {view.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              )}

              <h3>{t('migration.step3.mapping')}</h3>
              <div className="table-wrap">
                <table className="migration-table">
                  <thead>
                    <tr>
                      <th>{t('migration.targetField')}</th>
                      <th>{t('migration.sourceColumn')}</th>
                      <th>{t('migration.confidence')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.fields.map((field) => {
                      const suggestion = view.suggestions[field.key];
                      const current = mapping[field.key] ?? '';
                      return (
                        <tr key={field.key}>
                          <td>
                            <strong>{locale === 'fr' ? field.labelFr : field.labelEn}</strong>
                            {field.required && <span className="required"> *</span>}
                          </td>
                          <td>
                            <select
                              aria-label={locale === 'fr' ? field.labelFr : field.labelEn}
                              value={current}
                              onChange={(event) => {
                                const value = event.target.value;
                                setMapping((prev) => {
                                  const next = { ...prev };
                                  if (!value) delete next[field.key];
                                  else next[field.key] = value;
                                  return next;
                                });
                              }}
                            >
                              <option value="">{t('migration.notMapped')}</option>
                              {view.sheet.headers.map((header) => (
                                <option key={header} value={header}>
                                  {header}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            {suggestion?.column === current && suggestion.confidence > 0 ? (
                              <Badge kind={suggestion.confidence >= 0.9 ? 'success' : 'info'}>
                                {Math.round(suggestion.confidence * 100)} %
                              </Badge>
                            ) : (
                              <span className="muted">{t('migration.manual')}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {unknownAccounts.length > 0 && (
                <>
                  <h3>{t('migration.step3.accountMapping')}</h3>
                  <p className="muted">{t('migration.step3.accountMappingHint')}</p>
                  <div className="table-wrap">
                    <table className="migration-table">
                      <thead>
                        <tr>
                          <th>{t('migration.sourceAccount')}</th>
                          <th>{t('migration.destinationAccount')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unknownAccounts.map((code) => (
                          <tr key={code}>
                            <td>
                              <code>{code}</code>
                            </td>
                            <td>
                              <select
                                aria-label={`${t('migration.destinationAccount')} ${code}`}
                                value={accountMapping[code] ?? ''}
                                onChange={(event) =>
                                  setAccountMapping((prev) => {
                                    const next = { ...prev };
                                    if (!event.target.value) delete next[code];
                                    else next[code] = event.target.value;
                                    return next;
                                  })
                                }
                              >
                                <option value="">{t('migration.noCorrespondence')}</option>
                                {accounts
                                  .filter((a) => a.is_active)
                                  .map((a) => (
                                    <option key={a.id} value={a.code}>
                                      {a.code} — {a.name}
                                    </option>
                                  ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <h3>{t('migration.options.title')}</h3>
              <div className="migration-options">
                {(kind === 'opening_balance' || kind === 'journal_entries') && (
                  <label>
                    {t('migration.options.journal')}
                    <select
                      value={options.defaultJournalCode}
                      onChange={(event) =>
                        setOptions((prev) => ({ ...prev, defaultJournalCode: event.target.value }))
                      }
                    >
                      <option value="">{t('migration.options.fromFile')}</option>
                      {journals.map((j) => (
                        <option key={j.id} value={j.code}>
                          {j.code} — {j.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {kind === 'opening_balance' && (
                  <label>
                    {t('migration.options.openingDate')}
                    <input
                      type="date"
                      value={options.openingDate}
                      onChange={(event) =>
                        setOptions((prev) => ({ ...prev, openingDate: event.target.value }))
                      }
                    />
                  </label>
                )}
                {kind !== 'customers' && kind !== 'companies' && (
                  <label>
                    {t('migration.options.defaultAccountType')}
                    <select
                      value={options.defaultAccountType}
                      onChange={(event) =>
                        setOptions((prev) => ({ ...prev, defaultAccountType: event.target.value }))
                      }
                    >
                      <option value="">{t('migration.options.none')}</option>
                      <option value="asset">{t('migration.accountType.asset')}</option>
                      <option value="liability">{t('migration.accountType.liability')}</option>
                      <option value="equity">{t('migration.accountType.equity')}</option>
                      <option value="revenue">{t('migration.accountType.revenue')}</option>
                      <option value="expense">{t('migration.accountType.expense')}</option>
                    </select>
                  </label>
                )}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={options.dateDayFirst}
                    onChange={(event) =>
                      setOptions((prev) => ({ ...prev, dateDayFirst: event.target.checked }))
                    }
                  />
                  {t('migration.options.dayFirst')}
                </label>
                {kind === 'companies' && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={options.createCompanies}
                      onChange={(event) =>
                        setOptions((prev) => ({ ...prev, createCompanies: event.target.checked }))
                      }
                    />
                    {t('migration.options.createCompanies')}
                  </label>
                )}
              </div>

              <h3>{t('migration.templates.title')}</h3>
              <div className="migration-templates">
                <select
                  aria-label={t('migration.templates.title')}
                  value=""
                  onChange={(event) => {
                    const template = templates.find((x) => x.id === event.target.value);
                    if (template) void applyTemplate(template);
                  }}
                >
                  <option value="">{t('migration.templates.choose')}</option>
                  {templates
                    .filter((x) => x.import_kind === kind)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
                <input
                  type="text"
                  placeholder={t('migration.templates.namePlaceholder')}
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                />
                <Button onClick={() => void saveTemplate()} disabled={busy}>
                  {t('migration.templates.save')}
                </Button>
              </div>

              <div className="migration-actions">
                <Button onClick={() => setStep(2)}>{t('migration.back')}</Button>
                <Button variant="primary" onClick={() => void saveMapping(4)} disabled={busy}>
                  {t('migration.step3.continue')}
                </Button>
              </div>

              <details className="migration-preview-raw">
                <summary>{t('migration.step3.rawPreview')}</summary>
                <div className="table-wrap">
                  <table className="migration-table">
                    <thead>
                      <tr>
                        {view.sheet.headers.map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {view.sheet.rows.map((row, index) => (
                        <tr key={index}>
                          {view.sheet.headers.map((_, ci) => (
                            <td key={ci}>{row[ci] ?? ''}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {view.sheet.truncated && <p className="muted small">{t('migration.step3.truncated')}</p>}
              </details>
            </Card>
          )}

          {/* ------------------------------------------------------ step 4 */}
          {step === 4 && preview && (
            <Card title={t('migration.step4.heading')}>
              <div className="migration-counts">
                <div className="migration-count ok">
                  <strong>{preview.summary.create}</strong>
                  <span>{t('migration.counts.create')}</span>
                </div>
                <div className="migration-count">
                  <strong>{preview.summary.skip}</strong>
                  <span>{t('migration.counts.skip')}</span>
                </div>
                <div className="migration-count danger">
                  <strong>{preview.summary.errors}</strong>
                  <span>{t('migration.counts.errors')}</span>
                </div>
                <div className="migration-count warn">
                  <strong>{preview.summary.warnings}</strong>
                  <span>{t('migration.counts.warnings')}</span>
                </div>
              </div>

              {preview.totals && (
                <p className="migration-totals">
                  {t('common.debit')} : <strong>{preview.totals.debit}</strong> · {t('common.credit')} :{' '}
                  <strong>{preview.totals.credit}</strong> · {t('migration.difference')} :{' '}
                  <strong>{preview.totals.difference}</strong>
                </p>
              )}

              <div className="migration-filter">
                {(['all', 'error', 'warning', 'info'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={severityFilter === value ? 'active' : ''}
                    onClick={() => setSeverityFilter(value)}
                  >
                    {t(
                      value === 'all'
                        ? 'migration.filter.all'
                        : value === 'error'
                          ? 'migration.filter.errors'
                          : value === 'warning'
                            ? 'migration.filter.warnings'
                            : 'migration.filter.infos',
                    )}
                  </button>
                ))}
              </div>

              {filteredFindings.length === 0 ? (
                <p className="muted">{t('migration.step4.noFinding')}</p>
              ) : (
                <ul className="migration-findings">
                  {filteredFindings.map((finding, index) => (
                    <li key={`${finding.code}-${finding.rowNumber ?? 'x'}-${index}`}>
                      <Badge kind={severityKind(finding.severity)}>
                        {finding.severity === 'error'
                          ? t('migration.filter.errors')
                          : finding.severity === 'warning'
                            ? t('migration.filter.warnings')
                            : t('migration.filter.infos')}
                      </Badge>{' '}
                      <code>{finding.code}</code>{' '}
                      {finding.rowNumber !== null && <span className="muted">#{finding.rowNumber}</span>}{' '}
                      <span>{finding.message}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="migration-actions">
                <Button onClick={() => setStep(3)}>{t('migration.back')}</Button>
                <Button
                  variant="primary"
                  onClick={() => setStep(5)}
                  disabled={preview.blocksImport}
                  title={preview.blocksImport ? t('migration.blockedHint') : undefined}
                >
                  {t('migration.step4.continue')}
                </Button>
              </div>
              {preview.blocksImport && <p className="alert alert-error">{t('migration.blockedHint')}</p>}
            </Card>
          )}

          {/* ------------------------------------------------------ step 5 */}
          {step === 5 && preview && (
            <Card title={t('migration.step5.heading')}>
              <p className="migration-no-write">{t('migration.step5.noWrite')}</p>

              {preview.rows.chart && (
                <div className="table-wrap">
                  <table className="migration-table">
                    <thead>
                      <tr>
                        <th>{t('common.code')}</th>
                        <th>{t('migration.accountName')}</th>
                        <th>{t('common.type')}</th>
                        <th>{t('migration.action')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.chart.slice(0, 200).map((row) => (
                        <tr key={row.rowNumber}>
                          <td>{row.code}</td>
                          <td>{row.name}</td>
                          <td>{row.type ?? '—'}</td>
                          <td>
                            <Badge kind={row.action === 'create' ? 'success' : row.action === 'skip' ? 'neutral' : 'danger'}>
                              {t(`migration.action.${row.action}`)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.rows.opening && (
                <div className="table-wrap">
                  <table className="migration-table">
                    <thead>
                      <tr>
                        <th>{t('common.account')}</th>
                        <th>{t('common.debit')}</th>
                        <th>{t('common.credit')}</th>
                        <th>{t('migration.action')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.opening.slice(0, 200).map((row) => (
                        <tr key={row.rowNumber}>
                          <td>
                            {row.resolvedCode ?? row.accountCode}
                            {row.viaMapping && <span className="muted"> ({row.accountCode})</span>}
                          </td>
                          <td>{row.debit}</td>
                          <td>{row.credit}</td>
                          <td>
                            <Badge kind={row.action === 'create' ? 'success' : row.action === 'skip' ? 'neutral' : 'danger'}>
                              {t(`migration.action.${row.action}`)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.rows.entries && (
                <div className="migration-entries">
                  {preview.rows.entries.slice(0, 100).map((group) => (
                    <div key={group.key} className="migration-entry">
                      <div className="migration-entry-head">
                        <strong>
                          {group.key} · {group.entryDate ?? '—'} · {group.journalCode}
                        </strong>
                        <Badge kind={group.action === 'create' ? 'success' : group.action === 'skip' ? 'neutral' : 'danger'}>
                          {t(`migration.action.${group.action}`)}
                        </Badge>
                        <span className="muted">
                          {group.debitTotal} / {group.creditTotal} {group.currency}
                        </span>
                      </div>
                      <div className="table-wrap">
                        <table className="migration-table">
                          <thead>
                            <tr>
                              <th>{t('common.account')}</th>
                              <th>{t('common.description')}</th>
                              <th>{t('common.debit')}</th>
                              <th>{t('common.credit')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.lines.map((line) => (
                              <tr key={line.rowNumber}>
                                <td>{line.resolvedCode ?? line.accountCode}</td>
                                <td>{line.description ?? '—'}</td>
                                <td>{line.debit}</td>
                                <td>{line.credit}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {preview.rows.customers && (
                <div className="table-wrap">
                  <table className="migration-table">
                    <thead>
                      <tr>
                        <th>{t('common.name')}</th>
                        <th>BRN</th>
                        <th>{t('migration.email')}</th>
                        <th>{t('migration.action')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.customers.slice(0, 200).map((row) => (
                        <tr key={row.rowNumber}>
                          <td>{row.name}</td>
                          <td>{row.brn ?? '—'}</td>
                          <td>{row.email ?? '—'}</td>
                          <td>
                            <Badge kind={row.action === 'create' ? 'success' : row.action === 'skip' ? 'neutral' : 'danger'}>
                              {t(`migration.action.${row.action}`)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.rows.companies && (
                <div className="table-wrap">
                  <table className="migration-table">
                    <thead>
                      <tr>
                        <th>{t('common.name')}</th>
                        <th>BRN</th>
                        <th>{t('common.currency')}</th>
                        <th>{t('migration.action')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.companies.slice(0, 200).map((row) => (
                        <tr key={row.rowNumber}>
                          <td>{row.name}</td>
                          <td>{row.brn ?? '—'}</td>
                          <td>{row.currency}</td>
                          <td>
                            <Badge kind={row.action === 'create' ? 'success' : row.action === 'skip' ? 'neutral' : 'danger'}>
                              {t(`migration.action.${row.action}`)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="migration-actions">
                <Button onClick={() => setStep(4)}>{t('migration.back')}</Button>
                <Button variant="primary" onClick={() => setStep(6)}>
                  {t('migration.step5.continue')}
                </Button>
              </div>
            </Card>
          )}

          {/* ------------------------------------------------------ step 6 */}
          {step === 6 && (
            <Card title={t('migration.step6.heading')}>
              {report ? (
                <div className="migration-report">
                  <div className="migration-counts">
                    <div className="migration-count ok">
                      <strong>{report.counts.created}</strong>
                      <span>{t('migration.counts.created')}</span>
                    </div>
                    <div className="migration-count">
                      <strong>{report.counts.skipped}</strong>
                      <span>{t('migration.counts.skipped')}</span>
                    </div>
                    <div className="migration-count warn">
                      <strong>{report.counts.conflicts}</strong>
                      <span>{t('migration.counts.conflicts')}</span>
                    </div>
                  </div>
                  <p className="muted small">
                    {t('migration.report.idempotency')} : <code>{report.idempotencyKey}</code>
                  </p>
                  {report.createdSamples.length > 0 && (
                    <ul className="migration-report-list">
                      {report.createdSamples.map((line, index) => (
                        <li key={index}>{line}</li>
                      ))}
                    </ul>
                  )}
                  <div className="migration-actions">
                    <Button onClick={() => void downloadReportCsv()}>{t('migration.report.download')}</Button>
                    <Link className="btn" to="/accounting/entries">
                      {t('migration.report.seeEntries')}
                    </Link>
                    <Link className="btn" to="/accounting/accounts">
                      {t('migration.report.seeAccounts')}
                    </Link>
                    <Button
                      onClick={() => {
                        setView(null);
                        setReport(null);
                        setConfirm(false);
                        setStep(1);
                      }}
                    >
                      {t('migration.report.newImport')}
                    </Button>
                  </div>
                  {demoEnabled && <p className="muted small">{t('migration.report.demoNote')}</p>}
                </div>
              ) : (
                <>
                  <p className="migration-confirm-summary">
                    {t('migration.step6.summary')} {view?.job.file_name} —{' '}
                    {preview?.summary.create ?? 0} {t('migration.counts.create')}
                  </p>
                  {preview?.totals && (
                    <p className="migration-totals">
                      {t('common.debit')} : <strong>{preview.totals.debit}</strong> ·{' '}
                      {t('common.credit')} : <strong>{preview.totals.credit}</strong>
                    </p>
                  )}
                  <label className="checkbox migration-confirm">
                    <input
                      type="checkbox"
                      checked={confirm}
                      onChange={(event) => setConfirm(event.target.checked)}
                    />
                    {t('migration.step6.confirmLabel')}
                  </label>
                  <div className="migration-actions">
                    <Button onClick={() => setStep(5)}>{t('migration.back')}</Button>
                    <Button variant="primary" onClick={() => void runImport()} disabled={!confirm || busy}>
                      {t('migration.step6.confirm')}
                    </Button>
                  </div>
                  {busy && <Spinner label={t('migration.step6.running')} />}
                </>
              )}
            </Card>
          )}

          {/* ------------------------------------------------------- history */}
          <Card title={t('migration.history.title')}>
            {jobs.length === 0 ? (
              <p className="muted">{t('migration.history.empty')}</p>
            ) : (
              <div className="table-wrap">
                <table className="migration-table">
                  <thead>
                    <tr>
                      <th>{t('migration.history.file')}</th>
                      <th>{t('migration.history.kind')}</th>
                      <th>{t('common.status')}</th>
                      <th>{t('migration.history.date')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.slice(0, 20).map((job) => (
                      <tr key={job.id}>
                        <td>{job.file_name}</td>
                        <td>{locale === 'fr' ? catalogue.kinds[job.import_kind]?.fr : catalogue.kinds[job.import_kind]?.en}</td>
                        <td>
                          <Badge
                            kind={
                              job.status === 'imported'
                                ? 'success'
                                : job.status === 'failed'
                                  ? 'danger'
                                  : 'neutral'
                            }
                          >
                            {job.status}
                          </Badge>
                        </td>
                        <td>{job.created_at.slice(0, 10)}</td>
                        <td>
                          <Button
                            variant="link"
                            onClick={() => {
                              setKind(job.import_kind);
                              setSource(job.source);
                              setReport(job.report ?? null);
                              setStep(job.status === 'imported' ? 6 : 3);
                              void api
                                .get<JobView>(
                                  `/companies/${targetCompanyId}/migration/jobs/${job.id}`,
                                )
                                .then(applyView)
                                .catch((err) => setError(errorMessage(err, t('common.error')).message));
                            }}
                          >
                            {t('migration.history.open')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
