/**
 * Mission 34 — Settings → Data Management.
 *
 * Every button reflects a real server capability. Nothing is simulated:
 * restore is disabled here on purpose and remains an offline CLI operation.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadProtectedFile } from '../../api';
import { demoEnabled } from '../../demo/mode';
import { errorMessage, useSession } from '../../store';
import { useI18n } from '../../i18n';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Spinner } from '../../components/ui';
import { dateTime } from '../../format';

interface BackupRun {
  id: string;
  kind: 'global_backup' | 'company_export';
  companyId: string | null;
  status: 'running' | 'completed' | 'verified' | 'failed';
  archiveName: string | null;
  archiveSha256: string | null;
  archiveBytes: number | null;
  startedAt: string;
  completedAt: string | null;
  verifiedAt: string | null;
  errorCode: string | null;
}

interface Status {
  enabled: boolean;
  reason: string | null;
  globalBackupEnabled: boolean;
  exportEnabled: boolean;
  authorized: boolean;
  restore: { available: boolean; mode: string; reason: string; enabledByConfiguration: boolean };
}

const ADMIN_ROLES = new Set(['owner', 'admin', 'cabinet_admin']);

function bytes(value: number | null): string {
  if (value === null) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DataManagementPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [backups, setBackups] = useState<BackupRun[]>([]);
  const [exports, setExports] = useState<BackupRun[]>([]);
  const [loading, setLoading] = useState(!demoEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const role = (company as { role?: string } | null)?.role ?? 'viewer';
  const isCompanyAdmin = ADMIN_ROLES.has(role);

  const reload = async () => {
    if (demoEnabled) {
      setLoading(false);
      return;
    }
    try {
      const current = await api.get<Status>('/admin/backup/status');
      setStatus(current);
      if (current.authorized) {
        const list = await api.get<{ backups: BackupRun[] }>('/admin/backups');
        setBackups(list.backups);
      } else {
        setBackups([]);
      }
      if (company && isCompanyAdmin) {
        const list = await api.get<{ exports: BackupRun[] }>(`/companies/${company.id}/exports`);
        setExports(list.exports);
      } else {
        setExports([]);
      }
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id, isCompanyAdmin]);

  const run = async (task: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await task());
      await reload();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const createBackup = () => run(async () => {
    const result = await api.post<{ backup: BackupRun }>('/admin/backups');
    return `${t('data.created')} ${result.backup.archiveName ?? ''}`;
  });

  const createExport = () => {
    if (!company) return;
    return run(async () => {
      const result = await api.post<{ export: BackupRun }>(`/companies/${company.id}/exports`);
      return `${t('data.exportCreated')} ${result.export.archiveName ?? ''}`;
    });
  };

  const verifyGlobal = (id: string) => run(async () => {
    const result = await api.post<{ rows: number; tables: number }>(`/admin/backups/${id}/verify`);
    return `${t('data.verified')} ${result.tables} ${t('data.tables')}, ${result.rows} ${t('data.rows')}`;
  });

  const verifyExport = (id: string) => {
    if (!company) return Promise.resolve();
    return run(async () => {
      const result = await api.post<{ rows: number; tables: number }>(
        `/companies/${company.id}/exports/${id}/verify`,
      );
      return `${t('data.verified')} ${result.tables} ${t('data.tables')}, ${result.rows} ${t('data.rows')}`;
    });
  };

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  const exportsAvailable = demoEnabled ? false : Boolean(status?.exportEnabled && isCompanyAdmin);
  const globalAvailable = demoEnabled ? false : Boolean(status?.globalBackupEnabled && status?.authorized);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('data.title')}</h1>
          <div className="page-sub">{t('data.subtitle')}</div>
        </div>
        <Link className="btn btn-ghost" to="/accounting/settings">{t('data.back')}</Link>
      </div>
      <DemoNotice />
      {loading && <Spinner label={t('common.loading')} />}
      {message && <div className="alert alert-success">{message}</div>}
      <ErrorBanner message={error} />

      <div className="alert alert-warn">{t('data.securityNotice')}</div>
      {demoEnabled && <div className="alert alert-info">{t('data.demoUnavailable')}</div>}
      {!demoEnabled && status?.enabled === false && (
        <div className="alert alert-warn">
          {t('data.notConfigured')} {status.reason ? `(${status.reason})` : ''}
        </div>
      )}

      <Card
        title={t('data.backup')}
        actions={
          <Button variant="primary" disabled={!globalAvailable || busy} onClick={() => void createBackup()}>
            {t('data.createBackup')}
          </Button>
        }
      >
        <p className="page-sub">{t('data.backupHint')}</p>
        {!demoEnabled && status && !status.authorized && (
          <div className="alert alert-info">{t('data.backupForbidden')}</div>
        )}
        {backups.length === 0 ? (
          <EmptyState title={t('data.noBackups')} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('data.startedAt')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('data.size')}</th>
                  <th>SHA-256</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {backups.map((row) => (
                  <tr key={row.id}>
                    <td>{dateTime(row.startedAt, locale)}</td>
                    <td>
                      <Badge kind={row.status === 'failed' ? 'danger' : row.status === 'verified' ? 'success' : 'neutral'}>
                        {t(`data.status.${row.status}`)}
                      </Badge>
                    </td>
                    <td>{bytes(row.archiveBytes)}</td>
                    <td><code>{row.archiveSha256?.slice(0, 12) ?? '—'}</code></td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <Button
                          variant="ghost"
                          disabled={busy || !globalAvailable || row.status === 'failed'}
                          onClick={() => void verifyGlobal(row.id)}
                        >
                          {t('data.verify')}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy || !globalAvailable || !row.archiveName}
                          onClick={() => void run(async () => {
                            await downloadProtectedFile(`/admin/backups/${row.id}/download`, row.archiveName!);
                            return t('data.downloaded');
                          })}
                        >
                          {t('data.download')}
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

      <Card
        title={t('data.exportCompany')}
        actions={
          <Button disabled={!exportsAvailable || busy} onClick={() => void createExport()}>
            {t('data.createExport')}
          </Button>
        }
      >
        <p className="page-sub">{t('data.exportHint')}</p>
        <div className="alert alert-warn">{t('data.exportNotRestorable')}</div>
        {exports.length === 0 ? (
          <EmptyState title={t('data.noExports')} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('data.startedAt')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('data.size')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {exports.map((row) => (
                  <tr key={row.id}>
                    <td>{dateTime(row.startedAt, locale)}</td>
                    <td>
                      <Badge kind={row.status === 'failed' ? 'danger' : row.status === 'verified' ? 'success' : 'neutral'}>
                        {t(`data.status.${row.status}`)}
                      </Badge>
                    </td>
                    <td>{bytes(row.archiveBytes)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <Button variant="ghost" disabled={busy || !exportsAvailable} onClick={() => void verifyExport(row.id)}>
                          {t('data.verify')}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy || !exportsAvailable || !row.archiveName}
                          onClick={() => void run(async () => {
                            await downloadProtectedFile(
                              `/companies/${company.id}/exports/${row.id}/download`,
                              row.archiveName!,
                            );
                            return t('data.downloaded');
                          })}
                        >
                          {t('data.download')}
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

      <Card title={t('data.restore')}>
        <p className="page-sub">{t('data.restoreCliOnly')}</p>
        <Button disabled title={t('data.restoreDisabled')}>
          {t('data.restore')}
        </Button>
        <div className="alert alert-warn" style={{ marginTop: 12 }}>
          {t('data.restoreWarning')}
        </div>
      </Card>
    </>
  );
}
