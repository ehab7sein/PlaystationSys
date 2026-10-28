import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutGrid,
  ShoppingBag,
  BarChart2,
  Settings,
  LogOut,
  Building2,
  Store,
  KeyRound,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { ChangePasswordModal } from '@/components/auth/ChangePasswordModal'
import logoImg from '@/assets/logo.png'

const NAV_ITEMS = [
  { to: '/', icon: LayoutGrid, label: 'الرئيسية' },
  { to: '/products', icon: ShoppingBag, label: 'المنتجات' },
  { to: '/revenue', icon: BarChart2, label: 'الإيرادات' },
] as const

function roleLabel(role: string | null) {
  if (role === 'owner') return 'مالك المحل'
  if (role === 'admin') return 'مدير المحل'
  if (role === 'worker') return 'كاشير'
  return 'مستخدم'
}

export function Sidebar() {
  const {
    canManagePrices,
    profile,
    role,
    activeTenant,
    memberships,
    isSuperAdmin,
    switchTenant,
    logout,
  } = useAuth()
  const navigate = useNavigate()
  const [showChangePassword, setShowChangePassword] = useState(false)

  const handleSignOut = async () => {
    await logout()
    navigate('/login')
  }

  const availableTenants = memberships.filter(m => m.is_active)

  return (
    <aside className="fixed top-0 right-0 h-full w-16 md:w-56 flex flex-col bg-surface-container-low border-l border-card-border z-40">
      {/* Brand Logo Banner */}
      <div className="px-2.5 py-3.5 border-b border-card-border flex items-center justify-center">
        <div className="w-full bg-white rounded-xl p-1.5 shadow-md border border-white/20 flex items-center justify-center transition-all">
          <img
            src={logoImg}
            alt="KONTROL"
            className="w-full h-auto max-h-11 object-contain hidden md:block"
          />
          <img src={logoImg} alt="KONTROL" className="w-8 h-8 object-contain md:hidden" />
        </div>
      </div>

      {/* Active tenant / switcher */}
      <div className="px-2.5 py-3 border-b border-card-border">
        <div className="hidden md:block">
          {availableTenants.length > 1 ? (
            <label className="block">
              <span className="text-[10px] text-on-surface-variant/70">المحل الحالي</span>
              <div className="relative mt-1">
                <Store className="w-3.5 h-3.5 text-primary absolute right-2.5 top-2.5 pointer-events-none" />
                <select
                  value={activeTenant?.id ?? ''}
                  onChange={e => switchTenant(e.target.value)}
                  className="w-full appearance-none bg-surface-container border border-card-border rounded-lg pr-8 pl-2 py-1.5 text-xs text-on-surface focus:outline-none focus:border-primary/60 cursor-pointer"
                >
                  {availableTenants.map(m => (
                    <option key={m.tenant_id} value={m.tenant_id}>
                      {m.tenant?.name ?? 'محل'}
                      {m.tenant && !m.tenant.is_active ? ' (موقوف)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          ) : (
            <div className="flex items-center gap-2 px-1">
              <Store className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-on-surface-variant/70 leading-none">المحل</p>
                <p className="text-xs font-semibold text-on-surface truncate">
                  {activeTenant?.name ?? 'غير مرتبط'}
                </p>
              </div>
            </div>
          )}
        </div>
        <Store className="w-5 h-5 text-primary md:hidden mx-auto" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 flex flex-col gap-1">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT transition-colors duration-150 min-h-[48px]',
                isActive
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              )
            }
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            <span className="hidden md:block text-sm">{label}</span>
          </NavLink>
        ))}

        {/* Settings — Owner/Admin only */}
        {canManagePrices && (
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT transition-colors duration-150 min-h-[48px]',
                isActive
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              )
            }
          >
            <Settings className="w-5 h-5 flex-shrink-0" />
            <span className="hidden md:block text-sm">الإعدادات</span>
          </NavLink>
        )}

        {/* Platform dashboard — Super Admin only */}
        {isSuperAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT transition-colors duration-150 min-h-[48px]',
                isActive
                  ? 'bg-secondary/10 text-secondary font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              )
            }
          >
            <Building2 className="w-5 h-5 flex-shrink-0" />
            <span className="hidden md:block text-sm">إدارة المنصة</span>
          </NavLink>
        )}
      </nav>

      {/* User info + sign out */}
      <div className="px-2 py-4 border-t border-card-border">
        <div className="hidden md:block px-3 mb-3">
          <p className="text-xs font-semibold text-on-surface truncate">{profile?.name}</p>
          <p className="text-xs text-on-surface-variant">{roleLabel(role)}</p>
        </div>
        <button
          onClick={() => setShowChangePassword(true)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT w-full
            text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors duration-150 min-h-[48px]"
        >
          <KeyRound className="w-5 h-5 flex-shrink-0" />
          <span className="hidden md:block text-sm">تغيير كلمة المرور</span>
        </button>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT w-full
            text-on-surface-variant hover:text-busy hover:bg-busy/10 transition-colors duration-150 min-h-[48px]"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          <span className="hidden md:block text-sm">تسجيل الخروج</span>
        </button>
      </div>

      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
    </aside>
  )
}
