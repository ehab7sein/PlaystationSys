import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ClerkProvider, SignedIn, SignedOut } from '@clerk/clerk-react'
import { AuthProvider } from '@/contexts/AuthContext'
import { AppLayout } from '@/components/layout/AppLayout'
import { RouteGuard } from '@/components/auth/RouteGuard'
import { LoginPage } from '@/pages/LoginPage'
import { HomePage } from '@/pages/HomePage'
import { ProductsPage } from '@/pages/ProductsPage'
import { RevenuePage } from '@/pages/RevenuePage'
import { SettingsPage } from '@/pages/SettingsPage'

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string

function App() {
  return (
    <ClerkProvider publishableKey={CLERK_KEY}>
      <BrowserRouter>
        <SignedOut>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </SignedOut>

        <SignedIn>
          <AuthProvider>
            <Routes>
              <Route element={<AppLayout />}>
                {/* Worker + Owner + Admin */}
                <Route path="/" element={
                  <RouteGuard allowedRoles={['worker', 'owner', 'admin']}>
                    <HomePage />
                  </RouteGuard>
                } />
                <Route path="/products" element={
                  <RouteGuard allowedRoles={['worker', 'owner', 'admin']}>
                    <ProductsPage />
                  </RouteGuard>
                } />
                <Route path="/revenue" element={
                  <RouteGuard allowedRoles={['worker', 'owner', 'admin']}>
                    <RevenuePage />
                  </RouteGuard>
                } />

                {/* Owner + Admin only */}
                <Route path="/settings" element={
                  <RouteGuard allowedRoles={['owner', 'admin']}>
                    <SettingsPage />
                  </RouteGuard>
                } />
              </Route>

              {/* Error pages */}
              <Route path="/unauthorized" element={
                <div className="min-h-screen flex items-center justify-center bg-surface text-center">
                  <div>
                    <p className="text-4xl mb-4">🚫</p>
                    <h1 className="text-xl font-bold text-on-surface">غير مصرح</h1>
                    <p className="text-on-surface-variant mt-2">ليس لديك صلاحية للوصول لهذه الصفحة</p>
                  </div>
                </div>
              } />
              <Route path="/suspended" element={
                <div className="min-h-screen flex items-center justify-center bg-surface text-center">
                  <div>
                    <p className="text-4xl mb-4">⛔</p>
                    <h1 className="text-xl font-bold text-on-surface">الحساب موقوف</h1>
                    <p className="text-on-surface-variant mt-2">تواصل مع المدير لتفعيل حسابك</p>
                  </div>
                </div>
              } />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </SignedIn>
      </BrowserRouter>
    </ClerkProvider>
  )
}

export default App
