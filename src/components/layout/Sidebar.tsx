import { NavLink, useNavigate } from 'react-router-dom'
import { useClerk } from '@clerk/clerk-react'
import { LayoutGrid, ShoppingBag, BarChart2, Settings, LogOut, Gamepad2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'

const NAV_ITEMS = [
  { to: '/', icon: LayoutGrid, label: 'الرئيسية' },
  { to: '/products', icon: ShoppingBag, label: 'المنتجات' },
  { to: '/revenue', icon: BarChart2, label: 'الإيرادات' },
] as const

export function Sidebar() {
  const { canManagePrices, profile } = useAuth()
  const { signOut } = useClerk()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <aside className="fixed top-0 right-0 h-full w-16 md:w-56 flex flex-col bg-surface-container-low border-l border-card-border z-40">
      {/* Logo */}
      <div className="flex items-center gap-3 px-3 py-5 border-b border-card-border">
        <div className="flex-shrink-0 w-9 h-9 bg-primary rounded-lg flex items-center justify-center">
          <Gamepad2 className="w-5 h-5 text-primary-dark" />
        </div>
        <span className="hidden md:block font-bold text-on-surface text-sm leading-tight">
          إدارة<br />البلايستيشن
        </span>
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
      </nav>

      {/* User info + sign out */}
      <div className="px-2 py-4 border-t border-card-border">
        <div className="hidden md:block px-3 mb-3">
          <p className="text-xs font-semibold text-on-surface truncate">{profile?.name}</p>
          <p className="text-xs text-on-surface-variant">
            {profile?.role === 'admin' ? 'مدير' : profile?.role === 'owner' ? 'مالك' : 'كاشير'}
          </p>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT w-full
            text-on-surface-variant hover:text-busy hover:bg-busy/10 transition-colors duration-150 min-h-[48px]"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          <span className="hidden md:block text-sm">تسجيل الخروج</span>
        </button>
      </div>
    </aside>
  )
}
