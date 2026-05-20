export const dynamic = 'force-dynamic'
import StubPage from '@/components/StubPage'

export default function MembershipsPage() {
  return (
    <StubPage
      title="Memberships"
      subtitle="Membership plans, active members, and recurring revenue"
      features={[
        { title: 'Plans', description: 'Define membership tiers with monthly price and included services.' },
        { title: 'Active Members', description: 'List of current members, their plan, and billing status.' },
        { title: 'Enrollment', description: 'Sign up a new member and assign a plan.' },
        { title: 'Renewals & Cancellations', description: 'Track upcoming renewals and process cancellations.' },
        { title: 'Usage Tracking', description: 'Monitor how members are using their included sessions.' },
        { title: 'Recurring Revenue', description: 'Monthly membership revenue and churn metrics.' },
      ]}
    />
  )
}
