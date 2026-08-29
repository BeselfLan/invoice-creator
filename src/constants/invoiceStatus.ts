import type { InvoiceStatus } from '../models/Invoice'

interface InvoiceStatusStyle {
  label: string
  /** Muted pill, for showing a status. */
  badge: string
  /** Filled pill, for the chosen option in the editor. */
  selected: string
  /** Outline for a status that is switched on as a filter. */
  ring: string
}

// Full class strings on purpose: Tailwind only keeps classes it can see here.
export const invoiceStatusStyles: Record<InvoiceStatus, InvoiceStatusStyle> = {
  paid: {
    label: 'Paid',
    badge: 'bg-green-100 text-green-800 border-green-300',
    selected: 'bg-green-600 text-white border-green-600',
    ring: 'ring-green-600',
  },
  pending: {
    label: 'Pending',
    badge: 'bg-yellow-100 text-yellow-800 border-yellow-400',
    selected: 'bg-yellow-400 text-slate-900 border-yellow-400',
    ring: 'ring-yellow-500',
  },
  unpaid: {
    label: 'Unpaid',
    badge: 'bg-red-100 text-red-800 border-red-300',
    selected: 'bg-red-600 text-white border-red-600',
    ring: 'ring-red-600',
  },
}

/**
 * Where each status sits when the list is sorted by it: what still needs
 * chasing first, settled invoices last. Deliberately not the order in
 * `INVOICE_STATUSES`, which is the order the editor offers the buttons in.
 */
export const invoiceStatusSortOrder: Record<InvoiceStatus, number> = {
  pending: 0,
  unpaid: 1,
  paid: 2,
}
