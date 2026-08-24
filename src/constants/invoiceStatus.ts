import type { InvoiceStatus } from '../models/Invoice'

interface InvoiceStatusStyle {
  label: string
  /** Muted pill, for showing a status. */
  badge: string
  /** Filled pill, for the chosen option in the editor. */
  selected: string
}

// Full class strings on purpose: Tailwind only keeps classes it can see here.
export const invoiceStatusStyles: Record<InvoiceStatus, InvoiceStatusStyle> = {
  paid: {
    label: 'Paid',
    badge: 'bg-green-100 text-green-800 border-green-300',
    selected: 'bg-green-600 text-white border-green-600',
  },
  pending: {
    label: 'Pending',
    badge: 'bg-yellow-100 text-yellow-800 border-yellow-400',
    selected: 'bg-yellow-400 text-slate-900 border-yellow-400',
  },
  unpaid: {
    label: 'Unpaid',
    badge: 'bg-red-100 text-red-800 border-red-300',
    selected: 'bg-red-600 text-white border-red-600',
  },
}
