export const dynamic = 'force-dynamic'
import StubPage from '@/components/StubPage'

export default function ClientsPage() {
  return (
    <StubPage
      title="Clients"
      subtitle="Customer directory, visit history, and preferences"
      features={[
        { title: 'Client Directory', description: 'Search and browse all clients with contact info.' },
        { title: 'Client Profile', description: 'Full profile including visit history, spend, and notes.' },
        { title: 'Intake Forms', description: 'Health history and intake form records per client.' },
        { title: 'Preferences & Notes', description: 'Track pressure preference, allergies, and therapist notes.' },
        { title: 'Visit History', description: 'All past appointments, services received, and tips.' },
        { title: 'Retention Metrics', description: 'Last visit date, visit frequency, and lifetime value.' },
      ]}
    />
  )
}
