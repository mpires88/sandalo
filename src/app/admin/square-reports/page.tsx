import SquareReports from '@/components/SquareReports'
import { CLIENT_ID } from '@/constants'

export const dynamic = 'force-dynamic'

export default function SquareReportsPage() {
  return <SquareReports clientId={CLIENT_ID} />
}
