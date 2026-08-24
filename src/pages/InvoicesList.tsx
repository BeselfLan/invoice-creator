import { useLiveQuery } from 'dexie-react-hooks'
import { FilePlus2, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { deleteInvoice, listInvoices } from '../db/invoiceRepository'
import { currencyFormatter } from '../utils/currency'

const savedAtFormatter = new Intl.DateTimeFormat('en-CA', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function InvoicesList() {
  const navigate = useNavigate()
  // useLiveQuery re-runs whenever any of the three tables change.
  const invoices = useLiveQuery(() => listInvoices())

  const handleDelete = async (event: React.MouseEvent, id: number, label: string) => {
    event.stopPropagation()
    if (!confirm(`Delete invoice ${label}? This cannot be undone.`))
      return
    try {
      await deleteInvoice(id)
    } catch (error) {
      console.error('Failed to delete invoice', error)
      alert('Could not delete this invoice.')
    }
  }

  return (
    <>
      <div className="w-[100vw] absolute z-[-10] bg-grid top-0 left-0 min-h-screen h-full"></div>
      <div className="w-full flex flex-col items-center min-h-screen">
        <div className="bg-white shadow-lg rounded-lg p-8 w-[8.5in] max-w-2xl flex flex-col">
          <div className="flex flex-row justify-between items-center pb-4">
            <h1 className="text-2xl font-bold">Saved Invoices</h1>
            <Link
              to="/"
              className="bg-blue-600 text-white text-sm p-3 rounded-md flex gap-3 items-center no-underline hover:bg-blue-500 hover:shadow-xl active:scale-[.8]"
            >
              <FilePlus2 size={20} />
              <span>New invoice</span>
            </Link>
          </div>

          {invoices === undefined ? (
            <p className="text-sm text-gray-500 py-8 text-center">Loading invoices...</p>
          ) : invoices.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-gray-500">No invoices saved yet.</p>
              <p className="text-sm text-gray-500">
                Create one and hit <span className="font-bold">Save to database</span> to see it here.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border p-2 text-left w-1/6">Invoice #</th>
                  <th className="border p-2 text-left w-1/6">Date</th>
                  <th className="border p-2 text-left w-2/6">Customer</th>
                  <th className="border p-2 text-right w-1/6">Total</th>
                  <th className="border p-2 w-[40px]"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(invoice => (
                  <tr
                    key={invoice.id}
                    className="cursor-pointer hover:bg-slate-100"
                    onClick={() => navigate(`/invoices/${invoice.id}`)}
                    title={`Last saved ${savedAtFormatter.format(invoice.updatedAt)}`}
                  >
                    <td className="border p-2">{invoice.invoiceNo || '--'}</td>
                    <td className="border p-2">{invoice.date || '--'}</td>
                    <td className="border p-2">
                      <div>{invoice.customerName || 'Unnamed customer'}</div>
                      <div className="text-xs text-gray-500">
                        {[invoice.customerAddress, invoice.customerCity].filter(Boolean).join(', ')}
                      </div>
                    </td>
                    <td className="border p-2 text-right">
                      <div>{currencyFormatter.format(invoice.total)}</div>
                      <div className="text-xs text-gray-500">
                        {invoice.itemCount} item{invoice.itemCount === 1 ? '' : 's'}
                      </div>
                    </td>
                    <td className="border p-2 text-center">
                      <button
                        type="button"
                        title="Delete invoice"
                        className="text-gray-500 hover:text-red-500 align-middle"
                        onClick={event => handleDelete(event, invoice.id, invoice.invoiceNo || String(invoice.id))}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}

export default InvoicesList
