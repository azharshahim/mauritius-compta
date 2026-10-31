import { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../../api';
import { useI18n } from '../../i18n';
import { useSession } from '../../store';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';
import { money, today } from '../../format';

interface Account { id: string; code: string; name: string; type: string; is_active: boolean }
interface Journal { id: string; code: string; name: string; is_active: boolean }
interface Line {
  id: string; lineNo: number; periodStart: string; periodEnd: string; amount: string; status: string;
  entryId: string | null; entryNo: string | null; reversalEntryId: string | null; reversalEntryNo: string | null;
}
interface Schedule {
  id: string; reference: string; kind: string; description: string; counterparty: string | null;
  documentRef: string; pnlAccountId: string; balanceAccountId: string; journal: { code: string; name: string };
  totalAmount: string; startDate: string; endDate: string; months: number; status: string; notes: string | null;
  lines: Line[]; totals: { posted: string; pending: string; reversed: string };
  approvedByName: string | null; approvedAt: string | null; approvalNote: string | null; createdByName: string | null;
}
interface Report {
  asOf: string; byKind: Record<string, { posted: string; pending: string; reversed: string }>;
  reconciliation: { account: { code: string; name: string }; scheduleBalance: string; ledgerBalance: string; difference: string; balanced: boolean }[];
  balanced: boolean; note: string;
}

type Tab = 'schedules' | 'report';
const KINDS = ['accrued_expense', 'accrued_income', 'prepaid_expense', 'deferred_income'];
const kindLabel = (kind: string, en: boolean) => ({
  accrued_expense: en ? 'Accrued expense' : 'Charge à payer',
  accrued_income: en ? 'Accrued income' : 'Produit à recevoir',
  prepaid_expense: en ? 'Prepaid expense' : 'Charge constatée d’avance',
  deferred_income: en ? 'Deferred income' : 'Produit constaté d’avance',
} as Record<string, string>)[kind] ?? kind;
const statusKind = (status: string) => status === 'COMPLETED' ? 'success' : status === 'ACTIVE' ? 'info'
  : status === 'DRAFT' ? 'neutral' : status === 'CANCELLED' ? 'danger' : 'warning';

export default function AccrualsPage() {
  const { locale } = useI18n();
  const { company } = useSession();
  const en = locale === 'en';
  const L = (fr: string, txt: string) => (en ? txt : fr);
  const [tab, setTab] = useState<Tab>('schedules');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selected, setSelected] = useState<Schedule | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState(company?.financial_year_start ?? '');
  const [to, setTo] = useState(company?.financial_year_end ?? '');
  const [asOf, setAsOf] = useState(company?.financial_year_end ?? today());
  const [createOpen, setCreateOpen] = useState(false);
  const [decision, setDecision] = useState<{ path: string; action: 'approve' | 'cancel' } | null>(null);
  const [note, setNote] = useState('');
  const [reverseLine, setReverseLine] = useState<Line | null>(null);
  const [reverseDate, setReverseDate] = useState(today());
  const [reverseReason, setReverseReason] = useState('');
  const [form, setForm] = useState<any>({
    reference: '', kind: 'accrued_expense', description: '', counterparty: '', documentRef: '',
    pnlAccountId: '', balanceAccountId: '', journalId: '', totalAmount: '', startDate: today(),
    endDate: company?.financial_year_end ?? today(), months: 12, notes: '',
  });

  const activeAccounts = useMemo(() => accounts.filter((a) => a.is_active), [accounts]);
  const activeJournals = useMemo(() => journals.filter((j) => j.is_active), [journals]);
  const filtered = useMemo(() => schedules.filter((s) =>
    (!kindFilter || s.kind === kindFilter) && (!statusFilter || s.status === statusFilter)), [schedules, kindFilter, statusFilter]);

  async function loadCore() {
    if (!company) return;
    setLoading(true); setError(null);
    try {
      const [a, j, s] = await Promise.all([
        api.get<{ accounts: Account[] }>(`/companies/${company.id}/accounts`),
        api.get<{ journals: Journal[] }>(`/companies/${company.id}/journals`),
        api.get<{ schedules: Schedule[] }>(`/companies/${company.id}/accruals${qs({ from, to })}`),
      ]);
      setAccounts(a.accounts); setJournals(j.journals); setSchedules(s.schedules);
      setForm((f: any) => ({ ...f,
        journalId: f.journalId || j.journals.find((x) => x.is_active)?.id || '',
        pnlAccountId: f.pnlAccountId || a.accounts.find((x) => x.code === '6110')?.id || '',
        balanceAccountId: f.balanceAccountId || a.accounts.find((x) => x.code === '2100')?.id || '' }));
    } catch (err: any) { setError(err?.message ?? 'Erreur'); }
    finally { setLoading(false); }
  }
  async function loadSchedules() {
    if (!company) return;
    try {
      const s = await api.get<{ schedules: Schedule[] }>(`/companies/${company.id}/accruals${qs({ from, to })}`);
      setSchedules(s.schedules);
      if (selected) setSelected(s.schedules.find((x) => x.id === selected.id) ?? null);
    } catch (err: any) { setError(err?.message ?? 'Erreur'); }
  }
  async function loadReport() {
    if (!company) return;
    setBusy(true); setActionError(null);
    try { setReport(await api.get<Report>(`/companies/${company.id}/accruals/report${qs({ asOf })}`)); }
    catch (err: any) { setActionError(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void loadCore(); }, [company?.id]);

  const pnlOptions = form.kind === 'accrued_expense' || form.kind === 'prepaid_expense'
    ? activeAccounts.filter((a) => a.type === 'expense')
    : activeAccounts.filter((a) => a.type === 'revenue');
  const balanceOptions = form.kind === 'accrued_income' || form.kind === 'prepaid_expense'
    ? activeAccounts.filter((a) => a.type === 'asset')
    : activeAccounts.filter((a) => a.type === 'liability');

  async function create() {
    if (!company) return;
    setBusy(true); setActionError(null);
    try {
      await api.post(`/companies/${company.id}/accruals`, {
        ...form, counterparty: form.counterparty || null, notes: form.notes || null, months: Number(form.months),
      });
      setCreateOpen(false); await loadSchedules();
    } catch (err: any) { setActionError(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  }
  async function postLine(line: Line) {
    if (!company) return;
    setBusy(true); setActionError(null);
    try { await api.post(`/companies/${company.id}/accruals/${selected!.id}/lines/${line.id}/post`); await loadSchedules(); }
    catch (err: any) { setActionError(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  }
  async function postDue() {
    if (!company || !selected) return;
    setBusy(true); setActionError(null);
    try { await api.post(`/companies/${company.id}/accruals/${selected.id}/post-due`, { asOf }); await loadSchedules(); }
    catch (err: any) { setActionError(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  }
  async function confirmDecision() {
    if (!company || !decision) return;
    setBusy(true); setActionError(null);
    try {
      if (decision.action === 'approve') await api.post(decision.path, { confirm: true, note });
      else await api.post(decision.path);
      setDecision(null); setNote(''); await loadSchedules();
    } catch (err: any) { setActionError(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  }
  async function reverse() {
    if (!company || !selected || !reverseLine) return;
    setBusy(true); setActionError(null);
    try {
      await api.post(`/companies/${company.id}/accruals/${selected.id}/lines/${reverseLine.id}/reverse`, {
        reversalDate: reverseDate, reason: reverseReason,
      });
      setReverseLine(null); setReverseReason(''); await loadSchedules();
    } catch (err: any) { setActionError(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  }

  if (!company) return <EmptyState title={L('Sélectionnez une société', 'Select a company')} />;
  if (loading) return <Spinner />;
  return (
    <div>
      <div className="page-head">
        <div className="grow">
          <h1>{L('Charges à payer, avances et produits différés', 'Accruals, prepayments & deferred income')}</h1>
          <div className="page-sub">{L('Échéanciers mensuels, allocation exacte par période, extournes contrôlées et rapprochement avec le grand livre.', 'Monthly schedules, exact period allocation, controlled reversals and general-ledger reconciliation.')}</div>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>{L('Nouvel échéancier', 'New schedule')}</Button>
      </div>
      <DemoNotice />
      <div className="alert alert-warn">{L('Ces échéanciers sont des ajustements de période. Ils ne remplacent pas les avances clients ou fournisseurs, qui restent dans leurs modules commerciaux. Toute comptabilisation exige une approbation humaine.', 'These schedules are period-end adjustments. They do not replace customer or supplier advances, which remain in their commercial modules. Every posting requires human approval.')}</div>
      <ErrorBanner message={error ?? actionError} />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'schedules'} className={tab === 'schedules' ? 'tab active' : 'tab'} onClick={() => setTab('schedules')}>{L('Échéanciers', 'Schedules')}</button>
        <button role="tab" aria-selected={tab === 'report'} className={tab === 'report' ? 'tab active' : 'tab'} onClick={() => { setTab('report'); void loadReport(); }}>{L('Rapport & rapprochement', 'Report & reconciliation')}</button>
      </div>

      {tab === 'schedules' && (
        <>
          <Card title={L('Échéanciers', 'Schedules')} actions={<Button onClick={() => void loadSchedules()}>{L('Actualiser', 'Refresh')}</Button>}>
            <div className="form-row">
              <Field label={L('Du', 'From')}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label={L('Au', 'To')}><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              <Field label={L('Type', 'Kind')}><select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}><option value="">{L('Tous', 'All')}</option>{KINDS.map((k) => <option key={k} value={k}>{kindLabel(k, en)}</option>)}</select></Field>
              <Field label={L('Statut', 'Status')}><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">{L('Tous', 'All')}</option>{['DRAFT', 'APPROVED', 'ACTIVE', 'COMPLETED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
              <Button onClick={() => void loadSchedules()}>{L('Filtrer', 'Filter')}</Button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{L('Référence', 'Reference')}</th><th>{L('Type', 'Kind')}</th><th>{L('Description', 'Description')}</th><th>{L('Période', 'Period')}</th><th className="num">{L('Total', 'Total')}</th><th className="num">{L('Comptabilisé', 'Posted')}</th><th className="num">{L('En attente', 'Pending')}</th><th>{L('Statut', 'Status')}</th></tr></thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id} className="clickable" onClick={() => setSelected(s)}>
                      <td className="mono">{s.reference}</td><td>{kindLabel(s.kind, en)}</td><td>{s.description}</td>
                      <td>{s.startDate} → {s.endDate}<div className="page-sub">{s.months} {L('périodes', 'periods')}</div></td>
                      <td className="num">{money(s.totalAmount, locale, company.functional_currency)}</td>
                      <td className="num">{money(s.totals.posted, locale, company.functional_currency)}</td>
                      <td className="num">{money(s.totals.pending, locale, company.functional_currency)}</td>
                      <td><Badge kind={statusKind(s.status)}>{s.status}</Badge></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={8} className="page-sub">{L('Aucun échéancier.', 'No schedule.')}</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          {selected && (
            <Card title={`${selected.reference} — ${kindLabel(selected.kind, en)}`} actions={<Button onClick={() => setSelected(null)}>{L('Fermer', 'Close')}</Button>}>
              <div className="grid grid-2">
                <div>
                  <table className="table"><tbody>
                    <tr><th>{L('Description', 'Description')}</th><td>{selected.description}</td></tr>
                    <tr><th>{L('Contrepartie', 'Counterparty')}</th><td>{selected.counterparty ?? '—'}</td></tr>
                    <tr><th>{L('Justificatif', 'Document')}</th><td className="mono">{selected.documentRef}</td></tr>
                    <tr><th>{L('Journal', 'Journal')}</th><td>{selected.journal.code} — {selected.journal.name}</td></tr>
                    <tr><th>{L('Total', 'Total')}</th><td className="num">{money(selected.totalAmount, locale, company.functional_currency)}</td></tr>
                    <tr><th>{L('Approuvé par', 'Approved by')}</th><td>{selected.approvedByName ?? '—'}</td></tr>
                  </tbody></table>
                  <div className="form-row" style={{ flexWrap: 'wrap' }}>
                    {selected.status === 'DRAFT' && <Button variant="primary" onClick={() => { setDecision({ path: `/companies/${company.id}/accruals/${selected.id}/approve`, action: 'approve' }); setNote(''); }}>{L('Approuver', 'Approve')}</Button>}
                    {(selected.status === 'DRAFT' || selected.status === 'APPROVED') && <Button variant="danger" onClick={() => setDecision({ path: `/companies/${company.id}/accruals/${selected.id}/cancel`, action: 'cancel' })}>{L('Annuler', 'Cancel')}</Button>}
                    {['APPROVED', 'ACTIVE'].includes(selected.status) && <Button onClick={() => void postDue()}>{L('Comptabiliser les échéances dues', 'Post due periods')}</Button>}
                  </div>
                  {selected.approvalNote && <p className="page-sub">{L('Note d’approbation', 'Approval note')} : {selected.approvalNote}</p>}
                </div>
                <div>
                  <Field label={L('Date d’arrêté pour « échéances dues »', 'Cut-off date for “due periods”')}><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
                  <p className="page-sub">{L('Chaque ligne est comptabilisée à sa date de fin de période. Une ligne comptabilisée peut être extournée, jamais modifiée.', 'Each line is posted at its period end. A posted line can be reversed, never edited.')}</p>
                </div>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>#</th><th>{L('Début', 'Start')}</th><th>{L('Fin', 'End')}</th><th className="num">{L('Montant', 'Amount')}</th><th>{L('Statut', 'Status')}</th><th>{L('Écriture', 'Entry')}</th><th>{L('Actions', 'Actions')}</th></tr></thead>
                  <tbody>
                    {selected.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.lineNo}</td><td>{l.periodStart}</td><td>{l.periodEnd}</td>
                        <td className="num">{money(l.amount, locale, company.functional_currency)}</td>
                        <td><Badge kind={l.status === 'POSTED' ? 'success' : l.status === 'REVERSED' ? 'danger' : 'neutral'}>{l.status}</Badge></td>
                        <td className="mono">{l.entryNo ?? '—'}{l.reversalEntryNo ? ` / ${l.reversalEntryNo}` : ''}</td>
                        <td>
                          {l.status === 'PENDING' && ['APPROVED', 'ACTIVE'].includes(selected.status) && <Button variant="link" disabled={busy} onClick={() => void postLine(l)}>{L('Comptabiliser', 'Post')}</Button>}
                          {l.status === 'POSTED' && <Button variant="link" onClick={() => { setReverseLine(l); setReverseDate(l.periodEnd); setReverseReason(''); }}>{L('Extourner', 'Reverse')}</Button>}
                        </td>
                      </tr>
                    ))}
                    {selected.lines.length === 0 && <tr><td colSpan={7} className="page-sub">{L('Aucune ligne.', 'No line.')}</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {tab === 'report' && (
        <Card title={L('Rapport et rapprochement', 'Report and reconciliation')} actions={<Button onClick={() => void loadReport()}>{L('Calculer', 'Calculate')}</Button>}>
          <div className="form-row">
            <Field label={L('À la date', 'As of')}><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
            <Button onClick={() => void loadReport()}>{L('Actualiser', 'Refresh')}</Button>
          </div>
          {report && (
            <>
              <div className="kpi-grid">
                {Object.entries(report.byKind).map(([kind, totals]) => (
                  <div key={kind} className="kpi"><div className="kpi-label">{kindLabel(kind, en)}</div>
                    <div className="kpi-value">{money(totals.posted, locale, company.functional_currency)}</div>
                    <div className="page-sub">{L('En attente', 'Pending')} : {money(totals.pending, locale, company.functional_currency)}</div></div>
                ))}
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{L('Compte de bilan', 'Balance-sheet account')}</th><th className="num">{L('Échéanciers', 'Schedules')}</th><th className="num">{L('Grand livre (module)', 'Ledger (module)')}</th><th className="num">{L('Écart', 'Difference')}</th><th>{L('État', 'State')}</th></tr></thead>
                  <tbody>{report.reconciliation.map((r) => (
                    <tr key={r.account.code}><td>{r.account.code} — {r.account.name}</td>
                      <td className="num">{money(r.scheduleBalance, locale, company.functional_currency)}</td>
                      <td className="num">{money(r.ledgerBalance, locale, company.functional_currency)}</td>
                      <td className="num">{money(r.difference, locale, company.functional_currency)}</td>
                      <td><Badge kind={r.balanced ? 'success' : 'danger'}>{r.balanced ? L('Équilibré', 'Balanced') : L('Écart', 'Difference')}</Badge></td></tr>
                  ))}
                  {report.reconciliation.length === 0 && <tr><td colSpan={5} className="page-sub">{L('Aucun échéancier.', 'No schedule.')}</td></tr>}</tbody>
                </table>
              </div>
              <p className="page-sub">{report.note}</p>
            </>
          )}
        </Card>
      )}

      <Modal open={createOpen} title={L('Nouvel échéancier', 'New schedule')} onClose={() => setCreateOpen(false)} wide>
        <div className="form-row">
          <Field label={L('Référence', 'Reference')}><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
          <Field label={L('Type', 'Kind')}><select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, pnlAccountId: '', balanceAccountId: '' })}>{KINDS.map((k) => <option key={k} value={k}>{kindLabel(k, en)}</option>)}</select></Field>
          <Field label={L('Justificatif', 'Document reference')}><input value={form.documentRef} onChange={(e) => setForm({ ...form, documentRef: e.target.value })} /></Field>
        </div>
        <Field label={L('Description', 'Description')}><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="form-row">
          <Field label={L('Compte de résultat', 'Profit-or-loss account')}><select value={form.pnlAccountId} onChange={(e) => setForm({ ...form, pnlAccountId: e.target.value })}><option value="">—</option>{pnlOptions.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></Field>
          <Field label={L('Compte de bilan', 'Balance-sheet account')}><select value={form.balanceAccountId} onChange={(e) => setForm({ ...form, balanceAccountId: e.target.value })}><option value="">—</option>{balanceOptions.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></Field>
          <Field label={L('Journal', 'Journal')}><select value={form.journalId} onChange={(e) => setForm({ ...form, journalId: e.target.value })}>{activeJournals.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}</select></Field>
        </div>
        <div className="form-row">
          <Field label={L('Montant total', 'Total amount')}><input type="number" min="0" step="0.0001" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} /></Field>
          <Field label={L('Début', 'Start')}><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
          <Field label={L('Fin', 'End')}><input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
          <Field label={L('Nombre de périodes', 'Number of periods')}><input type="number" min="1" max="120" value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label={L('Contrepartie (facultatif)', 'Counterparty (optional)')}><input value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} /></Field>
          <Field label={L('Notes', 'Notes')}><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
        <p className="page-sub">{L('Le dernier échéancier reçoit le reliquat d’arrondi. Aucun flottant n’est utilisé et aucun montant n’est arrondi en silence.', 'The last period receives the rounding remainder. No floating point is used and no amount is silently rounded.')}</p>
        <Button variant="primary" disabled={busy} onClick={() => void create()}>{L('Créer l’échéancier', 'Create schedule')}</Button>
      </Modal>

      <Modal open={!!decision} title={decision?.action === 'approve' ? L('Approuver l’échéancier', 'Approve schedule') : L('Annuler l’échéancier', 'Cancel schedule')} onClose={() => setDecision(null)}>
        {decision?.action === 'approve' && <Field label={L('Note d’approbation (10 caractères minimum)', 'Approval note (at least 10 characters)')}><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
        <Button variant="primary" disabled={busy} onClick={() => void confirmDecision()}>{L('Confirmer', 'Confirm')}</Button>
      </Modal>

      <Modal open={!!reverseLine} title={L('Extourner une ligne comptabilisée', 'Reverse a posted line')} onClose={() => setReverseLine(null)}>
        <Field label={L('Date d’extourne', 'Reversal date')}><input type="date" value={reverseDate} onChange={(e) => setReverseDate(e.target.value)} /></Field>
        <Field label={L('Motif', 'Reason')}><textarea rows={3} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} /></Field>
        <p className="page-sub">{L('L’extourne crée une écriture inverse datée ; elle ne supprime pas l’écriture d’origine.', 'The reversal creates a dated opposite entry; it does not delete the original entry.')}</p>
        <Button variant="primary" disabled={busy} onClick={() => void reverse()}>{L('Extourner', 'Reverse')}</Button>
      </Modal>
    </div>
  );
}
