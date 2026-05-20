import Dashboard from '@/components/Dashboard'
import { CLIENT_ID } from '@/constants'

export const dynamic = 'force-dynamic'

export default function DashboardPage() {
  return <Dashboard clientId={CLIENT_ID} />
}
