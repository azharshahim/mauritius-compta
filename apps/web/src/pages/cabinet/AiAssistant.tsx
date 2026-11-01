import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Spinner } from '../../components/ui';
import { demoEnabled } from '../../demo/mode';

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  is_active: boolean;
}

interface Suggestion {
  id: string;
  input_text: string;
  amount: string | null;
  currency: string | null;
  suggested_account_code: string | null;
  category: string | null;
  rationale: string | null;
  confidence: number | null;
  status: 'proposed' | 'accepted' | 'modified' | 'rejected';
  source: 'provider' | 'rule';
  provider: string | null;
  model: string | null;
  created_at: string;
  account: { id: string; code: string; name: string } | null;
  decidedAccount: { id: string; code: string; name: string } | null;
}

interface Rule {
  id: string;
  keyword: string;
  accountId: string;
  code: string;
  name: string;
  useCount: number;
}

export default function AiAssistantPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('MUR');
  const [current, setCurrent] = useState<Suggestion | null>(null);

  const [chosenAccount, setChosenAccount] = useState('');
  const [createRule, setCreateRule] = useState(true);
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    try {
      const [accountRes, suggestionRes, ruleRes] = await Promise.all([
        api.get<{ accounts: Account[] }>(`/companies/${company.id}/accounts`),
        api.get<{ suggestions: Suggestion[] }>(`/companies/${company.id}/ai/suggestions`),
        api.get<{ rules: Rule[] }>(`/companies/${company.id}/ai/rules`),
      ]);
      setAccounts(accountRes.accounts.filter((a) => a.is_active));
      setSuggestions(suggestionRes.suggestions);
      setRules(ruleRes.rules);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setLoading(false);
    }
  }, [company?.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  const propose = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setCurrent(null);
    try {
      const res = await api.post<{ suggestion: Suggestion; entryCreated: boolean }>(
        `/companies/${company.id}/ai/suggestions/account`,
        {
          description,
          ...(amount ? { amount } : {}),
          currency,
        },
      );
      setCurrent(res.suggestion);
      setChosenAccount(res.suggestion.account?.id ?? '');
      setKeyword('');
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: 'accepted' | 'modified' | 'rejected') => {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/companies/${company.id}/ai/suggestions/${current.id}/decision`, {
        decision,
        ...(decision === 'modified' ? { accountId: chosenAccount } : {}),
        ...(decision !== 'rejected' ? { createRule } : {}),
        ...(decision !== 'rejected' && createRule && keyword ? { keyword } : {}),
      });
      setNotice(t('ai.assistant.decided'));
      setCurrent(null);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const removeRule = async (rule: Rule) => {
    if (!window.confirm(t('ai.assistant.ruleDeleteConfirm'))) return;
    setBusy(true);
    try {
      await api.del(`/companies/${company.id}/ai/rules/${rule.id}`);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('ai.assistant.title')}</h1>
          <div className="page-sub">{t('ai.assistant.sub')}</div>
        </div>
      </div>

      {demoEnabled && <div className="banner banner-warning">{t('ai.demoNotice')}</div>}
      <ErrorBanner message={error} />
      {notice && <div className="alert alert-info">{notice}</div>}

      <Card title={t('ai.assistant.new')}>
        <div className="form-grid">
          <Field label={t('ai.assistant.description')} hint={t('ai.assistant.descriptionHint')}>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('ai.assistant.descriptionPlaceholder')}
              maxLength={500}
            />
          </Field>
          <Field label={t('ai.assistant.amount')}>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="2500.00"
            />
          </Field>
          <Field label={t('common.currency')}>
            <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
          </Field>
        </div>
        <Button variant="primary" onClick={() => void propose()} disabled={busy || description.trim().length < 3}>
          {t('ai.assistant.propose')}
        </Button>
        <p className="muted">{t('ai.assistant.noPosting')}</p>
      </Card>

      {current && (
        <Card title={t('ai.assistant.proposal')}>
          <div className="suggestion-head">
            <div>
              <div className="page-sub">{t('ai.assistant.account')}</div>
              <div className="suggestion-account">
                {current.account ? `${current.account.code} — ${current.account.name}` : t('ai.assistant.noAccount')}
              </div>
            </div>
            <div className="row-actions">
              <Badge kind="warning">{t('ai.status.proposed')}</Badge>
              {current.confidence !== null && (
                <Badge kind="info">
                  {t('ai.assistant.confidence')} {Math.round(current.confidence * 100)} %
                </Badge>
              )}
              <Badge>{current.source === 'rule' ? t('ai.source.rule') : t('ai.source.provider')}</Badge>
            </div>
          </div>
          {current.category && (
            <p>
              <strong>{t('ai.assistant.category')} :</strong> {current.category}
            </p>
          )}
          {current.rationale && <p className="muted">{current.rationale}</p>}

          <div className="form-grid">
            <Field label={t('ai.assistant.modifyTo')}>
              <select value={chosenAccount} onChange={(e) => setChosenAccount(e.target.value)}>
                <option value="">{t('ai.assistant.choose')}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('ai.assistant.rule')} hint={t('ai.assistant.ruleHint')}>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t('ai.assistant.rulePlaceholder')}
                maxLength={60}
              />
            </Field>
          </div>
          <label className="inline">
            <input
              type="checkbox"
              checked={createRule}
              onChange={(e) => setCreateRule(e.target.checked)}
            />
            {t('ai.assistant.saveRule')}
          </label>

          <div className="modal-actions">
            <Button variant="ghost" onClick={() => void decide('rejected')} disabled={busy}>
              {t('ai.assistant.reject')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void decide('modified')}
              disabled={busy || !chosenAccount || chosenAccount === current.account?.id}
            >
              {t('ai.assistant.modify')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void decide('accepted')}
              disabled={busy || !current.account}
            >
              {t('ai.assistant.accept')}
            </Button>
          </div>
        </Card>
      )}

      <Card title={t('ai.assistant.history')}>
        {loading && suggestions.length === 0 ? (
          <Spinner label={t('common.loading')} />
        ) : suggestions.length === 0 ? (
          <EmptyState title={t('ai.assistant.empty')} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('ai.assistant.description')}</th>
                  <th>{t('ai.assistant.account')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('ai.assistant.source')}</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.input_text}
                      {s.amount && (
                        <div className="page-sub">
                          {s.amount} {s.currency ?? ''}
                        </div>
                      )}
                    </td>
                    <td className="mono">
                      {s.account
                        ? `${s.account.code} — ${s.account.name}`
                        : s.decidedAccount
                          ? `${s.decidedAccount.code} — ${s.decidedAccount.name}`
                          : '—'}
                    </td>
                    <td>
                      <Badge
                        kind={
                          s.status === 'accepted'
                            ? 'success'
                            : s.status === 'modified'
                              ? 'info'
                              : s.status === 'rejected'
                                ? 'danger'
                                : 'warning'
                        }
                      >
                        {t(`ai.status.${s.status}`)}
                      </Badge>
                    </td>
                    <td className="page-sub">
                      {s.source === 'rule' ? t('ai.source.rule') : `${s.provider ?? '—'}`}
                      <div>{new Date(s.created_at).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB')}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={t('ai.assistant.rules')}>
        <p className="muted">{t('ai.assistant.rulesHint')}</p>
        {rules.length === 0 ? (
          <EmptyState title={t('ai.assistant.noRules')} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('ai.assistant.keyword')}</th>
                  <th>{t('ai.assistant.account')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>{rule.keyword}</td>
                    <td className="mono">
                      {rule.code} — {rule.name}
                    </td>
                    <td>
                      <Button variant="ghost" onClick={() => void removeRule(rule)} disabled={busy}>
                        {t('common.delete')}
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
  );
}
