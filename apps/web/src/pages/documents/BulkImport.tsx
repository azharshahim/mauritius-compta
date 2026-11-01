import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { AppIcon } from '../../components/AppIcon';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Modal, Spinner } from '../../components/ui';

/**
 * Mission 28 — bulk invoice intake.
 *
 * This screen is an orchestration layer over the existing document API:
 * `POST /documents` (same OCR + storage), `PATCH /documents/:id`,
 * `POST /documents/:id/proposal` and the existing human approval endpoint.
 * No accounting rule is reimplemented in the browser and no entry is posted.
 * Files are processed two at a time so a phone is not asked to hold 100 base64
 * payloads in memory at once.
 */

type Side = 'purchase' | 'sale';
type RowState = 'pending' | 'uploading' | 'done' | 'error' | 'preparing' | 'approving' | 'approved';

interface DocumentRow {
  id: string;
  kind: 'purchase' | 'sale' | 'unknown';
  status: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  page_count: number;
  extraction_method: string;
  confidence: string | null;
  party_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  subtotal: string | null;
  vat_total: string | null;
  total_amount: string | null;
  duplicate_of: string | null;
  document_type?: 'invoice' | 'credit_note' | 'unknown' | null;
  discount_total?: string | null;
  purchase_order?: string | null;
  tax_ids?: Record<string, string | null> | null;
  uncertain_fields?: string[] | null;
  field_confidence?: Record<string, number> | null;
  creation_quality?: Record<string, unknown> | null;
  created_at: string;
}

interface ProposalLine {
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  description: string;
  debit: string;
  credit: string;
  needsAccount: boolean;
}

interface Proposal {
  id: string;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED';
  kind: 'purchase' | 'sale';
  party_id: string | null;
  party_name: string | null;
  journal_id: string | null;
  entry_date: string;
  currency: string;
  lines: ProposalLine[];
  balanced: boolean;
  uncertain_fields: string[];
  draft_entry_id: string | null;
}

interface Correction {
  party_name: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  currency: string;
  subtotal: string;
  vat_total: string;
  total_amount: string;
}

interface BulkRow {
  key: string;
  fileName: string;
  file?: File;
  document?: DocumentRow;
  proposal?: Proposal;
  proposalStale?: boolean;
  correction: Correction;
  state: RowState;
  progress: number;
  error?: string;
  actionError?: string;
  selected: boolean;
  entryNo?: string;
}

interface BulkResult {
  key: string;
  fileName: string;
  ok: boolean;
  message: string;
}

interface DocumentRule {
  id: string;
  kind: 'purchase' | 'sale';
  party_key: string;
  keyword_key: string;
  account_id: string;
  account_code: string | null;
  account_name: string | null;
  usage_count: number;
  last_used_at: string;
  is_active: boolean;
}

interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
  is_active: boolean;
}

type Filter = 'all' | 'ready' | 'review' | 'duplicates' | 'errors';

const MAX_FILES = 100;
const MAX_BYTES = 8 * 1024 * 1024;
const CONCURRENCY = 2;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const L = {
  fr: {
    title: 'Import groupé de factures',
    subtitle: 'Déposez plusieurs PDF ou images. Chaque document garde son résultat, ses erreurs et sa traçabilité.',
    back: 'Retour au journal',
    drop: 'Déposer les factures ici ou choisir plusieurs fichiers',
    dropHint: 'PDF, JPG, JPEG, PNG · 8 Mo par fichier · jusqu’à 100 fichiers',
    choose: 'Choisir des fichiers',
    privacy: 'Les fichiers restent dans le stockage privé de la société. L’OCR est le moteur existant ; aucun second moteur n’est utilisé.',
    globalProgress: 'Progression globale',
    processed: 'traités',
    retry: 'Réessayer les échecs',
    reload: 'Charger la file d’attente',
    queueLoading: 'Chargement de la file…',
    filters: 'Filtres',
    all: 'Tous',
    ready: 'Prêts à valider',
    review: 'À vérifier',
    duplicates: 'Doublons',
    errors: 'Erreurs',
    file: 'Fichier',
    party: 'Fournisseur / client',
    invoiceNo: 'N° facture',
    invoiceDate: 'Date',
    currency: 'Devise',
    subtotal: 'HT',
    vat: 'TVA',
    total: 'TTC',
    account: 'Compte proposé',
    status: 'Statut',
    confidence: 'Confiance',
    actions: 'Actions',
    pages: 'pages',
    multipage: 'PDF multipage — vérifier sans découpage automatique',
    duplicate: 'Doublon',
    duplicateHint: 'Fichier ou facture déjà présent : aucune proposition ne sera créée.',
    uncertain: 'Champs à vérifier',
    creditNote: 'Avoir',
    noValue: '—',
    editHint: 'Les champs surlignés sont modifiables avant validation.',
    save: 'Enregistrer les corrections',
    saved: 'Corrections enregistrées.',
    open: 'Ouvrir le document',
    uploadFailed: 'Échec de l’import',
    prepare: 'Préparer les propositions',
    preparing: 'Préparation des propositions…',
    validate: 'Créer les brouillons sélectionnés',
    selecting: 'sélectionné(s)',
    selectAll: 'Tout sélectionner',
    clearSelection: 'Tout désélectionner',
    prepareHelp: 'La préparation ne crée aucune écriture : elle calcule une proposition modifiable.',
    approveHelp: 'La validation humaine crée des brouillons, jamais des écritures validées. Les contrôles de période, d’équilibre, de devise et de permission restent ceux du serveur.',
    empty: 'Aucun document dans ce filtre.',
    noRows: 'Déposez des factures pour commencer, ou chargez les documents déjà extraits.',
    selectRequired: 'Sélectionnez au moins un document prêt.',
    notReady: 'Complétez les champs, la proposition ou choisissez le journal avant validation.',
    proposalReady: 'Proposition prête',
    proposalReview: 'Proposition à vérifier',
    noProposal: 'Aucune proposition',
    uploadState: 'Envoi et extraction',
    pendingState: 'En attente',
    doneState: 'Extrait',
    approvedState: 'Brouillon créé',
    errorState: 'Erreur',
    statusExtracted: 'Extrait',
    statusProposed: 'Proposé',
    statusApproved: 'Brouillon créé',
    statusDuplicate: 'Doublon',
    statusRejected: 'Refusé',
    resultTitle: 'Résultat de la validation groupée',
    resultOk: 'Brouillon créé',
    resultKo: 'Non validé',
    confirmTitle: 'Confirmer les brouillons',
    confirmIntro: 'Vous allez créer un brouillon d’écriture pour chaque document sélectionné. Aucun brouillon ne sera comptabilisé.',
    confirmCount: 'Documents concernés',
    confirmTotal: 'Total TTC des documents sélectionnés',
    confirmCheck: 'Je vérifie les documents, les comptes et les montants avant de créer les brouillons.',
    confirm: 'Confirmer la création des brouillons',
    cancel: 'Annuler',
    processing: 'Traitement…',
    summaryReady: 'prêts',
    summaryReview: 'à vérifier',
    summaryDuplicate: 'doublons',
    summaryError: 'erreurs',
    unsupported: 'Format non pris en charge (PDF, JPG, JPEG ou PNG uniquement).',
    emptyFile: 'Le fichier est vide.',
    tooLarge: 'Fichier trop volumineux (8 Mo maximum).',
    tooMany: 'Le lot est limité à 100 fichiers par import.',
    noCompany: 'Aucune société active.',
    required: 'Requis',
    proposalAccounts: 'Comptes de la proposition',
    exchangeReview: 'Devise étrangère : validation individuelle avec taux explicite.',
    rulesTitle: 'Règles supervisées',
    rulesHelp: 'Une correction isolée ne devient jamais une règle appliquée : le moteur ne l’utilise qu’après deux validations identiques. Vous pouvez modifier le compte ou désactiver chaque règle.',
    rulesEmpty: 'Aucune règle apprise pour ce journal. Elles apparaîtront après des validations humaines répétées.',
    ruleParty: 'Tiers',
    ruleKeyword: 'Libellé appris',
    ruleAccount: 'Compte',
    ruleEvidence: 'Validations',
    ruleLastUsed: 'Dernière utilisation',
    ruleActive: 'Active',
    ruleInactive: 'Désactivée',
    ruleUpdateError: 'La règle n’a pas pu être modifiée.',
  },
  en: {
    title: 'Bulk invoice import',
    subtitle: 'Drop several PDFs or images. Every document keeps its own result, errors and audit trail.',
    back: 'Back to the journal',
    drop: 'Drop invoices here or choose several files',
    dropHint: 'PDF, JPG, JPEG, PNG · 8 MB per file · up to 100 files',
    choose: 'Choose files',
    privacy: 'Files stay in the company’s private storage. OCR is the existing engine; no second engine is used.',
    globalProgress: 'Overall progress',
    processed: 'processed',
    retry: 'Retry failures',
    reload: 'Load the queue',
    queueLoading: 'Loading the queue…',
    filters: 'Filters',
    all: 'All',
    ready: 'Ready to validate',
    review: 'To review',
    duplicates: 'Duplicates',
    errors: 'Errors',
    file: 'File',
    party: 'Supplier / customer',
    invoiceNo: 'Invoice no.',
    invoiceDate: 'Date',
    currency: 'Currency',
    subtotal: 'Net',
    vat: 'VAT',
    total: 'Gross',
    account: 'Proposed account',
    status: 'Status',
    confidence: 'Confidence',
    actions: 'Actions',
    pages: 'pages',
    multipage: 'Multipage PDF — review without automatic splitting',
    duplicate: 'Duplicate',
    duplicateHint: 'Identical file or invoice already present: no proposal will be created.',
    uncertain: 'Fields to check',
    creditNote: 'Credit note',
    noValue: '—',
    editHint: 'Highlighted fields can be corrected before validation.',
    save: 'Save corrections',
    saved: 'Corrections saved.',
    open: 'Open the document',
    uploadFailed: 'Import failed',
    prepare: 'Prepare proposals',
    preparing: 'Preparing proposals…',
    validate: 'Create drafts for selected',
    selecting: 'selected',
    selectAll: 'Select all',
    clearSelection: 'Clear selection',
    prepareHelp: 'Preparing creates no entry: it computes an editable proposal.',
    approveHelp: 'Human validation creates drafts, never posted entries. Period, balance, currency and permission checks remain server-side.',
    empty: 'No document in this filter.',
    noRows: 'Drop invoices to start, or load documents that were already extracted.',
    selectRequired: 'Select at least one ready document.',
    notReady: 'Complete the fields or proposal and choose the journal before validation.',
    proposalReady: 'Proposal ready',
    proposalReview: 'Proposal to review',
    noProposal: 'No proposal',
    uploadState: 'Upload and extraction',
    pendingState: 'Waiting',
    doneState: 'Extracted',
    approvedState: 'Draft created',
    errorState: 'Error',
    statusExtracted: 'Extracted',
    statusProposed: 'Proposed',
    statusApproved: 'Draft created',
    statusDuplicate: 'Duplicate',
    statusRejected: 'Rejected',
    resultTitle: 'Bulk validation result',
    resultOk: 'Draft created',
    resultKo: 'Not validated',
    confirmTitle: 'Confirm drafts',
    confirmIntro: 'You are creating one draft entry per selected document. No draft is posted.',
    confirmCount: 'Documents concerned',
    confirmTotal: 'Gross total of selected documents',
    confirmCheck: 'I reviewed the documents, accounts and amounts before creating the drafts.',
    confirm: 'Confirm draft creation',
    cancel: 'Cancel',
    processing: 'Processing…',
    summaryReady: 'ready',
    summaryReview: 'to review',
    summaryDuplicate: 'duplicates',
    summaryError: 'errors',
    unsupported: 'Unsupported format (PDF, JPG, JPEG or PNG only).',
    emptyFile: 'The file is empty.',
    tooLarge: 'File too large (8 MB maximum).',
    tooMany: 'A batch is limited to 100 files.',
    noCompany: 'No active company.',
    required: 'Required',
    proposalAccounts: 'Proposal accounts',
    exchangeReview: 'Foreign currency: validate individually with an explicit rate.',
    rulesTitle: 'Supervised rules',
    rulesHelp: 'A single correction never becomes an applied rule: the engine only uses it after two identical approvals. You can change the account or disable each rule.',
    rulesEmpty: 'No learned rule for this journal. They appear after repeated human approvals.',
    ruleParty: 'Party',
    ruleKeyword: 'Learned label',
    ruleAccount: 'Account',
    ruleEvidence: 'Approvals',
    ruleLastUsed: 'Last used',
    ruleActive: 'Active',
    ruleInactive: 'Disabled',
    ruleUpdateError: 'The rule could not be updated.',
  },
} as const;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function correctionOf(document?: DocumentRow): Correction {
  return {
    party_name: document?.party_name ?? '',
    invoice_number: document?.invoice_number ?? '',
    invoice_date: document?.invoice_date?.slice(0, 10) ?? '',
    due_date: document?.due_date?.slice(0, 10) ?? '',
    currency: document?.currency ?? '',
    subtotal: document?.subtotal ?? '',
    vat_total: document?.vat_total ?? '',
    total_amount: document?.total_amount ?? '',
  };
}

function money(value: string | null | undefined): string {
  if (!value) return '—';
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString('en-MU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value;
}

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = items[index++]!;
      await work(current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export default function BulkImportPage({ mode }: { mode: Side }) {
  const { t, locale } = useI18n();
  const tr = L[locale];
  const { company } = useSession();
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [results, setResults] = useState<BulkResult[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [rules, setRules] = useState<DocumentRule[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const loadRules = async () => {
    if (!company) return;
    setRulesLoading(true);
    try {
      const [ruleResult, accountResult] = await Promise.all([
        api.get<{ rules: DocumentRule[] }>(`/companies/${company.id}/documents/rules`),
        api.get<{ accounts: AccountOption[] }>(`/companies/${company.id}/accounts`),
      ]);
      if (!mounted.current) return;
      setRules(ruleResult.rules);
      setAccounts(accountResult.accounts);
    } catch (err) {
      if (mounted.current) setError(errorMessage(err, tr.ruleUpdateError).message);
    } finally {
      if (mounted.current) setRulesLoading(false);
    }
  };

  useEffect(() => {
    void loadRules();
    // Reload only when the active company changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id]);

  const updateRule = async (rule: DocumentRule, patch: { accountId?: string; isActive?: boolean }) => {
    if (!company) return;
    setError(null);
    try {
      const result = await api.patch<{ rule: DocumentRule }>(
        `/companies/${company.id}/documents/rules/${rule.id}`,
        patch,
      );
      setRules((previous) => previous.map((item) => (item.id === rule.id ? result.rule : item)));
    } catch (err) {
      setError(errorMessage(err, tr.ruleUpdateError).message);
    }
  };

  const update = (key: string, patch: Partial<BulkRow>) => {
    if (!mounted.current) return;
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const isDuplicate = (row: BulkRow) =>
    row.document?.status === 'DUPLICATE' || Boolean(row.document?.duplicate_of);
  const fieldsReady = (row: BulkRow) => {
    const d = row.document;
    return Boolean(
      d &&
      d.status !== 'DUPLICATE' &&
      d.status !== 'APPROVED' &&
      d.status !== 'REJECTED' &&
      d.party_name?.trim() &&
      d.invoice_number?.trim() &&
      d.invoice_date &&
      d.currency &&
      d.total_amount,
    );
  };
  const proposalReady = (row: BulkRow) => {
    const p = row.proposal;
    return Boolean(
      p &&
      p.status === 'PROPOSED' &&
      !row.proposalStale &&
      p.balanced &&
      p.journal_id &&
      p.lines.length >= 2 &&
      p.lines.every((line) => line.accountId),
    );
  };
  // "Ready to validate" means a server-computed, balanced proposal with all
  // accounts resolved. An extracted document with complete fields is only
  // ready to *prepare* — it is deliberately not presented as validated data.
  const ready = (row: BulkRow) => row.state !== 'error' && !isDuplicate(row) && proposalReady(row);

  const counts = useMemo(() => {
    const duplicate = rows.filter(isDuplicate).length;
    const errors = rows.filter((row) => row.state === 'error').length;
    const readyCount = rows.filter(ready).length;
    const completed = rows.filter((row) => row.state === 'approved' || row.document?.status === 'APPROVED').length;
    return {
      all: rows.length,
      ready: readyCount,
      review: Math.max(0, rows.length - readyCount - duplicate - errors - completed),
      duplicates: duplicate,
      errors,
    };
  }, [rows]);

  const visible = useMemo(() => {
    if (filter === 'ready') return rows.filter(ready);
    if (filter === 'review') return rows.filter((row) => !ready(row) && !isDuplicate(row) && row.state !== 'error' && row.state !== 'approved' && row.document?.status !== 'APPROVED');
    if (filter === 'duplicates') return rows.filter(isDuplicate);
    if (filter === 'errors') return rows.filter((row) => row.state === 'error');
    return rows;
  }, [rows, filter]);

  const selected = rows.filter((row) => row.selected);
  const selectedReady = selected.filter((row) => fieldsReady(row) && !isDuplicate(row));
  const selectedApprovable = selected.filter(proposalReady);
  const preparable = selected.length ? selectedReady : rows.filter((row) => fieldsReady(row) && !isDuplicate(row));
  const totalSelected = selectedApprovable.reduce((sum, row) => sum + Number(row.document?.total_amount ?? 0), 0);
  const inFlight = rows.filter((row) => row.state === 'uploading' || row.state === 'preparing' || row.state === 'approving').length;
  const finished = rows.filter((row) => ['done', 'error', 'approved'].includes(row.state) && row.progress >= 100).length;
  const globalProgress = rows.length === 0 ? 0 : Math.round(((finished + inFlight * 0.45) / rows.length) * 100);

  const mergeDocument = (key: string, document: DocumentRow, selectedDefault: boolean) => {
    update(key, {
      document,
      correction: correctionOf(document),
      state: 'done',
      progress: 100,
      selected: selectedDefault,
      error: undefined,
      actionError: undefined,
    });
  };

  const validateFile = (file: File): string | null => {
    if (!file.size) return tr.emptyFile;
    if (file.size > MAX_BYTES) return tr.tooLarge;
    const mime = (file.type || '').toLowerCase();
    const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
    if (!ALLOWED.has(mime) && !['pdf', 'jpg', 'jpeg', 'png'].includes(extension ?? '')) return tr.unsupported;
    return null;
  };

  const uploadOne = async (initial: BulkRow) => {
    const file = initial.file;
    if (!file) return;
    update(initial.key, { state: 'uploading', progress: 20, error: undefined });
    try {
      const contentBase64 = await readBase64(file);
      update(initial.key, { progress: 45 });
      const declared = ALLOWED.has(file.type) ? file.type : undefined;
      const result = await api.post<{ document: DocumentRow }>(
        `/companies/${company!.id}/documents`,
        { fileName: file.name, contentBase64, ...(declared ? { declaredMime: declared } : {}), kind: mode },
      );
      update(initial.key, { progress: 90 });
      mergeDocument(initial.key, result.document, result.document.status !== 'DUPLICATE');
    } catch (err) {
      update(initial.key, {
        state: 'error',
        progress: 100,
        selected: false,
        error: errorMessage(err, tr.uploadFailed).message,
      });
    }
  };

  const uploadMany = async (newRows: BulkRow[]) => {
    setError(null);
    setNotice(null);
    setResults([]);
    await pool(newRows.filter((row) => row.file), CONCURRENCY, uploadOne);
  };

  const addFiles = (files: FileList | File[]) => {
    const all = Array.from(files);
    if (all.length === 0) return;
    let accepted = all;
    if (rows.length + all.length > MAX_FILES) {
      setError(tr.tooMany);
      accepted = all.slice(0, Math.max(0, MAX_FILES - rows.length));
    }
    const next: BulkRow[] = accepted.map((file) => {
      const key = `file-${crypto.randomUUID()}`;
      const invalid = validateFile(file);
      return {
        key,
        fileName: file.name,
        file,
        correction: correctionOf(),
        state: invalid ? 'error' : 'pending',
        progress: invalid ? 100 : 0,
        error: invalid ?? undefined,
        selected: false,
      };
    });
    if (next.length) {
      setRows((previous) => [...previous, ...next]);
      const valid = next.filter((row) => row.state !== 'error');
      if (valid.length) void uploadMany(valid);
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  const retryFailed = () => {
    const failed = rows.filter((row) => row.state === 'error' && row.file);
    if (!failed.length) return;
    setRows((previous) =>
      previous.map((row) =>
        row.state === 'error' && row.file
          ? { ...row, state: 'pending', progress: 0, error: undefined }
          : row,
      ),
    );
    void uploadMany(failed.map((row) => ({ ...row, state: 'pending' as const, progress: 0, error: undefined })));
  };

  const loadQueue = async () => {
    if (!company) return;
    setQueueLoading(true);
    setError(null);
    try {
      const res = await api.get<{ documents: DocumentRow[] }>(`/companies/${company.id}/documents`);
      const existing = new Set(rows.map((row) => row.document?.id).filter(Boolean));
      const queued = res.documents
        .filter((doc) => doc.kind === mode || doc.kind === 'unknown')
        .filter((doc) => ['EXTRACTED', 'PROPOSED', 'DUPLICATE'].includes(doc.status))
        .filter((doc) => !existing.has(doc.id))
        .map<BulkRow>((doc) => ({
          key: `doc-${doc.id}`,
          fileName: doc.original_name,
          document: doc,
          correction: correctionOf(doc),
          state: 'done',
          progress: 100,
          selected: false,
        }));
      if (queued.length) setRows((previous) => [...previous, ...queued]);
      setNotice(queued.length ? `${queued.length} ${tr.processed}` : tr.empty);
    } catch (err) {
      setError(errorMessage(err, tr.uploadFailed).message);
    } finally {
      setQueueLoading(false);
    }
  };

  const correct = (row: BulkRow, field: keyof Correction, value: string) => {
    update(row.key, {
      correction: { ...row.correction, [field]: value },
      proposalStale: Boolean(row.proposal),
    });
  };

  const saveRow = async (row: BulkRow) => {
    if (!company || !row.document) return;
    setSavingKey(row.key);
    setError(null);
    try {
      const result = await api.patch<{ document: DocumentRow }>(
        `/companies/${company.id}/documents/${row.document.id}`,
        {
          party_name: row.correction.party_name || null,
          invoice_number: row.correction.invoice_number || null,
          invoice_date: row.correction.invoice_date || null,
          due_date: row.correction.due_date || null,
          currency: row.correction.currency || null,
          subtotal: row.correction.subtotal || null,
          vat_total: row.correction.vat_total || null,
          total_amount: row.correction.total_amount || null,
        },
      );
      update(row.key, {
        document: { ...row.document, ...result.document },
        correction: correctionOf({ ...row.document, ...result.document }),
        proposalStale: Boolean(row.proposal),
      });
      setNotice(`${row.fileName} — ${tr.saved}`);
    } catch (err) {
      update(row.key, { actionError: errorMessage(err, tr.uploadFailed).message });
    } finally {
      setSavingKey(null);
    }
  };

  const prepareRows = async (chosen: BulkRow[]) => {
    const candidates = chosen.filter((row) => row.document && fieldsReady(row) && !isDuplicate(row));
    if (!candidates.length) {
      setError(tr.selectRequired);
      return;
    }
    setActionBusy(true);
    setError(null);
    setResults([]);
    await pool(candidates, CONCURRENCY, async (row) => {
      update(row.key, { state: 'preparing', actionError: undefined });
      try {
        const result = await api.post<{ proposal: Proposal }>(
          `/companies/${company!.id}/documents/${row.document!.id}/proposal`,
        );
        update(row.key, {
          proposal: result.proposal,
          proposalStale: false,
          state: 'done',
          progress: 100,
          actionError: undefined,
          document: row.document ? { ...row.document, status: 'PROPOSED' } : row.document,
          selected: proposalReady({ ...row, proposal: result.proposal, proposalStale: false }),
        });
      } catch (err) {
        update(row.key, {
          state: 'done',
          actionError: errorMessage(err, tr.notReady).message,
          selected: false,
        });
      }
    });
    setActionBusy(false);
  };

  const approveSelected = async () => {
    const candidates = selected.filter(proposalReady);
    if (!candidates.length) {
      setError(tr.selectRequired);
      return;
    }
    setActionBusy(true);
    setError(null);
    setResults([]);
    const collected: BulkResult[] = [];
    await pool(candidates, CONCURRENCY, async (row) => {
      const proposal = row.proposal!;
      if (!company) return;
      if (proposal.currency !== (company.functional_currency ?? 'MUR')) {
        collected.push({ key: row.key, fileName: row.fileName, ok: false, message: tr.exchangeReview });
        update(row.key, { actionError: tr.exchangeReview, selected: false });
        return;
      }
      update(row.key, { state: 'approving', actionError: undefined });
      try {
        const result = await api.post<{ draftEntry: { entry_no: string } }>(
          `/companies/${company.id}/documents/proposals/${proposal.id}/approve`,
          {
            confirm: true,
            partyId: proposal.party_id ?? null,
            journalId: proposal.journal_id ?? undefined,
            entryDate: proposal.entry_date?.slice(0, 10),
            lines: proposal.lines.map((line) => ({
              accountId: line.accountId,
              description: line.description || null,
              debit: line.debit,
              credit: line.credit,
            })),
          },
        );
        collected.push({
          key: row.key,
          fileName: row.fileName,
          ok: true,
          message: `${tr.resultOk} — ${result.draftEntry.entry_no}`,
        });
        update(row.key, {
          state: 'approved',
          progress: 100,
          selected: false,
          entryNo: result.draftEntry.entry_no,
          document: row.document ? { ...row.document, status: 'APPROVED' } : row.document,
        });
      } catch (err) {
        const message = errorMessage(err, tr.notReady).message;
        collected.push({ key: row.key, fileName: row.fileName, ok: false, message });
        update(row.key, { state: 'done', actionError: message, selected: false });
      }
    });
    setResults(collected);
    setActionBusy(false);
    setConfirmOpen(false);
    setConfirmed(false);
  };

  const toggleAllVisible = (checked: boolean) => {
    const keys = new Set(visible.map((row) => row.key));
    setRows((previous) => previous.map((row) => (keys.has(row.key) ? { ...row, selected: checked } : row)));
  };

  const allVisibleSelected = visible.length > 0 && visible.every((row) => row.selected);
  const statusLabel = (row: BulkRow) => {
    if (row.state === 'error') return tr.errorState;
    if (row.state === 'approved') return tr.statusApproved;
    if (isDuplicate(row)) return tr.statusDuplicate;
    if (row.proposal) return row.proposalStale ? tr.proposalReview : tr.proposalReady;
    if (row.state === 'uploading') return tr.uploadState;
    if (row.state === 'preparing') return tr.preparing;
    if (row.state === 'pending') return tr.pendingState;
    return row.document?.status === 'PROPOSED' ? tr.statusProposed : tr.statusExtracted;
  };
  const statusKind = (row: BulkRow): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
    if (row.state === 'error') return 'danger';
    if (isDuplicate(row)) return 'warning';
    if (row.state === 'approved') return 'success';
    if (row.proposal && !row.proposalStale) return proposalReady(row) ? 'success' : 'warning';
    return 'info';
  };

  if (!company) return <EmptyState title={tr.noCompany} />;

  const journalPath = `/accounting/journals/${mode === 'purchase' ? 'purchases' : 'sales'}`;
  const title = mode === 'purchase' ? `${tr.title} — ${t('nav.journals.purchases')}` : `${tr.title} — ${t('nav.journals.sales')}`;
  const filteredCount = (key: Filter) => counts[key];

  return (
    <div className="bulk-page">
      <DemoNotice />
      <div className="page-head">
        <div className="grow">
          <Link className="page-sub" to={journalPath}>← {tr.back}</Link>
          <h1>{title}</h1>
          <div className="page-sub">{tr.subtitle}</div>
        </div>
        <Link className="btn" to={`/accounting/journals/${mode === 'purchase' ? 'purchases' : 'sales'}/import`}>
          <AppIcon name="documents" /> {t(mode === 'purchase' ? 'journal.importPurchase' : 'journal.importSale')}
        </Link>
      </div>

      <ErrorBanner message={error} />
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <Card title={tr.title} actions={<Badge kind="info">{rows.length}/{MAX_FILES}</Badge>}>
        <label
          className={`bulk-dropzone ${dragging ? 'is-over' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            aria-label={tr.choose}
            onChange={(event) => { if (event.target.files) addFiles(event.target.files); }}
          />
          <span className="bulk-dropzone-icon"><AppIcon name="importCloud" size={30} /></span>
          <strong>{tr.drop}</strong>
          <span className="page-sub">{tr.dropHint}</span>
        </label>
        <div className="bulk-summary" style={{ marginTop: 10 }}>
          <Button onClick={() => inputRef.current?.click()}>
            <AppIcon name="plus" /> {tr.choose}
          </Button>
          <Button onClick={() => void loadQueue()} disabled={queueLoading || actionBusy}>
            <AppIcon name={queueLoading ? 'refresh' : 'journals'} /> {queueLoading ? tr.queueLoading : tr.reload}
          </Button>
          {rows.some((row) => row.state === 'error' && row.file) && (
            <Button onClick={retryFailed} disabled={actionBusy}>
              <AppIcon name="refresh" /> {tr.retry}
            </Button>
          )}
          <span className="page-sub" style={{ marginLeft: 'auto' }}>{tr.privacy}</span>
        </div>
        {rows.length > 0 && (
          <div className="bulk-progress" aria-live="polite">
            <div className="bulk-progress-head">
              <span>{tr.globalProgress}</span>
              <span>{finished}/{rows.length} {tr.processed} · {globalProgress}%</span>
            </div>
            <div className="bulk-progress-track" role="progressbar" aria-valuenow={globalProgress} aria-valuemin={0} aria-valuemax={100}>
              <span className="bulk-progress-bar" style={{ width: `${globalProgress}%` }} />
            </div>
          </div>
        )}
      </Card>

      <Card title={tr.filters}>
        <div className="bulk-summary">
          <Badge kind="success">{counts.ready} {tr.summaryReady}</Badge>
          <Badge kind="warning">{counts.review} {tr.summaryReview}</Badge>
          <Badge kind="warning">{counts.duplicates} {tr.summaryDuplicate}</Badge>
          <Badge kind="danger">{counts.errors} {tr.summaryError}</Badge>
        </div>
        <div className="bulk-filters" role="tablist" aria-label={tr.filters}>
          {([
            ['all', tr.all], ['ready', tr.ready], ['review', tr.review], ['duplicates', tr.duplicates], ['errors', tr.errors],
          ] as [Filter, string][]).map(([key, label]) => (
            <button type="button" role="tab" aria-selected={filter === key}
              className={`bulk-filter ${filter === key ? 'active' : ''}`} key={key}
              onClick={() => setFilter(key)}>
              {label} <span aria-hidden="true">({filteredCount(key)})</span>
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <EmptyState title={tr.noRows} />
        ) : visible.length === 0 ? (
          <EmptyState title={tr.empty} />
        ) : (
          <div className="table-wrap">
            <table className="bulk-table invoice-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" checked={allVisibleSelected} aria-label={tr.selectAll}
                      onChange={(event) => toggleAllVisible(event.target.checked)} />
                  </th>
                  <th>{tr.file}</th>
                  <th>{tr.party}</th>
                  <th>{tr.invoiceNo}</th>
                  <th>{tr.invoiceDate}</th>
                  <th>{tr.currency}</th>
                  <th>{tr.subtotal}</th>
                  <th>{tr.vat}</th>
                  <th>{tr.total}</th>
                  <th>{tr.account}</th>
                  <th>{tr.status}</th>
                  <th>{tr.confidence}</th>
                  <th>{tr.actions}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const document = row.document;
                  const disabled = !document || isDuplicate(row) || row.state === 'approved' || row.state === 'uploading';
                  const confidence = Number(document?.confidence ?? 0);
                  return (
                    <tr key={row.key}>
                      <td>
                        <input type="checkbox" checked={row.selected} disabled={row.state === 'error' || row.state === 'approved'}
                          aria-label={`${tr.selectAll} ${row.fileName}`}
                          onChange={(event) => update(row.key, { selected: event.target.checked })} />
                      </td>
                      <td className="cell-file" data-label={tr.file}>
                        <strong>{row.fileName}</strong>
                        <span className="page-sub">
                          {document ? `${Math.max(1, document.page_count)} ${tr.pages}` : row.file ? `${(row.file.size / 1024).toFixed(0)} Ko` : ''}
                        </span>
                        {document && document.document_type === 'credit_note' && (
                          <Badge kind="warning">{tr.creditNote}</Badge>
                        )}
                        {document && document.page_count > 1 && (
                          <div className="bulk-warning">{tr.multipage}</div>
                        )}
                        {row.state === 'uploading' && (
                          <div className="bulk-row-progress" aria-hidden="true">
                            <span style={{ width: `${row.progress}%` }} />
                          </div>
                        )}
                        {row.error && <div className="bulk-row-error">{row.error}</div>}
                        {row.actionError && <div className="bulk-row-error">{row.actionError}</div>}
                      </td>
                      <td data-label={tr.party}>
                        <input value={row.correction.party_name} disabled={disabled}
                          aria-label={`${tr.party} ${row.fileName}`}
                          onChange={(event) => correct(row, 'party_name', event.target.value)} />
                      </td>
                      <td data-label={tr.invoiceNo}>
                        <input value={row.correction.invoice_number} disabled={disabled}
                          aria-label={`${tr.invoiceNo} ${row.fileName}`}
                          onChange={(event) => correct(row, 'invoice_number', event.target.value)} />
                      </td>
                      <td data-label={tr.invoiceDate}>
                        <input type="date" value={row.correction.invoice_date} disabled={disabled}
                          aria-label={`${tr.invoiceDate} ${row.fileName}`}
                          onChange={(event) => correct(row, 'invoice_date', event.target.value)} />
                      </td>
                      <td data-label={tr.currency}>
                        <select value={row.correction.currency} disabled={disabled}
                          aria-label={`${tr.currency} ${row.fileName}`}
                          onChange={(event) => correct(row, 'currency', event.target.value)}>
                          <option value="">{t('docs.notSpecified')}</option>
                          {['MUR', 'EUR', 'USD', 'GBP'].map((currency) => <option key={currency}>{currency}</option>)}
                        </select>
                      </td>
                      {(['subtotal', 'vat_total', 'total_amount'] as const).map((field) => (
                        <td className="cell-amount" data-label={field === 'subtotal' ? tr.subtotal : field === 'vat_total' ? tr.vat : tr.total} key={field}>
                          <input inputMode="decimal" value={row.correction[field]} disabled={disabled}
                            aria-label={`${field === 'subtotal' ? tr.subtotal : field === 'vat_total' ? tr.vat : tr.total} ${row.fileName}`}
                            onChange={(event) => correct(row, field, event.target.value)} />
                        </td>
                      ))}
                      <td data-label={tr.account}>
                        {row.proposal?.lines.length ? (
                          <span title={row.proposal.lines.map((line) => `${line.accountCode ?? '—'} ${line.accountName ?? ''}`).join(' · ')}>
                            {[...new Set(row.proposal.lines.map((line) => line.accountCode).filter(Boolean))].join(', ') || tr.noValue}
                          </span>
                        ) : <span className="page-sub">{tr.noProposal}</span>}
                      </td>
                      <td className="cell-status" data-label={tr.status}>
                        <Badge kind={statusKind(row)}>{statusLabel(row)}</Badge>
                        {document?.uncertain_fields?.length ? (
                          <div className="bulk-warning">{tr.uncertain}: {document.uncertain_fields.join(', ')}</div>
                        ) : null}
                        {row.proposal?.uncertain_fields.length ? (
                          <div className="bulk-warning">{row.proposal.uncertain_fields.join(', ')}</div>
                        ) : null}
                        {isDuplicate(row) && <div className="bulk-warning">{tr.duplicateHint}</div>}
                      </td>
                      <td data-label={tr.confidence}>
                        {confidence > 0 ? (
                          <span title={`${tr.confidence}: ${Math.round(confidence * 100)}%`}>
                            {Math.round(confidence * 100)}%
                          </span>
                        ) : <span className="page-sub">{tr.noValue}</span>}
                      </td>
                      <td data-label={tr.actions}>
                        <div className="page-head-actions">
                          {document && (
                            <>
                              <Button className="btn-sm" onClick={() => void saveRow(row)} disabled={disabled || savingKey === row.key}>
                                <AppIcon name="save" size={15} /> <span className="btn-label">{savingKey === row.key ? tr.processing : tr.save}</span>
                              </Button>
                              <Link className="btn btn-sm" to={`/documents?doc=${encodeURIComponent(document.id)}`}>
                                <AppIcon name="view" size={15} /> <span className="btn-label">{tr.open}</span>
                              </Link>
                            </>
                          )}
                        </div>
                        {row.entryNo && <div className="page-sub mono">{row.entryNo}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="bulk-empty-note">{tr.editHint}</p>

        <div className="bulk-actions-bar" style={{ marginTop: 12 }}>
          <div className="grow">
            <strong>{selected.length}</strong> {tr.selecting}
            {selected.length > 0 && <span className="page-sub"> · {money(String(totalSelected))} MUR</span>}
          </div>
          <Button className="btn-sm" onClick={() => toggleAllVisible(true)} disabled={!visible.length}>
            {tr.selectAll}
          </Button>
          <Button className="btn-sm" onClick={() => toggleAllVisible(false)} disabled={!selected.length}>
            {tr.clearSelection}
          </Button>
          <Button onClick={() => void prepareRows(preparable)}
            disabled={actionBusy || preparable.length === 0}>
            <AppIcon name="refresh" /> {actionBusy ? tr.preparing : tr.prepare}
          </Button>
          <Button variant="primary" disabled={!selectedApprovable.length || actionBusy}
            onClick={() => { setConfirmed(false); setConfirmOpen(true); }}>
            <AppIcon name="validate" /> {tr.validate}
          </Button>
        </div>
        <p className="page-sub">{tr.prepareHelp}</p>
      </Card>

      <Card title={tr.rulesTitle} actions={<Badge kind="neutral">{rules.filter((rule) => rule.kind === mode).length}</Badge>}>
        <p className="page-sub">{tr.rulesHelp}</p>
        {rulesLoading ? (
          <Spinner label={tr.queueLoading} />
        ) : rules.filter((rule) => rule.kind === mode).length === 0 ? (
          <EmptyState title={tr.rulesEmpty} />
        ) : (
          <div className="table-wrap">
            <table className="bulk-table rules-table">
              <thead>
                <tr>
                  <th>{tr.ruleParty}</th>
                  <th>{tr.ruleKeyword}</th>
                  <th>{tr.ruleAccount}</th>
                  <th>{tr.ruleEvidence}</th>
                  <th>{tr.ruleLastUsed}</th>
                  <th>{tr.ruleActive}</th>
                </tr>
              </thead>
              <tbody>
                {rules.filter((rule) => rule.kind === mode).map((rule) => (
                  <tr key={rule.id}>
                    <td data-label={tr.ruleParty}>{rule.party_key}</td>
                    <td data-label={tr.ruleKeyword}>{rule.keyword_key}</td>
                    <td data-label={tr.ruleAccount}>
                      <select
                        value={rule.account_id}
                        aria-label={`${tr.ruleAccount} ${rule.party_key} ${rule.keyword_key}`}
                        onChange={(event) => void updateRule(rule, { accountId: event.target.value })}
                      >
                        {accounts
                          .filter((account) => account.is_active && account.type === (mode === 'purchase' ? 'expense' : 'revenue'))
                          .map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.code} — {account.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td data-label={tr.ruleEvidence}>{rule.usage_count}</td>
                    <td data-label={tr.ruleLastUsed}>{rule.last_used_at.slice(0, 10)}</td>
                    <td data-label={tr.ruleActive}>
                      <label className="inline">
                        <input
                          type="checkbox"
                          checked={rule.is_active}
                          aria-label={`${tr.ruleActive} ${rule.party_key} ${rule.keyword_key}`}
                          onChange={(event) => void updateRule(rule, { isActive: event.target.checked })}
                        />
                        {rule.is_active ? tr.ruleActive : tr.ruleInactive}
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {results.length > 0 && (
        <Card title={tr.resultTitle}>
          <div className="bulk-results" role="status">
            {results.map((result) => (
              <div className={`bulk-result ${result.ok ? 'ok' : 'ko'}`} key={result.key}>
                <AppIcon name={result.ok ? 'validate' : 'alert'} size={16} />
                <span><strong>{result.fileName}</strong> — {result.message}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal open={confirmOpen} title={tr.confirmTitle} onClose={() => { setConfirmOpen(false); setConfirmed(false); }} wide>
        <p>{tr.confirmIntro}</p>
        <div className="bulk-summary" style={{ margin: '12px 0' }}>
          <Badge kind="info">{tr.confirmCount}: {selectedApprovable.length}</Badge>
          <Badge kind="neutral">{tr.confirmTotal}: {money(String(totalSelected))} MUR</Badge>
        </div>
        <ul className="bulk-results">
          {selectedApprovable.map((row) => (
            <li key={row.key} className="bulk-result ok">
              <AppIcon name="documents" size={16} />
              <span>{row.fileName} — {money(row.document?.total_amount)} {row.correction.currency}</span>
            </li>
          ))}
        </ul>
        <label className="bulk-confirm-box" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 12 }}>
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>{tr.confirmCheck}</span>
        </label>
        <p className="page-sub">{tr.approveHelp}</p>
        <div className="page-head-actions" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => { setConfirmOpen(false); setConfirmed(false); }}>{tr.cancel}</Button>
          <Button variant="primary" disabled={!confirmed || actionBusy} onClick={() => void approveSelected()}>
            <AppIcon name="validate" /> {actionBusy ? tr.processing : tr.confirm}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
