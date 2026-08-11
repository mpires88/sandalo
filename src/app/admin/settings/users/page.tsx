export const dynamic = 'force-dynamic'
import UserManagement from '@/components/UserManagement'
import AdminOnly from '@/components/AdminOnly'

export default function UsersPage() {
  return (
    <AdminOnly>
      <UserManagement />
    </AdminOnly>
  )
}
