import { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../../api';
import { useI18n } from '../../i18n';
import { useSession } from '../../store';
import { useAsync } from '../../hooks';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';
import { money, today } from '../../format';
import { demoEnabled } from '../../demo/mode';

interface Account { id: string; code: string; name: string; type: string; is_active: boolean }
interface Journal { id: string; code: string; name: string; is_active: boolean }
interface Period {
  id: string; name: string; startDate: string; endDate: string; status: string; draftEntries: number;
  postedEntries: number; closing: any; archives: Archive[];
}
interface Timeline { periods: Period[]; currentPeriod: Period | null; counts: any }
interface Check { code: string; severity: 'ok' | 'warning' | 'block'; messageEn: string; messageFr: string }
interface Opening {
  period: any; previousPeriod: any; method: string; noteEn: string; noteFr: string;
  rows: any[]; totals: any; checks: Check[]; balanced: boolean; continuity: boolean | null;
  differences: any[]; profitAndLossOpening: any[]; preserved: any; externalBatch: any; externalPreview: any;
}
interface AdjustmentLine { accountId: string; account?: any; description: string; debit: string; credit: string }
interface Adjustment {
  id: string; adjustmentNo: string; sourcePeriodId: string; sourcePeriod: any; adjustmentDate: string;
  journal: any; treatment: string; originalReference: string; reason: string; documentRef: string;
  status: string; entryNo: string | null; restatesComparatives: boolean; comparativeNote: string | null;
  totalDebit: string; totalCredit: string; balanced: boolean; lines: AdjustmentLine[];
  approvalNote: string | null; rejectionReason: string | null; createdByName: string | null;
}
interface ChecklistItem {
  code: string; module: string; labelEn: string; labelFr: string;
  state: 'ok' | 'warning' | 'pending' | 'unavailable' | 'block'; detailEn: string; detailFr: string;
  count?: number; amount?: string;
}
interface Checklist {
  id?: string; version?: number; status?: string; period: any; items: ChecklistItem[];
  counts: Record<string, number>; ready?: boolean; noteEn: string; noteFr: string;
}
interface Archive {
  id: string; version: number; status: string; periodId: string; periodName: string;
  periodStart: string; periodEnd: string; checksum: string; sizeBytes: number; createdAt: string;
  sectionNames: string[]; sections: any[]; overall: string; retentionMonths: number | null;
  retentionNote: string | null; limitationsEn: string; limitationsFr: string;
  documentStorageEn: string; documentStorageFr: string;
}

type Tab = 'timeline' | 'opening' | 'adjustments' | 'checklist' | 'archives';
const emptyLine = (): AdjustmentLine => ({ accountId: '', description: '', debit: '', credit: '' });
const badge = (state: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' =>
  state === 'ok' || state === 'POSTED' || state === 'SEALED' ? 'success'
    : state === 'block' || state === 'REJECTED' ? 'danger'
      : state === 'warning' || state === 'PROPOSED' ? 'warning'
        : state === 'pending' || state === 'APPROVED' ? 'info' : 'neutral';

export default function FinancialYearsPage() {
  const { locale } = useI18n();
  const { company } = useSession();
  const L = (fr: string, en: string) => (locale === 'en' ? en : fr);
  const [tab, setTab] = useState<Tab>('timeline');
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: timeline, loading, error, reload: reloadTimeline } = useAsync<Timeline | null>(
    () => (company ? api.get<Timeline>(`/companies/${company.id}/financial-years/timeline`) : Promise.resolve(null)),
    [company?.id],
  );
  useEffect(() => {
    if (!timeline) return;
    setSelectedPeriod((current) => (current && timeline.periods.some((p) => p.id === current))
      ? current : (timeline.currentPeriod?.id ?? timeline.periods[0]?.id ?? ''));
  }, [timeline]);

  const { data: refs } = useAsync<{ accounts: Account[]; journals: Journal[] } | null>(
    () => (company ? Promise.all([
      api.get<{ accounts: Account[] }>(`/companies/${company.id}/accounts`),
      api.get<{ journals: Journal[] }>(`/companies/${company.id}/journals`),
    ]).then(([a, j]) => ({ accounts: a.accounts, journals: j.journals })) : Promise.resolve(null)),
    [company?.id],
  );
  const accounts = useMemo(() => (refs?.accounts ?? []).filter((a) => a.is_active), [refs]);
  const journals = useMemo(() => (refs?.journals ?? []).filter((j) => j.is_active), [refs]);

  const { data: opening, loading: openingLoading, reload: reloadOpening } = useAsync<Opening | null>(
    () => (company && selectedPeriod ? api.get<Opening>(`/companies/${company.id}/financial-years/opening-balances?periodId=${selectedPeriod}`) : Promise.resolve(null)),
    [company?.id, selectedPeriod],
  );
  const { data: adjustmentsData, loading: adjustmentsLoading, reload: reloadAdjustments } = useAsync<{ adjustments: Adjustment[] } | null>(
    () => (company ? api.get<{ adjustments: Adjustment[] }>(`/companies/${company.id}/financial-years/prior-year-adjustments`) : Promise.resolve(null)),
    [company?.id],
  );
  const { data: checklist, loading: checklistLoading, reload: reloadChecklist } = useAsync<Checklist | null>(
    () => (company && selectedPeriod ? api.get<Checklist>(`/companies/${company.id}/financial-years/checklist?periodId=${selectedPeriod}`) : Promise.resolve(null)),
    [company?.id, selectedPeriod],
  );
  const { data: archivesData, loading: archivesLoading, reload: reloadArchives } = useAsync<{ archives: Archive[] } | null>(
    () => (company ? api.get<{ archives: Archive[] }>(`/companies/${company.id}/financial-years/archives${qs({ periodId: selectedPeriod })}`) : Promise.resolve(null)),
    [company?.id, selectedPeriod],
  );
  const { data: settingsData, reload: reloadSettings } = useAsync<any | null>(
    () => (company ? api.get<any>(`/companies/${company.id}/financial-years/settings`).then((r) => r.settings) : Promise.resolve(null)),
    [company?.id],
  );

  async function run(fn: () => Promise<void>) {
    setBusy(true); setActionError(null);
    try { await fn(); } catch (e: any) { setActionError(e?.message ?? String(e)); } finally { setBusy(false); }
  }

  // ------------------------------------------------------------ external opening
  const [externalOpen, setExternalOpen] = useState(false);
  const [external, setExternal] = useState({ reference: 'OPEN-EXT-001', sourceReference: '', journalId: '', csv: '', notes: '' });
  const [externalPreview, setExternalPreview] = useState<any>(null);
  function parseCsv(text: string) {
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
      const [code, debit, credit, ...rest] = line.split(/[;,\t]/).map((v) => v.trim());
      const account = byCode.get(code ?? '');
      if (!account) throw new Error(L(`Compte inconnu ligne ${index + 1} : ${code}`, `Unknown account on line ${index + 1}: ${code}`));
      return { accountId: account.id, debit: debit || null, credit: credit || null, description: rest.join(' ') || null };
    });
  }
  async function previewExternal() {
    if (!company || !selectedPeriod) return;
    await run(async () => {
      const result = await api.post<any>(`/companies/${company.id}/financial-years/opening-balances/preview`, {
        periodId: selectedPeriod, lines: parseCsv(external.csv),
      });
      setExternalPreview(result.externalPreview);
    });
  }
  async function createExternal() {
    if (!company || !selectedPeriod) return;
    await run(async () => {
      await api.post(`/companies/${company.id}/financial-years/opening-balances/batches`, {
        periodId: selectedPeriod, ...external, lines: parseCsv(external.csv),
      });
      setExternalOpen(false); setExternalPreview(null);
      await reloadOpening();
    });
  }
  async function batchAction(id: string, action: 'approve' | 'post') {
    if (!company) return;
    await run(async () => {
      await api.post(`/companies/${company.id}/financial-years/opening-balances/batches/${id}/${action}`,
        action === 'approve' ? { confirm: true, note: L('Approbation fictive de démonstration.', 'Fictitious demonstration approval.') } : undefined);
      await reloadOpening();
    });
  }

  // ------------------------------------------------------------ adjustment form
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentForm, setAdjustmentForm] = useState({
    sourcePeriodId: '', adjustmentDate: today(), journalId: '', treatment: 'retained_earnings',
    originalReference: '', reason: '', documentRef: '', restatesComparatives: false, comparativeNote: '',
    lines: [emptyLine(), emptyLine()],
  });
  async function saveAdjustment() {
    if (!company) return;
    await run(async () => {
      await api.post(`/companies/${company.id}/financial-years/prior-year-adjustments`, {
        ...adjustmentForm,
        lines: adjustmentForm.lines.filter((l) => l.accountId && (l.debit || l.credit)),
      });
      setAdjustmentOpen(false); await reloadAdjustments();
    });
  }
  async function adjustmentAction(id: string, action: 'approve' | 'reject' | 'post') {
    if (!company) return;
    await run(async () => {
      await api.post(`/companies/${company.id}/financial-years/prior-year-adjustments/${id}/${action}`,
        action === 'approve' ? { confirm: true, note: L('Approbation fictive de démonstration.', 'Fictitious demonstration approval.') }
          : action === 'reject' ? { reason: L('Rejet fictif documenté pour la démonstration.', 'Fictitious documented rejection for the demonstration.') } : undefined);
      await reloadAdjustments();
    });
  }
  const [restatement, setRestatement] = useState<any>(null);
  async function showRestatement(id: string) {
    if (!company) return;
    await run(async () => {
      const res = await api.get<any>(`/companies/${company.id}/financial-years/prior-year-adjustments/${id}/restatement`);
      setRestatement(res.restatement);
    });
  }

  // ---------------------------------------------------------------- checklist
  async function saveChecklist() {
    if (!company || !selectedPeriod) return;
    await run(async () => {
      await api.post(`/companies/${company.id}/financial-years/checklists`, { periodId: selectedPeriod });
      await reloadChecklist();
    });
  }
  async function reviewChecklistRun() {
    if (!company || !checklist?.id) return;
    await run(async () => {
      await api.post(`/companies/${company.id}/financial-years/checklists/${checklist.id}/review`, {
        confirm: true, note: L('Revue fictive documentée pour la démonstration.', 'Fictitious documented review for the demonstration.'),
      });
      await reloadChecklist();
    });
  }

  // ----------------------------------------------------------------- archives
  const [archive, setArchive] = useState<Archive | null>(null);
  const [section, setSection] = useState<{ name: string; data: any } | null>(null);
  const [verification, setVerification] = useState<any>(null);
  async function createArchive() {
    if (!company || !selectedPeriod) return;
    await run(async () => {
      await api.post(`/companies/${company.id}/financial-years/archives`, {
        periodId: selectedPeriod, note: L('Archive annuelle fictive de démonstration.', 'Fictitious demonstration annual archive.'),
      });
      await reloadArchives(); await reloadTimeline();
    });
  }
  async function verifyArchive(item: Archive) {
    if (!company) return;
    await run(async () => {
      const res = await api.get<any>(`/companies/${company.id}/financial-years/archives/${item.id}/verify`);
      setVerification(res.verification); setArchive(item);
    });
  }
  async function viewSection(item: Archive, name: string) {
    if (!company) return;
    await run(async () => {
      const res = await api.get<any>(`/companies/${company.id}/financial-years/archives/${item.id}/sections/${name}`);
      setSection({ name, data: res.data }); setArchive(item);
    });
  }
  async function downloadArchive(item: Archive) {
    if (!company) return;
    await run(async () => {
      if (demoEnabled) {
        // The browser demo cannot create a server ZIP. It downloads the sealed
        // manifest as JSON and says so; this is never presented as a ZIP.
        const blob = new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = `archive-demo-v${item.version}.json`; link.click();
        URL.revokeObjectURL(url);
        return;
      }
      const res = await fetch(`/api/companies/${company.id}/financial-years/archives/${item.id}/download?format=zip`, { credentials: 'include' });
      if (!res.ok) throw new Error(L('Téléchargement refusé.', 'Download refused.'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `archive-v${item.version}.zip`; link.click();
      URL.revokeObjectURL(url);
    });
  }

  // ----------------------------------------------------------------- settings
  const [retention, setRetention] = useState({ retentionMonths: '', retentionNote: '', documentBackupNote: '', suspenseCodes: '' });
  useEffect(() => {
    if (!settingsData) return;
    const codes = (settingsData.suspense_account_ids ?? [])
      .map((id: string) => (refs?.accounts ?? []).find((a) => a.id === id)?.code).filter(Boolean).join(', ');
    setRetention({
      retentionMonths: settingsData.retention_months ? String(settingsData.retention_months) : '',
      retentionNote: settingsData.retention_note ?? '', documentBackupNote: settingsData.document_backup_note ?? '',
      suspenseCodes: codes,
    });
  }, [settingsData, refs]);
  async function saveSettings() {
    if (!company) return;
    await run(async () => {
      const codes = retention.suspenseCodes.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean);
      const ids = codes.map((code) => {
        const found = accounts.find((a) => a.code === code);
        if (!found) throw new Error(L(`Compte d’attente inconnu : ${code}`, `Unknown suspense account: ${code}`));
        return found.id;
      });
      await api.put(`/companies/${company.id}/financial-years/settings`, {
        suspenseAccountIds: ids,
        retentionMonths: retention.retentionMonths ? Number(retention.retentionMonths) : null,
        retentionNote: retention.retentionNote || null,
        documentBackupNote: retention.documentBackupNote || null,
      });
      await reloadSettings(); await reloadChecklist();
    });
  }

  const period = useMemo(() => timeline?.periods.find((p) => p.id === selectedPeriod) ?? null, [timeline, selectedPeriod]);
  const closedPeriods = useMemo(() => (timeline?.periods ?? []).filter((p) => p.status === 'closed'), [timeline]);
  const archived = archivesData?.archives ?? [];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{L('Exercices & archives', 'Financial Years & Archives')}</h1>
          <p className="page-sub">{L('Soldes d’ouverture, ajustements antérieurs, contrôles de clôture et archives annuelles immuables.',
            'Opening balances, prior-year adjustments, closing checks and immutable annual archives.')}</p>
        </div>
      </header>
      <DemoNotice />
      <ErrorBanner message={error ?? actionError} />

      <div className="tabs" role="tablist" aria-label={L('Exercices comptables', 'Financial years')}>
        {([
          ['timeline', L('Chronologie', 'Timeline')],
          ['opening', L('Soldes d’ouverture', 'Opening balances')],
          ['adjustments', L('Ajustements antérieurs', 'Prior-year adjustments')],
          ['checklist', L('Contrôles de clôture', 'Closing checklist')],
          ['archives', L('Archives', 'Archives')],
        ] as [Tab, string][]).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {loading ? <Spinner /> : !timeline ? <EmptyState title={L('Aucun exercice', 'No financial year')} /> : (
        <>
          {tab === 'timeline' && (
            <div className="grid grid-2">
              {timeline.periods.map((p) => (
                <Card key={p.id} title={p.name} actions={<Badge kind={badge(p.status === 'open' ? 'pending' : 'POSTED')}>{p.status === 'open' ? L('Ouvert', 'Open') : L('Clôturé', 'Closed')}</Badge>}>
                  <p className="page-sub">{p.startDate} → {p.endDate}</p>
                  <div className="grid grid-4">
                    <div><span className="page-sub">{L('Écritures', 'Entries')}</span><div>{p.postedEntries}</div></div>
                    <div><span className="page-sub">{L('Brouillons', 'Drafts')}</span><div>{p.draftEntries}</div></div>
                    <div><span className="page-sub">{L('Archives', 'Archives')}</span><div>{p.archives?.length ?? 0}</div></div>
                    <div><span className="page-sub">{L('Résultat', 'Result')}</span><div>{p.closing ? money(p.closing.resultAmount, locale) : '—'}</div></div>
                  </div>
                  {p.closing && <p className="page-sub">{L('Clôture', 'Closing')} : {p.closing.status} {p.closing.allocation ? `· ${L('affectation', 'allocation')} ${p.closing.allocation.status}` : ''}</p>}
                  <Button variant={p.id === selectedPeriod ? 'primary' : 'default'} onClick={() => setSelectedPeriod(p.id)}>
                    {p.id === selectedPeriod ? L('Sélectionné', 'Selected') : L('Sélectionner', 'Select')}
                  </Button>
                </Card>
              ))}
              <Card title={L('Continuité pluriannuelle', 'Multi-year continuity')}>
                <p>{L('Le grand livre est continu : aucun report d’ouverture n’est dupliqué. Le contrôle compare les soldes de clôture de N-1 aux soldes d’ouverture de N.',
                  'The ledger is continuous: no opening carry-forward entry is duplicated. The check compares N-1 closing balances with N opening balances.')}</p>
                <p className="page-sub">{L('Les archives sont scellées et ne modifient jamais la comptabilité.', 'Archives are sealed and never modify the accounting records.')}</p>
              </Card>
            </div>
          )}

          {tab === 'opening' && (
            openingLoading ? <Spinner /> : !opening ? <EmptyState title={L('Sélectionnez un exercice', 'Select a financial year')} /> : (
              <div className="grid">
                <Card title={L('Aperçu des soldes d’ouverture', 'Opening-balance overview')} actions={<Badge kind={opening.balanced ? 'success' : 'danger'}>{opening.balanced ? L('Équilibré', 'Balanced') : L('Déséquilibré', 'Unbalanced')}</Badge>}>
                  <div className="grid grid-4">
                    <div><span className="page-sub">{L('Débit', 'Debit')}</span><div>{money(opening.totals.openingDebit, locale)}</div></div>
                    <div><span className="page-sub">{L('Crédit', 'Credit')}</span><div>{money(opening.totals.openingCredit, locale)}</div></div>
                    <div><span className="page-sub">{L('Continuité', 'Continuity')}</span><div>{opening.continuity === null ? '—' : opening.continuity ? L('Vérifiée', 'Verified') : L('Écart', 'Gap')}</div></div>
                    <div><span className="page-sub">{L('Méthode', 'Method')}</span><div>{opening.method}</div></div>
                  </div>
                  <p className="page-sub">{locale === 'en' ? opening.noteEn : opening.noteFr}</p>
                  {opening.previousPeriod && <p className="page-sub">{L('Source', 'Source')} : {opening.previousPeriod.name} ({opening.previousPeriod.startDate} → {opening.previousPeriod.endDate})</p>}
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>{L('Compte', 'Account')}</th><th>{L('Type', 'Type')}</th><th>{L('Clôture N-1 (D / C)', 'N-1 closing (D / C)')}</th><th>{L('Ouverture N (D / C)', 'N opening (D / C)')}</th><th>{L('Écart', 'Difference')}</th></tr></thead>
                      <tbody>
                        {opening.rows.map((r) => (
                          <tr key={r.accountId}>
                            <td>{r.code} · {r.name}{!r.eligible ? ' ⚠' : ''}</td><td>{r.type}</td>
                            <td>{money(r.sourceClosingDebit, locale)} / {money(r.sourceClosingCredit, locale)}</td>
                            <td>{money(r.openingDebit, locale)} / {money(r.openingCredit, locale)}</td>
                            <td>{r.differs ? `${money(r.differenceDebit, locale)} / ${money(r.differenceCredit, locale)}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <div className="grid grid-2">
                  <Card title={L('Éléments préservés', 'Preserved items')}>
                    <ul>
                      <li>{L('Clients ouverts', 'Open customers')} : {opening.preserved.customerOpenItems.count} · {money(opening.preserved.customerOpenItems.total, locale)}</li>
                      <li>{L('Fournisseurs ouverts', 'Open suppliers')} : {opening.preserved.supplierOpenItems.count} · {money(opening.preserved.supplierOpenItems.total, locale)}</li>
                      <li>{L('Opérations bancaires non rapprochées', 'Unreconciled bank items')} : {opening.preserved.bankUnreconciled.count}</li>
                      <li>{L('Immobilisations', 'Fixed assets')} : {opening.preserved.fixedAssets.count} · {money(opening.preserved.fixedAssets.grossCost, locale)}</li>
                    </ul>
                    <p className="page-sub">{opening.preserved.partnerBalances.note}</p>
                    <p className="page-sub">{opening.preserved.loans.note}</p>
                  </Card>
                  <Card title={L('Contrôles', 'Checks')}>
                    {opening.checks.map((c) => <p key={c.code}><Badge kind={badge(c.severity === 'block' ? 'block' : c.severity === 'warning' ? 'warning' : 'ok')}>{c.code}</Badge> {locale === 'en' ? c.messageEn : c.messageFr}</p>)}
                    {opening.profitAndLossOpening.length > 0 && <p className="page-sub">{L('Des comptes de résultat portent un solde d’ouverture : à corriger, sans règle automatique.', 'Profit and loss accounts carry an opening balance: correct them manually; no rule is selected automatically.')}</p>}
                  </Card>
                </div>

                {!opening.previousPeriod && (
                  <Card title={L('Reprise externe initiale (optionnelle)', 'Initial external import (optional)')} actions={<Button onClick={() => setExternalOpen(true)}>{L('Importer une balance d’ouverture', 'Import opening trial balance')}</Button>}>
                    <p className="page-sub">{L('Réservée au premier exercice, sans écriture comptabilisée antérieure. Aucun double report n’est créé.', 'Only for the first period, with no earlier posted entry. No duplicate carry-forward is created.')}</p>
                    {opening.externalBatch && <p>{opening.externalBatch.reference} · {opening.externalBatch.status}</p>}
                  </Card>
                )}
                {opening.externalBatch && (
                  <Card title={L('Lot d’ouverture externe', 'External opening batch')}>
                    <p>{opening.externalBatch.reference} · {opening.externalBatch.status}</p>
                    {opening.externalBatch.status === 'DRAFT' && <Button variant="primary" onClick={() => batchAction(opening.externalBatch.id, 'approve')}>{L('Approuver', 'Approve')}</Button>}
                    {opening.externalBatch.status === 'APPROVED' && <Button variant="primary" onClick={() => batchAction(opening.externalBatch.id, 'post')}>{L('Comptabiliser', 'Post')}</Button>}
                  </Card>
                )}
              </div>
            )
          )}

          {tab === 'adjustments' && (
            <div className="grid">
              <Card title={L('Registre des ajustements antérieurs', 'Prior-year adjustment register')} actions={<Button variant="primary" onClick={() => setAdjustmentOpen(true)}>{L('Nouvel ajustement', 'New adjustment')}</Button>}>
                {adjustmentsLoading ? <Spinner /> : (adjustmentsData?.adjustments.length ?? 0) === 0 ? <EmptyState title={L('Aucun ajustement', 'No adjustment')} /> : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>{L('Référence', 'Reference')}</th><th>{L('Exercice source', 'Source year')}</th><th>{L('Date', 'Date')}</th><th>{L('Traitement', 'Treatment')}</th><th>{L('Statut', 'Status')}</th><th>{L('Écriture', 'Entry')}</th><th /></tr></thead>
                      <tbody>
                        {adjustmentsData!.adjustments.map((a) => (
                          <tr key={a.id}>
                            <td>{a.adjustmentNo}<div className="page-sub">{a.originalReference}</div></td>
                            <td>{a.sourcePeriod?.name ?? a.sourcePeriodId}</td><td>{a.adjustmentDate}</td><td>{a.treatment}</td>
                            <td><Badge kind={badge(a.status)}>{a.status}</Badge></td><td>{a.entryNo ?? '—'}</td>
                            <td>
                              {a.status === 'PROPOSED' && <><Button onClick={() => adjustmentAction(a.id, 'approve')}>{L('Approuver', 'Approve')}</Button> <Button variant="danger" onClick={() => adjustmentAction(a.id, 'reject')}>{L('Rejeter', 'Reject')}</Button></>}
                              {a.status === 'APPROVED' && <Button variant="primary" onClick={() => adjustmentAction(a.id, 'post')}>{L('Comptabiliser', 'Post')}</Button>}
                              <Button variant="ghost" onClick={() => showRestatement(a.id)}>{L('Comparatif', 'Comparative')}</Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              <Card title={L('Règles de contrôle', 'Control rules')}>
                <p>{L('La période source reste clôturée et l’écriture d’origine est conservée. Le traitement et les comptes sont choisis explicitement ; aucune règle mauricienne ou IFRS n’est appliquée automatiquement.',
                  'The source period remains closed and the original entry is preserved. The treatment and accounts are chosen explicitly; no Mauritian or IFRS rule is applied automatically.')}</p>
              </Card>
            </div>
          )}

          {tab === 'checklist' && (
            checklistLoading ? <Spinner /> : !checklist ? <EmptyState title={L('Sélectionnez un exercice', 'Select a financial year')} /> : (
              <div className="grid">
                <Card title={L('Contrôles de clôture', 'Year-end checklist')} actions={<><Badge kind={checklist.counts.block ? 'danger' : checklist.counts.warning || checklist.counts.pending ? 'warning' : 'success'}>{L('Bloquants', 'Blocks')} {checklist.counts.block} · {L('Alertes', 'Warnings')} {checklist.counts.warning} · {L('En attente', 'Pending')} {checklist.counts.pending}</Badge> <Button onClick={saveChecklist} disabled={busy}>{L('Enregistrer', 'Save')}</Button>{checklist.id && checklist.status !== 'REVIEWED' && <Button onClick={reviewChecklistRun}>{L('Marquer revu', 'Mark reviewed')}</Button>}</>}>
                  <p className="page-sub">{locale === 'en' ? checklist.noteEn : checklist.noteFr}</p>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>{L('Contrôle', 'Check')}</th><th>{L('Module', 'Module')}</th><th>{L('État', 'State')}</th><th>{L('Détail', 'Detail')}</th></tr></thead>
                      <tbody>{checklist.items.map((item) => (
                        <tr key={item.code}>
                          <td>{locale === 'en' ? item.labelEn : item.labelFr}</td><td>{item.module}</td>
                          <td><Badge kind={badge(item.state)}>{item.state}</Badge></td>
                          <td>{locale === 'en' ? item.detailEn : item.detailFr}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </Card>
                <Card title={L('Paramètres annuels', 'Annual settings')}>
                  <div className="form-row">
                    <Field label={L('Durée de conservation (mois, facultatif)', 'Retention months (optional, no statutory default)')} hint={L('Aucune durée légale n’est inventée ; la politique doit être validée.', 'No statutory period is invented; the policy must be validated.')}>
                      <input type="number" min="1" value={retention.retentionMonths} onChange={(e) => setRetention({ ...retention, retentionMonths: e.target.value })} />
                    </Field>
                    <Field label={L('Note de conservation', 'Retention note')}><textarea value={retention.retentionNote} onChange={(e) => setRetention({ ...retention, retentionNote: e.target.value })} /></Field>
                    <Field label={L('Note sur les sauvegardes de documents', 'Document-storage backup note')}><textarea value={retention.documentBackupNote} onChange={(e) => setRetention({ ...retention, documentBackupNote: e.target.value })} /></Field>
                    <Field label={L('Comptes d’attente (codes séparés par des virgules)', 'Suspense accounts (comma-separated codes)')}><input value={retention.suspenseCodes} onChange={(e) => setRetention({ ...retention, suspenseCodes: e.target.value })} /></Field>
                  </div>
                  <Button variant="primary" onClick={saveSettings} disabled={busy}>{L('Enregistrer les paramètres', 'Save settings')}</Button>
                </Card>
              </div>
            )
          )}

          {tab === 'archives' && (
            <div className="grid">
              <Card title={L('Archives annuelles', 'Annual archives')} actions={period?.status === 'closed' ? <Button variant="primary" onClick={createArchive} disabled={busy}>{L('Sceller une archive', 'Seal an archive')}</Button> : undefined}>
                <p className="page-sub">{L('Seul un exercice clôturé peut être archivé. Une archive est un instantané immuable avec empreintes ; elle ne remplace pas une certification légale ni la sauvegarde des documents.',
                  'Only a closed financial year can be archived. An archive is an immutable snapshot with checksums; it does not replace legal certification or document-storage backups.')}</p>
                {archivesLoading ? <Spinner /> : archived.length === 0 ? <EmptyState title={L('Aucune archive', 'No archive')} /> : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>{L('Exercice', 'Year')}</th><th>{L('Version', 'Version')}</th><th>{L('Créée', 'Created')}</th><th>{L('Empreinte', 'Checksum')}</th><th /></tr></thead>
                      <tbody>{archived.map((a) => (
                        <tr key={a.id}>
                          <td>{a.periodName}</td><td>{a.version}</td><td>{a.createdAt?.slice(0, 10)}</td><td><code>{a.checksum?.slice(0, 16)}…</code></td>
                          <td><Button onClick={() => verifyArchive(a)}>{L('Vérifier', 'Verify')}</Button> <Button onClick={() => downloadArchive(a)}>{demoEnabled ? L('JSON (démo)', 'JSON (demo)') : 'ZIP'}</Button> <Button variant="ghost" onClick={() => setArchive(a)}>{L('Voir', 'View')}</Button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                {verification && <div className="card"><p><Badge kind={verification.ok ? 'success' : 'danger'}>{verification.ok ? L('Intégrité vérifiée', 'Integrity verified') : L('Échec de vérification', 'Verification failed')}</Badge> {verification.overall?.slice(0, 16)}…</p><p className="page-sub">{locale === 'en' ? verification.noteEn : verification.noteFr}</p></div>}
              </Card>
              {archive && (
                <Card title={`${archive.periodName} · v${archive.version}`}>
                  <p className="page-sub">{archive.limitationsEn && (locale === 'en' ? archive.limitationsEn : archive.limitationsFr)}</p>
                  <p className="page-sub">{archive.documentStorageEn && (locale === 'en' ? archive.documentStorageEn : archive.documentStorageFr)}</p>
                  <div className="tabs">{archive.sectionNames.map((name) => <button key={name} type="button" className={section?.name === name ? 'active' : ''} onClick={() => viewSection(archive, name)}>{name}</button>)}</div>
                  {section && <pre style={{ maxHeight: 420, overflow: 'auto', fontSize: 11 }}>{JSON.stringify(section.data, null, 2)}</pre>}
                  <p className="page-sub">{L('Consultation en lecture seule ; toute modification est bloquée par la base.', 'Read-only consultation; any modification is blocked by the database.')}</p>
                </Card>
              )}
              <Card title={L('Politique de conservation', 'Retention policy')}>
                <p>{retention.retentionNote || L('Aucune note configurée.', 'No note configured.')}</p>
                <p className="page-sub">{L('La durée de conservation est une décision humaine configurable ; elle n’est pas déduite par le logiciel.',
                  'Retention is a configurable human decision; it is not inferred by the software.')}</p>
              </Card>
            </div>
          )}
        </>
      )}

      <Modal open={externalOpen} title={L('Reprise externe des soldes d’ouverture', 'External opening-balance import')} onClose={() => setExternalOpen(false)} wide>
        <p className="page-sub">{L('Format CSV : code compte ; débit ; crédit ; description. Aucune ligne de produit ou de charge n’est acceptée.', 'CSV format: account code; debit; credit; description. No profit or loss line is accepted.')}</p>
        <div className="form-row">
          <Field label={L('Référence du lot', 'Batch reference')}><input value={external.reference} onChange={(e) => setExternal({ ...external, reference: e.target.value })} /></Field>
          <Field label={L('Source externe', 'External source')}><input value={external.sourceReference} onChange={(e) => setExternal({ ...external, sourceReference: e.target.value })} /></Field>
          <Field label={L('Journal', 'Journal')}><select value={external.journalId} onChange={(e) => setExternal({ ...external, journalId: e.target.value })}><option value="">—</option>{journals.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.name}</option>)}</select></Field>
          <Field label="CSV"><textarea rows={8} value={external.csv} onChange={(e) => setExternal({ ...external, csv: e.target.value })} placeholder="1100;25000;0;Solde fictif" /></Field>
        </div>
        {externalPreview && <p><Badge kind={externalPreview.balanced ? 'success' : 'danger'}>{externalPreview.balanced ? L('Équilibré', 'Balanced') : L('Déséquilibré', 'Unbalanced')}</Badge> {externalPreview.totals?.debit} / {externalPreview.totals?.credit}</p>}
        <Button onClick={previewExternal} disabled={busy}>{L('Prévisualiser', 'Preview')}</Button>{' '}
        <Button variant="primary" onClick={createExternal} disabled={busy || !external.journalId}>{L('Créer le brouillon', 'Create draft')}</Button>
      </Modal>

      <Modal open={adjustmentOpen} title={L('Nouvel ajustement sur exercice antérieur', 'New prior-year adjustment')} onClose={() => setAdjustmentOpen(false)} wide>
        <div className="form-row">
          <Field label={L('Exercice source clôturé', 'Closed source year')}><select value={adjustmentForm.sourcePeriodId} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, sourcePeriodId: e.target.value })}><option value="">—</option>{closedPeriods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label={L('Date de l’ajustement (exercice ouvert)', 'Adjustment date (open year)')}><input type="date" value={adjustmentForm.adjustmentDate} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, adjustmentDate: e.target.value })} /></Field>
          <Field label={L('Journal', 'Journal')}><select value={adjustmentForm.journalId} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, journalId: e.target.value })}><option value="">—</option>{journals.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.name}</option>)}</select></Field>
          <Field label={L('Traitement documenté', 'Documented treatment')}><select value={adjustmentForm.treatment} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, treatment: e.target.value })}><option value="retained_earnings">{L('Report à nouveau', 'Retained earnings')}</option><option value="current_year_result">{L('Résultat de l’exercice', 'Current-year result')}</option><option value="custom">{L('Autre (choisi par l’utilisateur)', 'Custom (user choice)')}</option></select></Field>
          <Field label={L('Référence d’origine', 'Original reference')}><input value={adjustmentForm.originalReference} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, originalReference: e.target.value })} /></Field>
          <Field label={L('Justificatif', 'Supporting document')}><input value={adjustmentForm.documentRef} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, documentRef: e.target.value })} /></Field>
          <Field label={L('Motif', 'Reason')}><textarea value={adjustmentForm.reason} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, reason: e.target.value })} /></Field>
          <Field label={L('Note comparative', 'Comparative note')}><textarea value={adjustmentForm.comparativeNote} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, comparativeNote: e.target.value })} /></Field>
          <label className="field"><span className="field-label">{L('Retraitement comparatif proposé', 'Proposed comparative restatement')}</span><input type="checkbox" checked={adjustmentForm.restatesComparatives} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, restatesComparatives: e.target.checked })} /></label>
        </div>
        <div className="table-wrap">
          <table><thead><tr><th>{L('Compte', 'Account')}</th><th>{L('Débit', 'Debit')}</th><th>{L('Crédit', 'Credit')}</th><th>{L('Description', 'Description')}</th></tr></thead><tbody>
            {adjustmentForm.lines.map((line, index) => (
              <tr key={index}>
                <td><select value={line.accountId} onChange={(e) => { const lines = [...adjustmentForm.lines]; lines[index] = { ...line, accountId: e.target.value }; setAdjustmentForm({ ...adjustmentForm, lines }); }}><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></td>
                <td><input value={line.debit} onChange={(e) => { const lines = [...adjustmentForm.lines]; lines[index] = { ...line, debit: e.target.value }; setAdjustmentForm({ ...adjustmentForm, lines }); }} /></td>
                <td><input value={line.credit} onChange={(e) => { const lines = [...adjustmentForm.lines]; lines[index] = { ...line, credit: e.target.value }; setAdjustmentForm({ ...adjustmentForm, lines }); }} /></td>
                <td><input value={line.description} onChange={(e) => { const lines = [...adjustmentForm.lines]; lines[index] = { ...line, description: e.target.value }; setAdjustmentForm({ ...adjustmentForm, lines }); }} /></td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <Button onClick={() => setAdjustmentForm({ ...adjustmentForm, lines: [...adjustmentForm.lines, emptyLine()] })}>{L('Ajouter une ligne', 'Add a line')}</Button>
        <p className="page-sub">{L('Le brouillon ne crée aucune écriture. Approbation puis comptabilisation explicites requises.', 'The draft creates no entry. Explicit approval and posting are required.')}</p>
        <Button variant="primary" onClick={saveAdjustment} disabled={busy}>{L('Créer le brouillon', 'Create draft')}</Button>
      </Modal>

      <Modal open={Boolean(restatement)} title={L('Comparatif proposé', 'Proposed comparative')} onClose={() => setRestatement(null)} wide>
        {restatement && <><p>{L('Résultat d’origine', 'Original result')} : {money(restatement.originalResult, locale)} · {L('Ajustement', 'Adjustment')} : {money(restatement.adjustmentResult, locale)} · {L('Retraité', 'Restated')} : {money(restatement.restatedResult, locale)}</p><p className="page-sub">{locale === 'en' ? restatement.noteEn : restatement.noteFr}</p><pre style={{ maxHeight: 360, overflow: 'auto' }}>{JSON.stringify(restatement.rows, null, 2)}</pre></>}
      </Modal>
    </div>
  );
}
