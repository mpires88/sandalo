export const dynamic = 'force-dynamic'
import Staff from '@/components/Staff'
import { CLIENT_ID } from '@/constants'

export default function StaffPage() {
  return <Staff clientId={CLIENT_ID} />
}
