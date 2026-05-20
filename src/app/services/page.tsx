export const dynamic = 'force-dynamic'
import StubPage from '@/components/StubPage'

export default function ServicesPage() {
  return (
    <StubPage
      title="Services"
      subtitle="Service menu, pricing, and duration management"
      features={[
        { title: 'Service Menu', description: 'Full list of services with name, description, and category.' },
        { title: 'Pricing', description: 'Set and update pricing per service and duration tier.' },
        { title: 'Durations', description: 'Define available durations (30, 60, 90 min) per service.' },
        { title: 'Add-ons', description: 'Manage add-on services like hot stones, aromatherapy, etc.' },
        { title: 'Categories', description: 'Organize services into categories (massage, facial, body).' },
        { title: 'Revenue by Service', description: 'See which services generate the most revenue.' },
      ]}
    />
  )
}
