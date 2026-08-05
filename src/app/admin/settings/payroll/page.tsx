export const dynamic = 'force-dynamic'
import SettingsStub from '@/components/SettingsStub'

export default function PayrollPage() {
  return (
    <SettingsStub
      title="Payroll"
      description="Pay periods, rates, and staff compensation rules"
      fields={[
        { label: 'Pay Period',            description: 'How often payroll is run (weekly, bi-weekly, semi-monthly)', type: 'select' },
        { label: 'Pay Day',               description: 'Day of the week or month payroll is distributed', type: 'select' },
        { label: 'Local 26 Therapist Rate', description: 'Per-appointment rate for Union Local 26 clients', type: 'number' },
        { label: 'Standard Therapist Rate', description: 'Per-appointment rate for all other clients', type: 'number' },
        { label: 'Overtime Threshold',    description: 'Hours per week before overtime applies to hourly staff', type: 'number' },
        { label: 'Overtime Multiplier',   description: 'Rate multiplier for overtime hours (e.g. 1.5×)', type: 'number' },
      ]}
    />
  )
}
