export const dynamic = 'force-dynamic'
import ClientProfile from '@/components/ClientProfile'

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ClientProfile customerId={id} />
}
