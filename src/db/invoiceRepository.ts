import { db, type CustomerRecord, type InvoiceRecord, type ItemRecord } from './db';
import type { Invoice } from '../models/Invoice';

/** A stored invoice re-joined with its customer and items. */
export type StoredInvoice = Invoice & { id: number };

/** One row of the "all invoices" list. */
export interface InvoiceSummary {
  id: number;
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

const invoiceTotal = (
  invoice: Pick<InvoiceRecord, 'labourFee' | 'other1Fee' | 'other2Fee'>,
  items: ItemRecord[],
) =>
  items.reduce((sum, item) => sum + num(item.amount), 0) +
  num(invoice.labourFee) +
  num(invoice.other1Fee) +
  num(invoice.other2Fee);

/** Joins the three tables back into the shape the invoice form works with. */
const toInvoice = (
  invoice: InvoiceRecord,
  customer: CustomerRecord | undefined,
  items: ItemRecord[],
): StoredInvoice => ({
  id: invoice.id,
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
  labourFee: num(invoice.labourFee),
  other1: invoice.other1 ?? '',
  other1Fee: num(invoice.other1Fee),
  other2: invoice.other2 ?? '',
  other2Fee: num(invoice.other2Fee),
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
      invoiceNo: invoice.invoiceNo ?? '',
      date: invoice.date ?? '',
      customerId,
      description: invoice.description ?? '',
      recommendation: invoice.recommendation ?? '',
      labourFee: num(invoice.labourFee),
      other1: invoice.other1 ?? '',
      other1Fee: num(invoice.other1Fee),
      other2: invoice.other2 ?? '',
      other2Fee: num(invoice.other2Fee),
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

/** Loads one invoice with its customer info and items attached. */
export async function getInvoice(id: number): Promise<StoredInvoice | undefined> {
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

/** Lists every invoice, newest first, with its customer and computed total. */
export async function listInvoices(): Promise<InvoiceSummary[]> {
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

    return invoices.map((invoice) => {
      const customer = customersById.get(invoice.customerId);
      const invoiceItems = itemsByInvoice.get(invoice.id) ?? [];
      return {
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        date: invoice.date,
        customerName: customer?.name ?? '',
        customerAddress: customer?.address ?? '',
        customerCity: customer?.city ?? '',
        itemCount: invoiceItems.length,
        total: invoiceTotal(invoice, invoiceItems),
        updatedAt: invoice.updatedAt,
      };
    });
  });
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
