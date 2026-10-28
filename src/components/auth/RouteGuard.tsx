import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import type { UserRole } from '@/types/database'

interface RouteGuardProps {
  children: React.ReactNode
  /** Allowed tenant roles for this route. */
  allowedRoles?: UserRole[]
  /** Platform Super Admin routes. */
  requireSuperAdmin?: boolean
  /** Tenant app routes (the default). Set false for the platform dashboard. */
  requireTenant?: boolean
}

export function RouteGuard({
  children,
  allowedRoles,
  requireSuperAdmin = false,
  requireTenant = true,
}: RouteGuardProps) {
  const {
    profile,
    role,
    isLoading,
    isSuperAdmin,
    hasTenant,
    tenantSuspended,
  } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-on-surface-variant text-sm">جاري التحقق من الحساب...</p>
        </div>
      </div>
    )
  }

  // Not logged in -> redirect to login
  if (!profile) {
    return <Navigate to="/login" replace />
  }

  // Global account suspended
  if (!profile.is_active) {
    return <Navigate to="/suspended" replace />
  }

  if (requireSuperAdmin) {
    return isSuperAdmin ? <>{children}</> : <Navigate to="/unauthorized" replace />
  }

  if (requireTenant) {
    // A platform admin with no tenant belongs in the dashboard, not the POS.
    if (!hasTenant) {
      return <Navigate to={isSuperAdmin ? '/admin' : '/no-tenant'} replace />
    }

    // The tenant exists but the platform suspended it. The app stays signed in
    // so the user can switch to another tenant or sign out.
    if (tenantSuspended) {
      return <Navigate to="/suspended" replace />
    }

    if (allowedRoles && (!role || !allowedRoles.includes(role))) {
      return <Navigate to="/unauthorized" replace />
    }
  }

  return <>{children}</>
}
