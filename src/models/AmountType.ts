import type { Invoice } from './Invoice'

/**
 * The kinds of money an invoice bills for. Reports split totals along these
 * four, so they have to cover every field that contributes to a total.
 */
export const AMOUNT_TYPES = ['parts', 'labour', 'parking', 'tax'] as const

export type AmountType = typeof AMOUNT_TYPES[number]

export type AmountBreakdown = Record<AmountType, number>

/** The rate the editor charges on everything except the parking cost. */
export const HST_RATE = 0.13

export const emptyBreakdown = (): AmountBreakdown =>
  ({ parts: 0, labour: 0, parking: 0, tax: 0 })

export const breakdownTotal = (breakdown: AmountBreakdown) =>
  AMOUNT_TYPES.reduce((sum, type) => sum + breakdown[type], 0)

/** Adds `addend` into `target`, in place. */
export const addBreakdown = (target: AmountBreakdown, addend: AmountBreakdown) => {
  for (const type of AMOUNT_TYPES)
    target[type] += addend[type]
}

/**
 * Line items sit under a "Materials and Parts" heading, so they count as parts
 * -- except that nothing stops people typing labour straight into that table
 * instead of using the labour fee field, and plenty of invoices do exactly
 * that. Names that read as labour are moved across so the split stays honest.
 *
 * `\b` in front of `labou?r` keeps words like "collaborate" out of it.
 */
const LABOUR_ITEM = /\blabou?r|\bservice call|\bdiagnos/i

export const isLabourItem = (name: string | undefined) => LABOUR_ITEM.test(name ?? '')

const num = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

/**
 * The parts / labour / parking / tax split of everything one invoice bills for,
 * matching the totals the editor shows: HST on the parts and the labour, and
 * the parking cost passed through as billed.
 */
export function breakdownOf(invoice: {
  items?: Pick<Invoice['items'][number], 'name' | 'amount'>[]
  labourFee?: number
  parkingCost?: number
}): AmountBreakdown {
  const breakdown = emptyBreakdown()

  for (const item of invoice.items ?? []) {
    if (isLabourItem(item.name))
      breakdown.labour += num(item.amount)
    else
      breakdown.parts += num(item.amount)
  }

  breakdown.labour += num(invoice.labourFee)
  // Parking is billed at what it cost with its tax already inside it, so it is
  // the one charge HST is not added on top of. That tax cannot be separated
  // back out either, which is why it stays counted as parking rather than tax.
  breakdown.parking += num(invoice.parkingCost)
  breakdown.tax = (breakdown.parts + breakdown.labour) * HST_RATE

  return breakdown
}
