/**
 * Mission 22 — inventory subledger (FIFO and weighted average).
 *
 * Quantities and values are exact decimals with four places, handled as BigInt.
 * A movement is proposed, approved by a human and only then posted. Posting
 * creates a balanced journal entry through the shared accounting engine and
 * updates the subledger atomically. No statutory Mauritian valuation rule is
 * encoded: the valuation method and every account are chosen by the user.
 */
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { postEntryTx } from '../../lib/posting.js';
import { writeAudit } from '../../lib/audit.js';
import { assertOpenPeriod } from '../entries/service.js';

export interface InventoryActor {
  companyId: string;
  userId: string;
  ip?: string | null;
}

const SCALE = 10_000n;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const qty = (value: unknown): bigint => parseAmount(value ?? 0);
const fmt = (value: bigint) => formatAmount(value);

function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw badRequest('INVENTORY_DIVISION_BY_ZERO', 'Cannot divide by zero');
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const abs = remainder < 0n ? -remainder : remainder;
  const absDen = denominator < 0n ? -denominator : denominator;
  return abs * 2n >= absDen ? quotient + (numerator < 0n === denominator < 0n ? 1n : -1n) : quotient;
}
/** quantity × unit cost (both scale 4) → value scale 4. */
function mulAmount(quantity: bigint, unitCost: bigint): bigint {
  return divRound(quantity * unitCost, SCALE);
}
function checkDate(value: string, code: import('../../lib/errors.js').ErrorCode = 'INVENTORY_DATE_INVALID') {
  if (!ISO.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw badRequest(code, 'Invalid date (YYYY-MM-DD)');
  }
  return value;
}
async function cabinetIdOf(db: Db, companyId: string): Promise<string> {
  const res = await db.query<any>('SELECT cabinet_id FROM companies WHERE id = $1', [companyId]);
  if (!res.rows[0]) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  return res.rows[0].cabinet_id;
}
async function account(db: Db, companyId: string, id: string, label: string, types?: string[]) {
  const res = await db.query<any>('SELECT id, code, name, type, is_active FROM accounts WHERE id = $1 AND company_id = $2', [id, companyId]);
  const row = res.rows[0];
  if (!row) throw badRequest('INVENTORY_ACCOUNT_INVALID', `${label} does not belong to this company`);
  if (!row.is_active) throw badRequest('INVENTORY_ACCOUNT_INVALID', `${label} is inactive`);
  if (types && !types.includes(row.type)) throw badRequest('INVENTORY_ACCOUNT_INVALID', `${label} has an incompatible account type`);
  return row;
}
async function audit(db: Db, actor: InventoryActor, action: string, entityType: string, entityId: string, details: Record<string, unknown> = {}) {
  await writeAudit(db, { companyId: actor.companyId, userId: actor.userId, action, entityType, entityId, details, ip: actor.ip ?? null });
}
function requireDecision(confirm: unknown, note: unknown) {
  if (confirm !== true || String(note ?? '').trim().length < 10) {
    throw badRequest('INVENTORY_DECISION_REQUIRED', 'A confirmation and a note of at least 10 characters are required');
  }
  return String(note).trim();
}

/* --------------------------------------------------------------- categories */

export interface CategoryInput {
  code: string; name: string; valuationMethod: 'fifo' | 'weighted_average';
  inventoryAccountId: string; cogsAccountId: string;
  adjustmentAccountId?: string | null; writeDownAccountId?: string | null;
  allowNegativeStock?: boolean; isActive?: boolean;
}
async function categoryRow(db: Db, companyId: string, id: string) {
  const res = await db.query<any>('SELECT * FROM inventory_categories WHERE id = $1 AND company_id = $2', [id, companyId]);
  if (!res.rows[0]) throw notFound('INVENTORY_CATEGORY_NOT_FOUND', 'Inventory category not found');
  return res.rows[0];
}
function categoryView(row: any) {
  return {
    id: row.id, code: row.code, name: row.name, valuationMethod: row.valuation_method,
    inventoryAccountId: row.inventory_account_id, cogsAccountId: row.cogs_account_id,
    adjustmentAccountId: row.adjustment_account_id, writeDownAccountId: row.write_down_account_id,
    allowNegativeStock: row.allow_negative_stock, isActive: row.is_active,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
export async function listCategories(db: Db, companyId: string) {
  const res = await db.query<any>(`SELECT c.*, ia.code AS inventory_code, ia.name AS inventory_name,
      ca.code AS cogs_code, ca.name AS cogs_name
    FROM inventory_categories c JOIN accounts ia ON ia.id = c.inventory_account_id
    JOIN accounts ca ON ca.id = c.cogs_account_id
    WHERE c.company_id = $1 ORDER BY c.code`, [companyId]);
  return res.rows.map((row) => ({ ...categoryView(row),
    inventoryAccount: { code: row.inventory_code, name: row.inventory_name },
    cogsAccount: { code: row.cogs_code, name: row.cogs_name } }));
}
export async function createCategory(db: Db, actor: InventoryActor, input: CategoryInput) {
  const cabinet = await cabinetIdOf(db, actor.companyId);
  const inventory = await account(db, actor.companyId, input.inventoryAccountId, 'Inventory account', ['asset']);
  const cogs = await account(db, actor.companyId, input.cogsAccountId, 'COGS account', ['expense']);
  const adjustment = input.adjustmentAccountId ? await account(db, actor.companyId, input.adjustmentAccountId, 'Adjustment account') : null;
  const writeDown = input.writeDownAccountId ? await account(db, actor.companyId, input.writeDownAccountId, 'Write-down account', ['expense']) : null;
  if (!input.code.trim() || !input.name.trim()) throw badRequest('VALIDATION_ERROR', 'Code and name are required');
  const res = await db.query<any>(
    `INSERT INTO inventory_categories (cabinet_id, company_id, code, name, valuation_method,
       inventory_account_id, cogs_account_id, adjustment_account_id, write_down_account_id,
       allow_negative_stock, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [cabinet, actor.companyId, input.code.trim(), input.name.trim(), input.valuationMethod,
      inventory.id, cogs.id, adjustment?.id ?? null, writeDown?.id ?? null,
      Boolean(input.allowNegativeStock), input.isActive ?? true]);
  await audit(db, actor, 'inventory.category.create', 'inventory_category', res.rows[0].id, { code: input.code });
  return categoryView(res.rows[0]);
}
export async function updateCategory(db: Db, actor: InventoryActor, id: string, input: Partial<CategoryInput>) {
  const row = await categoryRow(db, actor.companyId, id);
  const inventory = input.inventoryAccountId ? await account(db, actor.companyId, input.inventoryAccountId, 'Inventory account', ['asset']) : null;
  const cogs = input.cogsAccountId ? await account(db, actor.companyId, input.cogsAccountId, 'COGS account', ['expense']) : null;
  const adjustment = input.adjustmentAccountId ? await account(db, actor.companyId, input.adjustmentAccountId, 'Adjustment account') : null;
  const writeDown = input.writeDownAccountId ? await account(db, actor.companyId, input.writeDownAccountId, 'Write-down account', ['expense']) : null;
  const res = await db.query<any>(
    `UPDATE inventory_categories SET code=$3, name=$4, valuation_method=$5,
       inventory_account_id=$6, cogs_account_id=$7, adjustment_account_id=$8,
       write_down_account_id=$9, allow_negative_stock=$10, is_active=$11, updated_at=now()
     WHERE id=$1 AND company_id=$2 RETURNING *`,
    [id, actor.companyId, input.code?.trim() ?? row.code, input.name?.trim() ?? row.name,
      input.valuationMethod ?? row.valuation_method, inventory?.id ?? row.inventory_account_id,
      cogs?.id ?? row.cogs_account_id, adjustment?.id ?? row.adjustment_account_id,
      writeDown?.id ?? row.write_down_account_id,
      input.allowNegativeStock ?? row.allow_negative_stock, input.isActive ?? row.is_active]);
  await audit(db, actor, 'inventory.category.update', 'inventory_category', id, {});
  return categoryView(res.rows[0]);
}

/* ---------------------------------------------------------------- locations */

export async function listLocations(db: Db, companyId: string) {
  const res = await db.query<any>('SELECT * FROM inventory_locations WHERE company_id = $1 ORDER BY code', [companyId]);
  return res.rows.map((r) => ({ id: r.id, code: r.code, name: r.name, description: r.description, isActive: r.is_active }));
}
export async function createLocation(db: Db, actor: InventoryActor, input: { code: string; name: string; description?: string | null }) {
  if (!input.code.trim() || !input.name.trim()) throw badRequest('VALIDATION_ERROR', 'Code and name are required');
  const cabinet = await cabinetIdOf(db, actor.companyId);
  const res = await db.query<any>(
    `INSERT INTO inventory_locations (cabinet_id, company_id, code, name, description)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [cabinet, actor.companyId, input.code.trim(), input.name.trim(), input.description ?? null]);
  await audit(db, actor, 'inventory.location.create', 'inventory_location', res.rows[0].id, { code: input.code });
  return { id: res.rows[0].id, code: res.rows[0].code, name: res.rows[0].name, description: res.rows[0].description, isActive: res.rows[0].is_active };
}
export async function updateLocation(db: Db, actor: InventoryActor, id: string, input: { code?: string; name?: string; description?: string | null; isActive?: boolean }) {
  const current = await db.query<any>('SELECT * FROM inventory_locations WHERE id=$1 AND company_id=$2', [id, actor.companyId]);
  if (!current.rows[0]) throw notFound('INVENTORY_LOCATION_NOT_FOUND', 'Inventory location not found');
  const row = current.rows[0];
  const res = await db.query<any>(
    `UPDATE inventory_locations SET code=$3, name=$4, description=$5, is_active=$6, updated_at=now()
     WHERE id=$1 AND company_id=$2 RETURNING *`,
    [id, actor.companyId, input.code?.trim() ?? row.code, input.name?.trim() ?? row.name,
      input.description === undefined ? row.description : input.description, input.isActive ?? row.is_active]);
  await audit(db, actor, 'inventory.location.update', 'inventory_location', id, {});
  return { id: res.rows[0].id, code: res.rows[0].code, name: res.rows[0].name, description: res.rows[0].description, isActive: res.rows[0].is_active };
}

/* -------------------------------------------------------------------- items */

export interface ItemInput {
  categoryId: string; sku: string; name: string; unit?: string;
  reorderLevel?: string | number | null; isActive?: boolean;
}
export async function listItems(db: Db, companyId: string) {
  const res = await db.query<any>(
    `SELECT i.*, c.code AS category_code, c.name AS category_name, c.valuation_method
       FROM inventory_items i JOIN inventory_categories c ON c.id = i.category_id
      WHERE i.company_id = $1 ORDER BY i.sku`, [companyId]);
  return res.rows.map((r) => ({
    id: r.id, categoryId: r.category_id, sku: r.sku, name: r.name, unit: r.unit,
    reorderLevel: r.reorder_level, isActive: r.is_active,
    category: { code: r.category_code, name: r.category_name, valuationMethod: r.valuation_method },
  }));
}
export async function createItem(db: Db, actor: InventoryActor, input: ItemInput) {
  const category = await categoryRow(db, actor.companyId, input.categoryId);
  if (!category.is_active) throw badRequest('INVENTORY_CATEGORY_INACTIVE', 'Inventory category is inactive');
  if (!input.sku.trim() || !input.name.trim()) throw badRequest('VALIDATION_ERROR', 'SKU and name are required');
  const cabinet = await cabinetIdOf(db, actor.companyId);
  const res = await db.query<any>(
    `INSERT INTO inventory_items (cabinet_id, company_id, category_id, sku, name, unit, reorder_level, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [cabinet, actor.companyId, category.id, input.sku.trim(), input.name.trim(),
      input.unit?.trim() || 'unit', input.reorderLevel === undefined || input.reorderLevel === null ? null : fmt(qty(input.reorderLevel)),
      input.isActive ?? true]);
  await audit(db, actor, 'inventory.item.create', 'inventory_item', res.rows[0].id, { sku: input.sku });
  return { id: res.rows[0].id, categoryId: res.rows[0].category_id, sku: res.rows[0].sku,
    name: res.rows[0].name, unit: res.rows[0].unit, reorderLevel: res.rows[0].reorder_level, isActive: res.rows[0].is_active };
}
export async function updateItem(db: Db, actor: InventoryActor, id: string, input: Partial<ItemInput>) {
  const current = await db.query<any>('SELECT * FROM inventory_items WHERE id=$1 AND company_id=$2', [id, actor.companyId]);
  if (!current.rows[0]) throw notFound('INVENTORY_ITEM_NOT_FOUND', 'Inventory item not found');
  const row = current.rows[0];
  const category = input.categoryId ? await categoryRow(db, actor.companyId, input.categoryId) : null;
  const res = await db.query<any>(
    `UPDATE inventory_items SET category_id=$3, sku=$4, name=$5, unit=$6, reorder_level=$7, is_active=$8, updated_at=now()
     WHERE id=$1 AND company_id=$2 RETURNING *`,
    [id, actor.companyId, category?.id ?? row.category_id, input.sku?.trim() ?? row.sku,
      input.name?.trim() ?? row.name, input.unit?.trim() ?? row.unit,
      input.reorderLevel === undefined ? row.reorder_level : (input.reorderLevel === null ? null : fmt(qty(input.reorderLevel))),
      input.isActive ?? row.is_active]);
  await audit(db, actor, 'inventory.item.update', 'inventory_item', id, {});
  return { id: res.rows[0].id, categoryId: res.rows[0].category_id, sku: res.rows[0].sku,
    name: res.rows[0].name, unit: res.rows[0].unit, reorderLevel: res.rows[0].reorder_level, isActive: res.rows[0].is_active };
}

/* ---------------------------------------------------------------- movements */

export interface MovementInput {
  itemId: string; locationId: string; destinationLocationId?: string | null;
  movementDate: string; direction: 'in' | 'out' | 'transfer_out' | 'adjustment_in' | 'adjustment_out';
  sourceKind: 'opening' | 'receipt' | 'issue' | 'adjustment' | 'count' | 'transfer' | 'reversal';
  quantity: string | number; unitCost?: string | number | null;
  reference?: string | null; description: string; documentRef?: string | null;
  journalId: string; counterpartAccountId?: string | null;
}
async function movementRow(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(
    `SELECT m.*, c.valuation_method, c.inventory_account_id AS category_inventory_account,
            c.cogs_account_id, c.adjustment_account_id, c.write_down_account_id, c.allow_negative_stock,
            i.sku, i.name AS item_name, l.code AS location_code, l.name AS location_name,
            dl.code AS destination_code, dl.name AS destination_name,
            e.entry_no, j.code AS journal_code, j.name AS journal_name
       FROM inventory_movements m
       JOIN inventory_items i ON i.id = m.item_id
       JOIN inventory_categories c ON c.id = i.category_id
       JOIN inventory_locations l ON l.id = m.location_id
       LEFT JOIN inventory_locations dl ON dl.id = m.destination_location_id
       LEFT JOIN journal_entries e ON e.id = m.entry_id
       LEFT JOIN journals j ON j.id = m.journal_id
      WHERE m.id = $1 AND m.company_id = $2`, [id, companyId]);
  if (!res.rows[0]) throw notFound('INVENTORY_MOVEMENT_NOT_FOUND', 'Inventory movement not found');
  return res.rows[0];
}
function movementView(row: any) {
  return {
    id: row.id, movementNo: row.movement_no, movementDate: row.movement_date,
    itemId: row.item_id, item: { sku: row.sku, name: row.item_name },
    locationId: row.location_id, location: { code: row.location_code, name: row.location_name },
    destinationLocationId: row.destination_location_id,
    destination: row.destination_code ? { code: row.destination_code, name: row.destination_name } : null,
    direction: row.direction, sourceKind: row.source_kind,
    quantity: fmt(qty(row.quantity)), unitCost: row.unit_cost === null ? null : fmt(qty(row.unit_cost)),
    value: row.value === null ? null : fmt(qty(row.value)), valuationMethod: row.valuation_method,
    reference: row.reference, description: row.description, documentRef: row.document_ref,
    journal: row.journal_code ? { code: row.journal_code, name: row.journal_name } : null,
    inventoryAccountId: row.inventory_account_id, counterpartAccountId: row.counterpart_account_id,
    status: row.status, entryNo: row.entry_no ?? null, entryId: row.entry_id ?? null,
    approvalNote: row.approval_note, approvedAt: row.approved_at, rejectionReason: row.rejection_reason,
    postedAt: row.posted_at, createdAt: row.created_at,
  };
}
export async function listMovements(db: Db, companyId: string, filter: { from?: string; to?: string; itemId?: string; status?: string } = {}) {
  const params: unknown[] = [companyId];
  let where = 'm.company_id = $1';
  if (filter.from) { params.push(filter.from); where += ` AND m.movement_date >= $${params.length}`; }
  if (filter.to) { params.push(filter.to); where += ` AND m.movement_date <= $${params.length}`; }
  if (filter.itemId) { params.push(filter.itemId); where += ` AND m.item_id = $${params.length}`; }
  if (filter.status) { params.push(filter.status); where += ` AND m.status = $${params.length}`; }
  const res = await db.query<any>(
    `SELECT m.id FROM inventory_movements m WHERE ${where} ORDER BY m.movement_date DESC, m.movement_no DESC LIMIT 500`, params);
  const rows = [];
  for (const r of res.rows) rows.push(movementView(await movementRow(db, companyId, r.id)));
  return rows;
}
export async function getMovement(db: Db, companyId: string, id: string) { return movementView(await movementRow(db, companyId, id)); }

export async function createMovement(db: Db, actor: InventoryActor, input: MovementInput) {
  const item = await db.query<any>(
    `SELECT i.*, c.valuation_method, c.inventory_account_id, c.cogs_account_id, c.adjustment_account_id,
            c.write_down_account_id, c.allow_negative_stock, c.is_active AS category_active
       FROM inventory_items i JOIN inventory_categories c ON c.id = i.category_id
      WHERE i.id = $1 AND i.company_id = $2`, [input.itemId, actor.companyId]);
  const row = item.rows[0];
  if (!row || !row.is_active) throw badRequest('INVENTORY_ITEM_INVALID', 'Inventory item is unknown or inactive');
  if (!row.category_active) throw badRequest('INVENTORY_CATEGORY_INACTIVE', 'Inventory category is inactive');
  const location = await db.query<any>('SELECT * FROM inventory_locations WHERE id=$1 AND company_id=$2', [input.locationId, actor.companyId]);
  if (!location.rows[0] || !location.rows[0].is_active) throw badRequest('INVENTORY_LOCATION_INVALID', 'Inventory location is unknown or inactive');
  checkDate(input.movementDate);
  const quantity = qty(input.quantity);
  if (quantity <= 0n) throw badRequest('INVENTORY_QUANTITY_INVALID', 'Quantity must be positive');
  if (!input.description?.trim()) throw badRequest('VALIDATION_ERROR', 'A description is required');
  const journal = await db.query<any>('SELECT * FROM journals WHERE id=$1 AND company_id=$2 AND is_active', [input.journalId, actor.companyId]);
  if (!journal.rows[0]) throw badRequest('JOURNAL_NOT_FOUND', 'Journal is unknown or inactive');
  const isTransfer = input.direction === 'transfer_out';
  if (isTransfer) {
    if (!input.destinationLocationId || input.destinationLocationId === input.locationId) {
      throw badRequest('INVENTORY_TRANSFER_INVALID', 'A different destination location is required');
    }
    const dest = await db.query<any>('SELECT * FROM inventory_locations WHERE id=$1 AND company_id=$2 AND is_active', [input.destinationLocationId, actor.companyId]);
    if (!dest.rows[0]) throw badRequest('INVENTORY_LOCATION_INVALID', 'Destination location is invalid');
  }
  if (input.direction === 'in' || input.direction === 'adjustment_in') {
    if (input.unitCost === undefined || input.unitCost === null || input.unitCost === '') {
      throw badRequest('INVENTORY_COST_REQUIRED', 'A unit cost is required for an inbound movement');
    }
  }
  const counterpart = input.counterpartAccountId
    ? await account(db, actor.companyId, input.counterpartAccountId, 'Counterpart account')
    : null;
  if (!isTransfer && !counterpart && input.direction !== 'out') {
    throw badRequest('INVENTORY_COUNTERPART_REQUIRED', 'A counterpart account is required');
  }
  const cabinet = await cabinetIdOf(db, actor.companyId);
  const year = input.movementDate.slice(0, 4);
  const countRes = await db.query<any>(
    `SELECT count(*)::int AS count FROM inventory_movements WHERE company_id=$1 AND movement_no LIKE $2`,
    [actor.companyId, `INV-${year}-%`]);
  const movementNo = `INV-${year}-${String(Number(countRes.rows[0]?.count ?? 0) + 1).padStart(4, '0')}`;
  const unitCost = input.unitCost === undefined || input.unitCost === null || input.unitCost === ''
    ? null : qty(input.unitCost);
  const value = unitCost !== null ? mulAmount(quantity, unitCost) : null;
  const res = await db.query<any>(
    `INSERT INTO inventory_movements (cabinet_id, company_id, item_id, location_id, destination_location_id,
       movement_no, movement_date, direction, source_kind, quantity, unit_cost, value, valuation_method,
       reference, description, document_ref, journal_id, inventory_account_id, counterpart_account_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
    [cabinet, actor.companyId, row.id, input.locationId, input.destinationLocationId ?? null,
      movementNo, input.movementDate, input.direction, input.sourceKind, fmt(quantity),
      unitCost === null ? null : fmt(unitCost), value === null ? null : fmt(value), row.valuation_method,
      input.reference ?? null, input.description.trim(), input.documentRef ?? null,
      journal.rows[0].id, row.inventory_account_id,
      counterpart?.id ?? (isTransfer ? row.inventory_account_id : null), actor.userId]);
  await audit(db, actor, 'inventory.movement.create', 'inventory_movement', res.rows[0].id,
    { movementNo, item: row.sku, quantity: fmt(quantity) });
  return getMovement(db, actor.companyId, res.rows[0].id);
}

/**
 * Bridge from an existing validated purchase invoice. The caller maps supplier
 * lines to inventory items; each mapped line becomes a proposed receipt. The
 * purchase module is never duplicated and nothing is posted without a second
 * human approval.
 */
export async function proposeFromPurchase(db: Db, actor: InventoryActor,
  documentId: string, input: { journalId: string; lines: { purchaseLineId: string; itemId: string; locationId: string; quantity: string | number; unitCost?: string | number | null }[] }) {
  const doc = await db.query<any>(
    `SELECT id, doc_no, supplier_reference, issue_date, status, kind FROM purchase_documents
      WHERE id=$1 AND company_id=$2`, [documentId, actor.companyId]);
  const document = doc.rows[0];
  if (!document) throw notFound('INVENTORY_SOURCE_NOT_FOUND', 'Purchase document not found');
  if (document.status !== 'validated' || document.kind !== 'invoice') {
    throw conflict('INVENTORY_SOURCE_INVALID', 'Only a validated supplier invoice can feed inventory');
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 200) {
    throw badRequest('INVENTORY_SOURCE_LINES_REQUIRED', 'At least one mapped line is required');
  }
  return db.transaction(async (tx) => {
    const movements: any[] = [];
    for (const line of input.lines) {
      const source = await tx.query<any>(
        `SELECT id, line_no, description, quantity, net_amount, account_id FROM purchase_document_lines
          WHERE id=$1 AND document_id=$2 AND company_id=$3`, [line.purchaseLineId, documentId, actor.companyId]);
      const purchaseLine = source.rows[0];
      if (!purchaseLine) throw badRequest('INVENTORY_SOURCE_LINE_INVALID', 'Purchase line does not belong to this document');
      const requested = qty(line.quantity);
      const available = qty(purchaseLine.quantity);
      if (requested <= 0n || requested > available) throw badRequest('INVENTORY_SOURCE_QUANTITY_INVALID', 'Quantity exceeds the supplier line');
      const unitCost = line.unitCost ? qty(line.unitCost) : divRound(qty(purchaseLine.net_amount) * SCALE, available);
      const docNo = document.doc_no || document.supplier_reference;
      movements.push(await createMovement(tx, actor, {
        itemId: line.itemId, locationId: line.locationId, movementDate: document.issue_date,
        direction: 'in', sourceKind: 'receipt', quantity: fmt(requested), unitCost: fmt(unitCost),
        reference: docNo, description: `Réception ${docNo} — ${purchaseLine.description}`,
        documentRef: `purchase:${docNo}`, journalId: input.journalId,
        counterpartAccountId: purchaseLine.account_id,
      }));
    }
    await audit(tx, actor, 'inventory.purchase.bridge', 'purchase_document', documentId,
      { lines: movements.length, document: document.doc_no || document.supplier_reference });
    return { document: { id: document.id, docNo: document.doc_no, supplierReference: document.supplier_reference }, movements };
  });
}

/** Bridge from an issued customer invoice: mapped lines become proposed issues. */
export async function proposeFromBilling(db: Db, actor: InventoryActor,
  documentId: string, input: { journalId: string; lines: { billingLineId: string; itemId: string; locationId: string; quantity: string | number }[] }) {
  const doc = await db.query<any>(
    `SELECT id, doc_no, issue_date, status, kind FROM billing_documents WHERE id=$1 AND company_id=$2`,
    [documentId, actor.companyId]);
  const document = doc.rows[0];
  if (!document) throw notFound('INVENTORY_SOURCE_NOT_FOUND', 'Billing document not found');
  if (document.status !== 'issued' || document.kind !== 'invoice') {
    throw conflict('INVENTORY_SOURCE_INVALID', 'Only an issued customer invoice can feed inventory');
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 200) {
    throw badRequest('INVENTORY_SOURCE_LINES_REQUIRED', 'At least one mapped line is required');
  }
  return db.transaction(async (tx) => {
    const movements: any[] = [];
    for (const line of input.lines) {
      const source = await tx.query<any>(
        `SELECT id, description, quantity FROM billing_document_lines
          WHERE id=$1 AND document_id=$2 AND company_id=$3`, [line.billingLineId, documentId, actor.companyId]);
      const billingLine = source.rows[0];
      if (!billingLine) throw badRequest('INVENTORY_SOURCE_LINE_INVALID', 'Billing line does not belong to this document');
      const requested = qty(line.quantity);
      if (requested <= 0n || requested > qty(billingLine.quantity)) throw badRequest('INVENTORY_SOURCE_QUANTITY_INVALID', 'Quantity exceeds the invoiced line');
      const docNo = document.doc_no || document.id.slice(0, 8);
      movements.push(await createMovement(tx, actor, {
        itemId: line.itemId, locationId: line.locationId, movementDate: document.issue_date,
        direction: 'out', sourceKind: 'issue', quantity: fmt(requested), unitCost: null,
        reference: docNo, description: `Sortie ${docNo} — ${billingLine.description}`,
        documentRef: `billing:${docNo}`, journalId: input.journalId, counterpartAccountId: null,
      }));
    }
    await audit(tx, actor, 'inventory.billing.bridge', 'billing_document', documentId,
      { lines: movements.length, document: document.doc_no });
    return { document: { id: document.id, docNo: document.doc_no }, movements };
  });
}

export async function approveMovement(db: Db, actor: InventoryActor, id: string, input: { confirm: boolean; note: string }) {
  const note = requireDecision(input.confirm, input.note);
  const row = await movementRow(db, actor.companyId, id);
  if (row.status !== 'PROPOSED') throw conflict('INVENTORY_MOVEMENT_DECIDED', 'This movement has already been decided');
  await db.query(`UPDATE inventory_movements SET status='APPROVED', approval_note=$3, approved_by=$4,
      approved_at=now(), updated_at=now() WHERE id=$1 AND company_id=$2`, [id, actor.companyId, note, actor.userId]);
  await audit(db, actor, 'inventory.movement.approve', 'inventory_movement', id, { note });
  return getMovement(db, actor.companyId, id);
}
export async function rejectMovement(db: Db, actor: InventoryActor, id: string, reason: string) {
  if (!String(reason ?? '').trim()) throw badRequest('VALIDATION_ERROR', 'A rejection reason is required');
  const row = await movementRow(db, actor.companyId, id);
  if (!['PROPOSED', 'APPROVED'].includes(row.status)) throw conflict('INVENTORY_MOVEMENT_DECIDED', 'This movement has already been posted or rejected');
  await db.query(`UPDATE inventory_movements SET status='REJECTED', rejection_reason=$3, updated_at=now()
    WHERE id=$1 AND company_id=$2`, [id, actor.companyId, String(reason).trim()]);
  await audit(db, actor, 'inventory.movement.reject', 'inventory_movement', id, { reason: String(reason).trim() });
  return getMovement(db, actor.companyId, id);
}

async function balanceRow(db: Db, companyId: string, itemId: string, locationId: string, lock = false) {
  const res = await db.query<any>(
    `SELECT * FROM inventory_balances WHERE company_id=$1 AND item_id=$2 AND location_id=$3${lock ? ' FOR UPDATE' : ''}`,
    [companyId, itemId, locationId]);
  return res.rows[0] ?? null;
}
async function adjustBalance(db: Db, companyId: string, itemId: string, locationId: string, dq: bigint, dv: bigint) {
  const cabinet = await cabinetIdOf(db, companyId);
  const existing = await balanceRow(db, companyId, itemId, locationId, true);
  const quantity = (existing ? qty(existing.quantity) : 0n) + dq;
  const value = (existing ? qty(existing.value) : 0n) + dv;
  if (quantity < 0n || value < 0n) throw conflict('INVENTORY_NEGATIVE_STOCK', 'The movement would make stock quantity or value negative');
  if (existing) {
    await db.query(`UPDATE inventory_balances SET quantity=$3, value=$4, updated_at=now() WHERE id=$1 AND company_id=$2`, [existing.id, companyId, fmt(quantity), fmt(value)]);
  } else {
    await db.query(`INSERT INTO inventory_balances (cabinet_id, company_id, item_id, location_id, quantity, value)
      VALUES ($1,$2,$3,$4,$5,$6)`, [cabinet, companyId, itemId, locationId, fmt(quantity), fmt(value)]);
  }
}
async function consumeFifo(db: Db, companyId: string, row: any, quantity: bigint) {
  const lots = await db.query<any>(
    `SELECT * FROM inventory_lots WHERE company_id=$1 AND item_id=$2 AND location_id=$3 AND remaining_quantity > 0
      ORDER BY received_date, created_at FOR UPDATE`, [companyId, row.item_id, row.location_id]);
  let remaining = quantity;
  let value = 0n;
  const allocations: { lotId: string; quantity: bigint; unitCost: bigint; value: bigint }[] = [];
  for (const lot of lots.rows) {
    if (remaining === 0n) break;
    const available = qty(lot.remaining_quantity);
    const take = available < remaining ? available : remaining;
    if (take <= 0n) continue;
    const unitCost = qty(lot.unit_cost);
    const allocationValue = mulAmount(take, unitCost);
    allocations.push({ lotId: lot.id, quantity: take, unitCost, value: allocationValue });
    remaining -= take;
    value += allocationValue;
    await db.query('UPDATE inventory_lots SET remaining_quantity=$2 WHERE id=$1', [lot.id, fmt(available - take)]);
  }
  if (remaining > 0n && !row.allow_negative_stock) {
    throw conflict('INVENTORY_NEGATIVE_STOCK', `Insufficient stock for ${row.sku}: ${fmt(remaining)} missing`);
  }
  if (remaining > 0n && row.allow_negative_stock) {
    const fallback = row.unit_cost ? qty(row.unit_cost) : 0n;
    value += mulAmount(remaining, fallback);
  }
  return { value, allocations };
}
async function consumeWeightedAverage(db: Db, companyId: string, row: any, quantity: bigint) {
  const balance = await balanceRow(db, companyId, row.item_id, row.location_id, true);
  const availableQty = balance ? qty(balance.quantity) : 0n;
  const availableValue = balance ? qty(balance.value) : 0n;
  if (quantity > availableQty && !row.allow_negative_stock) {
    throw conflict('INVENTORY_NEGATIVE_STOCK', `Insufficient stock for ${row.sku}: available ${fmt(availableQty)}`);
  }
  if (availableQty > 0n) {
    const cost = divRound(availableValue * quantity, availableQty);
    return { value: cost > availableValue ? availableValue : cost, allocations: [] as any[] };
  }
  return { value: 0n, allocations: [] as any[] };
}
async function createLot(db: Db, companyId: string, itemId: string, locationId: string, date: string, quantity: bigint, unitCost: bigint) {
  const cabinet = await cabinetIdOf(db, companyId);
  await db.query(
    `INSERT INTO inventory_lots (cabinet_id, company_id, item_id, location_id, received_date, unit_cost, original_quantity, remaining_quantity)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`, [cabinet, companyId, itemId, locationId, date, fmt(unitCost), fmt(quantity)]);
}

export async function postMovement(db: Db, actor: InventoryActor, id: string) {
  const result = await db.transaction(async (tx) => {
    const row = await movementRow(tx, actor.companyId, id);
    if (row.status !== 'APPROVED') throw conflict('INVENTORY_MOVEMENT_NOT_APPROVED', 'The movement must be approved before posting');
    await assertOpenPeriod(tx, actor.companyId, row.movement_date);
    const quantity = qty(row.quantity);
    let value = row.value === null ? null : qty(row.value);
    let allocations: any[] = [];
    const isInbound = ['in', 'adjustment_in'].includes(row.direction);
    const isTransfer = row.direction === 'transfer_out';
    if (!isInbound) {
      if (row.valuation_method === 'fifo') {
        const consumed = await consumeFifo(tx, actor.companyId, row, quantity);
        value = consumed.value; allocations = consumed.allocations;
      } else {
        const consumed = await consumeWeightedAverage(tx, actor.companyId, row, quantity);
        value = consumed.value;
      }
    }
    if (value === null) throw badRequest('INVENTORY_VALUE_MISSING', 'The movement value could not be determined');
    if (value <= 0n && !isTransfer) throw badRequest('INVENTORY_VALUE_MISSING', 'A positive movement value is required');
    const unitCost = quantity > 0n ? divRound(value * SCALE, quantity) : 0n;
    const inventoryAccount = row.inventory_account_id;
    let lines: { accountId: string; description: string; debit?: string; credit?: string }[];
    if (isTransfer) {
      lines = [
        { accountId: inventoryAccount, description: `Transfer in — ${row.item_name}`, debit: fmt(value) },
        { accountId: inventoryAccount, description: `Transfer out — ${row.item_name}`, credit: fmt(value) },
      ];
    } else if (isInbound) {
      lines = [
        { accountId: inventoryAccount, description: `${row.source_kind} — ${row.item_name}`, debit: fmt(value) },
        { accountId: row.counterpart_account_id, description: `${row.source_kind} counterpart`, credit: fmt(value) },
      ];
    } else {
      const debitAccount = row.counterpart_account_id
        ?? (row.direction === 'adjustment_out' ? row.adjustment_account_id : row.cogs_account_id);
      if (!debitAccount) throw badRequest('INVENTORY_COUNTERPART_REQUIRED', 'A counterpart account is required for this issue');
      lines = [
        { accountId: debitAccount, description: `${row.source_kind} — ${row.item_name}`, debit: fmt(value) },
        { accountId: inventoryAccount, description: `${row.source_kind} — ${row.item_name}`, credit: fmt(value) },
      ];
    }
    const posted = await postEntryTx(tx, {
      companyId: actor.companyId, userId: actor.userId, journalId: row.journal_id,
      entryDate: row.movement_date, reference: row.reference ?? row.movement_no,
      description: `Inventory ${row.movement_no} — ${row.description}`, lines, source: 'inventory',
    });
    // Subledger updates after a successful balanced entry.
    if (isTransfer) {
      await adjustBalance(tx, actor.companyId, row.item_id, row.location_id, -quantity, -value);
      await adjustBalance(tx, actor.companyId, row.item_id, row.destination_location_id, quantity, value);
      await createLot(tx, actor.companyId, row.item_id, row.destination_location_id, row.movement_date, quantity, unitCost);
    } else if (isInbound) {
      await adjustBalance(tx, actor.companyId, row.item_id, row.location_id, quantity, value);
      await createLot(tx, actor.companyId, row.item_id, row.location_id, row.movement_date, quantity, unitCost);
    } else {
      await adjustBalance(tx, actor.companyId, row.item_id, row.location_id, -quantity, -value);
      for (const allocation of allocations) {
        await tx.query(
          `INSERT INTO inventory_lot_allocations (company_id, movement_id, lot_id, quantity, unit_cost, value)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [actor.companyId, id, allocation.lotId, fmt(allocation.quantity), fmt(allocation.unitCost), fmt(allocation.value)]);
      }
    }
    await tx.query(`UPDATE inventory_movements SET status='POSTED', value=$3, unit_cost=$4, entry_id=$5,
      posted_at=now(), updated_at=now() WHERE id=$1 AND company_id=$2`,
      [id, actor.companyId, fmt(value), fmt(unitCost), posted.entry.id]);
    await audit(tx, actor, 'inventory.movement.post', 'inventory_movement', id,
      { movementNo: row.movement_no, entryNo: posted.entry.entry_no, value: fmt(value) });
    return posted.entry;
  });
  return { movement: await getMovement(db, actor.companyId, id), entry: result };
}

/* ---------------------------------------------------------------- transfers */

export async function createTransfer(db: Db, actor: InventoryActor, input: Omit<MovementInput, 'direction' | 'sourceKind' | 'destinationLocationId'> & { destinationLocationId: string }) {
  return createMovement(db, actor, { ...input, direction: 'transfer_out', sourceKind: 'transfer' });
}

/* ------------------------------------------------------------------- counts */

export async function listCounts(db: Db, companyId: string) {
  const res = await db.query<any>(
    `SELECT c.*, l.code AS location_code, l.name AS location_name,
            (SELECT count(*)::int FROM inventory_count_lines x WHERE x.count_id=c.id) AS line_count
       FROM inventory_counts c JOIN inventory_locations l ON l.id=c.location_id
      WHERE c.company_id=$1 ORDER BY c.count_date DESC, c.count_no DESC`, [companyId]);
  return res.rows.map((r) => ({ id: r.id, countNo: r.count_no, countDate: r.count_date,
    locationId: r.location_id, location: { code: r.location_code, name: r.location_name },
    reference: r.reference, notes: r.notes, status: r.status, lineCount: Number(r.line_count), createdAt: r.created_at }));
}
export async function getCount(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(`SELECT c.*, l.code AS location_code, l.name AS location_name
    FROM inventory_counts c JOIN inventory_locations l ON l.id=c.location_id WHERE c.id=$1 AND c.company_id=$2`, [id, companyId]);
  if (!res.rows[0]) throw notFound('INVENTORY_COUNT_NOT_FOUND', 'Inventory count not found');
  const lines = await db.query<any>(
    `SELECT cl.*, i.sku, i.name FROM inventory_count_lines cl JOIN inventory_items i ON i.id=cl.item_id
      WHERE cl.count_id=$1 AND cl.company_id=$2 ORDER BY i.sku`, [id, companyId]);
  return { id: res.rows[0].id, countNo: res.rows[0].count_no, countDate: res.rows[0].count_date,
    locationId: res.rows[0].location_id, location: { code: res.rows[0].location_code, name: res.rows[0].location_name },
    reference: res.rows[0].reference, notes: res.rows[0].notes, status: res.rows[0].status,
    lines: lines.rows.map((l) => ({ id: l.id, itemId: l.item_id, sku: l.sku, name: l.name,
      countedQuantity: fmt(qty(l.counted_quantity)), systemQuantity: fmt(qty(l.system_quantity)),
      difference: fmt(qty(l.difference)), unitCost: l.unit_cost === null ? null : fmt(qty(l.unit_cost)),
      movementId: l.movement_id })) };
}
export async function createCount(db: Db, actor: InventoryActor, input: {
  locationId: string; countDate: string; reference?: string | null; notes?: string | null;
  lines: { itemId: string; countedQuantity: string | number; unitCost?: string | number | null }[];
}) {
  checkDate(input.countDate, 'INVENTORY_COUNT_DATE_INVALID');
  const location = await db.query<any>('SELECT * FROM inventory_locations WHERE id=$1 AND company_id=$2 AND is_active', [input.locationId, actor.companyId]);
  if (!location.rows[0]) throw badRequest('INVENTORY_LOCATION_INVALID', 'Inventory location is invalid');
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw badRequest('INVENTORY_COUNT_LINES_REQUIRED', 'At least one count line is required');
  const cabinet = await cabinetIdOf(db, actor.companyId);
  const year = input.countDate.slice(0, 4);
  const countRes = await db.query<any>('SELECT count(*)::int AS count FROM inventory_counts WHERE company_id=$1 AND count_no LIKE $2', [actor.companyId, `CNT-${year}-%`]);
  const countNo = `CNT-${year}-${String(Number(countRes.rows[0]?.count ?? 0) + 1).padStart(4, '0')}`;
  return db.transaction(async (tx) => {
    const created = await tx.query<any>(
      `INSERT INTO inventory_counts (cabinet_id, company_id, location_id, count_no, count_date, reference, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [cabinet, actor.companyId, input.locationId, countNo, input.countDate, input.reference ?? null, input.notes ?? null, actor.userId]);
    const countId = created.rows[0].id;
    for (const line of input.lines) {
      const item = await tx.query<any>('SELECT i.*, c.is_active AS category_active FROM inventory_items i JOIN inventory_categories c ON c.id=i.category_id WHERE i.id=$1 AND i.company_id=$2', [line.itemId, actor.companyId]);
      if (!item.rows[0]) throw badRequest('INVENTORY_ITEM_INVALID', 'Count line item is invalid');
      const balance = await balanceRow(tx, actor.companyId, line.itemId, input.locationId);
      const systemQuantity = balance ? qty(balance.quantity) : 0n;
      const counted = qty(line.countedQuantity);
      const difference = counted - systemQuantity;
      const unitCost = line.unitCost === undefined || line.unitCost === null
        ? (balance && qty(balance.quantity) > 0n ? divRound(qty(balance.value) * SCALE, qty(balance.quantity)) : null)
        : qty(line.unitCost);
      await tx.query(
        `INSERT INTO inventory_count_lines (company_id, count_id, item_id, counted_quantity, system_quantity, difference, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [actor.companyId, countId, line.itemId, fmt(counted), fmt(systemQuantity), fmt(difference), unitCost === null ? null : fmt(unitCost)]);
    }
    await audit(tx, actor, 'inventory.count.create', 'inventory_count', countId, { countNo });
    return getCount(tx, actor.companyId, countId);
  });
}
export async function generateCountAdjustments(db: Db, actor: InventoryActor, id: string) {
  const count = await getCount(db, actor.companyId, id);
  if (count.status !== 'DRAFT') throw conflict('INVENTORY_COUNT_DECIDED', 'This count has already been processed');
  const movements: string[] = [];
  for (const line of count.lines) {
    const difference = qty(line.difference);
    if (difference === 0n) continue;
    const category = await db.query<any>(
      `SELECT c.* FROM inventory_categories c JOIN inventory_items i ON i.category_id=c.id WHERE i.id=$1 AND i.company_id=$2`,
      [line.itemId, actor.companyId]);
    if (!category.rows[0]?.adjustment_account_id) {
      throw badRequest('INVENTORY_ADJUSTMENT_ACCOUNT_REQUIRED', `Category for ${line.sku} has no adjustment account`);
    }
    if (difference > 0n && !line.unitCost) {
      throw badRequest('INVENTORY_COST_REQUIRED', `A unit cost is required to increase ${line.sku} from a physical count`);
    }
    const movement = await createMovement(db, actor, {
      itemId: line.itemId, locationId: count.locationId,
      movementDate: count.countDate, direction: difference > 0n ? 'adjustment_in' : 'adjustment_out',
      sourceKind: 'count', quantity: fmt(difference > 0n ? difference : -difference),
      unitCost: difference > 0n ? line.unitCost : null,
      description: `Physical count ${count.countNo} adjustment`,
      documentRef: count.reference ?? count.countNo,
      reference: count.countNo, journalId: (await db.query<any>('SELECT id FROM journals WHERE company_id=$1 AND is_active ORDER BY code LIMIT 1', [actor.companyId])).rows[0]?.id,
      counterpartAccountId: category.rows[0].adjustment_account_id,
    });
    await db.query('UPDATE inventory_count_lines SET movement_id=$3 WHERE id=$1 AND company_id=$2', [line.id, actor.companyId, movement.id]);
    movements.push(movement.id);
  }
  await db.query(`UPDATE inventory_counts SET status='POSTED' WHERE id=$1 AND company_id=$2`, [id, actor.companyId]);
  await audit(db, actor, 'inventory.count.adjust', 'inventory_count', id, { movements: movements.length });
  return { count: await getCount(db, actor.companyId, id), movements };
}

/* --------------------------------------------------------------- write-downs */

export interface WriteDownInput {
  itemId: string; locationId: string; writeDownDate: string; amount: string | number;
  reason: string; documentRef: string; journalId: string; kind?: 'write_down' | 'reversal'; reversesId?: string | null;
}
export async function listWriteDowns(db: Db, companyId: string) {
  const res = await db.query<any>(
    `SELECT w.*, i.sku, i.name AS item_name, l.code AS location_code, e.entry_no
       FROM inventory_write_downs w JOIN inventory_items i ON i.id=w.item_id
       JOIN inventory_locations l ON l.id=w.location_id
       LEFT JOIN journal_entries e ON e.id=w.entry_id
      WHERE w.company_id=$1 ORDER BY w.write_down_date DESC, w.write_down_no DESC`, [companyId]);
  return res.rows.map((r) => ({ id: r.id, writeDownNo: r.write_down_no, kind: r.kind,
    writeDownDate: r.write_down_date, itemId: r.item_id, item: { sku: r.sku, name: r.item_name },
    location: { code: r.location_code }, amount: fmt(qty(r.amount)), reason: r.reason,
    documentRef: r.document_ref, status: r.status, entryNo: r.entry_no ?? null,
    reversesId: r.reverses_id, approvalNote: r.approval_note, rejectionReason: r.rejection_reason,
    approvedAt: r.approved_at, postedAt: r.posted_at, createdAt: r.created_at }));
}
async function writeDownRow(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(
    `SELECT w.*, i.sku, i.name AS item_name FROM inventory_write_downs w JOIN inventory_items i ON i.id=w.item_id
      WHERE w.id=$1 AND w.company_id=$2`, [id, companyId]);
  if (!res.rows[0]) throw notFound('INVENTORY_WRITE_DOWN_NOT_FOUND', 'Inventory write-down not found');
  return res.rows[0];
}
export async function createWriteDown(db: Db, actor: InventoryActor, input: WriteDownInput) {
  checkDate(input.writeDownDate, 'INVENTORY_WRITE_DOWN_DATE_INVALID');
  const amount = qty(input.amount);
  if (amount <= 0n) throw badRequest('INVENTORY_AMOUNT_INVALID', 'A positive amount is required');
  if (!input.reason?.trim() || !input.documentRef?.trim()) throw badRequest('INVENTORY_EVIDENCE_REQUIRED', 'A reason and a supporting document reference are required');
  const item = await db.query<any>(
    `SELECT i.*, c.inventory_account_id, c.write_down_account_id FROM inventory_items i JOIN inventory_categories c ON c.id=i.category_id
      WHERE i.id=$1 AND i.company_id=$2`, [input.itemId, actor.companyId]);
  if (!item.rows[0]) throw badRequest('INVENTORY_ITEM_INVALID', 'Inventory item is invalid');
  const journal = await db.query<any>('SELECT id FROM journals WHERE id=$1 AND company_id=$2 AND is_active', [input.journalId, actor.companyId]);
  if (!journal.rows[0]) throw badRequest('JOURNAL_NOT_FOUND', 'Journal is unknown or inactive');
  const kind = input.kind ?? 'write_down';
  if (!item.rows[0].write_down_account_id) throw badRequest('INVENTORY_ACCOUNT_INVALID', 'The category has no write-down account');
  if (kind === 'reversal') {
    if (!input.reversesId) throw badRequest('INVENTORY_REVERSAL_REFERENCE_REQUIRED', 'A write-down to reverse is required');
    const original = await writeDownRow(db, actor.companyId, input.reversesId);
    if (original.kind !== 'write_down' || original.status !== 'POSTED') throw conflict('INVENTORY_REVERSAL_INVALID', 'Only a posted write-down can be reversed');
    const already = await db.query<any>(`SELECT COALESCE(SUM(amount),0)::text AS total FROM inventory_write_downs
      WHERE company_id=$1 AND reverses_id=$2 AND status='POSTED'`, [actor.companyId, input.reversesId]);
    if (qty(already.rows[0]?.total) + amount > qty(original.amount)) {
      throw conflict('INVENTORY_REVERSAL_EXCEEDS', 'The reversal exceeds the original write-down');
    }
  }
  const cabinet = await cabinetIdOf(db, actor.companyId);
  const year = input.writeDownDate.slice(0, 4);
  const countRes = await db.query<any>('SELECT count(*)::int AS count FROM inventory_write_downs WHERE company_id=$1 AND write_down_no LIKE $2', [actor.companyId, `WD-${year}-%`]);
  const writeDownNo = `WD-${year}-${String(Number(countRes.rows[0]?.count ?? 0) + 1).padStart(4, '0')}`;
  const res = await db.query<any>(
    `INSERT INTO inventory_write_downs (cabinet_id, company_id, item_id, location_id, write_down_no, kind, reverses_id,
       write_down_date, amount, reason, document_ref, journal_id, inventory_account_id, write_down_account_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [cabinet, actor.companyId, input.itemId, input.locationId, writeDownNo, kind, input.reversesId ?? null,
      input.writeDownDate, fmt(amount), input.reason.trim(), input.documentRef.trim(), journal.rows[0].id,
      item.rows[0].inventory_account_id, item.rows[0].write_down_account_id, actor.userId]);
  await audit(db, actor, 'inventory.write_down.create', 'inventory_write_down', res.rows[0].id, { writeDownNo, amount: fmt(amount) });
  return (await listWriteDowns(db, actor.companyId)).find((w: any) => w.id === res.rows[0].id);
}
export async function approveWriteDown(db: Db, actor: InventoryActor, id: string, input: { confirm: boolean; note: string }) {
  const note = requireDecision(input.confirm, input.note);
  const row = await writeDownRow(db, actor.companyId, id);
  if (row.status !== 'PROPOSED') throw conflict('INVENTORY_WRITE_DOWN_DECIDED', 'This write-down has already been decided');
  await db.query(`UPDATE inventory_write_downs SET status='APPROVED', approval_note=$3, approved_by=$4, approved_at=now(), updated_at=now()
    WHERE id=$1 AND company_id=$2`, [id, actor.companyId, note, actor.userId]);
  await audit(db, actor, 'inventory.write_down.approve', 'inventory_write_down', id, { note });
  return (await listWriteDowns(db, actor.companyId)).find((w: any) => w.id === id);
}
export async function rejectWriteDown(db: Db, actor: InventoryActor, id: string, reason: string) {
  const row = await writeDownRow(db, actor.companyId, id);
  if (row.status !== 'PROPOSED') throw conflict('INVENTORY_WRITE_DOWN_DECIDED', 'This write-down has already been decided');
  await db.query(`UPDATE inventory_write_downs SET status='REJECTED', rejection_reason=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
    [id, actor.companyId, String(reason ?? '').trim() || null]);
  await audit(db, actor, 'inventory.write_down.reject', 'inventory_write_down', id, {});
  return (await listWriteDowns(db, actor.companyId)).find((w: any) => w.id === id);
}
export async function postWriteDown(db: Db, actor: InventoryActor, id: string) {
  const entry = await db.transaction(async (tx) => {
    const row = await writeDownRow(tx, actor.companyId, id);
    if (row.status !== 'APPROVED') throw conflict('INVENTORY_WRITE_DOWN_NOT_APPROVED', 'The write-down must be approved before posting');
    await assertOpenPeriod(tx, actor.companyId, row.write_down_date);
    const amount = qty(row.amount);
    const balance = await balanceRow(tx, actor.companyId, row.item_id, row.location_id, true);
    const currentValue = balance ? qty(balance.value) : 0n;
    if (row.kind === 'write_down' && amount > currentValue) throw conflict('INVENTORY_WRITE_DOWN_EXCEEDS', 'The write-down exceeds the stock value');
    if (row.kind === 'reversal' && !balance) throw conflict('INVENTORY_REVERSAL_INVALID', 'There is no stock balance to reverse into');
    const lines = row.kind === 'write_down'
      ? [{ accountId: row.write_down_account_id, description: row.reason, debit: fmt(amount) },
         { accountId: row.inventory_account_id, description: row.reason, credit: fmt(amount) }]
      : [{ accountId: row.inventory_account_id, description: row.reason, debit: fmt(amount) },
         { accountId: row.write_down_account_id, description: row.reason, credit: fmt(amount) }];
    const posted = await postEntryTx(tx, {
      companyId: actor.companyId, userId: actor.userId, journalId: row.journal_id,
      entryDate: row.write_down_date, reference: row.write_down_no,
      description: `Inventory ${row.kind.replace('_', '-')} ${row.write_down_no} — ${row.sku}`,
      lines, source: 'inventory',
    });
    await adjustBalance(tx, actor.companyId, row.item_id, row.location_id, 0n, row.kind === 'write_down' ? -amount : amount);
    await tx.query(`UPDATE inventory_write_downs SET status='POSTED', entry_id=$3, posted_at=now(), updated_at=now()
      WHERE id=$1 AND company_id=$2`, [id, actor.companyId, posted.entry.id]);
    await audit(tx, actor, 'inventory.write_down.post', 'inventory_write_down', id,
      { entryNo: posted.entry.entry_no, amount: fmt(amount) });
    return posted.entry;
  });
  return { writeDown: (await listWriteDowns(db, actor.companyId)).find((w: any) => w.id === id), entry };
}

/* ------------------------------------------------------------------ reports */

/**
 * Rebuilds the stock position at a date from posted movements and posted
 * write-downs. This keeps period reports exact even when later movements exist
 * in the current subledger balances.
 */
async function positionAsOf(db: Db, companyId: string, asOf: string) {
  checkDate(asOf);
  const res = await db.query<any>(
    `WITH effects AS (
       SELECT m.item_id, m.location_id,
              CASE m.direction WHEN 'in' THEN m.quantity WHEN 'adjustment_in' THEN m.quantity
                               WHEN 'out' THEN -m.quantity WHEN 'adjustment_out' THEN -m.quantity
                               WHEN 'transfer_out' THEN -m.quantity ELSE 0 END AS quantity,
              CASE m.direction WHEN 'in' THEN m.value WHEN 'adjustment_in' THEN m.value
                               WHEN 'out' THEN -m.value WHEN 'adjustment_out' THEN -m.value
                               WHEN 'transfer_out' THEN -m.value ELSE 0 END AS value
         FROM inventory_movements m
        WHERE m.company_id=$1 AND m.status='POSTED' AND m.movement_date <= $2
       UNION ALL
       SELECT m.item_id, m.destination_location_id, m.quantity, m.value
         FROM inventory_movements m
        WHERE m.company_id=$1 AND m.status='POSTED' AND m.movement_date <= $2
          AND m.direction='transfer_out' AND m.destination_location_id IS NOT NULL
     ), movements AS (
       SELECT item_id, location_id, SUM(quantity) AS quantity, SUM(value) AS value
         FROM effects GROUP BY item_id, location_id
     ), write_downs AS (
       SELECT item_id, location_id,
              SUM(CASE kind WHEN 'write_down' THEN -amount ELSE amount END) AS value
         FROM inventory_write_downs
        WHERE company_id=$1 AND status='POSTED' AND write_down_date <= $2
        GROUP BY item_id, location_id
     ), combined AS (
       SELECT COALESCE(m.item_id, w.item_id) AS item_id,
              COALESCE(m.location_id, w.location_id) AS location_id,
              COALESCE(m.quantity, 0) AS quantity,
              COALESCE(m.value, 0) + COALESCE(w.value, 0) AS value
         FROM movements m FULL JOIN write_downs w USING (item_id, location_id)
     )
     SELECT c.item_id, c.location_id, c.quantity::text, c.value::text,
            i.sku, i.name AS item_name, i.unit, i.reorder_level,
            cat.id AS category_id, cat.code AS category_code, cat.name AS category_name,
            cat.valuation_method, cat.inventory_account_id,
            l.code AS location_code, l.name AS location_name
       FROM combined c
       JOIN inventory_items i ON i.id=c.item_id
       JOIN inventory_categories cat ON cat.id=i.category_id
       JOIN inventory_locations l ON l.id=c.location_id
      WHERE (c.quantity <> 0 OR c.value <> 0)
      ORDER BY cat.code, i.sku, l.code`, [companyId, asOf]);
  return res.rows.map((r) => ({ ...r, quantityValue: qty(r.quantity), valueValue: qty(r.value) }));
}

export async function valuationReport(db: Db, companyId: string, asOf?: string) {
  const effective = asOf ?? new Date().toISOString().slice(0, 10);
  const positions = await positionAsOf(db, companyId, effective);
  const rows = positions.map((r) => ({
    itemId: r.item_id, sku: r.sku, name: r.item_name, unit: r.unit,
    reorderLevel: r.reorder_level === null ? null : fmt(qty(r.reorder_level)),
    category: { code: r.category_code, name: r.category_name, valuationMethod: r.valuation_method },
    location: { code: r.location_code, name: r.location_name },
    quantity: fmt(r.quantityValue), value: fmt(r.valueValue),
    unitCost: r.quantityValue > 0n ? fmt(divRound(r.valueValue * SCALE, r.quantityValue)) : '0.0000',
    inventoryAccountId: r.inventory_account_id,
  }));
  return { asOf: effective, rows,
    totals: { quantity: fmt(rows.reduce((s, r) => s + qty(r.quantity), 0n)),
      value: fmt(rows.reduce((s, r) => s + qty(r.value), 0n)) },
    note: 'FIFO issues consume dated lots; weighted-average balances use exact decimal division. No statutory valuation rule is implied.' };
}

export async function reconciliationReport(db: Db, companyId: string, asOf: string) {
  const positions = await positionAsOf(db, companyId, asOf);
  const categories = await db.query<any>(
    `SELECT c.id, c.code, c.name, c.inventory_account_id, a.code AS account_code, a.name AS account_name
       FROM inventory_categories c JOIN accounts a ON a.id=c.inventory_account_id
      WHERE c.company_id=$1 ORDER BY c.code`, [companyId]);
  // Several categories may share one inventory account. The general ledger is
  // kept by account, so the reconciliation must aggregate those categories;
  // otherwise each category would be compared with the whole account.
  const byAccount = new Map<string, { account: any; categories: any[]; subledger: bigint }>();
  for (const c of categories.rows) {
    const bucket = byAccount.get(c.inventory_account_id) ?? {
      account: { code: c.account_code, name: c.account_name }, categories: [], subledger: 0n,
    };
    bucket.categories.push({ code: c.code, name: c.name });
    bucket.subledger += positions.filter((p) => p.category_id === c.id).reduce((s, p) => s + p.valueValue, 0n);
    byAccount.set(c.inventory_account_id, bucket);
  }
  const rows = [];
  for (const [accountId, bucket] of byAccount) {
    const gl = await db.query<any>(
      `SELECT COALESCE(SUM(l.debit - l.credit),0)::text AS balance FROM journal_lines l
        JOIN journal_entries e ON e.id=l.entry_id
       WHERE l.company_id=$1 AND l.account_id=$2 AND e.status='posted' AND e.entry_date <= $3`,
      [companyId, accountId, asOf]);
    const ledger = qty(gl.rows[0]?.balance);
    rows.push({ account: bucket.account, categories: bucket.categories,
      subledgerValue: fmt(bucket.subledger), ledgerBalance: fmt(ledger),
      difference: fmt(bucket.subledger - ledger), balanced: bucket.subledger === ledger });
  }
  return { asOf, rows, balanced: rows.every((r) => r.balanced),
    totalDifference: fmt(rows.reduce((s, r) => s + (qty(r.subledgerValue) - qty(r.ledgerBalance)), 0n)),
    note: 'The reconciliation compares the inventory subledger with posted general-ledger balances, aggregating categories that share an account. Differences are never hidden.' };
}

export async function inventoryCheck(db: Db, companyId: string, periodEnd: string) {
  const items = await db.query<any>('SELECT count(*)::int AS count FROM inventory_items WHERE company_id=$1 AND is_active', [companyId]);
  const pendingMoves = await db.query<any>(`SELECT count(*)::int AS count FROM inventory_movements
    WHERE company_id=$1 AND status IN ('PROPOSED','APPROVED')`, [companyId]);
  const pendingCounts = await db.query<any>(`SELECT count(*)::int AS count FROM inventory_counts WHERE company_id=$1 AND status='DRAFT'`, [companyId]);
  const pendingWd = await db.query<any>(`SELECT count(*)::int AS count FROM inventory_write_downs WHERE company_id=$1 AND status IN ('PROPOSED','APPROVED')`, [companyId]);
  const negative = await db.query<any>('SELECT count(*)::int AS count FROM inventory_balances WHERE company_id=$1 AND quantity < 0', [companyId]);
  const missingJournal = await db.query<any>(`SELECT count(*)::int AS count FROM inventory_movements m
    WHERE m.company_id=$1 AND m.status IN ('APPROVED') AND NOT EXISTS (SELECT 1 FROM journals j WHERE j.id=m.journal_id AND j.is_active)`, [companyId]);
  const recon = await reconciliationReport(db, companyId, periodEnd);
  return {
    itemCount: Number(items.rows[0]?.count ?? 0),
    pendingMovements: Number(pendingMoves.rows[0]?.count ?? 0),
    pendingCounts: Number(pendingCounts.rows[0]?.count ?? 0),
    pendingWriteDowns: Number(pendingWd.rows[0]?.count ?? 0),
    negativeBalances: Number(negative.rows[0]?.count ?? 0),
    missingJournal: Number(missingJournal.rows[0]?.count ?? 0),
    reconciliation: recon,
  };
}
