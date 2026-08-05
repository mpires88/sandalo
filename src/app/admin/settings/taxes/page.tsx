export const dynamic = 'force-dynamic'
import SettingsStub from '@/components/SettingsStub'

export default function TaxesPage() {
  return (
    <SettingsStub
      title="Taxes"
      description="Sales tax rates and tax-exempt service configuration"
      fields={[
        { label: 'Sales Tax Rate',        description: 'Default rate applied to taxable services (e.g. 6.25%)', type: 'number' },
        { label: 'Tax-Exempt Services',   description: 'Massage and therapeutic services may be exempt — configure per service', type: 'toggle' },
        { label: 'Tax ID / EIN',          description: 'Shown on receipts when required', type: 'text' },
        { label: 'Show Tax on Receipts',  description: 'Break out tax as a separate line item on client receipts', type: 'toggle' },
      ]}
    />
  )
}
