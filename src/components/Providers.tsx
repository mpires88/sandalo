'use client'

import { LanguageProvider } from '@/lib/language'
import { PermissionsProvider } from '@/lib/usePermissions'
import type { ReactNode } from 'react'

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <PermissionsProvider>{children}</PermissionsProvider>
    </LanguageProvider>
  )
}
