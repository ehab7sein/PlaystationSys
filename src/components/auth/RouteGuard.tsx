import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import type { UserRole } from '@/types/database'

interface RouteGuardProps {
  children: React.ReactNode
  /** Minimum role required. 'worker' = any logged-in user */
  allowedRoles?: UserRole[]
}

export function RouteGuard({ children, allowedRoles }: RouteGuardProps) {
  const { profile, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="text-on-surface-variant">جاري التحميل...</div>
      </div>
    )
  }

  if (!profile) {
    return <Navigate to="/login" replace />
  }

  if (!profile.is_active) {
    return <Navigate to="/suspended" replace />
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/unauthorized" replace />
  }

  return <>{children}</>
}
