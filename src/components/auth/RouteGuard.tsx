import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import type { UserRole } from '@/types/database'
import { Button } from '@/components/ui/Button'
import { useClerk } from '@clerk/clerk-react'

interface RouteGuardProps {
  children: React.ReactNode
  /** Minimum role required. 'worker' = any logged-in user */
  allowedRoles?: UserRole[]
}

export function RouteGuard({ children, allowedRoles }: RouteGuardProps) {
  const { profile, isLoading, createProfileWithRole } = useAuth()
  const { signOut } = useClerk()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-on-surface-variant text-sm">جاري تسجيل الدخول وتجهيز الحساب...</p>
        </div>
      </div>
    )
  }

  // If user is logged into Clerk but profile hasn't finished creating yet
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface p-4 text-center">
        <div className="bg-card border border-card-border rounded-xl p-6 max-w-md w-full shadow-lg">
          <div className="text-4xl mb-3">🎮</div>
          <h2 className="text-xl font-bold text-on-surface mb-2">تأكيد نوع الحساب</h2>
          <p className="text-on-surface-variant text-sm mb-6 leading-relaxed">
            اختر دورك للدخول إلى النظام:
          </p>
          <div className="flex flex-col gap-3">
            <Button
              variant="primary"
              fullWidth
              size="lg"
              onClick={() => createProfileWithRole('worker')}
            >
              💼 الدخول كـ كاشير (Worker)
            </Button>
            <Button
              variant="outline"
              fullWidth
              onClick={() => createProfileWithRole('admin')}
            >
              👑 الدخول كـ مدير (Admin)
            </Button>
            <Button
              variant="ghost"
              fullWidth
              onClick={() => signOut()}
            >
              تسجيل الخروج
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!profile.is_active) {
    return <Navigate to="/suspended" replace />
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/unauthorized" replace />
  }

  return <>{children}</>
}
