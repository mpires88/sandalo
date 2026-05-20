import ChartOfAccounts from '@/components/ChartOfAccounts'
import { CLIENT_ID } from '@/constants'

export const dynamic = 'force-dynamic'

export default function ChartOfAccountsPage() {
  return <ChartOfAccounts clientId={CLIENT_ID} />
}
