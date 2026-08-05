export const dynamic = 'force-dynamic'
import SettingsStub from '@/components/SettingsStub'

export default function BusinessProfilePage() {
  return (
    <SettingsStub
      title="Business Profile"
      description="Your business name, contact information, and branding"
      fields={[
        { label: 'Business Name',    description: 'Display name shown on receipts and confirmations', type: 'text' },
        { label: 'Phone Number',     description: 'Main contact number for clients', type: 'text' },
        { label: 'Email Address',    description: 'Booking confirmations and receipts are sent from this address', type: 'text' },
        { label: 'Address',          description: 'Physical location shown on receipts', type: 'text' },
        { label: 'Website',          description: 'Linked on client-facing communications', type: 'text' },
        { label: 'Time Zone',        description: 'All appointment times are displayed in this zone', type: 'select' },
      ]}
    />
  )
}
