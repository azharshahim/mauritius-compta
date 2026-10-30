import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, setApiLocale } from './api';
import { useI18n, type Locale } from './i18n';

export interface User {
  id: string;
  email: string;
  fullName: string;
  locale: Locale;
}

export interface Company {
  id: string;
  name: string;
  brn: string | null;
  vat_number: string | null;
  registered_address: string | null;
  business_activity: string | null;
  financial_year_start: string;
  financial_year_end: string;
  functional_currency: string;
  presentation_currency: string;
  accounting_standard: string;
  status: 'active' | 'inactive' | 'archived';
  locale: Locale;
  role?: string;
  accounts_count?: number;
}

interface SessionValue {
  user: User | null;
  initialized: boolean;
  companies: Company[];
  company: Company | null;
  setCompany: (id: string) => void;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (patch: { fullName?: string; locale?: Locale; currentPassword?: string; newPassword?: string }) => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { locale, setLocale } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(() => localStorage.getItem('mc.companyId'));

  const loadCompanies = useCallback(async () => {
    const res = await api.get<{ companies: Company[] }>('/companies');
    setCompanies(res.companies);
    const stored = localStorage.getItem('mc.companyId');
    const valid = res.companies.find((c) => c.id === stored);
    const chosen = valid ?? res.companies[0] ?? null;
    setCompanyId(chosen?.id ?? null);
    if (chosen) localStorage.setItem('mc.companyId', chosen.id);
    else localStorage.removeItem('mc.companyId');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ user: User }>('/auth/me');
      setUser(me.user);
      setApiLocale(me.user.locale);
      await loadCompanies();
    } catch {
      setUser(null);
      setCompanies([]);
    } finally {
      setInitialized(true);
    }
  }, [loadCompanies]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setApiLocale(locale);
  }, [locale]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<{ user: User }>('/auth/login', { email, password, locale });
      setUser(res.user);
      setLocale(res.user.locale);
      await loadCompanies();
      setInitialized(true);
    },
    [loadCompanies, locale, setLocale],
  );

  const register = useCallback(
    async (email: string, password: string, fullName: string) => {
      const res = await api.post<{ user: User }>('/auth/register', {
        email,
        password,
        fullName,
        locale,
      });
      setUser(res.user);
      await loadCompanies();
      setInitialized(true);
    },
    [loadCompanies, locale],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
    setCompanies([]);
    setCompanyId(null);
    localStorage.removeItem('mc.companyId');
  }, []);

  const updateUser = useCallback(
    async (patch: { fullName?: string; locale?: Locale; currentPassword?: string; newPassword?: string }) => {
      const res = await api.patch<{ user: User }>('/auth/me', patch);
      setUser(res.user);
      if (patch.locale) setLocale(patch.locale);
    },
    [setLocale],
  );

  const setCompany = useCallback((id: string) => {
    setCompanyId(id);
    localStorage.setItem('mc.companyId', id);
  }, []);

  const company = useMemo(
    () => companies.find((c) => c.id === companyId) ?? companies[0] ?? null,
    [companies, companyId],
  );

  const value = useMemo(
    () => ({
      user,
      initialized,
      companies,
      company,
      setCompany,
      refresh,
      login,
      register,
      logout,
      updateUser,
    }),
    [user, initialized, companies, company, setCompany, refresh, login, register, logout, updateUser],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

export function errorMessage(err: unknown, fallback: string): { code: string; message: string } {
  if (err instanceof ApiError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: 'ERROR', message: err.message };
  return { code: 'ERROR', message: fallback };
}
