export const dynamic = 'force-dynamic'
import SettingsStub from '@/components/SettingsStub'

export default function BookingPage() {
  return (
    <SettingsStub
      title="Booking Rules"
      description="Control how and when appointments can be scheduled"
      fields={[
        { label: 'Minimum Lead Time',       description: 'How far in advance a client must book (e.g. 2 hours)', type: 'select' },
        { label: 'Maximum Advance Booking', description: 'How far out appointments can be scheduled (e.g. 90 days)', type: 'select' },
        { label: 'Cancellation Window',     description: 'Minimum notice required to cancel without a fee (e.g. 24 hours)', type: 'select' },
        { label: 'Late Cancellation Fee',   description: 'Charge applied when client cancels inside the window', type: 'number' },
        { label: 'No-Show Fee',             description: 'Charge applied when client does not show up', type: 'number' },
        { label: 'Require Deposit',         description: 'Collect a deposit at time of booking to hold the slot', type: 'toggle' },
        { label: 'Double-Booking Allowed',  description: 'Allow a provider to be booked in two places at once', type: 'toggle' },
      ]}
    />
  )
}
