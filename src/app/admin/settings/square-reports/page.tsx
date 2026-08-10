export const dynamic = 'force-dynamic'
import SquareReports from '@/components/SquareReports'
import { CLIENT_ID } from '@/constants'

export default function SquareReportsPage() {
  return <SquareReports clientId={CLIENT_ID} />
}
