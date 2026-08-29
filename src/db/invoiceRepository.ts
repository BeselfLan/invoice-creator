import { createInvoiceUuid, db, type CustomerRecord, type InvoiceRecord, type ItemRecord } from './db';
import {
  DEFAULT_INVOICE_STATUS,
  isInvoiceStatus,
  type Invoice,
  type InvoiceStatus,
} from '../models/Invoice';
import { breakdownOf, breakdownTotal } from '../models/AmountType';
import { chargeAmounts, type ChargeAmounts } from '../models/charges';
import { parseInvoiceDate } from '../utils/invoiceDate';
import type { InvoiceStat } from '../utils/invoiceStats';

/** A stored invoice re-joined with its customer and items. */
export type StoredInvoice = Invoice & { id: number };

/** One row of the "all invoices" list. */
export interface InvoiceSummary {
  id: number;
  /** The invoice's portable unique id. */
  uuid: string;
  status: InvoiceStatus;
  invoiceNo: string;
  date: string;
  customerName: string;
  customerAddress: string;
  customerCity: string;
  itemCount: number;
  total: number;
  updatedAt: number;
}

const num = (value: number | undefined, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const optionalNum = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** What one stored invoice bills, split the way the reports read it. */
const breakdownFor = (invoice: ChargeAmounts, items: ItemRecord[]) =>
  breakdownOf({ items, ...chargeAmounts(invoice) });

/**
 * The invoice total, HST included -- the same figure the editor shows. Taken
 * off the report breakdown rather than summed separately, so the list, the
 * reports and the editor can never disagree about what an invoice came to.
 */
const invoiceTotal = (invoice: ChargeAmounts, items: ItemRecord[]) =>
  breakdownTotal(breakdownFor(invoice, items));

/** Joins the three tables back into the shape the invoice form works with. */
const toInvoice = (
  invoice: InvoiceRecord,
  customer: CustomerRecord | undefined,
  items: ItemRecord[],
): Invoice => ({
  uuid: invoice.uuid,
  status: invoice.status ?? DEFAULT_INVOICE_STATUS,
  invoiceNo: invoice.invoiceNo,
  date: invoice.date,
  customerInfo: {
    name: customer?.name,
    address: customer?.address ?? '',
    city: customer?.city ?? '',
    phone: customer?.phone,
    email: customer?.email,
  },
  description: invoice.description,
  recommendation: invoice.recommendation,
  // The form uses `id` purely as a render key, so hand it fresh sequential
  // ones rather than leaking database ids into the UI.
  items: items
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item, index) => ({
      id: index,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: num(item.amount),
    })),
  ...chargeAmounts(invoice),
});

/**
 * Writes an invoice across all three tables in one transaction.
 * Pass an `id` to update an existing invoice, omit it to create a new one.
 * Returns the invoice id.
 */
export async function saveInvoice(invoice: Invoice, id?: number): Promise<number> {
  return db.transaction('rw', db.customers, db.invoices, db.items, async () => {
    const now = Date.now();
    const existing = id !== undefined ? await db.invoices.get(id) : undefined;

    const customerInfo: Omit<CustomerRecord, 'id'> = {
      name: invoice.customerInfo?.name,
      address: invoice.customerInfo?.address ?? '',
      city: invoice.customerInfo?.city ?? '',
      phone: invoice.customerInfo?.phone,
      email: invoice.customerInfo?.email,
    };

    let customerId: number;
    if (existing) {
      customerId = existing.customerId;
      await db.customers.put({ ...customerInfo, id: customerId });
    } else {
      customerId = await db.customers.add(customerInfo);
    }

    const header: Omit<InvoiceRecord, 'id'> = {
      // An existing invoice keeps its identity no matter what the form sends
      // back; a new one adopts an imported id or gets a fresh one.
      uuid: existing?.uuid ?? invoice.uuid?.trim() ?? createInvoiceUuid(),
      // The form always sends a status; fall back for older saved data.
      status: isInvoiceStatus(invoice.status)
        ? invoice.status
        : existing?.status ?? DEFAULT_INVOICE_STATUS,
      invoiceNo: invoice.invoiceNo ?? '',
      date: invoice.date ?? '',
      customerId,
      description: invoice.description ?? '',
      recommendation: invoice.recommendation ?? '',
      ...chargeAmounts(invoice),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const invoiceId = existing
      ? (await db.invoices.put({ ...header, id: existing.id }), existing.id)
      : await db.invoices.add(header);

    // Items are replaced wholesale: simpler and safer than diffing rows that
    // the form is free to reorder or delete.
    await db.items.where('invoiceId').equals(invoiceId).delete();
    await db.items.bulkAdd(
      (invoice.items ?? []).map((item, index) => ({
        invoiceId,
        sortOrder: index,
        name: item.name ?? '',
        quantity: optionalNum(item.quantity),
        unitPrice: optionalNum(item.unitPrice),
        amount: num(item.amount),
      })),
    );

    return invoiceId;
  });
}

/** Joins the three tables back together for a single invoice. */
async function readInvoice(id: number): Promise<Invoice | undefined> {
  return db.transaction('r', db.customers, db.invoices, db.items, async () => {
    const invoice = await db.invoices.get(id);
    if (!invoice) return undefined;

    const [customer, items] = await Promise.all([
      db.customers.get(invoice.customerId),
      db.items.where('invoiceId').equals(id).toArray(),
    ]);

    return toInvoice(invoice, customer, items);
  });
}

/** Loads one invoice with its customer info and items attached. */
export async function getInvoice(id: number): Promise<StoredInvoice | undefined> {
  const invoice = await readInvoice(id);
  return invoice && { ...invoice, id };
}

interface JoinedInvoice {
  record: InvoiceRecord;
  customer?: CustomerRecord;
  items: ItemRecord[];
}

/** Joins every invoice with its customer and items in one pass, newest first. */
async function readAllInvoices(): Promise<JoinedInvoice[]> {
  return db.transaction('r', db.customers, db.invoices, db.items, async () => {
    const invoices = await db.invoices.orderBy('updatedAt').reverse().toArray();
    if (invoices.length === 0) return [];

    const [customers, items] = await Promise.all([
      db.customers.bulkGet(invoices.map((invoice) => invoice.customerId)),
      db.items.where('invoiceId').anyOf(invoices.map((invoice) => invoice.id)).toArray(),
    ]);

    const customersById = new Map(
      customers.filter((c): c is CustomerRecord => !!c).map((c) => [c.id, c]),
    );
    const itemsByInvoice = new Map<number, ItemRecord[]>();
    for (const item of items) {
      const group = itemsByInvoice.get(item.invoiceId);
      if (group) group.push(item);
      else itemsByInvoice.set(item.invoiceId, [item]);
    }

    return invoices.map((record) => ({
      record,
      customer: customersById.get(record.customerId),
      items: itemsByInvoice.get(record.id) ?? [],
    }));
  });
}

/** Lists every invoice, newest first, with its customer and computed total. */
export async function listInvoices(): Promise<InvoiceSummary[]> {
  const joined = await readAllInvoices();
  return joined.map(({ record, customer, items }) => ({
    id: record.id,
    uuid: record.uuid,
    status: record.status ?? DEFAULT_INVOICE_STATUS,
    invoiceNo: record.invoiceNo,
    date: record.date,
    customerName: customer?.name ?? '',
    customerAddress: customer?.address ?? '',
    customerCity: customer?.city ?? '',
    itemCount: items.length,
    total: invoiceTotal(record, items),
    updatedAt: record.updatedAt,
  }));
}

/**
 * Every saved invoice reduced to the numbers the reports page aggregates:
 * when it was billed, what state it is in, and how its total splits across
 * parts, labour and everything else.
 *
 * An invoice whose `date` is blank or unreadable falls back to when it was
 * first saved, so it still lands somewhere on the timeline rather than
 * dropping out of the totals.
 */
export async function listInvoiceStats(): Promise<InvoiceStat[]> {
  const joined = await readAllInvoices();
  return joined.map(({ record, customer, items }) => {
    const amounts = breakdownFor(record, items);
    return {
      id: record.id,
      status: record.status ?? DEFAULT_INVOICE_STATUS,
      invoiceNo: record.invoiceNo,
      customerName: customer?.name ?? '',
      dateMs: parseInvoiceDate(record.date) ?? record.createdAt,
      amounts,
      total: breakdownTotal(amounts),
    };
  });
}

/**
 * Reads a stored invoice back in the plain JSON shape the editor exports, so
 * downloaded files are interchangeable with the ones saved from the editor.
 */
export async function getInvoiceForExport(id: number): Promise<Invoice | undefined> {
  // Deliberately without the database id, which means nothing outside this browser.
  return readInvoice(id)
}

const str = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback

/**
 * Turns the contents of an uploaded JSON file into an invoice we are willing
 * to store, or null if it does not look like one of our invoices at all.
 */
export function normalizeImportedInvoice(parsed: unknown): Invoice | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return null

  const raw = parsed as Record<string, unknown>
  const customerInfo = (typeof raw.customerInfo === 'object' && raw.customerInfo !== null
    ? raw.customerInfo
    : {}) as Record<string, unknown>
  const rawItems = Array.isArray(raw.items) ? raw.items : []

  // A file with neither customer details nor line items is not an invoice.
  if (Object.keys(customerInfo).length === 0 && rawItems.length === 0)
    return null

  return {
    uuid: str(raw.uuid) || undefined,
    status: isInvoiceStatus(raw.status) ? raw.status : DEFAULT_INVOICE_STATUS,
    invoiceNo: str(raw.invoiceNo),
    date: str(raw.date),
    customerInfo: {
      name: str(customerInfo.name) || undefined,
      address: str(customerInfo.address),
      city: str(customerInfo.city),
      phone: str(customerInfo.phone) || undefined,
      email: str(customerInfo.email) || undefined,
    },
    description: str(raw.description),
    recommendation: str(raw.recommendation),
    items: rawItems.map((entry, index) => {
      const item = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>
      return {
        id: index,
        name: str(item.name),
        quantity: optionalNum(item.quantity as number | undefined),
        unitPrice: optionalNum(item.unitPrice as number | undefined),
        amount: num(item.amount as number | undefined),
      }
    }),
    ...chargeAmounts(raw),
    // Files exported before parking replaced the two "other" fees carry those
    // instead; their money is folded in rather than dropped on the way back.
    ...(raw.parkingCost === undefined && {
      parkingCost: num(raw.other1Fee as number | undefined) +
        num(raw.other2Fee as number | undefined),
    }),
  }
}

const BACKUP_TYPE = 'invoice-creator-backup'

/** One file holding every invoice, for the "Save all" button. */
export interface InvoiceBackup {
  type: typeof BACKUP_TYPE
  version: 1
  exportedAt: string
  /** Each entry is exactly the single-invoice format the editor reads. */
  invoices: Invoice[]
}

/** Collects every saved invoice into a single backup file's contents. */
export async function exportAllInvoices(): Promise<InvoiceBackup> {
  const joined = await readAllInvoices()
  return {
    type: BACKUP_TYPE,
    version: 1,
    exportedAt: new Date().toISOString(),
    invoices: joined.map(({ record, customer, items }) => toInvoice(record, customer, items)),
  }
}

/**
 * Finds the saved invoice that an uploaded one should overwrite.
 *
 * Invoices carry a unique id, so that alone decides it: an uploaded invoice
 * replaces the one it *is*, and an unknown id is simply a new invoice. Files
 * exported before ids existed fall back to the old rule, matching on invoice
 * number plus customer name -- but never onto a row this same file has already
 * written, so a legacy backup holding two same-numbered invoices restores as
 * two invoices instead of collapsing into one.
 */
async function findReplaceableInvoice(invoice: Invoice, claimed?: Set<number>): Promise<number | undefined> {
  const uuid = invoice.uuid?.trim()
  if (uuid)
    return (await db.invoices.get({ uuid }))?.id

  const invoiceNo = invoice.invoiceNo?.trim() ?? ''
  if (invoiceNo === '')
    return undefined

  const candidates = await db.invoices.where('invoiceNo').equals(invoiceNo).toArray()
  if (candidates.length === 0)
    return undefined

  const wantedName = (invoice.customerInfo?.name ?? '').trim().toLowerCase()
  const customers = await db.customers.bulkGet(candidates.map(candidate => candidate.customerId))

  const match = candidates.find((candidate, index) =>
    !claimed?.has(candidate.id) &&
    (customers[index]?.name ?? '').trim().toLowerCase() === wantedName)
  return match?.id
}

export type ImportOutcome = 'added' | 'replaced' | 'skipped'

export interface ImportResult {
  added: number
  replaced: number
  skipped: number
}

/**
 * Stores one invoice parsed out of a JSON file, overwriting the invoice it
 * matches if there is one. `claimed` collects the rows already written by the
 * file being imported.
 */
export async function importInvoice(parsed: unknown, claimed?: Set<number>): Promise<ImportOutcome> {
  const invoice = normalizeImportedInvoice(parsed)
  if (!invoice)
    return 'skipped'

  // One transaction so the match and the write cannot disagree; the write
  // inside saveInvoice joins this transaction rather than opening its own.
  return db.transaction('rw', db.customers, db.invoices, db.items, async () => {
    const existingId = await findReplaceableInvoice(invoice, claimed)
    // Kept on its own line: `claimed?.add(await saveInvoice(...))` would skip
    // the save entirely whenever `claimed` is undefined.
    const savedId = await saveInvoice(invoice, existingId)
    claimed?.add(savedId)
    return existingId === undefined ? 'added' : 'replaced'
  })
}

/** Pulls the invoices out of a file, which may be a backup or a single invoice. */
function toImportEntries(parsed: unknown): unknown[] {
  if (Array.isArray(parsed))
    return parsed
  if (typeof parsed !== 'object' || parsed === null)
    return []

  const invoices = (parsed as Record<string, unknown>).invoices
  return Array.isArray(invoices) ? invoices : [parsed]
}

/**
 * Restores the contents of one uploaded file, whether it holds a single
 * invoice or a whole backup.
 */
export async function importInvoiceFile(parsed: unknown): Promise<ImportResult> {
  const result: ImportResult = { added: 0, replaced: 0, skipped: 0 }
  const entries = toImportEntries(parsed)
  // Rows written by this file, so two of its entries cannot claim the same one.
  const claimed = new Set<number>()

  if (entries.length === 0) {
    result.skipped++
    return result
  }

  for (const entry of entries) {
    try {
      result[await importInvoice(entry, claimed)]++
    } catch (error) {
      console.error('Failed to import invoice', error)
      result.skipped++
    }
  }

  return result
}

/** Deletes an invoice, its items, and its customer if nothing else uses it. */
export async function deleteInvoice(id: number): Promise<void> {
  await db.transaction('rw', db.customers, db.invoices, db.items, async () => {
    const invoice = await db.invoices.get(id);
    if (!invoice) return;

    await db.items.where('invoiceId').equals(id).delete();
    await db.invoices.delete(id);

    const stillReferenced = await db.invoices
      .where('customerId')
      .equals(invoice.customerId)
      .count();
    if (stillReferenced === 0) {
      await db.customers.delete(invoice.customerId);
    }
  });
}
