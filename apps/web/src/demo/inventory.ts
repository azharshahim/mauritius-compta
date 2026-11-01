/**
 * Mission 22 — browser demonstration for inventory, accruals/prepayments and
 * provisions. Fictional data only, localStorage only. The module mirrors the
 * real API controls (exact decimals, proposal → human approval → posting,
 * closed-period protection, company isolation, reconciliation) without
 * asserting any statutory valuation, IAS 37 or Mauritian rule.
 */
import { ApiError } from '../errors';
import { scaled4ToString, toScaled4 } from '../format';
import type { DemoAccount, DemoEntry, DemoJournal, DemoLine, DemoState } from './runtime';

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const amt = (v: unknown) => toScaled4(v as any) ?? 0n;
const fmt = (v: bigint) => scaled4ToString(v);
const SCALE = 10_000n;
function mul(qty: bigint, unitCost: bigint): bigint {
  const p = qty * unitCost;
  const q = p / SCALE;
  const r = p % SCALE;
  return (r < 0n ? -r : r) * 2n >= SCALE ? q + (p < 0n ? -1n : 1n) : q;
}
function div(value: bigint, qty: bigint): bigint {
  if (qty === 0n) return 0n;
  const p = value * SCALE;
  const q = p / qty;
  const r = p % qty;
  return (r < 0n ? -r : r) * 2n >= qty ? q + (p < 0n ? -1n : 1n) : q;
}

export interface DemoInvCategory {
  id: string; company_id: string; code: string; name: string;
  valuation_method: 'fifo' | 'weighted_average'; inventory_account_id: string; cogs_account_id: string;
  adjustment_account_id: string | null; write_down_account_id: string | null;
  allow_negative_stock: boolean; is_active: boolean; created_at: string;
}
export interface DemoInvLocation { id: string; company_id: string; code: string; name: string; description: string | null; is_active: boolean }
export interface DemoInvItem {
  id: string; company_id: string; category_id: string; sku: string; name: string; unit: string;
  reorder_level: string | null; is_active: boolean;
}
export interface DemoInvBalance { item_id: string; location_id: string; quantity: string; value: string }
export interface DemoInvLot { id: string; item_id: string; location_id: string; received_date: string; unit_cost: string; remaining_quantity: string }
export interface DemoInvMovement {
  id: string; company_id: string; item_id: string; location_id: string; destination_location_id: string | null;
  movement_no: string; movement_date: string; direction: string; source_kind: string; quantity: string;
  unit_cost: string | null; value: string | null; valuation_method: string; reference: string | null;
  description: string; document_ref: string | null; journal_id: string; inventory_account_id: string;
  counterpart_account_id: string | null; status: string; entry_id: string | null;
  approval_note: string | null; rejection_reason: string | null; posted_at: string | null; created_at: string;
}
export interface DemoInvCount {
  id: string; company_id: string; location_id: string; count_no: string; count_date: string;
  reference: string | null; notes: string | null; status: string; created_at: string;
  lines: { id: string; item_id: string; counted_quantity: string; system_quantity: string; difference: string; unit_cost: string | null; movement_id: string | null }[];
}
export interface DemoInvWriteDown {
  id: string; company_id: string; write_down_no: string; item_id: string; location_id: string;
  write_down_date: string; kind: 'write_down' | 'reversal'; reverses_id: string | null; amount: string;
  reason: string; document_ref: string; journal_id: string; inventory_account_id: string;
  write_down_account_id: string; status: string; approval_note: string | null; entry_id: string | null;
  rejection_reason: string | null; created_at: string;
}
export interface DemoAccrualLine {
  id: string; line_no: number; period_start: string; period_end: string; amount: string;
  status: string; entry_id: string | null; reversal_entry_id: string | null;
  posted_at: string | null; reversed_at: string | null;
}
export interface DemoAccrual {
  id: string; company_id: string; reference: string; kind: string; description: string; counterparty: string | null;
  document_ref: string; pnl_account_id: string; balance_account_id: string; journal_id: string;
  total_amount: string; start_date: string; end_date: string; months: number; notes: string | null;
  status: string; approval_note: string | null; approved_at: string | null; created_at: string;
  lines: DemoAccrualLine[];
}
export interface DemoProvisionMovement {
  id: string; movement_no: string; movement_type: string; movement_date: string; amount: string;
  direction: string; reason: string; document_ref: string; journal_id: string; counterpart_account_id: string | null;
  status: string; approval_note: string | null; rejection_reason: string | null; entry_id: string | null;
  created_at: string;
}
export interface DemoProvision {
  id: string; company_id: string; provision_no: string; category: string; description: string; evidence_ref: string;
  recognition_date: string; measurement_basis: string; expense_account_id: string; provision_account_id: string;
  current_portion: string; non_current_portion: string; status: string; created_at: string;
  movements: DemoProvisionMovement[];
}
export interface DemoMission22 {
  categories: DemoInvCategory[]; locations: DemoInvLocation[]; items: DemoInvItem[];
  balances: DemoInvBalance[]; lots: DemoInvLot[]; movements: DemoInvMovement[];
  counts: DemoInvCount[]; writeDowns: DemoInvWriteDown[];
  accruals: DemoAccrual[]; provisions: DemoProvision[];
}

function store(state: DemoState): DemoMission22 {
  state.mission22 ??= { categories: [], locations: [], items: [], balances: [], lots: [], movements: [],
    counts: [], writeDowns: [], accruals: [], provisions: [] };
  return state.mission22 as DemoMission22;
}
function account(state: DemoState, companyId: string, code: string): DemoAccount {
  const found = state.accounts.find((a) => a.company_id === companyId && a.code === code);
  if (!found) throw new ApiError(400, 'ACCOUNT_NOT_FOUND', `Compte ${code} absent du plan démo`);
  return found;
}
function ensureAccount(state: DemoState, companyId: string, code: string): DemoAccount {
  const found = state.accounts.find((a) => a.company_id === companyId && a.code === code);
  if (found) return found;
  const template = state.accounts.find((a) => a.code === code);
  if (!template) throw new ApiError(400, 'ACCOUNT_NOT_FOUND', `Compte ${code} absent du plan démo`);
  const copy: DemoAccount = { ...template, id: uid(), company_id: companyId };
  state.accounts.push(copy);
  return copy;
}
function journal(state: DemoState, companyId: string, id?: string): DemoJournal {
  const found = state.journals.find((j) => j.company_id === companyId && (id ? j.id === id : j.code === 'OD'));
  if (!found) throw new ApiError(400, 'JOURNAL_NOT_FOUND', 'Journal absent');
  return found;
}
function entryNo(state: DemoState, j: DemoJournal, date: string): string {
  const year = date.slice(0, 4);
  const count = state.entries.filter((e) => e.company_id === j.company_id && e.journal_id === j.id && e.entry_date.startsWith(year)).length;
  return `${j.code}-${year}-${String(count + 1).padStart(4, '0')}`;
}
function postEntry(state: DemoState, companyId: string, journalId: string, date: string, reference: string,
  description: string, lines: { accountId: string; description: string; debit?: bigint | string; credit?: bigint | string }[], source: DemoEntry['source']): DemoEntry {
  const j = journal(state, companyId, journalId);
  const debit = lines.reduce((s, l) => s + amt(l.debit ?? 0n), 0n);
  const credit = lines.reduce((s, l) => s + amt(l.credit ?? 0n), 0n);
  if (debit !== credit) throw new ApiError(409, 'ENTRY_UNBALANCED', 'Écriture déséquilibrée');
  const period = state.periods.find((p) => p.company_id === companyId && p.start_date <= date && p.end_date >= date);
  if (!period || period.status === 'closed') throw new ApiError(409, 'PERIOD_CLOSED', 'Période clôturée ou absente');
  const entry: DemoEntry = {
    id: uid(), company_id: companyId, journal_id: j.id, entry_no: entryNo(state, j, date),
    entry_date: date, reference, description, currency: 'MUR', exchange_rate: '1.00000000',
    status: 'posted', source, reversal_of_entry_id: null, posted_at: now(), created_at: now(),
  };
  state.entries.push(entry);
  lines.forEach((l, index) => state.lines.push({
    id: uid(), entry_id: entry.id, company_id: companyId, account_id: l.accountId, line_no: index + 1,
    description: l.description, debit: fmt(amt(l.debit ?? 0n)), credit: fmt(amt(l.credit ?? 0n)),
    txn_amount: fmt(amt(l.debit ?? l.credit ?? 0n)), txn_currency: 'MUR', fx_rate: null,
  } satisfies DemoLine));
  return entry;
}
function glBalance(state: DemoState, companyId: string, accountId: string, asOf: string, source?: string): bigint {
  const ids = new Set(state.entries.filter((e) => e.company_id === companyId && e.status === 'posted'
    && e.entry_date <= asOf && (!source || e.source === source)).map((e) => e.id));
  return state.lines.filter((l) => l.company_id === companyId && l.account_id === accountId && ids.has(l.entry_id))
    .reduce((s, l) => s + amt(l.debit) - amt(l.credit), 0n);
}
function member(state: DemoState, companyId: string) {
  const user = state.users.find((u) => u.id === state.session);
  const m = state.members.find((x) => x.company_id === companyId && x.user_id === user?.id);
  if (!m) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
  return m;
}
function writeMember(state: DemoState, companyId: string) {
  const m = member(state, companyId);
  if (!['owner', 'admin', 'accountant', 'manager', 'cabinet_admin'].includes(m.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'Rôle comptable requis');
  }
  return m;
}

/* ------------------------------------------------------------------ views */

function categoryView(c: DemoInvCategory) {
  return { id: c.id, code: c.code, name: c.name, valuationMethod: c.valuation_method,
    inventoryAccountId: c.inventory_account_id, cogsAccountId: c.cogs_account_id,
    adjustmentAccountId: c.adjustment_account_id, writeDownAccountId: c.write_down_account_id,
    allowNegativeStock: c.allow_negative_stock, isActive: c.is_active };
}
function locationView(l: DemoInvLocation) {
  return { id: l.id, code: l.code, name: l.name, description: l.description, isActive: l.is_active };
}
function balanceOf(state: DemoState, itemId: string, locationId: string): DemoInvBalance | undefined {
  return store(state).balances.find((b) => b.item_id === itemId && b.location_id === locationId);
}
function itemView(state: DemoState, companyId: string, i: DemoInvItem) {
  return { id: i.id, categoryId: i.category_id, sku: i.sku, name: i.name, unit: i.unit,
    reorderLevel: i.reorder_level, isActive: i.is_active,
    category: store(state).categories.find((c) => c.id === i.category_id) };
}
function movementView(state: DemoState, m: DemoInvMovement) {
  const i = (state.mission22 as DemoMission22).items.find((x) => x.id === m.item_id);
  const l = (state.mission22 as DemoMission22).locations.find((x) => x.id === m.location_id);
  const d = (state.mission22 as DemoMission22).locations.find((x) => x.id === m.destination_location_id);
  const e = state.entries.find((x) => x.id === m.entry_id);
  const j = state.journals.find((x) => x.id === m.journal_id);
  return { id: m.id, movementNo: m.movement_no, movementDate: m.movement_date, direction: m.direction,
    sourceKind: m.source_kind, item: { sku: i?.sku, name: i?.name }, location: { code: l?.code, name: l?.name },
    destination: d ? { code: d.code, name: d.name } : null, quantity: m.quantity, unitCost: m.unit_cost,
    value: m.value, valuationMethod: m.valuation_method, reference: m.reference, description: m.description,
    documentRef: m.document_ref, journal: j ? { code: j.code, name: j.name } : null,
    inventoryAccountId: m.inventory_account_id, counterpartAccountId: m.counterpart_account_id,
    status: m.status, entryNo: e?.entry_no ?? null, entryId: m.entry_id, approvalNote: m.approval_note,
    rejectionReason: m.rejection_reason, postedAt: m.posted_at, createdAt: m.created_at };
}
function writeDownView(state: DemoState, w: DemoInvWriteDown) {
  const i = (state.mission22 as DemoMission22).items.find((x) => x.id === w.item_id);
  const l = (state.mission22 as DemoMission22).locations.find((x) => x.id === w.location_id);
  const e = state.entries.find((x) => x.id === w.entry_id);
  return { id: w.id, writeDownNo: w.write_down_no,
    writeDownDate: w.write_down_date, kind: w.kind, item: { sku: i?.sku, name: i?.name },
    location: { code: l?.code, name: l?.name }, amount: w.amount, reason: w.reason,
    documentRef: w.document_ref, status: w.status, entryNo: e?.entry_no ?? null,
    approvalNote: w.approval_note, rejectionReason: w.rejection_reason, createdAt: w.created_at };
}
function countView(state: DemoState, companyId: string, c: DemoInvCount) {
  const l = store(state).locations.find((x) => x.id === c.location_id);
  return { id: c.id, countNo: c.count_no, countDate: c.count_date, locationId: c.location_id,
    location: { code: l?.code, name: l?.name }, reference: c.reference, notes: c.notes, status: c.status,
    lineCount: c.lines.length, createdAt: c.created_at,
    lines: c.lines.map((l2) => {
      const item = store(state).items.find((i) => i.id === l2.item_id);
      return { id: l2.id, itemId: l2.item_id, sku: item?.sku, name: item?.name,
        countedQuantity: l2.counted_quantity, systemQuantity: l2.system_quantity,
        difference: l2.difference, unitCost: l2.unit_cost, movementId: l2.movement_id };
    }) };
}

/* ------------------------------------------------------------- positions */

interface Position { itemId: string; locationId: string; quantity: bigint; value: bigint }
function positions(state: DemoState, companyId: string, asOf: string): Position[] {
  const s = store(state);
  const map = new Map<string, Position>();
  const add = (itemId: string, locationId: string, q: bigint, v: bigint) => {
    const key = `${itemId}:${locationId}`;
    const p = map.get(key) ?? { itemId, locationId, quantity: 0n, value: 0n };
    p.quantity += q; p.value += v; map.set(key, p);
  };
  for (const m of s.movements.filter((x) => x.company_id === companyId && x.status === 'POSTED' && x.movement_date <= asOf)) {
    const q = amt(m.quantity), v = amt(m.value);
    if (m.direction === 'in' || m.direction === 'adjustment_in') add(m.item_id, m.location_id, q, v);
    else if (m.direction === 'out' || m.direction === 'adjustment_out') add(m.item_id, m.location_id, -q, -v);
    else if (m.direction === 'transfer_out') {
      add(m.item_id, m.location_id, -q, -v);
      if (m.destination_location_id) add(m.item_id, m.destination_location_id, q, v);
    }
  }
  for (const w of s.writeDowns.filter((x) => x.company_id === companyId && x.status === 'POSTED' && x.write_down_date <= asOf)) {
    add(w.item_id, w.location_id, 0n, w.kind === 'write_down' ? -amt(w.amount) : amt(w.amount));
  }
  return [...map.values()].filter((p) => p.quantity !== 0n || p.value !== 0n);
}

function valuation(state: DemoState, companyId: string, asOf: string) {
  const s = store(state);
  const rows = positions(state, companyId, asOf).map((p) => {
    const item = s.items.find((i) => i.id === p.itemId)!;
    const cat = s.categories.find((c) => c.id === item.category_id)!;
    const loc = s.locations.find((l) => l.id === p.locationId)!;
    return { itemId: item.id, sku: item.sku, name: item.name, unit: item.unit,
      reorderLevel: item.reorder_level, category: { code: cat.code, name: cat.name, valuationMethod: cat.valuation_method },
      location: { code: loc.code, name: loc.name }, quantity: fmt(p.quantity), value: fmt(p.value),
      unitCost: fmt(div(p.value, p.quantity)), inventoryAccountId: cat.inventory_account_id };
  });
  return { asOf, rows, totals: { quantity: fmt(rows.reduce((x, r) => x + amt(r.quantity), 0n)),
    value: fmt(rows.reduce((x, r) => x + amt(r.value), 0n)) },
    note: 'Démonstration : FIFO par lots datés, coût moyen par division décimale exacte. Aucune règle statutaire.' };
}
function reconciliation(state: DemoState, companyId: string, asOf: string) {
  const s = store(state);
  const pos = positions(state, companyId, asOf);
  const map = new Map<string, { account: any; categories: any[]; subledger: bigint }>();
  for (const c of s.categories.filter((x) => x.company_id === companyId)) {
    const a = state.accounts.find((x) => x.id === c.inventory_account_id);
    const b = map.get(c.inventory_account_id) ?? { account: { code: a?.code, name: a?.name }, categories: [], subledger: 0n };
    b.categories.push({ code: c.code, name: c.name });
    b.subledger += pos.filter((p) => s.items.find((i) => i.id === p.itemId)?.category_id === c.id).reduce((x, p) => x + p.value, 0n);
    map.set(c.inventory_account_id, b);
  }
  const rows = [...map.entries()].map(([accountId, b]) => {
    const ledger = glBalance(state, companyId, accountId, asOf);
    return { account: b.account, categories: b.categories, subledgerValue: fmt(b.subledger),
      ledgerBalance: fmt(ledger), difference: fmt(b.subledger - ledger), balanced: b.subledger === ledger };
  });
  return { asOf, rows, balanced: rows.every((r) => r.balanced),
    totalDifference: fmt(rows.reduce((x, r) => x + amt(r.subledgerValue) - amt(r.ledgerBalance), 0n)),
    note: 'Le sous-registre est comparé au grand livre ; les catégories partageant un compte sont agrégées et tout écart reste visible.' };
}

/* --------------------------------------------------------------- movement */

function createMovement(state: DemoState, companyId: string, body: any): DemoInvMovement {
  const s = store(state);
  const item = s.items.find((i) => i.id === body.itemId && i.company_id === companyId);
  if (!item) throw new ApiError(400, 'INVENTORY_ITEM_INVALID', 'Article inconnu');
  const cat = s.categories.find((c) => c.id === item.category_id)!;
  const location = s.locations.find((l) => l.id === body.locationId && l.company_id === companyId);
  if (!location) throw new ApiError(400, 'INVENTORY_LOCATION_INVALID', 'Emplacement inconnu');
  const qty = amt(body.quantity);
  if (qty <= 0n) throw new ApiError(400, 'INVENTORY_QUANTITY_INVALID', 'Quantité positive requise');
  if (!String(body.description ?? '').trim()) throw new ApiError(400, 'VALIDATION_ERROR', 'Description requise');
  const direction = body.direction;
  const inbound = direction === 'in' || direction === 'adjustment_in';
  if (inbound && !body.unitCost) throw new ApiError(400, 'INVENTORY_COST_REQUIRED', 'Coût unitaire requis');
  if (direction === 'transfer_out' && (!body.destinationLocationId || body.destinationLocationId === body.locationId)) {
    throw new ApiError(400, 'INVENTORY_TRANSFER_INVALID', 'Destination différente requise');
  }
  const year = body.movementDate.slice(0, 4);
  const count = s.movements.filter((m) => m.company_id === companyId && m.movement_no.startsWith(`INV-${year}-`)).length;
  const movement: DemoInvMovement = {
    id: uid(), company_id: companyId, item_id: item.id, location_id: location.id,
    destination_location_id: body.destinationLocationId ?? null, movement_no: `INV-${year}-${String(count + 1).padStart(4, '0')}`,
    movement_date: body.movementDate, direction, source_kind: body.sourceKind ?? 'adjustment',
    quantity: fmt(qty), unit_cost: body.unitCost ? fmt(amt(body.unitCost)) : null,
    value: inbound ? fmt(mul(qty, amt(body.unitCost))) : null, valuation_method: cat.valuation_method,
    reference: body.reference ?? null, description: String(body.description), document_ref: body.documentRef ?? null,
    journal_id: body.journalId ?? journal(state, companyId).id, inventory_account_id: cat.inventory_account_id,
    counterpart_account_id: body.counterpartAccountId ?? (direction === 'transfer_out' ? cat.inventory_account_id : null),
    status: 'PROPOSED', entry_id: null, approval_note: null, rejection_reason: null, posted_at: null, created_at: now(),
  };
  s.movements.push(movement);
  return movement;
}
function decide(state: DemoState, companyId: string, id: string, action: 'approve' | 'reject' | 'post', body: any) {
  const m = store(state).movements.find((x) => x.id === id && x.company_id === companyId);
  if (!m) throw new ApiError(404, 'INVENTORY_MOVEMENT_NOT_FOUND', 'Mouvement introuvable');
  if (action === 'approve') {
    if (m.status !== 'PROPOSED') throw new ApiError(409, 'INVENTORY_MOVEMENT_DECIDED', 'Déjà décidé');
    if (body.confirm !== true || String(body.note ?? '').trim().length < 10) throw new ApiError(400, 'INVENTORY_DECISION_REQUIRED', 'Note de 10 caractères requise');
    m.status = 'APPROVED'; m.approval_note = String(body.note).trim();
  } else if (action === 'reject') {
    if (!['PROPOSED', 'APPROVED'].includes(m.status)) throw new ApiError(409, 'INVENTORY_MOVEMENT_DECIDED', 'Déjà décidé');
    m.status = 'REJECTED'; m.rejection_reason = String(body.reason ?? '').trim() || null;
  } else {
    if (m.status !== 'APPROVED') throw new ApiError(409, 'INVENTORY_MOVEMENT_NOT_APPROVED', 'Approbation requise');
    const item = store(state).items.find((i) => i.id === m.item_id)!;
    const cat = store(state).categories.find((c) => c.id === item.category_id)!;
    const qty = amt(m.quantity);
    let value = m.value ? amt(m.value) : 0n;
    if (!['in', 'adjustment_in'].includes(m.direction)) {
      const lots = store(state).lots.filter((l) => l.item_id === m.item_id && l.location_id === m.location_id && amt(l.remaining_quantity) > 0n)
        .sort((a, b) => `${a.received_date}${a.id}`.localeCompare(`${b.received_date}${b.id}`));
      value = 0n;
      let remaining = 0n;
      if (cat.valuation_method === 'fifo') {
        remaining = qty;
        for (const lot of lots) {
          if (remaining === 0n) break;
          const take = amt(lot.remaining_quantity) < remaining ? amt(lot.remaining_quantity) : remaining;
          value += mul(take, amt(lot.unit_cost));
          lot.remaining_quantity = fmt(amt(lot.remaining_quantity) - take);
          remaining -= take;
        }
      } else {
        const bal = balanceOf(state, m.item_id, m.location_id);
        const availableQty = bal ? amt(bal.quantity) : 0n;
        const availableValue = bal ? amt(bal.value) : 0n;
        value = availableQty > 0n ? mul(qty, div(availableValue, availableQty)) : 0n;
        if (availableQty < qty && !cat.allow_negative_stock) throw new ApiError(409, 'INVENTORY_NEGATIVE_STOCK', 'Stock insuffisant');
      }
      if (remaining > 0n && !cat.allow_negative_stock) throw new ApiError(409, 'INVENTORY_NEGATIVE_STOCK', 'Stock insuffisant');
    }
    if (value <= 0n && m.direction !== 'transfer_out') throw new ApiError(400, 'INVENTORY_VALUE_MISSING', 'Valeur positive requise');
    const unitCost = qty > 0n ? div(value, qty) : 0n;
    const lines = m.direction === 'transfer_out'
      ? [{ accountId: m.inventory_account_id, description: 'Transfert entrée', debit: fmt(value) },
        { accountId: m.inventory_account_id, description: 'Transfert sortie', credit: fmt(value) }]
      : ['in', 'adjustment_in'].includes(m.direction)
        ? [{ accountId: m.inventory_account_id, description: m.description, debit: fmt(value) },
          { accountId: m.counterpart_account_id ?? cat.inventory_account_id, description: 'Contrepartie', credit: fmt(value) }]
        : [{ accountId: m.counterpart_account_id ?? (m.direction === 'adjustment_out' ? cat.adjustment_account_id : cat.cogs_account_id) ?? cat.cogs_account_id,
          description: 'Contrepartie', debit: fmt(value) },
        { accountId: m.inventory_account_id, description: m.description, credit: fmt(value) }];
    const entry = postEntry(state, companyId, m.journal_id, m.movement_date, m.movement_no,
      `Stock ${m.movement_no} — ${m.description}`, lines, 'inventory');
    const adjust = (locationId: string, q: bigint, v: bigint) => {
      const b = balanceOf(state, m.item_id, locationId);
      if (!b) store(state).balances.push({ item_id: m.item_id, location_id: locationId, quantity: fmt(q), value: fmt(v) });
      else { b.quantity = fmt(amt(b.quantity) + q); b.value = fmt(amt(b.value) + v); }
    };
    if (m.direction === 'transfer_out') {
      adjust(m.location_id, -qty, -value);
      adjust(m.destination_location_id!, qty, value);
      store(state).lots.push({ id: uid(), item_id: m.item_id, location_id: m.destination_location_id!, received_date: m.movement_date, unit_cost: fmt(unitCost), remaining_quantity: fmt(qty) });
    } else if (['in', 'adjustment_in'].includes(m.direction)) {
      adjust(m.location_id, qty, value);
      store(state).lots.push({ id: uid(), item_id: m.item_id, location_id: m.location_id, received_date: m.movement_date, unit_cost: fmt(unitCost), remaining_quantity: fmt(qty) });
    } else adjust(m.location_id, -qty, -value);
    m.value = fmt(value); m.unit_cost = fmt(unitCost); m.entry_id = entry.id; m.status = 'POSTED'; m.posted_at = now();
  }
  return m;
}

/* -------------------------------------------------------------- write-down */

function createWriteDown(state: DemoState, companyId: string, body: any): DemoInvWriteDown {
  const s = store(state);
  const item = s.items.find((i) => i.id === body.itemId && i.company_id === companyId);
  const location = s.locations.find((l) => l.id === body.locationId && l.company_id === companyId);
  if (!item || !location) throw new ApiError(400, 'INVENTORY_ITEM_INVALID', 'Article ou emplacement invalide');
  const cat = s.categories.find((c) => c.id === item.category_id)!;
  const amount = amt(body.amount);
  if (amount <= 0n) throw new ApiError(400, 'INVENTORY_AMOUNT_INVALID', 'Montant positif requis');
  if (!cat.write_down_account_id) throw new ApiError(400, 'INVENTORY_ACCOUNT_INVALID', 'Compte de dépréciation manquant');
  const year = body.writeDownDate.slice(0, 4);
  const count = s.writeDowns.filter((w) => w.company_id === companyId && w.write_down_no.startsWith(`WD-${year}-`)).length;
  const wd: DemoInvWriteDown = { id: uid(), company_id: companyId, write_down_no: `WD-${year}-${String(count + 1).padStart(4, '0')}`,
    item_id: item.id, location_id: location.id, write_down_date: body.writeDownDate, kind: body.kind ?? 'write_down',
    reverses_id: body.reversesId ?? null, amount: fmt(amount), reason: String(body.reason ?? ''), document_ref: String(body.documentRef ?? ''),
    journal_id: body.journalId, inventory_account_id: cat.inventory_account_id, write_down_account_id: cat.write_down_account_id,
    status: 'PROPOSED', approval_note: null, entry_id: null, rejection_reason: null, created_at: now() };
  s.writeDowns.push(wd);
  return wd;
}
function decideWriteDown(state: DemoState, companyId: string, id: string, action: string, body: any) {
  const w = store(state).writeDowns.find((x) => x.id === id && x.company_id === companyId);
  if (!w) throw new ApiError(404, 'INVENTORY_WRITE_DOWN_NOT_FOUND', 'Dépréciation introuvable');
  if (action === 'approve') {
    if (w.status !== 'PROPOSED') throw new ApiError(409, 'INVENTORY_WRITE_DOWN_DECIDED', 'Déjà décidé');
    if (body.confirm !== true || String(body.note ?? '').trim().length < 10) throw new ApiError(400, 'INVENTORY_DECISION_REQUIRED', 'Note requise');
    w.status = 'APPROVED'; w.approval_note = String(body.note).trim();
  } else if (action === 'reject') {
    if (!['PROPOSED', 'APPROVED'].includes(w.status)) throw new ApiError(409, 'INVENTORY_WRITE_DOWN_DECIDED', 'Déjà décidé');
    w.status = 'REJECTED'; w.rejection_reason = String(body.reason ?? '').trim() || null;
  } else {
    if (w.status !== 'APPROVED') throw new ApiError(409, 'INVENTORY_WRITE_DOWN_NOT_APPROVED', 'Approbation requise');
    const amount = amt(w.amount);
    if (w.kind === 'write_down') {
      const bal = balanceOf(state, w.item_id, w.location_id);
      if (!bal || amt(bal.value) < amount) throw new ApiError(409, 'INVENTORY_WRITE_DOWN_EXCEEDS', 'Dépréciation supérieure au stock');
    }
    const entry = postEntry(state, companyId, w.journal_id, w.write_down_date, w.write_down_no,
      `Dépréciation ${w.write_down_no}`, [
        { accountId: w.write_down_account_id, description: w.reason, debit: fmt(amount) },
        { accountId: w.inventory_account_id, description: w.reason, credit: fmt(amount) },
      ], 'inventory');
    const bal = balanceOf(state, w.item_id, w.location_id);
    if (bal) bal.value = fmt(amt(bal.value) + (w.kind === 'write_down' ? -amount : amount));
    w.status = 'POSTED'; w.entry_id = entry.id;
  }
  return w;
}

/* --------------------------------------------------------------- accruals */

function accrualView(state: DemoState, a: DemoAccrual) {
  const j = state.journals.find((x) => x.id === a.journal_id);
  const lines = a.lines.map((l) => {
    const e = state.entries.find((x) => x.id === l.entry_id);
    const re = state.entries.find((x) => x.id === l.reversal_entry_id);
    return { id: l.id, lineNo: l.line_no, periodStart: l.period_start, periodEnd: l.period_end,
      amount: l.amount, status: l.status, entryId: l.entry_id, entryNo: e?.entry_no ?? null,
      reversalEntryId: l.reversal_entry_id, reversalEntryNo: re?.entry_no ?? null,
      postedAt: l.posted_at, reversedAt: l.reversed_at };
  });
  return { id: a.id, reference: a.reference, kind: a.kind, description: a.description, counterparty: a.counterparty,
    documentRef: a.document_ref, pnlAccountId: a.pnl_account_id, balanceAccountId: a.balance_account_id,
    journal: { id: a.journal_id, code: j?.code, name: j?.name }, totalAmount: a.total_amount,
    startDate: a.start_date, endDate: a.end_date, months: a.months, status: a.status, notes: a.notes,
    createdByName: 'Utilisateur démo', approvedByName: a.approved_at ? 'Utilisateur démo' : null,
    approvedAt: a.approved_at, approvalNote: a.approval_note, createdAt: a.created_at,
    lines, totals: { posted: fmt(lines.filter((l) => l.status === 'POSTED').reduce((s, l) => s + amt(l.amount), 0n)),
      pending: fmt(lines.filter((l) => l.status === 'PENDING').reduce((s, l) => s + amt(l.amount), 0n)),
      reversed: fmt(lines.filter((l) => l.status === 'REVERSED').reduce((s, l) => s + amt(l.amount), 0n)) } };
}
function nextMonthEnd(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
function addMonths(value: string, n: number): string {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
function accrualLinesFor(total: bigint, months: number, start: string, end: string): DemoAccrualLine[] {
  const base = total / BigInt(months);
  return Array.from({ length: months }, (_, i) => {
    const lineStart = addMonths(start, i);
    const next = nextMonthEnd(lineStart);
    return { id: uid(), line_no: i + 1, period_start: lineStart, period_end: next > end ? end : next,
      amount: fmt(i === months - 1 ? total - base * BigInt(months - 1) : base),
      status: 'PENDING', entry_id: null, reversal_entry_id: null, posted_at: null, reversed_at: null };
  });
}
function accrualReport(state: DemoState, companyId: string, asOf: string) {
  const schedules = store(state).accruals.filter((a) => a.company_id === companyId);
  const byKind: Record<string, { posted: bigint; pending: bigint; reversed: bigint }> = {};
  for (const a of schedules) {
    for (const l of a.lines) {
      if (l.period_end > asOf) continue;
      const bucket = byKind[a.kind] ?? { posted: 0n, pending: 0n, reversed: 0n };
      if (l.status === 'POSTED') bucket.posted += amt(l.amount);
      else if (l.status === 'PENDING') bucket.pending += amt(l.amount);
      else bucket.reversed += amt(l.amount);
      byKind[a.kind] = bucket;
    }
  }
  const accounts = new Map<string, DemoAccrual>();
  for (const a of schedules) accounts.set(a.balance_account_id, a);
  const rows = [...accounts.entries()].map(([accountId]) => {
    const acc = state.accounts.find((x) => x.id === accountId);
    const schedule = schedules.filter((s) => s.balance_account_id === accountId).reduce((sum, s) => {
      for (const l of s.lines) {
        const e = state.entries.find((x) => x.id === l.entry_id);
        const re = state.entries.find((x) => x.id === l.reversal_entry_id);
        if (!e || e.entry_date > asOf || (re && re.entry_date <= asOf)) continue;
        sum += (s.kind === 'accrued_income' || s.kind === 'deferred_income') ? amt(l.amount) : -amt(l.amount);
      }
      return sum;
    }, 0n);
    const ledger = glBalance(state, companyId, accountId, asOf, 'accrual');
    return { account: { code: acc?.code, name: acc?.name }, scheduleBalance: fmt(schedule),
      ledgerBalance: fmt(ledger), difference: fmt(schedule - ledger), balanced: schedule === ledger };
  });
  return { asOf, byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k,
    { posted: fmt(v.posted), pending: fmt(v.pending), reversed: fmt(v.reversed) }])),
    reconciliation: rows, balanced: rows.every((r) => r.balanced),
    note: 'Comparaison avec les écritures du module (source accrual) ; aucun montant extérieur n’est absorbé.' };
}
function postAccrualLine(state: DemoState, companyId: string, schedule: DemoAccrual, line: DemoAccrualLine) {
  if (!['APPROVED', 'ACTIVE'].includes(schedule.status)) throw new ApiError(409, 'ACCRUAL_SCHEDULE_NOT_APPROVED', 'Approbation requise');
  if (line.status !== 'PENDING') throw new ApiError(409, 'ACCRUAL_LINE_DECIDED', 'Ligne déjà traitée');
  const value = amt(line.amount);
  const expense = schedule.kind === 'accrued_expense' || schedule.kind === 'prepaid_expense';
  const lines = expense
    ? [{ accountId: schedule.pnl_account_id, description: schedule.description, debit: fmt(value) },
      { accountId: schedule.balance_account_id, description: schedule.description, credit: fmt(value) }]
    : [{ accountId: schedule.balance_account_id, description: schedule.description, debit: fmt(value) },
      { accountId: schedule.pnl_account_id, description: schedule.description, credit: fmt(value) }];
  const entry = postEntry(state, companyId, schedule.journal_id, line.period_end, schedule.reference,
    `Échéancier ${schedule.reference} ${line.period_start} → ${line.period_end}`, lines, 'accrual');
  line.status = 'POSTED'; line.entry_id = entry.id; line.posted_at = now();
  if (schedule.lines.every((l) => l.status !== 'PENDING')) schedule.status = 'COMPLETED';
  else schedule.status = 'ACTIVE';
  return entry;
}

/* -------------------------------------------------------------- provisions */

function provisionView(state: DemoState, p: DemoProvision) {
  const expense = state.accounts.find((x) => x.id === p.expense_account_id);
  const provision = state.accounts.find((x) => x.id === p.provision_account_id);
  const movements = p.movements.map((m) => {
    const e = state.entries.find((x) => x.id === m.entry_id);
    const j = state.journals.find((x) => x.id === m.journal_id);
    const c = state.accounts.find((x) => x.id === m.counterpart_account_id);
    return { id: m.id, movementNo: m.movement_no, movementType: m.movement_type, movementDate: m.movement_date,
      amount: m.amount, direction: m.direction, reason: m.reason, documentRef: m.document_ref, status: m.status,
      journal: { id: m.journal_id, code: j?.code, name: j?.name }, counterpartAccountId: m.counterpart_account_id,
      counterpartAccount: c ? { code: c.code, name: c.name } : null, entryId: m.entry_id,
      entryNo: e?.entry_no ?? null, approvalNote: m.approval_note, rejectionReason: m.rejection_reason,
      postedAt: e ? m.created_at : null, createdAt: m.created_at };
  });
  const posted = p.movements.filter((m) => m.status === 'POSTED');
  const carrying = posted.reduce((s, m) => s + (m.direction === 'increase' ? amt(m.amount) : -amt(m.amount)), 0n);
  return { id: p.id, provisionNo: p.provision_no, category: p.category, description: p.description,
    evidenceRef: p.evidence_ref, recognitionDate: p.recognition_date, measurementBasis: p.measurement_basis,
    expenseAccountId: p.expense_account_id, provisionAccountId: p.provision_account_id,
    expenseAccount: { code: expense?.code, name: expense?.name }, provisionAccount: { code: provision?.code, name: provision?.name },
    currentPortion: p.current_portion, nonCurrentPortion: p.non_current_portion, status: p.status,
    createdAt: p.created_at, movements, pendingMovements: p.movements.filter((m) => ['PROPOSED', 'APPROVED'].includes(m.status)).length,
    totals: { recognised: fmt(posted.filter((m) => m.movement_type === 'recognition').reduce((s, m) => s + amt(m.amount), 0n)),
      revisionsUp: fmt(posted.filter((m) => m.movement_type === 'revision' && m.direction === 'increase').reduce((s, m) => s + amt(m.amount), 0n)),
      revisionsDown: fmt(posted.filter((m) => m.movement_type === 'revision' && m.direction === 'decrease').reduce((s, m) => s + amt(m.amount), 0n)),
      utilised: fmt(posted.filter((m) => m.movement_type === 'utilisation').reduce((s, m) => s + amt(m.amount), 0n)),
      reversed: fmt(posted.filter((m) => m.movement_type === 'reversal').reduce((s, m) => s + amt(m.amount), 0n)),
      carrying: fmt(carrying) },
    note: 'Totaux issus des mouvements comptabilisés. Aucun seuil de probabilité ni règle IAS 37 n’est appliqué.' };
}
function provisionReconciliation(state: DemoState, companyId: string, asOf: string) {
  const s = store(state);
  const accounts = new Set<string>();
  for (const p of s.provisions.filter((x) => x.company_id === companyId)) accounts.add(p.provision_account_id);
  const rows = [...accounts].map((accountId) => {
    const acc = state.accounts.find((x) => x.id === accountId);
    let asOfCarrying = 0n;
    for (const prov of s.provisions.filter((x) => x.company_id === companyId && x.provision_account_id === accountId)) {
      for (const m of prov.movements) {
        if (m.status === 'POSTED' && m.movement_date <= asOf) asOfCarrying += m.direction === 'increase' ? amt(m.amount) : -amt(m.amount);
      }
    }
    const ledger = glBalance(state, companyId, accountId, asOf, 'provision');
    return { account: { code: acc?.code, name: acc?.name }, carrying: fmt(asOfCarrying),
      ledgerBalance: fmt(ledger), difference: fmt(-asOfCarrying - ledger), balanced: -asOfCarrying === ledger };
  });
  return { asOf, rows, balanced: rows.every((r) => r.balanced),
    note: 'Comparaison avec les écritures du registre (source provision). Aucun montant extérieur n’est absorbé.' };
}

/* -------------------------------------------------------------------- seed */

export function seedDemoMission22(state: DemoState): void {
  const s = store(state);
  if (s.categories.length > 0) return;
  const companies = state.companies.filter((c) => !/archived/i.test(c.name)).slice(0, 2);
  for (const [index, company] of companies.entries()) {
    const companyId = company.id;
    const inv = ensureAccount(state, companyId, '1300');
    const cogs = ensureAccount(state, companyId, '5000');
    const adjust = ensureAccount(state, companyId, '5100');
    const writeDown = ensureAccount(state, companyId, '6200');
    const revenue = ensureAccount(state, companyId, '4010');
    const prepaid = ensureAccount(state, companyId, '1150');
    const liability = ensureAccount(state, companyId, '2100');
    const bank = ensureAccount(state, companyId, '1010');
    const expense = ensureAccount(state, companyId, '6130');
    const utilities = ensureAccount(state, companyId, '6110');
    const supplier = ensureAccount(state, companyId, '3100');
    const journalId = journal(state, companyId).id;
    const fifo = index === 0;
    const year = company.financial_year_start?.slice(0, 4) ?? '2025';
    const category: DemoInvCategory = { id: uid(), company_id: companyId, code: fifo ? 'FIFO-COMM' : 'WAVG-COMM',
      name: fifo ? 'Marchandises FIFO (fictif)' : 'Marchandises coût moyen (fictif)',
      valuation_method: fifo ? 'fifo' : 'weighted_average', inventory_account_id: inv.id, cogs_account_id: cogs.id,
      adjustment_account_id: adjust.id, write_down_account_id: writeDown.id, allow_negative_stock: false, is_active: true, created_at: now() };
    s.categories.push(category);
    const location: DemoInvLocation = { id: uid(), company_id: companyId, code: 'MAIN',
      name: 'Magasin principal fictif', description: 'Entrepôt fictif', is_active: true };
    s.locations.push(location);
    const item: DemoInvItem = { id: uid(), company_id: companyId, category_id: category.id,
      sku: fifo ? 'DEMO-FIFO-01' : 'DEMO-WAVG-01', name: fifo ? 'Article FIFO fictif' : 'Article coût moyen fictif',
      unit: 'unité', reorder_level: '10.0000', is_active: true };
    s.items.push(item);
    const mk = (date: string, direction: string, qty: string, unitCost: string | null, sourceKind: string,
      description: string): DemoInvMovement => {
      const q = amt(qty);
      return { id: uid(), company_id: companyId, item_id: item.id, location_id: location.id,
        destination_location_id: null, movement_no: `INV-${date.slice(0, 4)}-${String(s.movements.length + 1).padStart(4, '0')}`,
        movement_date: date, direction, source_kind: sourceKind, quantity: fmt(q),
        unit_cost: unitCost ? fmt(amt(unitCost)) : null, value: unitCost ? fmt(mul(q, amt(unitCost))) : null,
        valuation_method: category.valuation_method, reference: null, description,
        document_ref: `DEMO-${sourceKind.toUpperCase()}`, journal_id: journalId, inventory_account_id: inv.id,
        counterpart_account_id: direction === 'in' ? supplier.id : cogs.id, status: 'APPROVED', entry_id: null,
        approval_note: 'Validation fictive de démonstration.', rejection_reason: null, posted_at: null, created_at: now() };
    };
    const opening = mk(`${year}-07-02`, 'in', '100', '10', 'opening', 'Stock d’ouverture fictif');
    const purchase = mk(`${year}-08-05`, 'in', '40', '12', 'receipt', 'Achat fictif');
    const issue = mk(`${year}-09-10`, 'out', '30', null, 'issue', 'Vente fictive');
    s.movements.push(opening, purchase, issue);
    for (const m of [opening, purchase, issue]) decide(state, companyId, m.id, 'post', {});

    const write = createWriteDown(state, companyId, { itemId: item.id, locationId: location.id,
      writeDownDate: `${year}-10-15`, amount: '100', reason: 'Obsolescence fictive documentée.', documentRef: 'WD-DEMO-001',
      journalId });
    write.status = 'APPROVED'; write.approval_note = 'Validation fictive.';
    decideWriteDown(state, companyId, write.id, 'post', {});

    const prepaidTotal = 24_000n * SCALE;
    const prep: DemoAccrual = { id: uid(), company_id: companyId, reference: `PRE-DEMO-${index + 1}`,
      kind: 'prepaid_expense', description: 'Assurance fictive payée d’avance', counterparty: 'Assureur fictif',
      document_ref: 'POL-DEMO-001', pnl_account_id: ensureAccount(state, companyId, '6150').id,
      balance_account_id: prepaid.id, journal_id: journalId, total_amount: fmt(prepaidTotal),
      start_date: `${year}-07-01`, end_date: `${Number(year) + 1}-06-30`, months: 12, notes: 'Donnée fictive de démonstration.',
      status: 'APPROVED', approval_note: 'Validation fictive.', approved_at: now(), created_at: now(),
      lines: accrualLinesFor(prepaidTotal, 12, `${year}-07-01`, `${Number(year) + 1}-06-30`) };
    s.accruals.push(prep);
    for (const line of prep.lines.slice(0, 3)) postAccrualLine(state, companyId, prep, line);

    const accruedTotal = 9_000n * SCALE;
    const accrued: DemoAccrual = { id: uid(), company_id: companyId, reference: `ACC-DEMO-${index + 1}`,
      kind: 'accrued_expense', description: 'Charges d’eau et électricité fictives à payer', counterparty: 'Fournisseur fictif',
      document_ref: 'UTIL-DEMO-001', pnl_account_id: utilities.id, balance_account_id: liability.id,
      journal_id: journalId, total_amount: fmt(accruedTotal), start_date: `${year}-07-01`, end_date: `${year}-09-30`,
      months: 3, notes: 'Donnée fictive.', status: 'APPROVED', approval_note: 'Validation fictive.', approved_at: now(),
      created_at: now(), lines: accrualLinesFor(accruedTotal, 3, `${year}-07-01`, `${year}-09-30`) };
    s.accruals.push(accrued);
    postAccrualLine(state, companyId, accrued, accrued.lines[0]!);

    const deferredTotal = 6_000n * SCALE;
    const deferred: DemoAccrual = { id: uid(), company_id: companyId, reference: `DEF-DEMO-${index + 1}`,
      kind: 'deferred_income', description: 'Prestation fictive facturée d’avance', counterparty: 'Client fictif',
      document_ref: 'CONTRACT-DEMO-001', pnl_account_id: revenue.id, balance_account_id: liability.id,
      journal_id: journalId, total_amount: fmt(deferredTotal), start_date: `${year}-07-01`, end_date: `${year}-09-30`,
      months: 3, notes: 'Donnée fictive.', status: 'APPROVED', approval_note: 'Validation fictive.', approved_at: now(),
      created_at: now(), lines: accrualLinesFor(deferredTotal, 3, `${year}-07-01`, `${year}-09-30`) };
    s.accruals.push(deferred);
    postAccrualLine(state, companyId, deferred, deferred.lines[0]!);

    const warranty: DemoProvision = { id: uid(), company_id: companyId, provision_no: `PROV-${year}-0001`,
      category: 'warranty', description: 'Garantie fictive sur équipements vendus', evidence_ref: 'WARRANTY-DEMO-001',
      recognition_date: `${year}-08-01`, measurement_basis: 'Estimation de gestion fictive, à revoir par un professionnel.',
      expense_account_id: expense.id, provision_account_id: liability.id, current_portion: '50000.0000',
      non_current_portion: '0.0000', status: 'ACTIVE', created_at: now(), movements: [] };
    s.provisions.push(warranty);
    const rec: DemoProvisionMovement = { id: uid(), movement_no: `PM-${year}-0001`, movement_type: 'recognition',
      movement_date: `${year}-08-01`, amount: '50000.0000', direction: 'increase', reason: 'Reconnaissance fictive documentée.',
      document_ref: 'WARRANTY-DEMO-001', journal_id: journalId, counterpart_account_id: null, status: 'POSTED',
      approval_note: 'Validation fictive.', rejection_reason: null, entry_id: null, created_at: now() };
    warranty.movements.push(rec);
    rec.entry_id = postEntry(state, companyId, journalId, rec.movement_date, rec.movement_no,
      'Reconnaissance de provision fictive', [
        { accountId: expense.id, description: rec.reason, debit: '50000.0000' },
        { accountId: liability.id, description: rec.reason, credit: '50000.0000' },
      ], 'provision').id;
    const use: DemoProvisionMovement = { id: uid(), movement_no: `PM-${year}-0002`, movement_type: 'utilisation',
      movement_date: `${year}-09-15`, amount: '20000.0000', direction: 'decrease',
      reason: 'Utilisation fictive contre facture de réparation.', document_ref: 'USE-DEMO-001', journal_id: journalId,
      counterpart_account_id: bank.id, status: 'POSTED', approval_note: 'Validation fictive.', rejection_reason: null,
      entry_id: null, created_at: now() };
    warranty.movements.push(use);
    use.entry_id = postEntry(state, companyId, journalId, use.movement_date, use.movement_no,
      'Utilisation de provision fictive', [
        { accountId: liability.id, description: use.reason, debit: '20000.0000' },
        { accountId: bank.id, description: use.reason, credit: '20000.0000' },
      ], 'provision').id;
    const rev: DemoProvisionMovement = { id: uid(), movement_no: `PM-${year}-0003`, movement_type: 'reversal',
      movement_date: `${year}-10-01`, amount: '30000.0000', direction: 'decrease',
      reason: 'Reprise fictive du solde après revue.', document_ref: 'REVERSAL-DEMO-001', journal_id: journalId,
      counterpart_account_id: null, status: 'POSTED', approval_note: 'Validation fictive.', rejection_reason: null,
      entry_id: null, created_at: now() };
    warranty.movements.push(rev);
    rev.entry_id = postEntry(state, companyId, journalId, rev.movement_date, rev.movement_no,
      'Reprise de provision fictive', [
        { accountId: liability.id, description: rev.reason, debit: '30000.0000' },
        { accountId: expense.id, description: rev.reason, credit: '30000.0000' },
      ], 'provision').id;
    warranty.status = 'REVERSED';
  }
}


/** Mission 22 — data used by the financial-year checklist (demo only). */
export function demoMission22Checklist(state: DemoState, companyId: string, asOf: string) {
  const s = store(state);
  const categories = s.categories.filter((c) => c.company_id === companyId);
  const movements = s.movements.filter((m) => m.company_id === companyId);
  const writeDowns = s.writeDowns.filter((w) => w.company_id === companyId);
  const counts = s.counts.filter((c) => c.company_id === companyId);
  const accruals = s.accruals.filter((a) => a.company_id === companyId);
  const provisions = s.provisions.filter((p) => p.company_id === companyId);
  return {
    categories: categories.length,
    pendingMovements: movements.filter((m) => ['PROPOSED', 'APPROVED'].includes(m.status)).length,
    draftCounts: counts.filter((c) => c.status === 'DRAFT').length,
    pendingWriteDowns: writeDowns.filter((w) => ['PROPOSED', 'APPROVED'].includes(w.status)).length,
    negativeBalances: s.balances.filter((b) => b.quantity.startsWith('-')).length,
    reconciliation: categories.length > 0 ? reconciliation(state, companyId, asOf) : null,
    schedules: accruals.length,
    draftSchedules: accruals.filter((a) => a.status === 'DRAFT').length,
    pendingAccrualLines: accruals.flatMap((a) => a.lines).filter((l) => l.status === 'PENDING' && l.period_end <= asOf).length,
    missingAccrualEvidence: accruals.filter((a) => !a.document_ref.trim()).length,
    provisions: provisions.length,
    pendingProvisionMovements: provisions.flatMap((p) => p.movements).filter((m) => ['PROPOSED', 'APPROVED'].includes(m.status)).length,
    missingProvisionEvidence: provisions.filter((p) => !p.evidence_ref.trim()).length,
  };
}

/* ----------------------------------------------------------------- handler */

export function handleDemoMission22(state: DemoState, companyId: string, method: string, rest: string,
  query: Record<string, string>, payload: Record<string, any>): unknown {
  member(state, companyId);
  const s = store(state);
  const write = () => writeMember(state, companyId);
  const asOf = query.asOf ?? new Date().toISOString().slice(0, 10);

  if (rest === '/categories' && method === 'GET') return { categories: s.categories.filter((c) => c.company_id === companyId).map(categoryView) };
  if (rest === '/categories' && method === 'POST') {
    write();
    if (!payload.code || !payload.name) throw new ApiError(400, 'VALIDATION_ERROR', 'Code et nom requis');
    const c: DemoInvCategory = { id: uid(), company_id: companyId, code: String(payload.code).trim(), name: String(payload.name).trim(),
      valuation_method: payload.valuationMethod, inventory_account_id: payload.inventoryAccountId, cogs_account_id: payload.cogsAccountId,
      adjustment_account_id: payload.adjustmentAccountId ?? null, write_down_account_id: payload.writeDownAccountId ?? null,
      allow_negative_stock: Boolean(payload.allowNegativeStock), is_active: true, created_at: now() };
    s.categories.push(c); return { category: categoryView(c) };
  }
  const catMatch = /^\/categories\/([^/]+)$/.exec(rest);
  if (catMatch && method === 'PUT') {
    write();
    const c = s.categories.find((x) => x.id === catMatch[1] && x.company_id === companyId);
    if (!c) throw new ApiError(404, 'INVENTORY_CATEGORY_NOT_FOUND', 'Catégorie introuvable');
    if (payload.code !== undefined) c.code = String(payload.code).trim();
    if (payload.name !== undefined) c.name = String(payload.name).trim();
    if (payload.valuationMethod !== undefined) c.valuation_method = payload.valuationMethod;
    if (payload.inventoryAccountId !== undefined) c.inventory_account_id = payload.inventoryAccountId;
    if (payload.cogsAccountId !== undefined) c.cogs_account_id = payload.cogsAccountId;
    if (payload.adjustmentAccountId !== undefined) c.adjustment_account_id = payload.adjustmentAccountId || null;
    if (payload.writeDownAccountId !== undefined) c.write_down_account_id = payload.writeDownAccountId || null;
    if (payload.allowNegativeStock !== undefined) c.allow_negative_stock = Boolean(payload.allowNegativeStock);
    if (payload.isActive !== undefined) c.is_active = Boolean(payload.isActive);
    return { category: categoryView(c) };
  }
  if (rest === '/locations' && method === 'GET') return { locations: s.locations.filter((l) => l.company_id === companyId).map(locationView) };
  if (rest === '/locations' && method === 'POST') {
    write();
    const l: DemoInvLocation = { id: uid(), company_id: companyId, code: String(payload.code ?? '').trim(),
      name: String(payload.name ?? '').trim(), description: payload.description ?? null, is_active: true };
    if (!l.code || !l.name) throw new ApiError(400, 'VALIDATION_ERROR', 'Code et nom requis');
    s.locations.push(l); return { location: locationView(l) };
  }
  const locMatch = /^\/locations\/([^/]+)$/.exec(rest);
  if (locMatch && method === 'PUT') {
    write();
    const l = s.locations.find((x) => x.id === locMatch[1] && x.company_id === companyId);
    if (!l) throw new ApiError(404, 'INVENTORY_LOCATION_NOT_FOUND', 'Emplacement introuvable');
    if (payload.code !== undefined) l.code = String(payload.code).trim();
    if (payload.name !== undefined) l.name = String(payload.name).trim();
    if (payload.description !== undefined) l.description = payload.description || null;
    if (payload.isActive !== undefined) l.is_active = Boolean(payload.isActive);
    return { location: locationView(l) };
  }
  if (rest === '/items' && method === 'GET') return { items: s.items.filter((i) => i.company_id === companyId).map((i) => itemView(state, companyId, i)) };
  if (rest === '/items' && method === 'POST') {
    write();
    const i: DemoInvItem = { id: uid(), company_id: companyId, category_id: payload.categoryId, sku: String(payload.sku ?? '').trim(),
      name: String(payload.name ?? '').trim(), unit: String(payload.unit ?? 'unité'), reorder_level: payload.reorderLevel ?? null, is_active: true };
    if (!s.categories.some((c) => c.id === i.category_id && c.company_id === companyId)) throw new ApiError(400, 'INVENTORY_CATEGORY_INACTIVE', 'Catégorie invalide');
    if (!i.sku || !i.name) throw new ApiError(400, 'VALIDATION_ERROR', 'SKU et nom requis');
    s.items.push(i); return { item: itemView(state, companyId, i) };
  }
  const itemMatch = /^\/items\/([^/]+)$/.exec(rest);
  if (itemMatch && method === 'PUT') {
    write();
    const i = s.items.find((x) => x.id === itemMatch[1] && x.company_id === companyId);
    if (!i) throw new ApiError(404, 'INVENTORY_ITEM_NOT_FOUND', 'Article introuvable');
    if (payload.categoryId !== undefined) i.category_id = payload.categoryId;
    if (payload.sku !== undefined) i.sku = String(payload.sku).trim();
    if (payload.name !== undefined) i.name = String(payload.name).trim();
    if (payload.unit !== undefined) i.unit = String(payload.unit);
    if (payload.reorderLevel !== undefined) i.reorder_level = payload.reorderLevel || null;
    if (payload.isActive !== undefined) i.is_active = Boolean(payload.isActive);
    return { item: itemView(state, companyId, i) };
  }
  const bridgeMatch = /^\/movements\/from-billing\/([^/]+)$/.exec(rest);
  if (bridgeMatch && method === 'POST') {
    write();
    const doc = state.billingDocuments.find((d) => d.id === bridgeMatch[1] && d.company_id === companyId);
    if (!doc) throw new ApiError(404, 'INVENTORY_SOURCE_NOT_FOUND', 'Facture introuvable');
    if (doc.kind !== 'invoice' || doc.status !== 'issued') throw new ApiError(409, 'INVENTORY_SOURCE_INVALID', 'Facture émise requise');
    const docNo = doc.doc_no ?? doc.id.slice(0, 8);
    const movements = (payload.lines ?? []).map((line: any) => createMovement(state, companyId, {
      itemId: line.itemId, locationId: line.locationId, movementDate: doc.issue_date,
      direction: 'out', sourceKind: 'issue', quantity: line.quantity, unitCost: null,
      reference: docNo, description: `Sortie ${docNo}`, documentRef: `billing:${docNo}`,
      journalId: payload.journalId, counterpartAccountId: null,
    }));
    return { document: { id: doc.id, docNo }, movements: movements.map((m: DemoInvMovement) => movementView(state, m)) };
  }
  if (rest === '/movements' && method === 'GET') {
    const list = s.movements.filter((m) => m.company_id === companyId
      && (!query.status || m.status === query.status)
      && (!query.from || m.movement_date >= query.from) && (!query.to || m.movement_date <= query.to)
      && (!query.itemId || m.item_id === query.itemId))
      .sort((a, b) => `${b.movement_date}${b.movement_no}`.localeCompare(`${a.movement_date}${a.movement_no}`));
    return { movements: list.map((m) => movementView(state, m)) };
  }
  if (rest === '/movements' && method === 'POST') { write(); return { movement: movementView(state, createMovement(state, companyId, payload)) }; }
  if (rest === '/transfers' && method === 'POST') {
    write();
    return { movement: movementView(state, createMovement(state, companyId, { ...payload, direction: 'transfer_out', sourceKind: 'transfer' })) };
  }
  const moveMatch = /^\/movements\/([^/]+)(?:\/(approve|reject|post))?$/.exec(rest);
  if (moveMatch) {
    const [, id, action] = moveMatch;
    if (method === 'GET') {
      const m = s.movements.find((x) => x.id === id && x.company_id === companyId);
      if (!m) throw new ApiError(404, 'INVENTORY_MOVEMENT_NOT_FOUND', 'Mouvement introuvable');
      return { movement: movementView(state, m) };
    }
    write();
    const m = decide(state, companyId, id!, action as any, payload);
    return action === 'post'
      ? { movement: movementView(state, m), entry: state.entries.find((e) => e.id === m.entry_id) }
      : { movement: movementView(state, m) };
  }
  if (rest === '/counts' && method === 'GET') return { counts: s.counts.filter((c) => c.company_id === companyId).map((c) => countView(state, companyId, c)) };
  if (rest === '/counts' && method === 'POST') {
    write();
    const location = s.locations.find((l) => l.id === payload.locationId && l.company_id === companyId);
    if (!location) throw new ApiError(400, 'INVENTORY_LOCATION_INVALID', 'Emplacement invalide');
    if (!Array.isArray(payload.lines) || payload.lines.length === 0) throw new ApiError(400, 'INVENTORY_COUNT_LINES_REQUIRED', 'Ligne requise');
    const year = payload.countDate.slice(0, 4);
    const count: DemoInvCount = { id: uid(), company_id: companyId, location_id: location.id,
      count_no: `CNT-${year}-${String(s.counts.filter((c) => c.company_id === companyId).length + 1).padStart(4, '0')}`,
      count_date: payload.countDate, reference: payload.reference ?? null, notes: payload.notes ?? null,
      status: 'DRAFT', created_at: now(), lines: payload.lines.map((l: any) => {
        const item = s.items.find((i) => i.id === l.itemId && i.company_id === companyId);
        if (!item) throw new ApiError(400, 'INVENTORY_ITEM_INVALID', 'Article invalide');
        const bal = balanceOf(state, l.itemId, location.id);
        const system = bal ? amt(bal.quantity) : 0n;
        const counted = amt(l.countedQuantity);
        return { id: uid(), item_id: l.itemId, counted_quantity: fmt(counted), system_quantity: fmt(system),
          difference: fmt(counted - system), unit_cost: l.unitCost ? fmt(amt(l.unitCost)) : (system > 0n && bal ? fmt(div(amt(bal.value), system)) : null),
          movement_id: null };
      }) };
    s.counts.push(count); return { count: countView(state, companyId, count) };
  }
  const countMatch = /^\/counts\/([^/]+)(\/generate-adjustments)?$/.exec(rest);
  if (countMatch) {
    const count = s.counts.find((c) => c.id === countMatch[1] && c.company_id === companyId);
    if (!count) throw new ApiError(404, 'INVENTORY_COUNT_NOT_FOUND', 'Inventaire introuvable');
    if (method === 'GET') return { count: countView(state, companyId, count) };
    write();
    if (count.status !== 'DRAFT') throw new ApiError(409, 'INVENTORY_COUNT_DECIDED', 'Inventaire déjà traité');
    if (!countMatch[2]) throw new ApiError(404, 'NOT_FOUND', 'Route inconnue');
    const cat = s.categories.find((c) => c.id === s.items.find((i) => i.id === count.lines[0]?.item_id)?.category_id);
    const movements: string[] = [];
    for (const line of count.lines) {
      const diff = amt(line.difference);
      if (diff === 0n) continue;
      const movement = createMovement(state, companyId, { itemId: line.item_id, locationId: count.location_id,
        movementDate: count.count_date, direction: diff > 0n ? 'adjustment_in' : 'adjustment_out',
        sourceKind: 'count', quantity: fmt(diff > 0n ? diff : -diff),
        unitCost: diff > 0n ? line.unit_cost : null, description: `Ajustement inventaire ${count.count_no}`,
        documentRef: count.reference ?? count.count_no, journalId: journal(state, companyId).id,
        counterpartAccountId: cat?.adjustment_account_id ?? null });
      line.movement_id = movement.id; movements.push(movement.id);
    }
    count.status = 'POSTED';
    return { count: countView(state, companyId, count), movements };
  }
  if (rest === '/write-downs' && method === 'GET') return { writeDowns: s.writeDowns.filter((w) => w.company_id === companyId).map((w) => writeDownView(state, w)) };
  if (rest === '/write-downs' && method === 'POST') { write(); return { writeDown: writeDownView(state, createWriteDown(state, companyId, payload)) }; }
  const wdMatch = /^\/write-downs\/([^/]+)\/(approve|reject|post)$/.exec(rest);
  if (wdMatch) {
    write();
    return { writeDown: writeDownView(state, decideWriteDown(state, companyId, wdMatch[1]!, wdMatch[2]!, payload)) };
  }
  if (rest === '/report' && method === 'GET') return valuation(state, companyId, asOf);
  if (rest === '/reconciliation' && method === 'GET') return reconciliation(state, companyId, asOf);

  if (rest === '/accruals' && method === 'GET') {
    const list = s.accruals.filter((a) => a.company_id === companyId
      && (!query.kind || a.kind === query.kind) && (!query.status || a.status === query.status)
      && (!query.from || a.end_date >= query.from) && (!query.to || a.start_date <= query.to));
    return { schedules: list.map((a) => accrualView(state, a)) };
  }
  if (rest === '/accruals' && method === 'POST') {
    write();
    const total = amt(payload.totalAmount);
    if (total <= 0n) throw new ApiError(400, 'ACCRUAL_AMOUNT_INVALID', 'Montant positif requis');
    if (!Number.isInteger(payload.months) || payload.months < 1) throw new ApiError(400, 'ACCRUAL_MONTHS_INVALID', 'Nombre de périodes invalide');
    if (!payload.documentRef) throw new ApiError(400, 'ACCRUAL_EVIDENCE_REQUIRED', 'Justificatif requis');
    const a: DemoAccrual = { id: uid(), company_id: companyId, reference: payload.reference, kind: payload.kind,
      description: payload.description, counterparty: payload.counterparty ?? null, document_ref: payload.documentRef,
      pnl_account_id: payload.pnlAccountId, balance_account_id: payload.balanceAccountId, journal_id: payload.journalId,
      total_amount: fmt(total), start_date: payload.startDate, end_date: payload.endDate, months: payload.months,
      notes: payload.notes ?? null, status: 'DRAFT', approval_note: null, approved_at: null, created_at: now(),
      lines: accrualLinesFor(total, payload.months, payload.startDate, payload.endDate) };
    s.accruals.push(a); return { schedule: accrualView(state, a) };
  }
  if (rest === '/accruals/report' && method === 'GET') return accrualReport(state, companyId, asOf);
  const accMatch = /^\/accruals\/([^/]+)(?:\/(approve|cancel|post-due))?$/.exec(rest);
  if (accMatch) {
    const a = s.accruals.find((x) => x.id === accMatch[1] && x.company_id === companyId);
    if (!a) throw new ApiError(404, 'ACCRUAL_SCHEDULE_NOT_FOUND', 'Échéancier introuvable');
    if (method === 'GET') return { schedule: accrualView(state, a) };
    write();
    if (accMatch[2] === 'approve') {
      if (a.status !== 'DRAFT') throw new ApiError(409, 'ACCRUAL_SCHEDULE_DECIDED', 'Déjà décidé');
      if (payload.confirm !== true || String(payload.note ?? '').trim().length < 10) throw new ApiError(400, 'ACCRUAL_DECISION_REQUIRED', 'Note requise');
      a.status = 'APPROVED'; a.approval_note = String(payload.note).trim(); a.approved_at = now();
    } else if (accMatch[2] === 'cancel') {
      if (!['DRAFT', 'APPROVED'].includes(a.status)) throw new ApiError(409, 'ACCRUAL_SCHEDULE_DECIDED', 'Déjà comptabilisé');
      a.status = 'CANCELLED';
    } else if (accMatch[2] === 'post-due') {
      for (const line of a.lines) if (line.status === 'PENDING' && line.period_end <= asOf) postAccrualLine(state, companyId, a, line);
    }
    return { schedule: accrualView(state, a) };
  }
  const lineMatch = /^\/accruals\/([^/]+)\/lines\/([^/]+)\/(post|reverse)$/.exec(rest);
  if (lineMatch) {
    const a = s.accruals.find((x) => x.id === lineMatch[1] && x.company_id === companyId);
    if (!a) throw new ApiError(404, 'ACCRUAL_SCHEDULE_NOT_FOUND', 'Échéancier introuvable');
    const line = a.lines.find((l) => l.id === lineMatch[2]);
    if (!line) throw new ApiError(404, 'ACCRUAL_LINE_NOT_FOUND', 'Ligne introuvable');
    write();
    if (lineMatch[3] === 'post') return { schedule: accrualView(state, a), entry: postAccrualLine(state, companyId, a, line) };
    if (line.status !== 'POSTED') throw new ApiError(409, 'ACCRUAL_LINE_NOT_POSTED', 'Ligne non comptabilisée');
    if (!payload.reversalDate || !payload.reason) throw new ApiError(400, 'ACCRUAL_REVERSAL_REASON_REQUIRED', 'Motif requis');
    const amount = amt(line.amount);
    const expense = a.kind === 'accrued_expense' || a.kind === 'prepaid_expense';
    const lines = expense
      ? [{ accountId: a.balance_account_id, description: payload.reason, debit: fmt(amount) },
        { accountId: a.pnl_account_id, description: payload.reason, credit: fmt(amount) }]
      : [{ accountId: a.pnl_account_id, description: payload.reason, debit: fmt(amount) },
        { accountId: a.balance_account_id, description: payload.reason, credit: fmt(amount) }];
    const e = postEntry(state, companyId, a.journal_id, payload.reversalDate, `${a.reference}-REV`,
      `Extourne ${a.reference}`, lines, 'accrual');
    line.status = 'REVERSED'; line.reversal_entry_id = e.id; line.reversed_at = now();
    return { schedule: accrualView(state, a), entry: e };
  }

  if (rest === '/provisions' && method === 'GET') {
    return { provisions: s.provisions.filter((p) => p.company_id === companyId
      && (!query.category || p.category === query.category) && (!query.status || p.status === query.status))
      .map((p) => provisionView(state, p)) };
  }
  if (rest === '/provisions' && method === 'POST') {
    write();
    if (!payload.evidenceRef || !payload.measurementBasis) throw new ApiError(400, 'PROVISION_EVIDENCE_REQUIRED', 'Preuve et base de mesure requises');
    const initial = payload.initialAmount ? amt(payload.initialAmount) : 0n;
    const year = payload.recognitionDate.slice(0, 4);
    const p: DemoProvision = { id: uid(), company_id: companyId,
      provision_no: `PROV-${year}-${String(s.provisions.filter((x) => x.company_id === companyId).length + 1).padStart(4, '0')}`,
      category: payload.category, description: payload.description, evidence_ref: payload.evidenceRef,
      recognition_date: payload.recognitionDate, measurement_basis: payload.measurementBasis,
      expense_account_id: payload.expenseAccountId, provision_account_id: payload.provisionAccountId,
      current_portion: payload.currentPortion ?? '0.0000', non_current_portion: payload.nonCurrentPortion ?? '0.0000',
      status: 'DRAFT', created_at: now(), movements: [] };
    if (initial > 0n) p.movements.push({ id: uid(),
      movement_no: `PM-${year}-${String(s.provisions.length + 1).padStart(4, '0')}`,
      movement_type: 'recognition', movement_date: payload.recognitionDate, amount: fmt(initial), direction: 'increase',
      reason: payload.initialReason || 'Reconnaissance initiale fictive.', document_ref: payload.documentRef || payload.evidenceRef,
      journal_id: payload.journalId ?? journal(state, companyId).id, counterpart_account_id: null, status: 'PROPOSED',
      approval_note: null, rejection_reason: null, entry_id: null, created_at: now() });
    s.provisions.push(p); return { provision: provisionView(state, p) };
  }
  if (rest === '/provisions/reconciliation' && method === 'GET') return provisionReconciliation(state, companyId, asOf);
  if (rest === '/provisions/report' && method === 'GET') {
    const rows = s.provisions.filter((p) => p.company_id === companyId).flatMap((p) => {
      const view = provisionView(state, p);
      return p.movements
        .filter((m) => m.movement_date >= (query.from ?? '0000-01-01') && m.movement_date <= (query.to ?? '9999-12-31'))
        .map((m) => ({ ...view.movements.find((x) => x.id === m.id), provisionNo: p.provision_no,
          category: p.category, provisionDescription: p.description, provisionStatus: p.status }));
    });
    return { from: query.from, to: query.to, movements: rows };
  }
  const provMatch = /^\/provisions\/([^/]+)\/movements$/.exec(rest);
  if (provMatch && method === 'POST') {
    const p = s.provisions.find((x) => x.id === provMatch[1] && x.company_id === companyId);
    if (!p) throw new ApiError(404, 'PROVISION_NOT_FOUND', 'Provision introuvable');
    write();
    if (!['DRAFT', 'ACTIVE'].includes(p.status)) throw new ApiError(409, 'PROVISION_CLOSED', 'Provision clôturée');
    const amount = amt(payload.amount);
    if (amount <= 0n) throw new ApiError(400, 'PROVISION_AMOUNT_INVALID', 'Montant positif requis');
    if (payload.movementType === 'recognition' && p.movements.some((m) => m.movement_type === 'recognition')) {
      throw new ApiError(409, 'PROVISION_RECOGNITION_EXISTS', 'Reconnaissance déjà proposée');
    }
    const year = payload.movementDate.slice(0, 4);
    const m: DemoProvisionMovement = { id: uid(), movement_no: `PM-${year}-${String(p.movements.length + 1).padStart(4, '0')}`,
      movement_type: payload.movementType, movement_date: payload.movementDate, amount: fmt(amount),
      direction: payload.movementType === 'recognition' ? 'increase'
        : payload.movementType === 'revision' ? (payload.direction ?? 'increase') : 'decrease',
      reason: payload.reason, document_ref: payload.documentRef, journal_id: payload.journalId,
      counterpart_account_id: payload.counterpartAccountId ?? null, status: 'PROPOSED', approval_note: null,
      rejection_reason: null, entry_id: null, created_at: now() };
    p.movements.push(m); return { provision: provisionView(state, p), movementId: m.id };
  }
  const provDetail = /^\/provisions\/([^/]+)$/.exec(rest);
  if (provDetail && method === 'GET') {
    const p = s.provisions.find((x) => x.id === provDetail[1] && x.company_id === companyId);
    if (!p) throw new ApiError(404, 'PROVISION_NOT_FOUND', 'Provision introuvable');
    return { provision: provisionView(state, p) };
  }
  const provMove = /^\/provisions\/movements\/([^/]+)\/(approve|reject|post)$/.exec(rest);
  if (provMove) {
    write();
    let found: { p: DemoProvision; m: DemoProvisionMovement } | null = null;
    for (const p of s.provisions.filter((x) => x.company_id === companyId)) {
      const m = p.movements.find((x) => x.id === provMove[1]);
      if (m) found = { p, m };
    }
    if (!found) throw new ApiError(404, 'PROVISION_MOVEMENT_NOT_FOUND', 'Mouvement introuvable');
    const { p, m } = found;
    if (provMove[2] === 'approve') {
      if (m.status !== 'PROPOSED') throw new ApiError(409, 'PROVISION_MOVEMENT_DECIDED', 'Déjà décidé');
      if (payload.confirm !== true || String(payload.note ?? '').trim().length < 10) throw new ApiError(400, 'PROVISION_DECISION_REQUIRED', 'Note requise');
      m.status = 'APPROVED'; m.approval_note = String(payload.note).trim();
    } else if (provMove[2] === 'reject') {
      if (m.status !== 'PROPOSED') throw new ApiError(409, 'PROVISION_MOVEMENT_DECIDED', 'Déjà décidé');
      m.status = 'REJECTED'; m.rejection_reason = String(payload.reason ?? '').trim() || null;
    } else {
      if (m.status !== 'APPROVED') throw new ApiError(409, 'PROVISION_MOVEMENT_NOT_APPROVED', 'Approbation requise');
      const value = amt(m.amount);
      const increase = m.direction === 'increase';
      const lines = m.movement_type === 'utilisation'
        ? [{ accountId: p.provision_account_id, description: m.reason, debit: fmt(value) },
          { accountId: m.counterpart_account_id ?? p.expense_account_id, description: m.reason, credit: fmt(value) }]
        : increase
          ? [{ accountId: p.expense_account_id, description: m.reason, debit: fmt(value) },
            { accountId: p.provision_account_id, description: m.reason, credit: fmt(value) }]
          : [{ accountId: p.provision_account_id, description: m.reason, debit: fmt(value) },
            { accountId: p.expense_account_id, description: m.reason, credit: fmt(value) }];
      const e = postEntry(state, companyId, m.journal_id, m.movement_date, m.movement_no,
        `Provision ${m.movement_no}`, lines, 'provision');
      m.status = 'POSTED'; m.entry_id = e.id;
      if (m.movement_type === 'recognition') p.status = 'ACTIVE';
      const carrying = p.movements.filter((x) => x.status === 'POSTED')
        .reduce((sum, x) => sum + (x.direction === 'increase' ? amt(x.amount) : -amt(x.amount)), 0n);
      if (carrying === 0n && m.movement_type === 'reversal') p.status = 'REVERSED';
    }
    return { provision: provisionView(state, p) };
  }
  throw new ApiError(404, 'NOT_FOUND', 'Route stock/échéancier/provision inconnue');
}

export function demoMission22Csv(state: DemoState, companyId: string, path: string): string {
  const query = Object.fromEntries(new URLSearchParams(path.split('?')[1] ?? '').entries());
  const report = valuation(state, companyId, query.asOf ?? new Date().toISOString().slice(0, 10));
  const rows = [['SKU', 'Article', 'Catégorie', 'Méthode', 'Emplacement', 'Quantité', 'Valeur', 'Coût unitaire'],
    ...report.rows.map((r) => [r.sku, r.name, r.category.code, r.category.valuationMethod, r.location.code, r.quantity, r.value, r.unitCost])];
  return '\uFEFF' + rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n') + '\r\n';
}
