export const dynamic = 'force-dynamic'
import StubPage from '@/components/StubPage'

export default function InventoryPage() {
  return (
    <StubPage
      title="Inventory"
      subtitle="Supplies, retail products, and stock management"
      features={[
        { title: 'Product Catalog', description: 'All retail and supply items with SKU, cost, and sell price.' },
        { title: 'Stock Levels', description: 'Current on-hand quantities with low-stock alerts.' },
        { title: 'Receive Stock', description: 'Log incoming purchases and update quantities.' },
        { title: 'Retail Sales', description: 'Track products sold at point of sale (linked to Square).' },
        { title: 'Reorder Management', description: 'Set reorder points and generate purchase orders.' },
        { title: 'COGS Tracking', description: 'Cost of goods sold per product tied to the chart of accounts.' },
      ]}
    />
  )
}
