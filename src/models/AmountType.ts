import type { Invoice } from './Invoice'

/**
 * The kinds of money an invoice bills for. Reports split totals along these
 * three, so they have to cover every field that contributes to a total.
 */
export const AMOUNT_TYPES = ['parts', 'labour', 'other'] as const

export type AmountType = typeof AMOUNT_TYPES[number]

export type AmountBreakdown = Record<AmountType, number>

export const emptyBreakdown = (): AmountBreakdown => ({ parts: 0, labour: 0, other: 0 })

export const breakdownTotal = (breakdown: AmountBreakdown) =>
  breakdown.parts + breakdown.labour + breakdown.other

/** Adds `addend` into `target`, in place. */
export const addBreakdown = (target: AmountBreakdown, addend: AmountBreakdown) => {
  target.parts += addend.parts
  target.labour += addend.labour
  target.other += addend.other
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

/** The parts / labour / other split of everything one invoice bills for. */
export function breakdownOf(invoice: {
  items?: Pick<Invoice['items'][number], 'name' | 'amount'>[]
  labourFee?: number
  other1Fee?: number
  other2Fee?: number
}): AmountBreakdown {
  const breakdown = emptyBreakdown()

  for (const item of invoice.items ?? []) {
    if (isLabourItem(item.name))
      breakdown.labour += num(item.amount)
    else
      breakdown.parts += num(item.amount)
  }

  breakdown.labour += num(invoice.labourFee)
  breakdown.other += num(invoice.other1Fee) + num(invoice.other2Fee)

  return breakdown
}
