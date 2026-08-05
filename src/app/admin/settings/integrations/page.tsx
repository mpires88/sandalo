export const dynamic = 'force-dynamic'
import SquareIntegration from '@/components/SquareIntegration'
import AdminOnly from '@/components/AdminOnly'

export default function IntegrationsPage() {
  return <AdminOnly><SquareIntegration /></AdminOnly>
}
