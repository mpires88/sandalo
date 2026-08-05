export const dynamic = 'force-dynamic'
import GroupManagement from '@/components/GroupManagement'
import AdminOnly from '@/components/AdminOnly'

export default function GroupsPage() {
  return <AdminOnly><GroupManagement /></AdminOnly>
}
