export const dynamic = 'force-dynamic'
import MigrationTool from '@/components/MigrationTool'
import { CLIENT_ID } from '@/constants'

export default function MigratePage() {
  return <MigrationTool clientId={CLIENT_ID} />
}
