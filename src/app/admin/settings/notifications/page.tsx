export const dynamic = 'force-dynamic'
import SettingsStub from '@/components/SettingsStub'

export default function NotificationsPage() {
  return (
    <SettingsStub
      title="Notifications"
      description="Automated messages sent to clients and staff"
      fields={[
        { label: 'Booking Confirmation',    description: 'Send a confirmation message when an appointment is booked', type: 'toggle' },
        { label: 'Reminder — 24 Hours',     description: 'Remind clients 24 hours before their appointment', type: 'toggle' },
        { label: 'Reminder — 2 Hours',      description: 'Send a same-day reminder 2 hours before the appointment', type: 'toggle' },
        { label: 'Cancellation Notice',     description: 'Notify client and provider when an appointment is cancelled', type: 'toggle' },
        { label: 'No-Show Follow-Up',       description: 'Send a message after a missed appointment', type: 'toggle' },
        { label: 'Staff Schedule Change',   description: 'Alert staff when their schedule is modified', type: 'toggle' },
        { label: 'Notification Channel',    description: 'Deliver via SMS, email, or both', type: 'select' },
      ]}
    />
  )
}
