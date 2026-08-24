import { INVOICE_STATUSES, type InvoiceStatus } from '../models/Invoice'
import {
  addBreakdown,
  breakdownTotal,
  emptyBreakdown,
  type AmountBreakdown,
} from '../models/AmountType'
import {
  addUnits,
  bucketLabel,
  bucketTitle,
  startOfBucket,
  type BucketUnit,
} from './invoiceDate'

/** One saved invoice, reduced to the numbers a report cares about. */
export interface InvoiceStat {
  id: number
  status: InvoiceStatus
  invoiceNo: string
  customerName: string
  /** The invoice's own date, falling back to when it was first saved. */
  dateMs: number
  amounts: AmountBreakdown
  total: number
}

export const REPORT_RANGES = ['week', 'month', 'year', 'all'] as const

export type ReportRange = typeof REPORT_RANGES[number]

export const reportRangeLabels: Record<ReportRange, string> = {
  week: 'Last week',
  month: 'Last month',
  year: 'Last year',
  all: 'All time',
}

/** The columns of the timeline, and how wide each one is. */
interface Timeline {
  unit: BucketUnit
  starts: number[]
}

/**
 * A fixed range is a whole number of columns ending with the one we are in,
 * so the range the totals cover and the range the chart draws are the same
 * thing -- the two can never disagree about which invoices they counted.
 */
const FIXED_TIMELINES: Record<Exclude<ReportRange, 'all'>, { unit: BucketUnit; count: number }> = {
  week: { unit: 'day', count: 7 },
  month: { unit: 'week', count: 5 },
  year: { unit: 'month', count: 12 },
}

/** Coarsest-last, for picking a column width that "All time" can actually draw. */
const UNIT_LADDER: BucketUnit[] = ['day', 'week', 'month', 'year']

/** More columns than this and the axis labels stop being readable. */
const MAX_BUCKETS = 24

/** Stops a span of nonsense dates from spinning the loop below. */
const HARD_CAP = 400

const bucketStarts = (from: number, to: number, unit: BucketUnit): number[] => {
  const starts: number[] = []
  const last = startOfBucket(to, unit)
  let cursor = startOfBucket(from, unit)
  while (cursor <= last && starts.length < HARD_CAP) {
    starts.push(cursor)
    cursor = addUnits(cursor, unit, 1)
  }
  return starts
}

/** The narrowest column width that keeps the whole span under the cap. */
const timelineForSpan = (from: number, to: number): Timeline => {
  for (const unit of UNIT_LADDER) {
    const starts = bucketStarts(from, to, unit)
    if (starts.length <= MAX_BUCKETS || unit === 'year')
      return { unit, starts }
  }
  return { unit: 'year', starts: bucketStarts(from, to, 'year') }
}

const timelineFor = (stats: InvoiceStat[], range: ReportRange, now: number): Timeline => {
  if (range !== 'all') {
    const { unit, count } = FIXED_TIMELINES[range]
    const first = addUnits(startOfBucket(now, unit), unit, -(count - 1))
    return { unit, starts: bucketStarts(first, now, unit) }
  }

  if (stats.length === 0)
    return timelineForSpan(now, now)

  const dates = stats.map(stat => stat.dateMs)
  // An invoice dated in the future still belongs on an all-time timeline.
  return timelineForSpan(Math.min(...dates), Math.max(now, ...dates))
}

/** One column of the chart: what was billed in that slice of time. */
export interface ReportBucket {
  start: number
  /** Short label for the axis. */
  label: string
  /** Spelled-out label for the tooltip. */
  title: string
  amounts: AmountBreakdown
  total: number
  invoiceCount: number
}

export interface StatusTotal {
  total: number
  count: number
}

export interface ReportSummary {
  unit: BucketUnit
  buckets: ReportBucket[]
  /** The invoices inside the range that passed the status filter, newest first. */
  invoices: InvoiceStat[]
  invoiceCount: number
  total: number
  amounts: AmountBreakdown
  /**
   * Every status in the range, counted whether or not the status filter let it
   * through -- these are the numbers on the buttons that drive that filter, so
   * narrowing to one status must not empty the other two.
   */
  byStatus: Record<InvoiceStatus, StatusTotal>
}

const emptyStatusTotals = (): Record<InvoiceStatus, StatusTotal> =>
  Object.fromEntries(
    INVOICE_STATUSES.map(status => [status, { total: 0, count: 0 }]),
  ) as Record<InvoiceStatus, StatusTotal>

/**
 * Buckets and totals every invoice that falls inside `range`. Anything dated
 * outside the timeline is left out of both the chart and the totals, so every
 * number on the page describes the same set of invoices.
 *
 * `statuses` narrows that set further; an empty or missing set means no status
 * filter at all, which is what deselecting every button leaves behind.
 *
 * The timeline itself is measured from every in-range invoice rather than the
 * ones that survive the filter, so toggling a status re-draws the columns
 * without moving the axis under them.
 */
export function buildReport(
  stats: InvoiceStat[],
  range: ReportRange,
  statuses?: ReadonlySet<InvoiceStatus>,
  now = Date.now(),
): ReportSummary {
  const { unit, starts } = timelineFor(stats, range, now)

  // Only a monthly axis is ambiguous without its year; weeks and days carry a
  // date, and a yearly axis is nothing but years.
  const withYear = unit === 'month' &&
    new Date(starts[0]).getFullYear() !== new Date(starts[starts.length - 1]).getFullYear()

  const buckets: ReportBucket[] = starts.map(start => ({
    start,
    label: bucketLabel(start, unit, withYear),
    title: bucketTitle(start, unit),
    amounts: emptyBreakdown(),
    total: 0,
    invoiceCount: 0,
  }))
  const bucketsByStart = new Map(buckets.map(bucket => [bucket.start, bucket]))

  const amounts = emptyBreakdown()
  const byStatus = emptyStatusTotals()
  const invoices: InvoiceStat[] = []

  const filtering = statuses !== undefined && statuses.size > 0

  for (const stat of stats) {
    const bucket = bucketsByStart.get(startOfBucket(stat.dateMs, unit))
    if (!bucket)
      continue

    // Counted before the filter runs, so the buttons keep their totals.
    byStatus[stat.status].total += stat.total
    byStatus[stat.status].count++

    if (filtering && !statuses.has(stat.status))
      continue

    addBreakdown(bucket.amounts, stat.amounts)
    bucket.total += stat.total
    bucket.invoiceCount++

    addBreakdown(amounts, stat.amounts)
    invoices.push(stat)
  }

  invoices.sort((a, b) => b.dateMs - a.dateMs)

  return {
    unit,
    buckets,
    invoices,
    invoiceCount: invoices.length,
    total: breakdownTotal(amounts),
    amounts,
    byStatus,
  }
}
