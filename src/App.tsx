import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { AppLayout } from '@/components/layout/AppLayout'
import { RouteGuard } from '@/components/auth/RouteGuard'
import { LoginPage } from '@/pages/LoginPage'
import { HomePage } from '@/pages/HomePage'
import { Button } from '@/components/ui/Button'
import { Building2, ShieldAlert, Store } from 'lucide-react'

// Code-split pages to reduce the initial JS bundle size and speed up first render.
const ProductsPage = lazy(() =>
  import('@/pages/ProductsPage').then(m => ({ default: m.ProductsPage }))
)
const RevenuePage = lazy(() =>
  import('@/pages/RevenuePage').then(m => ({ default: m.RevenuePage }))
)
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage }))
)
const SuperAdminPage = lazy(() =>
  import('@/pages/SuperAdminPage').then(m => ({ default: m.SuperAdminPage }))
)

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function SuspendedPage() {
  const { profile, activeTenant, memberships, switchTenant, logout, isSuperAdmin } = useAuth()

  const accountSuspended = !!profile && !profile.is_active
  const otherTenants = memberships.filter(
    m => m.is_active && m.tenant?.is_active && m.tenant_id !== activeTenant?.id
  )

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-4 text-center">
      <div className="bg-card border border-card-border rounded-2xl p-8 max-w-md w-full shadow-xl">
        <div className="w-16 h-16 rounded-2xl bg-busy/10 border border-busy/30 flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-8 h-8 text-busy" />
        </div>
        <h1 className="text-xl font-bold text-on-surface">
          {accountSuspended ? 'الحساب موقوف' : 'هذا المحل موقوف مؤقتاً'}
        </h1>
        <p className="text-on-surface-variant text-sm mt-2 mb-6 leading-relaxed">
          {accountSuspended
            ? 'تم إيقاف هذا الحساب، يرجى التواصل مع إدارة المنصة لتفعيله.'
            : `تم إيقاف الوصول إلى «${activeTenant?.name ?? 'المحل'}» من قبل إدارة المنصة. بياناتك محفوظة، ويمكنك العودة بعد إعادة التفعيل.`}
        </p>

        {otherTenants.length > 0 && (
          <div className="mb-4 text-right">
            <p className="text-xs text-on-surface-variant mb-2">لديك محلات أخرى متاحة:</p>
            <div className="flex flex-col gap-2">
              {otherTenants.map(m => (
                <button
                  key={m.tenant_id}
                  onClick={() => switchTenant(m.tenant_id)}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-card-border bg-surface-container-low hover:border-primary/50 transition-colors"
                >
                  <span className="flex items-center gap-2 text-sm text-on-surface">
                    <Store className="w-4 h-4 text-primary" />
                    {m.tenant?.name}
                  </span>
                  <span className="text-[11px] text-on-surface-variant">دخول</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {isSuperAdmin && (
            <Link to="/admin">
              <Button variant="primary" fullWidth>
                <Building2 className="w-4 h-4" />
                لوحة إدارة المنصة
              </Button>
            </Link>
          )}
          <Button variant="outline" fullWidth onClick={logout}>
            تسجيل الخروج
          </Button>
        </div>
      </div>
    </div>
  )
}

function NoTenantPage() {
  const { profile, logout, isSuperAdmin, memberships } = useAuth()

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-4 text-center">
      <div className="bg-card border border-card-border rounded-2xl p-8 max-w-md w-full shadow-xl">
        <div className="w-16 h-16 rounded-2xl bg-tertiary/10 border border-tertiary/30 flex items-center justify-center mx-auto mb-4">
          <Store className="w-8 h-8 text-tertiary" />
        </div>
        <h1 className="text-xl font-bold text-on-surface">لا يوجد محل مرتبط بحسابك</h1>
        <p className="text-on-surface-variant text-sm mt-2 mb-6 leading-relaxed">
          {profile?.name ? `أهلاً ${profile.name}. ` : ''}
          حسابك غير مرتبط بأي محل حتى الآن. تواصل مع إدارة المنصة لإضافتك.
        </p>
        {memberships.some(m => !m.is_active) && (
          <p className="text-xs text-tertiary mb-4">
            توجد عضوية موقوفة في أحد المحلات. تواصل مع مالك المحل لإعادة تفعيلها.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {isSuperAdmin && (
            <Link to="/admin">
              <Button variant="primary" fullWidth>
                <Building2 className="w-4 h-4" />
                لوحة إدارة المنصة
              </Button>
            </Link>
          )}
          <Button variant="outline" fullWidth onClick={logout}>
            تسجيل الخروج
          </Button>
        </div>
      </div>
    </div>
  )
}

function UnauthorizedPage() {
  const { logout, isSuperAdmin, hasTenant } = useAuth()
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-4 text-center">
      <div className="bg-card border border-card-border rounded-2xl p-8 max-w-sm w-full shadow-xl">
        <div className="w-16 h-16 rounded-2xl bg-error/10 border border-error/30 flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-8 h-8 text-error" />
        </div>
        <h1 className="text-xl font-bold text-on-surface">غير مصرح لك بالدخول</h1>
        <p className="text-on-surface-variant text-sm mt-2 mb-6">
          ليس لديك الصلاحيات الكافية للوصول إلى هذه الصفحة.
        </p>
        <div className="flex flex-col gap-2">
          {isSuperAdmin && (
            <Link to="/admin">
              <Button variant="primary" fullWidth>
                <Building2 className="w-4 h-4" />
                لوحة إدارة المنصة
              </Button>
            </Link>
          )}
          {hasTenant && (
            <Button variant="primary" fullWidth onClick={() => (window.location.href = '/')}>
              العودة للرئيسية
            </Button>
          )}
          <Button variant="ghost" fullWidth onClick={logout}>
            تسجيل الخروج
          </Button>
        </div>
      </div>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Login Route */}
          <Route path="/login" element={<LoginPage />} />

          {/* Platform Super Admin (no tenant required) */}
          <Route
            path="/admin"
            element={
              <RouteGuard requireSuperAdmin requireTenant={false}>
                <Suspense fallback={<PageLoader />}>
                  <SuperAdminPage />
                </Suspense>
              </RouteGuard>
            }
          />

          {/* Protected Tenant Routes */}
          <Route
            element={
              <RouteGuard allowedRoles={['worker', 'owner', 'admin']}>
                <AppLayout />
              </RouteGuard>
            }
          >
            {/* Worker + Owner + Admin */}
            <Route path="/" element={<HomePage />} />
            <Route
              path="/products"
              element={
                <Suspense fallback={<PageLoader />}>
                  <ProductsPage />
                </Suspense>
              }
            />
            <Route
              path="/revenue"
              element={
                <Suspense fallback={<PageLoader />}>
                  <RevenuePage />
                </Suspense>
              }
            />

            {/* Owner + Admin only */}
            <Route
              path="/settings"
              element={
                <RouteGuard allowedRoles={['owner', 'admin']}>
                  <Suspense fallback={<PageLoader />}>
                    <SettingsPage />
                  </Suspense>
                </RouteGuard>
              }
            />
          </Route>

          {/* Status & Error pages */}
          <Route path="/unauthorized" element={<UnauthorizedPage />} />
          <Route path="/suspended" element={<SuspendedPage />} />
          <Route path="/no-tenant" element={<NoTenantPage />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
