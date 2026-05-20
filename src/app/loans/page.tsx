import Loans from '@/components/Loans'
import { CLIENT_ID } from '@/constants'

export const dynamic = 'force-dynamic'

export default function LoansPage() {
  return <Loans clientId={CLIENT_ID} />
}
