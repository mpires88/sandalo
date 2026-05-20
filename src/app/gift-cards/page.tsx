export const dynamic = 'force-dynamic'
import StubPage from '@/components/StubPage'

export default function GiftCardsPage() {
  return (
    <StubPage
      title="Gift Cards"
      subtitle="Issue, track balances, and manage redemptions"
      features={[
        { title: 'Issue Gift Card', description: 'Create a new gift card with a set dollar value.' },
        { title: 'Balance Lookup', description: 'Check remaining balance by card number or client.' },
        { title: 'Redemption History', description: 'Full log of when and how each card was used.' },
        { title: 'Outstanding Liability', description: 'Total unredeemed gift card balance (liability tracking).' },
        { title: 'Expiration Management', description: 'Set and enforce expiration policies per card.' },
        { title: 'Sales Reporting', description: 'Gift card revenue vs. redemptions over time.' },
      ]}
    />
  )
}
