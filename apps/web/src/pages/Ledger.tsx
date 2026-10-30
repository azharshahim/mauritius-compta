import { useState } from 'react';
import { api, downloadExport, qs } from '../api';
import { useI18n } from '../i18n';
import { useSession } from '../store';
import { useAsync } from '../hooks';
import { Button, Card, DemoNotice, EmptyState, ErrorBanner, Spinner } from '../components/ui';
import { date, money } from '../format';

interface LedgerAccount {
  accountId: string;
  code: string;
  name: string;
  opening: string;
  totalDebit: string;
  totalCredit: string;
  closing: string;
  lines: {
    entryId: string;
    entryNo: string;
    date: string;
    journal: string;
    reference: string | null;
    description: string;
    debit: string;
    credit: string;
    balance: string;
  }[];
}

interface LedgerResponse {
  from: string;
  to: string;
  currency: string;
  accounts: LedgerAccount[];
  totals: { debit: string; credit: string };
}

export default function LedgerPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const [accountId, setAccountId] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: accountsMeta } = useAsync<{ accounts: { id: string; code: string; name: string }[] } | null>(
    () =>
      company
        ? api.get<{ accounts: { id: string; code: string; name: string }[] }>(
            `/companies/${company.id}/accounts`,
          )
        : Promise.resolve(null),
    [company?.id],
  );

  const { data, loading, error } = useAsync<LedgerResponse | null>(
    () =>
      company
        ? api.get<LedgerResponse>(`/companies/${company.id}/reports/ledger${qs({ accountId, search, from, to })}`)
        : Promise.resolve(null),
    [company?.id, accountId, search, from, to],
  );

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  const exportPath = `/companies/${company.id}/reports/ledger${qs({ accountId, search, from, to })}`;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('ledger.title')}</h1>
          <div className="page-sub">
            {company.name} · {company.functional_currency}
          </div>
        </div>
        <Button onClick={() => void downloadExport(exportPath, 'ledger.csv', 'csv')}>
          {t('common.exportCsv')}
        </Button>
        <Button onClick={() => void downloadExport(exportPath, 'ledger.pdf', 'pdf')}>
          {t('common.exportPdf')}
        </Button>
      </div>
      <DemoNotice />

      <Card>
        <div className="form-row" style={{ marginBottom: 6 }}>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ maxWidth: 280 }}>
            <option value="">{t('ledger.selectAccount')}</option>
            {(accountsMeta?.accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
          <input
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 220 }}
          />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 160 }} aria-label={t('common.from')} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 160 }} aria-label={t('common.to')} />
        </div>
        <ErrorBanner message={error} />
        {loading ? (
          <Spinner />
        ) : (data?.accounts.length ?? 0) === 0 ? (
          <EmptyState title={t('ledger.empty')} />
        ) : (
          <>
            {data?.accounts.map((account) => (
              <div key={account.accountId} className="ledger-account">
                <h3>
                  <span className="mono">{account.code}</span> — {account.name}
                </h3>
                <div className="ledger-meta">
                  {t('ledger.opening')} : {money(account.opening, locale, data.currency)} ·{' '}
                  {t('ledger.closing')} : <strong>{money(account.closing, locale, data.currency)}</strong>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('common.date')}</th>
                        <th>{t('entries.journal')}</th>
                        <th>{t('common.reference')}</th>
                        <th>{t('common.description')}</th>
                        <th className="num">{t('common.debit')}</th>
                        <th className="num">{t('common.credit')}</th>
                        <th className="num">{t('common.balance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {account.lines.map((line, index) => (
                        <tr key={`${line.entryId}-${index}`}>
                          <td>{date(line.date, locale)}</td>
                          <td>{line.journal}</td>
                          <td className="mono">{line.reference ?? line.entryNo}</td>
                          <td>{line.description}</td>
                          <td className="num">{line.debit !== '0.0000' ? money(line.debit, locale) : ''}</td>
                          <td className="num">{line.credit !== '0.0000' ? money(line.credit, locale) : ''}</td>
                          <td className="num">{money(line.balance, locale)}</td>
                        </tr>
                      ))}
                      <tr className="total-row">
                        <td colSpan={4}>{t('common.total')}</td>
                        <td className="num">{money(account.totalDebit, locale)}</td>
                        <td className="num">{money(account.totalCredit, locale)}</td>
                        <td className="num">{money(account.closing, locale)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <div className="entry-totals" style={{ padding: '14px 16px' }}>
              <span>
                {t('entries.totalDebit')} : <strong>{money(data?.totals.debit ?? '0', locale)}</strong>
              </span>
              <span>
                {t('common.credit')} : <strong>{money(data?.totals.credit ?? '0', locale)}</strong>
              </span>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
