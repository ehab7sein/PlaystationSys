import { useState, useEffect, useCallback } from 'react'
import { Shield, ShieldAlert, User, Power, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { Profile, UserRole } from '@/types/database'

const ROLES: { value: UserRole; label: string; desc: string }[] = [
  { value: 'worker', label: 'كاشير (Worker)', desc: 'بدء الجلسات، بيع المنتجات، ملخص اليوم فقط' },
  { value: 'owner', label: 'مالك (Owner)', desc: 'إدارة الأجهزة، الأسعار، المنتجات، الرواتب، والإيرادات' },
  { value: 'admin', label: 'مدير (Admin)', desc: 'كل الصلاحيات بما فيها إدارة المستخدمين والإعدادات' },
]

export function UsersTab() {
  const { profile: currentProfile, isAdmin } = useAuth()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    setIsLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    if (data) {
      setProfiles(data)
    }
    if (error) {
      console.error('Error fetching users:', error)
    }
    setIsLoading(false)
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    setUpdatingId(userId)
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId)

    if (error) {
      alert(`خطأ في تعديل الدور: ${error.message}`)
    } else {
      setProfiles(prev =>
        prev.map(p => (p.id === userId ? { ...p, role: newRole } : p))
      )
    }
    setUpdatingId(null)
  }

  const handleToggleActive = async (user: Profile) => {
    if (user.id === currentProfile?.id) {
      alert('لا يمكنك إيقاف حسابك الشخصي!')
      return
    }

    setUpdatingId(user.id)
    const newActive = !user.is_active
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: newActive })
      .eq('id', user.id)

    if (error) {
      alert(`خطأ في تحديث الحالة: ${error.message}`)
    } else {
      setProfiles(prev =>
        prev.map(p => (p.id === user.id ? { ...p, is_active: newActive } : p))
      )
    }
    setUpdatingId(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-on-surface">إدارة المستخدمين والصلاحيات</h2>
          <p className="text-sm text-on-surface-variant">
            عرض الموظفين وتعديل أدوارهم بين كاشير، مالك، أو مدير
          </p>
        </div>
        <Button variant="ghost" onClick={fetchUsers} disabled={isLoading}>
          تحديث القائمة
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-on-surface-variant">جاري تحميل المستخدمين...</div>
      ) : profiles.length === 0 ? (
        <div className="text-center py-12 text-on-surface-variant">لا يوجد مستخدمين مسجلين</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {profiles.map(user => {
            const isSelf = user.id === currentProfile?.id
            return (
              <Card
                key={user.id}
                className={`flex flex-col gap-4 ${
                  !user.is_active ? 'opacity-60 border-busy/30' : 'border-card-border'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center font-bold text-primary">
                      {user.role === 'admin' ? (
                        <ShieldAlert className="w-5 h-5 text-tertiary" />
                      ) : user.role === 'owner' ? (
                        <Shield className="w-5 h-5 text-secondary" />
                      ) : (
                        <User className="w-5 h-5 text-primary" />
                      )}
                    </div>
                    <div>
                      <p className="font-bold text-on-surface flex items-center gap-2">
                        {user.name}
                        {isSelf && (
                          <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                            أنت
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        مسجل منذ: {new Date(user.created_at).toLocaleDateString('ar-EG')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                        user.is_active
                          ? 'bg-available/10 text-available'
                          : 'bg-busy/10 text-busy'
                      }`}
                    >
                      {user.is_active ? 'مفعّل' : 'موقوف'}
                    </span>
                    {!isSelf && (
                      <button
                        onClick={() => handleToggleActive(user)}
                        title={user.is_active ? 'إيقاف الحساب' : 'تفعيل الحساب'}
                        className={`p-1.5 rounded transition-colors ${
                          user.is_active
                            ? 'text-on-surface-variant hover:text-busy hover:bg-busy/10'
                            : 'text-on-surface-variant hover:text-available hover:bg-available/10'
                        }`}
                      >
                        <Power className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Role Switcher */}
                <div className="border-t border-card-border pt-3">
                  <label className="text-xs font-semibold text-on-surface-variant block mb-2">
                    الدور والصلاحيات:
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {ROLES.map(r => (
                      <button
                        key={r.value}
                        disabled={updatingId === user.id}
                        onClick={() => handleRoleChange(user.id, r.value)}
                        className={`py-2 px-2 text-xs rounded-DEFAULT border font-medium transition-all text-center flex items-center justify-center gap-1 ${
                          user.role === r.value
                            ? 'bg-primary/15 border-primary text-primary font-bold shadow-sm'
                            : 'border-outline-variant/60 text-on-surface-variant hover:border-primary/40'
                        }`}
                      >
                        {user.role === r.value && <Check className="w-3 h-3 flex-shrink-0" />}
                        {r.label.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
