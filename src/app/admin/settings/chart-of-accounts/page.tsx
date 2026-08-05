export const dynamic = 'force-dynamic'
import ChartOfAccounts from '@/components/ChartOfAccounts'
import { CLIENT_ID } from '@/constants'

export default function ChartOfAccountsPage() {
  return <ChartOfAccounts clientId={CLIENT_ID} />
}
