export const dynamic = 'force-dynamic'
import StubPage from '@/components/StubPage'

export default function AppointmentsPage() {
  return (
    <StubPage
      title="Appointments"
      subtitle="Book, view, and manage massage appointments"
      features={[
        { title: 'Calendar View', description: 'Day, week, and month views of all scheduled appointments.' },
        { title: 'Book Appointment', description: 'Schedule a new appointment with client, service, staff, and time.' },
        { title: 'Upcoming Queue', description: 'Today\'s and tomorrow\'s appointments at a glance.' },
        { title: 'Appointment History', description: 'Full log of past appointments with status and notes.' },
        { title: 'Cancellations & No-shows', description: 'Track and manage cancelled or missed appointments.' },
        { title: 'Reminders', description: 'Automated appointment reminder workflows.' },
      ]}
    />
  )
}
