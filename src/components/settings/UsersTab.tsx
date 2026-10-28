import { useState, useEffect, useCallback } from 'react'
import {
  Shield,
  ShieldAlert,
  User,
  Power,
  RotateCcw,
  Check,
  Plus,
  KeyRound,
  Trash2,
  Lock,
  Mail,
  Clock,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { translateDbError } from '@/lib/errors'
import type { Invitation, UserRole } from '@/types/database'

const ALL_ROLES: { value: UserRole; label: string; desc: string }[] = [
  { value: 'worker', label: 'كاشير', desc: 'بدء الجلسات، بيع المنتجات، ملخص اليوم فقط' },
  { value: 'owner', label: 'مالك المحل', desc: 'إدارة المحل بالكامل وتعيين المديرين' },
  { value: 'admin', label: 'مدير', desc: 'إدارة الأجهزة والمنتجات والمستخدمين والإعدادات' },
]

const ROLE_LABEL: Record<UserRole, string> = {
  owner: 'مالك المحل',
  admin: 'مدير',
  worker: 'كاشير',
}

interface MemberRow {
  id: string
  user_id: string
  role: UserRole
  is_active: boolean
  created_at: string
  profile: {
    id: string
    name: string
    username: string | null
    email: string | null
    is_active: boolean
    created_at: string
  } | null
}

export function UsersTab() {
  const {
    profile: currentProfile,
    activeTenant,
    isSuperAdmin,
    isAdmin,
    isTenantOwner,
    canManageUsers,
  } = useAuth()
  const tenantId = activeTenant?.id ?? null

  const [members, setMembers] = useState<MemberRow[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [pageError, setPageError] = useState('')

  // Add User Modal State
  const [showAddModal, setShowAddModal] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('worker')
  const [addError, setAddError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Change Password Modal State
  const [passwordUser, setPasswordUser] = useState<MemberRow | null>(null)
  const [changePasswordVal, setChangePasswordVal] = useState('')
  const [changePasswordError, setChangePasswordError] = useState('')
  const [isChangingPass, setIsChangingPass] = useState(false)

  // Platform admins can assign any role; a tenant admin can create admins and
  // cashiers; a tenant owner can only create cashiers. The SQL RPCs enforce
  // the same rules, so this is only the UI affordance.
  const assignableRoles: UserRole[] = isSuperAdmin
    ? ['owner', 'admin', 'worker']
    : isAdmin
      ? ['admin', 'worker']
      : isTenantOwner
        ? ['worker']
        : []

  const canManageTarget = (member: MemberRow) => {
    if (isSuperAdmin) return true
    if (!canManageUsers) return false
    if (member.role === 'owner') return false
    if (isAdmin) return member.role === 'admin' || member.role === 'worker'
    if (isTenantOwner) return member.role === 'worker'
    return false
  }

  const fetchUsers = useCallback(async () => {
    if (!tenantId) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setPageError('')

    const [membersRes, invitesRes] = await Promise.all([
      supabase
        .from('memberships')
        .select(
          'id, user_id, role, is_active, created_at, profile:profiles(id, name, username, email, is_active, created_at)'
        )
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true }),
      supabase
        .from('invitations')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }),
    ])

    if (membersRes.error) {
      setPageError(translateDbError(membersRes.error, 'تعذر تحميل المستخدمين'))
      setMembers([])
    } else {
      setMembers((membersRes.data ?? []) as unknown as MemberRow[])
    }

    if (!invitesRes.error) {
      setInvitations((invitesRes.data ?? []) as Invitation[])
    }

    setIsLoading(false)
  }, [tenantId])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleRoleChange = async (member: MemberRow, targetRole: UserRole) => {
    if (member.role === targetRole) return
    setUpdatingId(member.id)
    setPageError('')
    const { error } = await supabase.rpc('admin_set_membership_role', {
      p_membership_id: member.id,
      p_role: targetRole,
    })
    if (error) setPageError(translateDbError(error, 'تعذر تعديل الدور'))
    else await fetchUsers()
    setUpdatingId(null)
  }

  const handleToggleActive = async (member: MemberRow) => {
    const nextActive = !member.is_active
    setUpdatingId(member.id)
    setPageError('')

    // التحديث التفاؤلي الفوري لحالة العضوية
    setMembers(prev =>
      prev.map(m => (m.id === member.id ? { ...m, is_active: nextActive } : m))
    )

    const { error } = await supabase.rpc('admin_set_membership_active', {
      p_membership_id: member.id,
      p_is_active: nextActive,
    })

    if (error) {
      // استرجاع الحالة الأصلية عند حدوث خطأ
      setMembers(prev =>
        prev.map(m => (m.id === member.id ? { ...m, is_active: member.is_active } : m))
      )
      setPageError(translateDbError(error, 'تعذر تحديث حالة الحساب'))
    } else {
      await fetchUsers()
    }
    setUpdatingId(null)
  }

  const handleRemove = async (member: MemberRow) => {
    if (
      !confirm(
        `هل أنت متأكد من إزالة «${member.profile?.name ?? 'المستخدم'}» من هذا المحل؟\nلن يتم حذف حسابه أو فواتيره أو جلساته السابقة.`
      )
    ) {
      return
    }

    setUpdatingId(member.id)
    setPageError('')
    const { error } = await supabase.rpc('admin_remove_membership', {
      p_membership_id: member.id,
    })
    if (error) setPageError(translateDbError(error, 'تعذر إزالة المستخدم'))
    else await fetchUsers()
    setUpdatingId(null)
  }

  const resetAddForm = () => {
    setNewEmail('')
    setNewName('')
    setNewUsername('')
    setNewPassword('')
    setNewRole('worker')
    setAddError('')
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddError('')

    if (!tenantId) {
      setAddError('لا يوجد محل نشط')
      return
    }

    const email = newEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      setAddError('يرجى إدخال بريد إلكتروني صحيح')
      return
    }
    if (!assignableRoles.includes(newRole)) {
      setAddError('لا تملك صلاحية تعيين هذا الدور')
      return
    }

    setIsSubmitting(true)
    // One RPC handles both cases: an existing auth account is reused (never
    // duplicated) and a new one is created with this password. The invitation
    // row is recorded as accepted immediately.
    const { error } = await supabase.rpc('admin_create_tenant_user', {
      p_tenant_id: tenantId,
      p_email: email,
      p_password: newPassword.trim(),
      p_name: newName.trim(),
      p_username: newUsername.trim(),
      p_role: newRole,
    })
    setIsSubmitting(false)

    if (error) {
      setAddError(translateDbError(error, 'تعذر إضافة المستخدم'))
      return
    }

    setShowAddModal(false)
    resetAddForm()
    await fetchUsers()
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passwordUser) return
    setChangePasswordError('')

    const cleanPass = changePasswordVal.trim()
    if (cleanPass.length < 6) {
      setChangePasswordError('كلمة المرور يجب أن تكون 6 أحرف على الأقل')
      return
    }

    setIsChangingPass(true)
    const { error } = await supabase.rpc('admin_set_user_password', {
      p_user_id: passwordUser.user_id,
      p_new_password: cleanPass,
    })
    setIsChangingPass(false)

    if (error) {
      setChangePasswordError(translateDbError(error, 'تعذر تغيير كلمة المرور'))
      return
    }

    alert(`تم تغيير كلمة المرور بنجاح للمستخدم: ${passwordUser.profile?.name ?? ''}`)
    setPasswordUser(null)
    setChangePasswordVal('')
  }

  const pendingInvitations = invitations.filter(i => i.status === 'pending')

  return (
    <div className="space-y-4">
      {/* Header & Add Button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-on-surface">إدارة المستخدمين والصلاحيات</h2>
          <p className="text-sm text-on-surface-variant">
            {isSuperAdmin
              ? 'صلاحيات كاملة: إضافة مالكين ومديرين وكاشيرين لأي محل'
              : isAdmin
                ? 'يمكنك إضافة مديرين وكاشيرين وتعديل أدوارهم وإيقاف عضويتهم'
                : 'يمكنك إضافة كاشيرين وتعديل حساباتهم فقط'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={fetchUsers} disabled={isLoading}>
            تحديث
          </Button>
          {assignableRoles.length > 0 && (
            <Button
              variant="primary"
              onClick={() => {
                setNewRole(assignableRoles.includes('worker') ? 'worker' : assignableRoles[0])
                setShowAddModal(true)
              }}
              className="flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مستخدم</span>
            </Button>
          )}
        </div>
      </div>

      {pageError && (
        <div className="p-3 bg-busy/10 border border-busy/30 rounded-lg text-busy text-xs">
          {pageError}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-on-surface-variant">جاري تحميل المستخدمين...</div>
      ) : members.length === 0 ? (
        <div className="text-center py-12 text-on-surface-variant">لا يوجد مستخدمون في هذا المحل</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {members.map(member => {
            const user = member.profile
            const isSelf = member.user_id === currentProfile?.id
            const manageable = canManageTarget(member) && !isSelf
            const isOwnerRow = member.role === 'owner'
            const invitation = invitations.find(
              inv => inv.email?.toLowerCase() === user?.email?.toLowerCase()
            )

            return (
              <Card
                key={member.id}
                className={`flex flex-col gap-4 transition-all duration-200 ${
                  !member.is_active ? 'border-busy/50 bg-busy/[0.03]' : 'border-card-border'
                } ${isOwnerRow ? 'border-secondary/30 bg-surface-container-low/50' : ''}`}
              >
                <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-bold flex-shrink-0 transition-colors ${
                        !member.is_active
                          ? 'bg-busy/15 text-busy'
                          : 'bg-surface-container-high text-primary'
                      }`}
                    >
                      {member.role === 'owner' ? (
                        <Shield className={`w-5 h-5 ${!member.is_active ? 'text-busy' : 'text-secondary'}`} />
                      ) : member.role === 'admin' ? (
                        <ShieldAlert className={`w-5 h-5 ${!member.is_active ? 'text-busy' : 'text-tertiary'}`} />
                      ) : (
                        <User className={`w-5 h-5 ${!member.is_active ? 'text-busy' : 'text-primary'}`} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-on-surface truncate">
                          {user?.name ?? 'مستخدم'}
                        </span>
                        {isSelf && (
                          <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full font-medium">
                            أنت
                          </span>
                        )}
                        {isOwnerRow && (
                          <span className="text-xs bg-secondary/15 text-secondary px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold border border-secondary/30">
                            <Shield className="w-3 h-3" />
                            مالك المحل
                          </span>
                        )}
                        {!member.is_active && (
                          <span className="text-[11px] bg-busy/20 text-busy border border-busy/40 px-2 py-0.5 rounded-full font-bold">
                            موقوف حالياً
                          </span>
                        )}
                        {user && !user.is_active && (
                          <span className="text-xs bg-busy/15 text-busy px-2 py-0.5 rounded-full font-semibold">
                            الحساب موقوف عالمياً
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span
                          className="text-xs bg-surface-container-high px-2 py-0.5 rounded text-on-surface-variant font-mono truncate max-w-[180px]"
                          dir="ltr"
                        >
                          {user?.email || `@${user?.username || 'بدون يوزر'}`}
                        </span>
                        {invitation && (
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full ${
                              invitation.status === 'accepted'
                                ? 'bg-available/10 text-available'
                                : 'bg-tertiary/10 text-tertiary'
                            }`}
                          >
                            {invitation.status === 'accepted'
                              ? 'دعوة مقبولة'
                              : invitation.status === 'pending'
                                ? 'دعوة معلقة'
                                : invitation.status === 'revoked'
                                  ? 'دعوة ملغاة'
                                  : 'دعوة منتهية'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                    <span
                      className={`text-xs px-3 py-1 rounded-full font-bold border transition-colors ${
                        member.is_active
                          ? 'bg-available/10 text-available border-available/30'
                          : 'bg-busy/15 text-busy border-busy/40 shadow-sm'
                      }`}
                    >
                      {member.is_active ? 'الحساب مفعّل' : 'الحساب موقوف'}
                    </span>

                    {manageable && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setPasswordUser(member)
                            setChangePasswordVal('')
                            setChangePasswordError('')
                          }}
                          title="تغيير كلمة المرور"
                          className="p-1.5 rounded text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>

                        {member.is_active ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggleActive(member)}
                            disabled={updatingId === member.id}
                            title="إيقاف حساب المستخدم"
                            className="h-8 px-2.5 text-xs text-busy border-busy/30 hover:bg-busy/10 hover:border-busy/50 transition-colors"
                          >
                            <Power className="w-3.5 h-3.5" />
                            <span>إيقاف الحساب</span>
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleToggleActive(member)}
                            disabled={updatingId === member.id}
                            title="إعادة تفعيل وتشغيل الحساب"
                            className="h-8 px-3 text-xs bg-available hover:bg-available/90 text-white font-bold shadow-sm transition-all"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>إعادة التفعيل</span>
                          </Button>
                        )}

                        <button
                          onClick={() => handleRemove(member)}
                          disabled={updatingId === member.id}
                          title="إزالة من المحل"
                          className="p-1.5 rounded text-on-surface-variant hover:text-busy hover:bg-busy/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Role Section */}
                <div className="border-t border-card-border pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-on-surface-variant">
                      الدور والصلاحيات:
                    </label>
                    {!manageable && (
                      <span className="text-[11px] text-on-surface-variant/70 flex items-center gap-1 font-medium">
                        <Lock className="w-3 h-3 text-on-surface-variant/50" />
                        {isSelf
                          ? 'لا يمكنك تعديل دورك بنفسك'
                          : isOwnerRow
                            ? 'حساب مالك المحل محمي'
                            : 'لا تملك صلاحية تعديل هذا الحساب'}
                      </span>
                    )}
                  </div>

                  {manageable && !isOwnerRow ? (
                    <div className="grid grid-cols-3 gap-1.5">
                      {ALL_ROLES.filter(r => assignableRoles.includes(r.value)).map(r => (
                        <button
                          key={r.value}
                          disabled={updatingId === member.id || member.role === r.value}
                          onClick={() => handleRoleChange(member, r.value)}
                          className={`py-2 px-2 text-xs rounded-DEFAULT border font-medium transition-all text-center flex items-center justify-center gap-1 ${
                            member.role === r.value
                              ? 'bg-primary/15 border-primary text-primary font-bold shadow-sm'
                              : 'border-outline-variant/60 text-on-surface-variant hover:border-primary/40'
                          }`}
                        >
                          {member.role === r.value && <Check className="w-3 h-3 flex-shrink-0" />}
                          {r.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-2 rounded-lg bg-surface-container/60 border border-card-border">
                      <span className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                        {ROLE_LABEL[member.role]}
                      </span>
                      <span className="text-[11px] text-on-surface-variant/60">
                        {member.created_at
                          ? `منذ ${new Date(member.created_at).toLocaleDateString('ar-EG')}`
                          : ''}
                      </span>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Pending invitations (invitation status is also shown on each member) */}
      {pendingInvitations.length > 0 && (
        <div className="rounded-lg border border-card-border bg-card p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-on-surface mb-3">
            <Mail className="w-4 h-4 text-tertiary" /> دعوات معلقة
          </h3>
          <div className="space-y-2">
            {pendingInvitations.map(inv => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-2 rounded-DEFAULT bg-surface-container px-3 py-2 text-xs"
              >
                <span className="font-mono text-on-surface" dir="ltr">
                  {inv.email}
                </span>
                <span className="flex items-center gap-2 text-on-surface-variant">
                  <span>{ROLE_LABEL[inv.role]}</span>
                  <span className="flex items-center gap-1 text-tertiary">
                    <Clock className="w-3 h-3" /> معلقة
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal: Add New User */}
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false)
          resetAddForm()
        }}
        title="إضافة مستخدم للمحل"
        size="md"
      >
        <form onSubmit={handleAddUser} className="space-y-4">
          {addError && (
            <div className="p-3 bg-busy/10 border border-busy/30 rounded-lg text-busy text-xs">
              {addError}
            </div>
          )}

          <Input
            label="البريد الإلكتروني"
            type="email"
            placeholder="user@example.com"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            dir="ltr"
            required
            autoFocus
          />

          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            إذا كان البريد مسجلاً بالفعل في المنصة، سيتم ربط نفس الحساب بالمحل دون إنشاء
            حساب مكرر. الدعوة تُسجَّل كمقبولة فوراً لأنك تعيّن كلمة المرور.
          </p>

          <Input
            label="اسم المستخدم"
            placeholder="أحمد محمد"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="اسم الدخول (اختياري)"
              placeholder="ahmed"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              dir="ltr"
              helperText="يُولَّد تلقائياً إن تُرك فارغاً"
            />
            <Input
              label="كلمة المرور"
              type="password"
              placeholder="6 أحرف على الأقل"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              dir="ltr"
              helperText="مطلوبة فقط للحساب الجديد"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-on-surface-variant">الصلاحية (الدور)</label>
            <div className={`grid gap-2 ${assignableRoles.length === 1 ? 'grid-cols-1' : 'grid-cols-3'}`}>
              {assignableRoles.map(role => (
                <button
                  type="button"
                  key={role}
                  onClick={() => setNewRole(role)}
                  className={`p-2.5 rounded-lg border text-xs font-semibold text-center transition-all ${
                    newRole === role
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-outline-variant/60 text-on-surface-variant hover:border-primary/40'
                  }`}
                >
                  {ROLE_LABEL[role]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowAddModal(false)
                resetAddForm()
              }}
            >
              إلغاء
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? 'جاري الحفظ...' : 'حفظ المستخدم'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Change Password */}
      <Modal
        isOpen={Boolean(passwordUser)}
        onClose={() => setPasswordUser(null)}
        title={`تغيير كلمة المرور لـ "${passwordUser?.profile?.name ?? ''}"`}
        size="sm"
      >
        <form onSubmit={handleChangePassword} className="space-y-4">
          {changePasswordError && (
            <div className="p-3 bg-busy/10 border border-busy/30 rounded-lg text-busy text-xs">
              {changePasswordError}
            </div>
          )}

          <p className="text-xs text-on-surface-variant">
            البريد:{' '}
            <strong className="font-mono text-primary" dir="ltr">
              {passwordUser?.profile?.email || passwordUser?.profile?.username || ''}
            </strong>
          </p>

          <Input
            label="كلمة المرور الجديدة"
            type="password"
            placeholder="أدخل كلمة المرور الجديدة"
            value={changePasswordVal}
            onChange={e => setChangePasswordVal(e.target.value)}
            dir="ltr"
            required
            autoFocus
          />

          <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
            <Button type="button" variant="ghost" onClick={() => setPasswordUser(null)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary" disabled={isChangingPass}>
              {isChangingPass ? 'جاري التحديث...' : 'تحديث كلمة المرور'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
