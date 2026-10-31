import { useMemo, useState } from 'react';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { useAsync } from '../../hooks';
import { Badge, Button, Card, ErrorBanner, EmptyState, Field, Modal, Spinner } from '../../components/ui';
import { date, dateTime, today } from '../../format';

const CATEGORIES = [
  'accounting',
  'vat',
  'tax',
  'payroll',
  'financial_statements',
  'administrative',
] as const;
const STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export interface TaskRow {
  id: string;
  company_id: string;
  company_name?: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  due_date: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
  completed_at: string | null;
}

interface TaskDetail {
  task: TaskRow;
  comments: { id: string; body: string; created_at: string; author_name: string | null }[];
  history: { id: number; action: string; created_at: string; user_name: string | null }[];
}

interface Team {
  collaborators: {
    userId: string;
    fullName: string;
    assignments: { companyId: string; companyName: string; role: string }[];
  }[];
}

const emptyTask = {
  companyId: '',
  title: '',
  description: '',
  category: 'accounting' as string,
  priority: 'normal' as string,
  status: 'todo' as string,
  dueDate: '',
  assignedTo: '',
};

export default function TasksPage() {
  const { t, locale } = useI18n();
  const { companies, company } = useSession();
  const [status, setStatus] = useState('open');
  const [category, setCategory] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('');
  const [overdue, setOverdue] = useState(false);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [form, setForm] = useState({ ...emptyTask, companyId: company?.id ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [comment, setComment] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status !== 'open') params.set('status', status);
    if (category !== 'all') params.set('category', category);
    if (companyFilter) params.set('companyId', companyFilter);
    if (overdue) params.set('overdue', '1');
    return params.toString();
  }, [status, category, companyFilter, overdue]);

  const { data, loading, error: loadError, reload } = useAsync<{ tasks: TaskRow[] } | null>(
    () => api.get<{ tasks: TaskRow[] }>(`/cabinet/tasks${query ? `?${query}` : ''}`),
    [query],
  );

  const { data: team } = useAsync<Team | null>(() => api.get<Team>('/cabinet/team'), []);

  const tasks = (data?.tasks ?? []).filter((task) =>
    status === 'open' ? !['done', 'cancelled'].includes(task.status) : true,
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyTask, companyId: companyFilter || company?.id || companies[0]?.id || '' });
    setError(null);
    setOpen(true);
  };

  const openEdit = (task: TaskRow) => {
    setEditing(task);
    setForm({
      companyId: task.company_id,
      title: task.title,
      description: task.description ?? '',
      category: task.category,
      priority: task.priority,
      status: task.status,
      dueDate: task.due_date ? task.due_date.slice(0, 10) : '',
      assignedTo: task.assigned_to ?? '',
    });
    setError(null);
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      title: form.title,
      description: form.description || null,
      category: form.category,
      priority: form.priority,
      status: form.status,
      dueDate: form.dueDate || null,
      assignedTo: form.assignedTo || null,
    };
    try {
      if (editing) {
        await api.patch(`/companies/${editing.company_id}/tasks/${editing.id}`, payload);
      } else {
        await api.post(`/companies/${form.companyId}/tasks`, payload);
      }
      await reload();
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (task: TaskRow) => {
    setDetailOpen(true);
    setDetail(null);
    setComment('');
    try {
      const res = await api.get<TaskDetail>(
        `/companies/${task.company_id}/tasks/${task.id}`,
      );
      setDetail(res);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    }
  };

  const changeStatus = async (task: TaskRow, next: string) => {
    try {
      await api.patch(`/companies/${task.company_id}/tasks/${task.id}`, { status: next });
      await reload();
      if (detailOpen) await openDetail({ ...task, status: next });
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    }
  };

  const addComment = async () => {
    if (!detail || !comment.trim()) return;
    try {
      await api.post(
        `/companies/${detail.task.company_id}/tasks/${detail.task.id}/comments`,
        { body: comment },
      );
      setComment('');
      await openDetail(detail.task);
      await reload();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    }
  };

  const remove = async (task: TaskRow) => {
    if (!window.confirm(t('cabinet.tasks.deleteConfirm'))) return;
    try {
      await api.del(`/companies/${task.company_id}/tasks/${task.id}`);
      setDetailOpen(false);
      await reload();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    }
  };

  const assignees = form.companyId
    ? (team?.collaborators ?? []).filter((c) =>
        c.assignments.some((a) => a.companyId === form.companyId),
      )
    : (team?.collaborators ?? []);

  const isOverdue = (task: TaskRow) =>
    !!task.due_date &&
    task.due_date.slice(0, 10) < today() &&
    !['done', 'cancelled'].includes(task.status);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('cabinet.tasks.title')}</h1>
          <div className="page-sub">{t('cabinet.tasks.sub')}</div>
        </div>
        <Button variant="primary" onClick={openCreate}>
          + {t('cabinet.tasks.new')}
        </Button>
      </div>

      <ErrorBanner message={loadError ?? error} />

      <Card>
        <div className="filters">
          <Field label={t('cabinet.status')}>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">{t('cabinet.kpi.openTasks')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`cabinet.tasks.status.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('cabinet.category')}>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">{t('cabinet.tasks.allCategories')}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`cabinet.tasks.category.${c}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('cabinet.company')}>
            <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
              <option value="">{t('cabinet.tasks.allCompanies')}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="inline">
            <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
            {t('cabinet.kpi.overdue')}
          </label>
        </div>

        {loading && <Spinner label={t('common.loading')} />}
        {!loading && tasks.length === 0 && <EmptyState title={t('cabinet.tasks.empty')} />}
        {!loading && tasks.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.description')}</th>
                  <th>{t('cabinet.company')}</th>
                  <th>{t('cabinet.category')}</th>
                  <th>{t('cabinet.dueDate')}</th>
                  <th>{t('cabinet.tasks.assignee')}</th>
                  <th>{t('cabinet.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <button className="link-button" onClick={() => void openDetail(task)}>
                        <strong>{task.title}</strong>
                      </button>
                      <div className="page-sub">
                        {t(`cabinet.tasks.priority.${task.priority}`)}
                        {task.description ? ` · ${task.description}` : ''}
                      </div>
                    </td>
                    <td>{task.company_name ?? companies.find((c) => c.id === task.company_id)?.name}</td>
                    <td>{t(`cabinet.tasks.category.${task.category}`)}</td>
                    <td className="mono">
                      {task.due_date ? date(task.due_date, locale) : '—'}
                      {isOverdue(task) && (
                        <>
                          {' '}
                          <Badge kind="danger">{t('cabinet.tasks.overdue')}</Badge>
                        </>
                      )}
                    </td>
                    <td>{task.assignee_name ?? t('cabinet.tasks.unassigned')}</td>
                    <td>
                      <Badge
                        kind={
                          task.status === 'done'
                            ? 'success'
                            : task.status === 'blocked'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {t(`cabinet.tasks.status.${task.status}`)}
                      </Badge>
                    </td>
                    <td>
                      <div className="row-actions">
                        {task.status !== 'done' && (
                          <Button variant="ghost" onClick={() => void changeStatus(task, 'done')}>
                            ✓
                          </Button>
                        )}
                        <Button variant="ghost" onClick={() => openEdit(task)}>
                          {t('common.edit')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        title={editing ? t('cabinet.tasks.edit') : t('cabinet.tasks.new')}
        onClose={() => setOpen(false)}
        wide
      >
        <ErrorBanner message={error} />
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label={t('cabinet.company')}>
              <select
                value={form.companyId}
                onChange={(e) => setForm({ ...form, companyId: e.target.value, assignedTo: '' })}
                disabled={!!editing}
                required
              >
                <option value="">—</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('common.description')}>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                maxLength={200}
              />
            </Field>
            <Field label={t('cabinet.category')}>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`cabinet.tasks.category.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('cabinet.priority')}>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`cabinet.tasks.priority.${p}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('cabinet.dueDate')}>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </Field>
            <Field label={t('cabinet.tasks.assignee')}>
              <select
                value={form.assignedTo}
                onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
              >
                <option value="">{t('cabinet.tasks.unassigned')}</option>
                {assignees.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('cabinet.status')}>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`cabinet.tasks.status.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('common.description')}>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                maxLength={4000}
                aria-label={t('common.description')}
              />
            </Field>
          </div>
          <div className="modal-actions">
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={detailOpen}
        title={detail?.task.title ?? t('cabinet.tasks.detail')}
        onClose={() => setDetailOpen(false)}
        wide
      >
        <ErrorBanner message={error} />
        {!detail && <Spinner label={t('common.loading')} />}
        {detail && (
          <>
            <dl className="definition">
              <dt>{t('cabinet.company')}</dt>
              <dd>{detail.task.company_name ?? detail.task.company_id}</dd>
              <dt>{t('cabinet.category')}</dt>
              <dd>{t(`cabinet.tasks.category.${detail.task.category}`)}</dd>
              <dt>{t('cabinet.status')}</dt>
              <dd>{t(`cabinet.tasks.status.${detail.task.status}`)}</dd>
              <dt>{t('cabinet.dueDate')}</dt>
              <dd>{detail.task.due_date ? date(detail.task.due_date, locale) : '—'}</dd>
              <dt>{t('cabinet.tasks.assignee')}</dt>
              <dd>{detail.task.assignee_name ?? t('cabinet.tasks.unassigned')}</dd>
            </dl>
            {detail.task.description && <p>{detail.task.description}</p>}

            <h3>{t('cabinet.tasks.comments')}</h3>
            {detail.comments.length === 0 && <p className="muted">—</p>}
            <ul className="timeline">
              {detail.comments.map((c) => (
                <li key={c.id}>
                  <span className="timeline-dot" aria-hidden="true" />
                  <div>
                    <div>{c.body}</div>
                    <div className="page-sub">
                      {c.author_name ?? '—'} · {dateTime(c.created_at, locale)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="inline-form">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t('cabinet.tasks.comment')}
                aria-label={t('cabinet.tasks.comment')}
              />
              <Button onClick={() => void addComment()} disabled={!comment.trim()}>
                {t('cabinet.tasks.addComment')}
              </Button>
            </div>

            <h3 style={{ marginTop: 18 }}>{t('cabinet.tasks.history')}</h3>
            <ul className="timeline">
              {detail.history.map((h) => (
                <li key={h.id}>
                  <span className="timeline-dot" aria-hidden="true" />
                  <div>
                    <div>{h.action}</div>
                    <div className="page-sub">
                      {h.user_name ?? '—'} · {dateTime(h.created_at, locale)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="modal-actions">
              <Button variant="danger" onClick={() => void remove(detail.task)}>
                {t('cabinet.tasks.delete')}
              </Button>
              <Button onClick={() => setDetailOpen(false)}>{t('common.close')}</Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
