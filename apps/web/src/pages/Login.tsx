import { useState } from 'react';
import { useI18n } from '../i18n';
import { errorMessage, useSession } from '../store';
import { Button, ErrorBanner } from '../components/ui';

export default function LoginPage() {
  const { t } = useI18n();
  const { login, register } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, fullName);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <section className="auth-hero">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name" style={{ fontSize: '1.1rem' }}>
              {t('app.name')}
            </div>
            <div className="brand-tag">{t('app.tagline')}</div>
          </div>
        </div>
        <h1>
          {t('app.name')}
          <br />
          <span style={{ fontSize: '1.1rem', fontWeight: 500, opacity: 0.85 }}>
            {t('app.tagline')}
          </span>
        </h1>
        <p>
          {t('dashboard.balanceOk')} · MUR · EUR · USD · GBP · FR / EN
        </p>
        <ul>
          <li>{t('nav.accounts')} · {t('nav.entries')}</li>
          <li>{t('nav.ledger')} · {t('nav.trialBalance')}</li>
          <li>{t('nav.statements')} · PDF / CSV</li>
        </ul>
        <p style={{ fontSize: '0.76rem', opacity: 0.7 }}>{t('common.demoNotice')}</p>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="card">
            <div className="card-body">
              <h2 style={{ marginBottom: 4 }}>
                {mode === 'login' ? t('login.title') : t('login.registerTitle')}
              </h2>
              <p className="page-sub" style={{ marginTop: 0 }}>
                {t('login.subtitle')}
              </p>
              <ErrorBanner message={error} />
              <form onSubmit={submit}>
                {mode === 'register' && (
                  <label className="field">
                    <span className="field-label">{t('login.fullName')}</span>
                    <input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                      autoComplete="name"
                    />
                  </label>
                )}
                <label className="field">
                  <span className="field-label">{t('login.email')}</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    inputMode="email"
                  />
                </label>
                <label className="field">
                  <span className="field-label">{t('login.password')}</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={mode === 'register' ? 10 : 1}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                  {mode === 'register' && (
                    <span className="field-hint">10+ characters, letters and digits.</span>
                  )}
                </label>
                <Button type="submit" variant="primary" disabled={busy} className="btn-block">
                  {busy ? t('common.loading') : mode === 'login' ? t('login.submit') : t('login.register')}
                </Button>
              </form>
              <div className="auth-foot">
                <button
                  className="btn btn-link"
                  onClick={() => {
                    setMode(mode === 'login' ? 'register' : 'login');
                    setError(null);
                  }}
                >
                  {mode === 'login' ? t('login.noAccount') : t('login.haveAccount')}
                </button>
              </div>
            </div>
          </div>
          <p className="auth-foot">{t('login.demoHint')}</p>
        </div>
      </section>
    </div>
  );
}
