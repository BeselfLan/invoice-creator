import Dexie, { type EntityTable } from 'dexie';

/**
 * Customer info, stored once per customer and referenced by invoices.
 */
export interface CustomerRecord {
  id: number;
  name?: string;
  address: string;
  city: string;
  phone?: string;
  email?: string;
}

/**
 * The invoice header. Line items live in the `items` table and the billing
 * details live in `customers`, both linked back by foreign key.
 */
export interface InvoiceRecord {
  id: number;
  invoiceNo: string;
  date: string;
  /** FK -> customers.id */
  customerId: number;
  description: string;
  recommendation: string;
  labourFee: number;
  other1: string;
  other1Fee: number;
  other2: string;
  other2Fee: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * A single line item belonging to one invoice.
 */
export interface ItemRecord {
  id: number;
  /** FK -> invoices.id */
  invoiceId: number;
  /** Position of the item within its invoice. */
  sortOrder: number;
  name: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
}

const db = new Dexie('InvoiceCreatorDB') as Dexie & {
  customers: EntityTable<CustomerRecord, 'id'>;
  invoices: EntityTable<InvoiceRecord, 'id'>;
  items: EntityTable<ItemRecord, 'id'>;
};

// Indexes on the foreign keys are what make the relational lookups cheap.
db.version(1).stores({
  customers: '++id, name, city, phone, email',
  invoices: '++id, invoiceNo, date, customerId, updatedAt',
  items: '++id, invoiceId, name',
});

export { db };
