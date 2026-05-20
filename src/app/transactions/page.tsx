import Transactions from '@/components/Transactions'
import { CLIENT_ID } from '@/constants'

export const dynamic = 'force-dynamic'

export default function TransactionsPage() {
  return <Transactions clientId={CLIENT_ID} />
}
