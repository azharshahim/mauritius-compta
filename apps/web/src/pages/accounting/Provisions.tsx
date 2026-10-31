import { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../../api';
import { useI18n } from '../../i18n';
import { useSession } from '../../store';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';
import { money, today } from '../../format';

interface Account { id: string; code: string; name: string; type: string; is_active: boolean }
interface Journal { id: string; code: string; name: string; is_active: boolean }
interface Movement {
  id: string; movementNo: string; movementType: string; movementDate: string; amount: string; direction: string;
  reason: string; documentRef: string; status: string; journal: { code: string; name: string };
  counterpartAccount: { code: string; name: string } | null; entryNo: string | null; approvalNote: string | null;
  rejectionReason: string | null; createdAt: string;
}
interface Provision {
  id: string; provisionNo: string; category: string; description: string; evidenceRef: string;
  recognitionDate: string; measurementBasis: string; expenseAccountId: string; provisionAccountId: string;
  expenseAccount: { code: string; name: string }; provisionAccount: { code: string; name: string };
  currentPortion: string | null; nonCurrentPortion: string | null; status: string;
  movements: Movement[]; totals: { recognised: string; revisionsUp: string; revisionsDown: string; utilised: string; reversed: string; carrying: string };
  pendingMovements: number; note: string;
}
interface Recon {
  asOf: string; rows: { account: { code: string; name: string }; carrying: string; ledgerBalance: string; difference: string; balanced: boolean }[];
  balanced: boolean; note: string;
}

type Tab = 'register' | 'reports';
const CATEGORIES = ['litigation', 'warranty', 'restructuring', 'other'];
const categoryLabel = (c: string, en: boolean) => ({
  litigation: en ? 'Litigation' : 'Litige', warranty: en ? 'Warranty' : 'Garanties',
  restructuring: en ? 'Restructuring' : 'Restructuration', other: en ? 'Other' : 'Autre',
} as Record<string, string>)[c] ?? c;
const movementLabel = (m: string, en: boolean) => ({
  recognition: en ? 'Recognition' : 'Reconnaissance', revision: en ? 'Revision' : 'Révision',
  utilisation: en ? 'Utilisation' : 'Utilisation', reversal: en ? 'Reversal' : 'Reprise',
} as Record<string, string>)[m] ?? m;
const statusKind = (status: string) => status === 'ACTIVE' ? 'info' : status === 'REVERSED' ? 'success'
  : status === 'DRAFT' ? 'neutral' : 'warning';
const movementKind = (status: string) => status === 'POSTED' ? 'success' : status === 'APPROVED' ? 'info'
  : status === 'PROPOSED' ? 'warning' : 'danger';

export default function ProvisionsPage() {
  const { locale } = useI18n();
  const { company } = useSession();
  const en = locale === 'en';
  const L = (fr: string, txt: string) => (en ? txt : fr);
  const [tab, setTab] = useState<Tab>('register');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [provisions, setProvisions] = useState<Provision[]>([]);
  const [selected, setSelected] = useState<Provision | null>(null);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [movementsReport, setMovementsReport] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [asOf, setAsOf] = useState(company?.financial_year_end ?? today());
  const [from, setFrom] = useState(company?.financial_year_start ?? '');
  const [to, setTo] = useState(company?.financial_year_end ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [decision, setDecision] = useState<{ path: string; action: 'approve' | 'reject' | 'post'; title: string } | null>(null);
  const [note, setNote] = useState('');
  const [form, setForm] = useState<any>({
    category: 'litigation', description: '', evidenceRef: '', recognitionDate: today(), measurementBasis: '',
    expenseAccountId: '', provisionAccountId: '', currentPortion: '', nonCurrentPortion: '', initialAmount: '',
    journalId: '', initialReason: '', documentRef: '',
  });
  const [movementForm, setMovementForm] = useState<any>({
    movementType: 'recognition', movementDate: today(), amount: '', direction: 'increase', reason: '',
    documentRef: '', journalId: '', counterpartAccountId: '',
  });

  const activeAccounts = useMemo(() => accounts.filter((a) => a.is_active), [accounts]);
  const activeJournals = useMemo(() => journals.filter((j) => j.is_active), [journals]);
  const filtered = useMemo(() => provisions.filter((p) =>
    (!categoryFilter || p.category === categoryFilter) && (!statusFilter || p.status === statusFilter)), [provisions, categoryFilter, statusFilter]);

  async function loadCore() {
    if (!company) return;
    setLoading(true); setError(null);
    try {
      const [a, j, p] = await Promise.all([
        api.get<{ accounts: Account[] }>(`/companies/${company.id}/accounts`),
        api.get<{ journals: Journal[] }>(`/companies/${company.id}/journals`),
        api.get<{ provisions: Provision[] }>(`/companies/${company.id}/provisions`),
      ]);
      setAccounts(a.accounts); setJournals(j.journals); setProvisions(p.provisions);
      const journalId = j.journals.find((x) => x.is_active)?.id ?? '';
      setForm((f: any) => ({ ...f, journalId: f.journalId || journalId,
        expenseAccountId: f.expenseAccountId || a.accounts.find((x) => x.code === '6130')?.id || '',
        provisionAccountId: f.provisionAccountId || a.accounts.find((x) => x.code === '2100')?.id || '' }));
      setMovementForm((f: any) => ({ ...f, journalId: f.journalId || journalId }));
    } catch (err: any) { setError(err?.message ?? 'Erreur'); }
    finally { setLoading(false); }
  }
  async function loadProvisions() {
    if (!company) return;
    try {
      const p = await api.get<{ provisions: Provision[] }>(`/companies/${company.id}/provisions`);
      setProvisions(p.provisions);
      if (selected) setSelected(p.provisions.find((x) => x.id === selected.id) ?? null);
    } catch (err: any) { setError(err?.message ?? 'Erreur'); }
  }
  async function loadReport() {
    if (!company) return;
    setBusy(true); setActionError(null);
    try {
      const [r, m] = await Promise.all([
        api.get<Recon>(`/companies/${company.id}/provisions/reconciliation${qs({ asOf })}`),
        api.get<{ movements: any[] }>(`/companies/${company.id}/provisions/report${qs({ from, to })}`),
      ]);
      setRecon(r); setMovementsReport(m.movements);
    } catch (err: any) { setActionError(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void loadCore(); }, [company?.id]);

  async function create() {
    if (!company) return;
    setBusy(true); setActionError(null);
    try {
      await api.post(`/companies/${company.id}/provisions`, {
        ...form, currentPortion: form.currentPortion || null, nonCurrentPortion: form.nonCurrentPortion || null,
        initialAmount: form.initialAmount || null, journalId: form.journalId || null,
        initialReason: form.initialReason || null, documentRef: form.documentRef || null,
      });
      setCreateOpen(false); await loadProvisions();
    } catch (err: any) { setActionError(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  }
  async function addMovement() {
    if (!company || !selected) return;
    setBusy(true); setActionError(null);
    try {
      await api.post(`/companies/${company.id}/provisions/${selected.id}/movements`, {
        ...movementForm, counterpartAccountId: movementForm.counterpartAccountId || null,
      });
      setMovementOpen(false); await loadProvisions();
    } catch (err: any) { setActionError(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  }
  async function confirmDecision() {
    if (!company || !decision) return;
    setBusy(true); setActionError(null);
    try {
      if (decision.action === 'post') await api.post(decision.path);
      else if (decision.action === 'approve') await api.post(decision.path, { confirm: true, note });
      else await api.post(decision.path, { reason: note });
      setDecision(null); setNote(''); await loadProvisions();
    } catch (err: any) { setActionError(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  }

  if (!company) return <EmptyState title={L('Sélectionnez une société', 'Select a company')} />;
  if (loading) return <Spinner />;
  return (
    <div>
      <div className="page-head">
        <div className="grow">
          <h1>{L('Provisions', 'Provisions')}</h1>
          <div className="page-sub">{L('Registre documenté : reconnaissance, révision, utilisation et reprise, chacune proposée puis validée par un humain.', 'Documented register: recognition, revision, utilisation and reversal, each proposed then approved by a human.')}</div>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>{L('Nouvelle provision', 'New provision')}</Button>
      </div>
      <DemoNotice />
      <div className="alert alert-warn">{L('Aucune conformité IAS 37 ni règle mauricienne n’est affirmée. Aucun seuil de probabilité n’est appliqué et une suggestion ne peut jamais créer une provision comptabilisée.', 'No IAS 37 compliance and no Mauritian rule is asserted. No probability threshold is applied and a suggestion can never create a posted provision.')}</div>
      <ErrorBanner message={error ?? actionError} />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'register'} className={tab === 'register' ? 'tab active' : 'tab'} onClick={() => setTab('register')}>{L('Registre', 'Register')}</button>
        <button role="tab" aria-selected={tab === 'reports'} className={tab === 'reports' ? 'tab active' : 'tab'} onClick={() => { setTab('reports'); void loadReport(); }}>{L('Mouvements & rapprochement', 'Movements & reconciliation')}</button>
      </div>

      {tab === 'register' && (
        <>
          <Card title={L('Registre des provisions', 'Provision register')} actions={<Button onClick={() => void loadProvisions()}>{L('Actualiser', 'Refresh')}</Button>}>
            <div className="form-row">
              <Field label={L('Catégorie', 'Category')}><select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="">{L('Toutes', 'All')}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c, en)}</option>)}</select></Field>
              <Field label={L('Statut', 'Status')}><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">{L('Tous', 'All')}</option>{['DRAFT', 'ACTIVE', 'REVERSED', 'CLOSED'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{L('N°', 'No.')}</th><th>{L('Catégorie', 'Category')}</th><th>{L('Description', 'Description')}</th><th>{L('Preuve', 'Evidence')}</th><th>{L('Reconnaissance', 'Recognition')}</th><th className="num">{L('Solde', 'Carrying')}</th><th>{L('En attente', 'Pending')}</th><th>{L('Statut', 'Status')}</th></tr></thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => setSelected(p)}>
                      <td className="mono">{p.provisionNo}</td><td>{categoryLabel(p.category, en)}</td><td>{p.description}</td>
                      <td className="mono">{p.evidenceRef}</td><td>{p.recognitionDate}</td>
                      <td className="num">{money(p.totals.carrying, locale, company.functional_currency)}</td>
                      <td>{p.pendingMovements > 0 ? <Badge kind="warning">{p.pendingMovements}</Badge> : '—'}</td>
                      <td><Badge kind={statusKind(p.status)}>{p.status}</Badge></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={8} className="page-sub">{L('Aucune provision.', 'No provision.')}</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          {selected && (
            <Card title={`${selected.provisionNo} — ${selected.description}`} actions={<Button onClick={() => setSelected(null)}>{L('Fermer', 'Close')}</Button>}>
              <div className="grid grid-2">
                <div>
                  <table className="table"><tbody>
                    <tr><th>{L('Catégorie', 'Category')}</th><td>{categoryLabel(selected.category, en)}</td></tr>
                    <tr><th>{L('Preuve', 'Evidence')}</th><td className="mono">{selected.evidenceRef}</td></tr>
                    <tr><th>{L('Base de mesure', 'Measurement basis')}</th><td>{selected.measurementBasis}</td></tr>
                    <tr><th>{L('Comptes', 'Accounts')}</th><td>{selected.expenseAccount.code} / {selected.provisionAccount.code}</td></tr>
                    <tr><th>{L('Courant / non courant', 'Current / non-current')}</th><td>{selected.currentPortion ?? '—'} / {selected.nonCurrentPortion ?? '—'}</td></tr>
                    <tr><th>{L('Statut', 'Status')}</th><td><Badge kind={statusKind(selected.status)}>{selected.status}</Badge></td></tr>
                  </tbody></table>
                </div>
                <div className="kpi-grid">
                  <div className="kpi"><div className="kpi-label">{L('Reconnu', 'Recognised')}</div><div className="kpi-value">{money(selected.totals.recognised, locale, company.functional_currency)}</div></div>
                  <div className="kpi"><div className="kpi-label">{L('Révisions nettes', 'Net revisions')}</div><div className="kpi-value">{money((Number(selected.totals.revisionsUp) - Number(selected.totals.revisionsDown)).toFixed(4), locale, company.functional_currency)}</div></div>
                  <div className="kpi"><div className="kpi-label">{L('Utilisé', 'Utilised')}</div><div className="kpi-value">{money(selected.totals.utilised, locale, company.functional_currency)}</div></div>
                  <div className="kpi"><div className="kpi-label">{L('Solde', 'Carrying')}</div><div className="kpi-value">{money(selected.totals.carrying, locale, company.functional_currency)}</div></div>
                </div>
              </div>
              <div className="form-row" style={{ flexWrap: 'wrap' }}>
                <Button variant="primary" disabled={!['DRAFT', 'ACTIVE'].includes(selected.status)} onClick={() => {
                  setMovementForm({ ...movementForm, movementType: selected.status === 'DRAFT' ? 'recognition' : 'revision',
                    movementDate: today(), amount: '', direction: 'increase', reason: '', documentRef: '' });
                  setMovementOpen(true);
                }}>{L('Proposer un mouvement', 'Propose movement')}</Button>
              </div>
              <p className="page-sub">{selected.note}</p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{L('N°', 'No.')}</th><th>{L('Date', 'Date')}</th><th>{L('Type', 'Type')}</th><th className="num">{L('Montant', 'Amount')}</th><th>{L('Sens', 'Direction')}</th><th>{L('Motif / preuve', 'Reason / evidence')}</th><th>{L('Statut', 'Status')}</th><th>{L('Actions', 'Actions')}</th></tr></thead>
                  <tbody>
                    {selected.movements.map((m) => (
                      <tr key={m.id}>
                        <td className="mono">{m.movementNo}</td><td>{m.movementDate}</td><td>{movementLabel(m.movementType, en)}</td>
                        <td className="num">{money(m.amount, locale, company.functional_currency)}</td><td>{m.direction === 'increase' ? '+' : '−'}</td>
                        <td>{m.reason}<div className="page-sub mono">{m.documentRef}</div></td>
                        <td><Badge kind={movementKind(m.status)}>{m.status}</Badge>{m.entryNo && <div className="page-sub mono">{m.entryNo}</div>}</td>
                        <td>
                          {m.status === 'PROPOSED' && <>
                            <Button variant="link" onClick={() => { setDecision({ path: `/companies/${company.id}/provisions/movements/${m.id}/approve`, action: 'approve', title: L('Approuver le mouvement', 'Approve movement') }); setNote(''); }}>{L('Approuver', 'Approve')}</Button>
                            <Button variant="link" onClick={() => { setDecision({ path: `/companies/${company.id}/provisions/movements/${m.id}/reject`, action: 'reject', title: L('Rejeter le mouvement', 'Reject movement') }); setNote(''); }}>{L('Rejeter', 'Reject')}</Button>
                          </>}
                          {m.status === 'APPROVED' && <Button variant="link" onClick={() => { setDecision({ path: `/companies/${company.id}/provisions/movements/${m.id}/post`, action: 'post', title: L('Comptabiliser le mouvement', 'Post movement') }); setNote(''); }}>{L('Comptabiliser', 'Post')}</Button>}
                        </td>
                      </tr>
                    ))}
                    {selected.movements.length === 0 && <tr><td colSpan={8} className="page-sub">{L('Aucun mouvement. Une provision n’est jamais reconnue automatiquement.', 'No movement. A provision is never recognised automatically.')}</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {tab === 'reports' && (
        <>
          <Card title={L('Rapprochement du registre avec le grand livre', 'Register reconciliation with the ledger')} actions={<Button onClick={() => void loadReport()}>{L('Calculer', 'Calculate')}</Button>}>
            <div className="form-row">
              <Field label={L('À la date', 'As of')}><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
              <Button onClick={() => void loadReport()}>{L('Actualiser', 'Refresh')}</Button>
            </div>
            {recon && <>
              <div className="kpi-grid"><div className={recon.balanced ? 'kpi' : 'kpi kpi-danger'}>
                <div className="kpi-label">{L('État', 'State')}</div><div className="kpi-value">{recon.balanced ? L('Équilibré', 'Balanced') : L('Écart', 'Difference')}</div>
              </div></div>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>{L('Compte', 'Account')}</th><th className="num">{L('Registre', 'Register')}</th><th className="num">{L('Grand livre', 'Ledger')}</th><th className="num">{L('Écart', 'Difference')}</th><th>{L('État', 'State')}</th></tr></thead>
                <tbody>{recon.rows.map((r) => <tr key={r.account.code}><td>{r.account.code} — {r.account.name}</td>
                  <td className="num">{money(r.carrying, locale, company.functional_currency)}</td>
                  <td className="num">{money(r.ledgerBalance, locale, company.functional_currency)}</td>
                  <td className="num">{money(r.difference, locale, company.functional_currency)}</td>
                  <td><Badge kind={r.balanced ? 'success' : 'danger'}>{r.balanced ? L('Équilibré', 'Balanced') : L('Écart', 'Difference')}</Badge></td></tr>)}
                  {recon.rows.length === 0 && <tr><td colSpan={5} className="page-sub">{L('Aucune provision.', 'No provision.')}</td></tr>}</tbody>
              </table></div>
              <p className="page-sub">{recon.note}</p>
            </>}
          </Card>
          <Card title={L('Rapport de mouvements', 'Movement report')}>
            <div className="form-row">
              <Field label={L('Du', 'From')}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label={L('Au', 'To')}><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              <Button onClick={() => void loadReport()}>{L('Calculer', 'Calculate')}</Button>
            </div>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{L('Date', 'Date')}</th><th>{L('Provision', 'Provision')}</th><th>{L('Type', 'Type')}</th><th className="num">{L('Montant', 'Amount')}</th><th>{L('Sens', 'Direction')}</th><th>{L('Statut', 'Status')}</th></tr></thead>
              <tbody>{movementsReport.map((m) => <tr key={m.id}><td>{m.movementDate}</td><td className="mono">{m.provisionNo}</td>
                <td>{movementLabel(m.movementType, en)}</td><td className="num">{money(m.amount, locale, company.functional_currency)}</td>
                <td>{m.direction === 'increase' ? '+' : '−'}</td><td><Badge kind={movementKind(m.status)}>{m.status}</Badge></td></tr>)}
                {movementsReport.length === 0 && <tr><td colSpan={6} className="page-sub">{L('Aucun mouvement sur la période.', 'No movement in the period.')}</td></tr>}</tbody>
            </table></div>
          </Card>
        </>
      )}

      <Modal open={createOpen} title={L('Nouvelle provision', 'New provision')} onClose={() => setCreateOpen(false)} wide>
        <div className="form-row">
          <Field label={L('Catégorie', 'Category')}><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c, en)}</option>)}</select></Field>
          <Field label={L('Date de reconnaissance', 'Recognition date')}><input type="date" value={form.recognitionDate} onChange={(e) => setForm({ ...form, recognitionDate: e.target.value })} /></Field>
          <Field label={L('Preuve', 'Evidence reference')}><input value={form.evidenceRef} onChange={(e) => setForm({ ...form, evidenceRef: e.target.value })} /></Field>
        </div>
        <Field label={L('Description', 'Description')}><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label={L('Hypothèses de mesure', 'Measurement basis')}><textarea rows={2} value={form.measurementBasis} onChange={(e) => setForm({ ...form, measurementBasis: e.target.value })} /></Field>
        <div className="form-row">
          <Field label={L('Compte de charge', 'Expense account')}><select value={form.expenseAccountId} onChange={(e) => setForm({ ...form, expenseAccountId: e.target.value })}>{activeAccounts.filter((a) => a.type === 'expense').map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></Field>
          <Field label={L('Compte de provision', 'Provision account')}><select value={form.provisionAccountId} onChange={(e) => setForm({ ...form, provisionAccountId: e.target.value })}>{activeAccounts.filter((a) => a.type === 'liability').map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></Field>
          <Field label={L('Journal', 'Journal')}><select value={form.journalId} onChange={(e) => setForm({ ...form, journalId: e.target.value })}>{activeJournals.map((j) => <option key={j.id} value={j.id}>{j.code}</option>)}</select></Field>
        </div>
        <div className="form-row">
          <Field label={L('Part courante', 'Current portion')}><input type="number" min="0" step="0.0001" value={form.currentPortion} onChange={(e) => setForm({ ...form, currentPortion: e.target.value })} /></Field>
          <Field label={L('Part non courante', 'Non-current portion')}><input type="number" min="0" step="0.0001" value={form.nonCurrentPortion} onChange={(e) => setForm({ ...form, nonCurrentPortion: e.target.value })} /></Field>
          <Field label={L('Montant initial proposé', 'Proposed initial amount')} hint={L('Crée un mouvement de reconnaissance à approuver, jamais une écriture directe.', 'Creates a recognition movement to approve, never a direct entry.')}><input type="number" min="0" step="0.0001" value={form.initialAmount} onChange={(e) => setForm({ ...form, initialAmount: e.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label={L('Motif initial', 'Initial reason')}><input value={form.initialReason} onChange={(e) => setForm({ ...form, initialReason: e.target.value })} /></Field>
          <Field label={L('Justificatif du mouvement', 'Movement document')}><input value={form.documentRef} onChange={(e) => setForm({ ...form, documentRef: e.target.value })} /></Field>
        </div>
        <Button variant="primary" disabled={busy} onClick={() => void create()}>{L('Créer la provision', 'Create provision')}</Button>
      </Modal>

      <Modal open={movementOpen} title={L('Nouveau mouvement de provision', 'New provision movement')} onClose={() => setMovementOpen(false)} wide>
        <div className="form-row">
          <Field label={L('Type', 'Type')}><select value={movementForm.movementType} onChange={(e) => setMovementForm({ ...movementForm, movementType: e.target.value, direction: e.target.value === 'revision' ? 'increase' : 'decrease' })}>{['recognition', 'revision', 'utilisation', 'reversal'].map((m) => <option key={m} value={m}>{movementLabel(m, en)}</option>)}</select></Field>
          <Field label={L('Date', 'Date')}><input type="date" value={movementForm.movementDate} onChange={(e) => setMovementForm({ ...movementForm, movementDate: e.target.value })} /></Field>
          <Field label={L('Montant', 'Amount')}><input type="number" min="0" step="0.0001" value={movementForm.amount} onChange={(e) => setMovementForm({ ...movementForm, amount: e.target.value })} /></Field>
          {movementForm.movementType === 'revision' && <Field label={L('Sens', 'Direction')}><select value={movementForm.direction} onChange={(e) => setMovementForm({ ...movementForm, direction: e.target.value })}><option value="increase">{L('Augmentation', 'Increase')}</option><option value="decrease">{L('Diminution', 'Decrease')}</option></select></Field>}
        </div>
        <Field label={L('Motif documenté', 'Documented reason')}><textarea rows={2} value={movementForm.reason} onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })} /></Field>
        <div className="form-row">
          <Field label={L('Justificatif', 'Document reference')}><input value={movementForm.documentRef} onChange={(e) => setMovementForm({ ...movementForm, documentRef: e.target.value })} /></Field>
          <Field label={L('Journal', 'Journal')}><select value={movementForm.journalId} onChange={(e) => setMovementForm({ ...movementForm, journalId: e.target.value })}>{activeJournals.map((j) => <option key={j.id} value={j.id}>{j.code}</option>)}</select></Field>
          {movementForm.movementType === 'utilisation' && <Field label={L('Contrepartie', 'Counterpart account')}><select value={movementForm.counterpartAccountId} onChange={(e) => setMovementForm({ ...movementForm, counterpartAccountId: e.target.value })}><option value="">—</option>{activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></Field>}
        </div>
        <Button variant="primary" disabled={busy} onClick={() => void addMovement()}>{L('Proposer le mouvement', 'Propose movement')}</Button>
      </Modal>

      <Modal open={!!decision} title={decision?.title ?? ''} onClose={() => setDecision(null)}>
        <p className="page-sub">{decision?.action === 'post' ? L('La comptabilisation est définitive et reste dans la période ouverte.', 'Posting is final and remains in the open period.') : L('Une note humaine d’au moins 10 caractères est requise.', 'A human note of at least 10 characters is required.')}</p>
        {decision?.action !== 'post' && <Field label={L('Note / motif', 'Note / reason')}><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
        <Button variant="primary" disabled={busy} onClick={() => void confirmDecision()}>{L('Confirmer', 'Confirm')}</Button>
      </Modal>
    </div>
  );
}
