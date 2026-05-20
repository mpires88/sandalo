import LoanDetail from '@/components/LoanDetail'
import { CLIENT_ID } from '@/constants'

export const dynamic = 'force-dynamic'

export default async function LoanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LoanDetail clientId={CLIENT_ID} loanId={id} />
}
