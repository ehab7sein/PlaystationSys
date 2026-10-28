import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Building2,
  Users,
  LayoutDashboard,
  Store,
  Monitor,
  Activity,
  TrendingUp,
  Search,
  Plus,
  Pencil,
  Power,
  RotateCcw,
  Eye,
  Shield,
  ShieldAlert,
  User,
  Trash2,
  KeyRound,
  ChevronRight,
  ChevronLeft,
  LogOut,
  RefreshCw,
  Mail,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Globe2,
  UserPlus,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Card, StatCard } from '@/components/ui/Card'
import { ChangePasswordModal } from '@/components/auth/ChangePasswordModal'
import { formatEGP } from '@/lib/utils'
import { translateDbError } from '@/lib/errors'
import logoImg from '@/assets/logo.png'
import type { Invitation, Profile, Tenant, UserRole } from '@/types/database'

type AdminTab = 'overview' | 'tenants' | 'users'
type TenantStatusFilter = 'all' | 'active' | 'suspended'
type TenantSort = 'newest' | 'oldest' | 'name'

interface AdminMemberRow {
  id: string
  tenant_id: string
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

interface AdminTenant extends Tenant {
  memberships?: AdminMemberRow[]
}

interface AdminUser extends Profile {
  memberships?: Array<{
    id: string
    tenant_id: string
    role: UserRole
    is_active: boolean
    tenant: { id: string; name: string; is_active: boolean } | null
  }>
}

const ROLE_LABEL: Record<UserRole, string> = {
  owner: 'مالك المحل',
  admin: 'مدير',
  worker: 'كاشير',
}

const PAGE_SIZE = 8

export function SuperAdminPage() {
  const { profile, hasTenant, logout } = useAuth()
  const navigate = useNavigate()

  const [tab, setTab] = useState<AdminTab>('overview')
  const [tenants, setTenants] = useState<AdminTenant[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [devices, setDevices] = useState<Array<{ id: string; tenant_id: string; is_active: boolean }>>([])
  const [activeSessions, setActiveSessions] = useState<Array<{ id: string; tenant_id: string }>>([])
  const [todayRevenue, setTodayRevenue] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  // Tenant list controls
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<TenantStatusFilter>('all')
  const [sortBy, setSortBy] = useState<TenantSort>('newest')
  const [page, setPage] = useState(1)

  // Global users controls
  const [userSearch, setUserSearch] = useState('')

  // Create tenant modal
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({
    name: '',
    slug: '',
    owner_email: '',
    owner_name: '',
    owner_username: '',
    owner_password: '',
  })
  const [createError, setCreateError] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  // Edit tenant modal
  const [editingTenant, setEditingTenant] = useState<AdminTenant | null>(null)
  const [editForm, setEditForm] = useState({ name: '', slug: '' })
  const [editError, setEditError] = useState('')
  const [isEditing, setIsEditing] = useState(false)

  // Status confirmation
  const [statusTenant, setStatusTenant] = useState<AdminTenant | null>(null)
  const [statusError, setStatusError] = useState('')
  const [isChangingStatus, setIsChangingStatus] = useState(false)

  // Tenant details
  const [detailsTenantId, setDetailsTenantId] = useState<string | null>(null)
  const [detailsTab, setDetailsTab] = useState<'members' | 'invitations'>('members')
  const [memberForm, setMemberForm] = useState({
    email: '',
    name: '',
    username: '',
    password: '',
    role: 'worker' as UserRole,
  })
  const [memberError, setMemberError] = useState('')
  const [isAddingMember, setIsAddingMember] = useState(false)
  const [memberActionId, setMemberActionId] = useState<string | null>(null)

  // Password reset (tenant details / global user)
  const [passwordMember, setPasswordMember] = useState<AdminMemberRow | null>(null)
  const [passwordValue, setPasswordValue] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [isResettingPassword, setIsResettingPassword] = useState(false)

  // Self-service password change
  const [showChangePassword, setShowChangePassword] = useState(false)

  // Add existing global user to a tenant
  const [addExistingUser, setAddExistingUser] = useState<AdminUser | null>(null)
  const [addExistingForm, setAddExistingForm] = useState({ tenant_id: '', role: 'worker' as UserRole })
  const [addExistingError, setAddExistingError] = useState('')
  const [isAddingExisting, setIsAddingExisting] = useState(false)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const midnight = new Date()
      midnight.setHours(0, 0, 0, 0)

      const [tenantsRes, usersRes, invitesRes, devicesRes, sessionsRes, paymentsRes] =
        await Promise.all([
          supabase
            .from('tenants')
            .select(
              '*, memberships(id, tenant_id, user_id, role, is_active, created_at, profile:profiles(id, name, username, email, is_active, created_at))'
            )
            .order('created_at', { ascending: false }),
          supabase
            .from('profiles')
            .select(
              '*, memberships(id, tenant_id, role, is_active, tenant:tenants(id, name, is_active))'
            )
            .order('created_at', { ascending: false }),
          supabase.from('invitations').select('*').order('created_at', { ascending: false }),
          supabase.from('devices').select('id, tenant_id, is_active'),
          supabase.from('sessions').select('id, tenant_id').eq('status', 'active'),
          supabase
            .from('payments')
            .select('amount, created_at')
            .gte('created_at', midnight.toISOString()),
        ])

      // Never show a partially loaded dashboard: surface every query error so
      // a missing RLS policy/grant cannot silently look like "zero data".
      const firstError =
        tenantsRes.error ||
        usersRes.error ||
        invitesRes.error ||
        devicesRes.error ||
        sessionsRes.error ||
        paymentsRes.error
      if (firstError) throw firstError

      setTenants((tenantsRes.data ?? []) as unknown as AdminTenant[])
      setUsers((usersRes.data ?? []) as unknown as AdminUser[])
      setInvitations((invitesRes.data ?? []) as Invitation[])
      setDevices((devicesRes.data ?? []) as Array<{ id: string; tenant_id: string; is_active: boolean }>)
      setActiveSessions((sessionsRes.data ?? []) as Array<{ id: string; tenant_id: string }>)
      setTodayRevenue(
        (paymentsRes.data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
      )
    } catch (err) {
      const detail =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message ?? '')
          : ''
      console.error('[SuperAdminPage] fetchData failed:', err)
      setError(
        translateDbError(
          err,
          detail
            ? `تعذر تحميل بيانات المنصة: ${detail}`
            : 'تعذر تحميل بيانات المنصة'
        )
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const deviceCountByTenant = useMemo(() => {
    const map = new Map<string, number>()
    for (const device of devices) {
      if (!device.is_active) continue
      map.set(device.tenant_id, (map.get(device.tenant_id) ?? 0) + 1)
    }
    return map
  }, [devices])

  const sessionCountByTenant = useMemo(() => {
    const map = new Map<string, number>()
    for (const session of activeSessions) {
      map.set(session.tenant_id, (map.get(session.tenant_id) ?? 0) + 1)
    }
    return map
  }, [activeSessions])

  const ownerOf = (tenant: AdminTenant) => {
    const memberships = tenant.memberships ?? []
    return (
      memberships.find(m => m.role === 'owner' && m.is_active)?.profile ??
      memberships.find(m => m.role === 'owner')?.profile ??
      null
    )
  }

  const activeMemberCount = (tenant: AdminTenant) =>
    (tenant.memberships ?? []).filter(m => m.is_active).length

  const filteredTenants = useMemo(() => {
    const query = search.trim().toLowerCase()
    let rows = tenants.filter(tenant => {
      if (statusFilter === 'active' && !tenant.is_active) return false
      if (statusFilter === 'suspended' && tenant.is_active) return false
      if (!query) return true
      const owner = ownerOf(tenant)
      return (
        tenant.name.toLowerCase().includes(query) ||
        tenant.slug.toLowerCase().includes(query) ||
        (owner?.name ?? '').toLowerCase().includes(query) ||
        (owner?.email ?? '').toLowerCase().includes(query) ||
        (owner?.username ?? '').toLowerCase().includes(query)
      )
    })

    rows = [...rows].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'ar')
      const aTime = new Date(a.created_at).getTime()
      const bTime = new Date(b.created_at).getTime()
      return sortBy === 'oldest' ? aTime - bTime : bTime - aTime
    })

    return rows
  }, [tenants, search, statusFilter, sortBy])

  const pageCount = Math.max(1, Math.ceil(filteredTenants.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pagedTenants = filteredTenants.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [search, statusFilter, sortBy])

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase()
    if (!query) return users
    return users.filter(user => {
      return (
        user.name.toLowerCase().includes(query) ||
        (user.email ?? '').toLowerCase().includes(query) ||
        (user.username ?? '').toLowerCase().includes(query)
      )
    })
  }, [users, userSearch])

  const detailsTenant = tenants.find(t => t.id === detailsTenantId) ?? null
  const detailsMembers = detailsTenant?.memberships ?? []
  const detailsInvitations = invitations.filter(i => i.tenant_id === detailsTenantId)

  const activeTenants = tenants.filter(t => t.is_active).length
  const suspendedTenants = tenants.length - activeTenants
  const totalMemberships = tenants.reduce((sum, t) => sum + (t.memberships?.length ?? 0), 0)
  const pendingInvitations = invitations.filter(i => i.status === 'pending').length

  const resetCreateForm = () => {
    setCreateForm({
      name: '',
      slug: '',
      owner_email: '',
      owner_name: '',
      owner_username: '',
      owner_password: '',
    })
    setCreateError('')
  }

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    if (!createForm.name.trim()) {
      setCreateError('اسم المحل مطلوب')
      return
    }
    if (!createForm.owner_email.trim().includes('@')) {
      setCreateError('بريد مالك المحل غير صحيح')
      return
    }
    if (
      createForm.owner_password.trim() &&
      createForm.owner_password.trim().length < 6
    ) {
      setCreateError('كلمة المرور يجب أن تكون 6 أحرف على الأقل (للحساب الجديد)')
      return
    }

    setIsCreating(true)
    const { error: rpcError } = await supabase.rpc('create_tenant', {
      p_name: createForm.name.trim(),
      p_slug: createForm.slug.trim(),
      p_owner_email: createForm.owner_email.trim().toLowerCase(),
      p_owner_password: createForm.owner_password,
      p_owner_name: createForm.owner_name.trim(),
      p_owner_username: createForm.owner_username.trim() || null,
    })
    setIsCreating(false)

    if (rpcError) {
      setCreateError(translateDbError(rpcError, 'تعذر إنشاء المحل'))
      return
    }

    setShowCreate(false)
    resetCreateForm()
    await fetchData()
    setTab('tenants')
  }

  const openEdit = (tenant: AdminTenant) => {
    setEditingTenant(tenant)
    setEditForm({ name: tenant.name, slug: tenant.slug })
    setEditError('')
  }

  const handleEditTenant = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingTenant) return
    setEditError('')
    if (!editForm.name.trim()) {
      setEditError('اسم المحل مطلوب')
      return
    }

    setIsEditing(true)
    const { error: rpcError } = await supabase.rpc('update_tenant', {
      p_tenant_id: editingTenant.id,
      p_name: editForm.name.trim(),
      p_slug: editForm.slug.trim(),
    })
    setIsEditing(false)

    if (rpcError) {
      setEditError(translateDbError(rpcError, 'تعذر تحديث المحل'))
      return
    }

    setEditingTenant(null)
    await fetchData()
  }

  const handleChangeStatus = async () => {
    if (!statusTenant) return
    setStatusError('')
    setIsChangingStatus(true)
    const nextActive = !statusTenant.is_active
    const { error: rpcError } = await supabase.rpc('set_tenant_status', {
      p_tenant_id: statusTenant.id,
      p_is_active: nextActive,
    })
    setIsChangingStatus(false)

    if (rpcError) {
      setStatusError(translateDbError(rpcError, 'تعذر تغيير حالة المحل'))
      return
    }

    setStatusTenant(null)
    await fetchData()
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!detailsTenant) return
    setMemberError('')

    if (!memberForm.email.trim().includes('@')) {
      setMemberError('بريد إلكتروني غير صحيح')
      return
    }
    if (memberForm.password.trim() && memberForm.password.trim().length < 6) {
      setMemberError('كلمة المرور يجب أن تكون 6 أحرف على الأقل')
      return
    }

    setIsAddingMember(true)
    const { error: rpcError } = await supabase.rpc('admin_create_tenant_user', {
      p_tenant_id: detailsTenant.id,
      p_email: memberForm.email.trim().toLowerCase(),
      p_password: memberForm.password.trim(),
      p_name: memberForm.name.trim(),
      p_username: memberForm.username.trim(),
      p_role: memberForm.role,
    })
    setIsAddingMember(false)

    if (rpcError) {
      setMemberError(translateDbError(rpcError, 'تعذر إضافة المستخدم'))
      return
    }

    setMemberForm({ email: '', name: '', username: '', password: '', role: 'worker' })
    await fetchData()
  }

  const handleMemberRole = async (member: AdminMemberRow, role: UserRole) => {
    if (member.role === role) return
    setMemberActionId(member.id)
    const { error: rpcError } = await supabase.rpc('admin_set_membership_role', {
      p_membership_id: member.id,
      p_role: role,
    })
    if (rpcError) setMemberError(translateDbError(rpcError, 'تعذر تعديل الدور'))
    else await fetchData()
    setMemberActionId(null)
  }

  const handleMemberActive = async (member: AdminMemberRow) => {
    setMemberActionId(member.id)
    const { error: rpcError } = await supabase.rpc('admin_set_membership_active', {
      p_membership_id: member.id,
      p_is_active: !member.is_active,
    })
    if (rpcError) setMemberError(translateDbError(rpcError, 'تعذر تحديث العضوية'))
    else await fetchData()
    setMemberActionId(null)
  }

  const handleRemoveMember = async (member: AdminMemberRow) => {
    if (
      !confirm(
        `هل أنت متأكد من إزالة «${member.profile?.name ?? 'المستخدم'}» من هذا المحل؟\nلن تُحذف جلساته أو فواتيره أو حسابه العالمي.`
      )
    ) {
      return
    }
    setMemberActionId(member.id)
    const { error: rpcError } = await supabase.rpc('admin_remove_membership', {
      p_membership_id: member.id,
    })
    if (rpcError) setMemberError(translateDbError(rpcError, 'تعذر إزالة العضوية'))
    else await fetchData()
    setMemberActionId(null)
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passwordMember) return
    setPasswordError('')
    if (passwordValue.trim().length < 6) {
      setPasswordError('كلمة المرور يجب أن تكون 6 أحرف على الأقل')
      return
    }

    setIsResettingPassword(true)
    const { error: rpcError } = await supabase.rpc('admin_set_user_password', {
      p_user_id: passwordMember.user_id,
      p_new_password: passwordValue.trim(),
    })
    setIsResettingPassword(false)

    if (rpcError) {
      setPasswordError(translateDbError(rpcError, 'تعذر تغيير كلمة المرور'))
      return
    }

    alert(`تم تغيير كلمة المرور للمستخدم: ${passwordMember.profile?.name ?? ''}`)
    setPasswordMember(null)
    setPasswordValue('')
  }

  const handleToggleGlobalUser = async (user: AdminUser) => {
    const nextActive = !user.is_active
    if (!confirm(`${nextActive ? 'تفعيل' : 'إيقاف'} الحساب العالمي «${user.name}»؟`)) return
    const { error: rpcError } = await supabase.rpc('admin_set_profile_active', {
      p_user_id: user.id,
      p_is_active: nextActive,
    })
    if (rpcError) setError(translateDbError(rpcError, 'تعذر تحديث الحساب'))
    else await fetchData()
  }

  const handleAddExistingToTenant = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addExistingUser) return
    setAddExistingError('')
    if (!addExistingForm.tenant_id) {
      setAddExistingError('اختر المحل أولاً')
      return
    }

    setIsAddingExisting(true)
    const { error: rpcError } = await supabase.rpc('admin_create_tenant_user', {
      p_tenant_id: addExistingForm.tenant_id,
      p_email: addExistingUser.email ?? '',
      p_password: '',
      p_name: addExistingUser.name,
      p_username: addExistingUser.username ?? '',
      p_role: addExistingForm.role,
    })
    setIsAddingExisting(false)

    if (rpcError) {
      setAddExistingError(translateDbError(rpcError, 'تعذر إضافة المستخدم للمحل'))
      return
    }

    setAddExistingUser(null)
    setAddExistingForm({ tenant_id: '', role: 'worker' })
    await fetchData()
  }

  const handleSignOut = async () => {
    await logout()
    navigate('/login')
  }

  const NAV = [
    { value: 'overview' as const, label: 'نظرة عامة', icon: LayoutDashboard },
    { value: 'tenants' as const, label: 'المحلات', icon: Building2 },
    { value: 'users' as const, label: 'المستخدمون', icon: Users },
  ]

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="hidden lg:flex fixed top-0 right-0 h-full w-60 flex-col bg-surface-container-low border-l border-card-border z-40">
        <div className="px-3 py-4 border-b border-card-border">
          <div className="w-full bg-white rounded-xl p-2 shadow-md flex items-center justify-center">
            <img src={logoImg} alt="KONTROL" className="w-full h-auto max-h-11 object-contain" />
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-secondary/30 bg-secondary/10 px-3 py-2">
            <Globe2 className="w-4 h-4 text-secondary" />
            <div>
              <p className="text-[11px] text-on-surface-variant leading-none">لوحة المنصة</p>
              <p className="text-xs font-bold text-secondary">Super Admin</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-4 flex flex-col gap-1">
          {NAV.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT transition-colors text-right ${
                tab === value
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{label}</span>
            </button>
          ))}
        </nav>

        <div className="px-2 py-4 border-t border-card-border space-y-1">
          {hasTenant && (
            <Link
              to="/"
              className="flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
            >
              <Store className="w-5 h-5" />
              <span className="text-sm">العودة لنظام المحل</span>
            </Link>
          )}
          <button
            onClick={() => setShowChangePassword(true)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT w-full text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors"
          >
            <KeyRound className="w-5 h-5" />
            <span className="text-sm">تغيير كلمة المرور</span>
          </button>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT w-full text-on-surface-variant hover:text-busy hover:bg-busy/10 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-sm">تسجيل الخروج</span>
          </button>
          <div className="px-3 pt-2">
            <p className="text-xs font-semibold text-on-surface truncate">{profile?.name}</p>
            <p className="text-[11px] text-on-surface-variant">مدير المنصة</p>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 lg:mr-60 min-h-screen">
        {/* Mobile header */}
        <div className="lg:hidden sticky top-0 z-30 bg-surface-container-low border-b border-card-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              <span className="font-bold text-on-surface">إدارة المنصة</span>
            </div>
            <button onClick={handleSignOut} className="text-on-surface-variant" aria-label="خروج">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
          <div className="flex gap-2 mt-3 overflow-x-auto">
            {NAV.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${
                  tab === value
                    ? 'bg-primary text-primary-dark'
                    : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div>
              <h1 className="text-2xl font-black text-on-surface">
                {tab === 'overview'
                  ? 'نظرة عامة على المنصة'
                  : tab === 'tenants'
                    ? 'إدارة المحلات'
                    : 'إدارة المستخدمين'}
              </h1>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {tab === 'overview'
                  ? 'إحصائيات مباشرة من قاعدة البيانات لكل المحلات والمستخدمين'
                  : tab === 'tenants'
                    ? 'إنشاء المحلات، تعيين المالكين، والإيقاف والتفعيل'
                    : 'كل الحسابات العالمية وعضوياتها في المحلات'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={fetchData} disabled={isLoading}>
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                تحديث
              </Button>
              <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="w-4 h-4" />
                محل جديد
              </Button>
            </div>
          </div>

          {error && (
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-2 rounded-DEFAULT border border-busy/30 bg-busy/10 px-3 py-2.5 text-xs font-semibold text-busy">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={fetchData} disabled={isLoading}>
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                إعادة المحاولة
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <div className="text-center">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-on-surface-variant text-sm">جاري تحميل بيانات المنصة...</p>
              </div>
            </div>
          ) : tab === 'overview' ? (
            <OverviewTab
              tenants={tenants}
              users={users}
              todayRevenue={todayRevenue}
              activeTenants={activeTenants}
              suspendedTenants={suspendedTenants}
              totalMemberships={totalMemberships}
              pendingInvitations={pendingInvitations}
              deviceCountByTenant={deviceCountByTenant}
              sessionCountByTenant={sessionCountByTenant}
              ownerOf={ownerOf}
              onOpenTenant={id => {
                setDetailsTenantId(id)
                setDetailsTab('members')
                setTab('tenants')
              }}
            />
          ) : tab === 'tenants' ? (
            <TenantsTab
              tenants={pagedTenants}
              filteredCount={filteredTenants.length}
              search={search}
              onSearch={setSearch}
              statusFilter={statusFilter}
              onStatusFilter={setStatusFilter}
              sortBy={sortBy}
              onSort={setSortBy}
              page={safePage}
              pageCount={pageCount}
              onPage={setPage}
              ownerOf={ownerOf}
              activeMemberCount={activeMemberCount}
              deviceCountByTenant={deviceCountByTenant}
              sessionCountByTenant={sessionCountByTenant}
              onDetails={id => {
                setDetailsTenantId(id)
                setDetailsTab('members')
              }}
              onEdit={openEdit}
              onStatus={tenant => {
                setStatusTenant(tenant)
                setStatusError('')
              }}
              onOpenCreate={() => setShowCreate(true)}
            />
          ) : (
            <UsersTab
              users={filteredUsers}
              totalUsers={users.length}
              search={userSearch}
              onSearch={setUserSearch}
              onToggleActive={handleToggleGlobalUser}
              onAddToTenant={user => {
                setAddExistingUser(user)
                setAddExistingForm({ tenant_id: '', role: 'worker' })
                setAddExistingError('')
              }}
            />
          )}
        </div>
      </main>

      {/* Create Tenant Modal */}
      <Modal
        isOpen={showCreate}
        onClose={() => {
          setShowCreate(false)
          resetCreateForm()
        }}
        title="إنشاء محل جديد"
        size="lg"
      >
        <form onSubmit={handleCreateTenant} className="space-y-4">
          {createError && (
            <div className="p-3 bg-busy/10 border border-busy/30 rounded-lg text-busy text-xs">
              {createError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="اسم المحل"
              value={createForm.name}
              onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
              placeholder="مثال: PlayStation KONTROL - فرع المعادي"
              required
              autoFocus
            />
            <Input
              label="الرابط المختصر (اختياري)"
              value={createForm.slug}
              onChange={e => setCreateForm(f => ({ ...f, slug: e.target.value }))}
              placeholder="maadi"
              dir="ltr"
              helperText="حروف إنجليزية وأرقام فقط"
            />
          </div>

          <div className="rounded-xl border border-card-border bg-surface-container-low p-3">
            <h3 className="flex items-center gap-2 text-sm font-bold text-on-surface mb-3">
              <Shield className="w-4 h-4 text-secondary" /> مالك المحل
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="بريد المالك"
                type="email"
                value={createForm.owner_email}
                onChange={e => setCreateForm(f => ({ ...f, owner_email: e.target.value }))}
                placeholder="owner@example.com"
                dir="ltr"
                required
              />
              <Input
                label="اسم المالك"
                value={createForm.owner_name}
                onChange={e => setCreateForm(f => ({ ...f, owner_name: e.target.value }))}
                placeholder="اسم صاحب المحل"
              />
              <Input
                label="اسم الدخول (اختياري)"
                value={createForm.owner_username}
                onChange={e => setCreateForm(f => ({ ...f, owner_username: e.target.value }))}
                placeholder="owner"
                dir="ltr"
                helperText="يمكنه الدخول بالبريد أو باسم الدخول"
              />
              <Input
                label="كلمة المرور"
                type="password"
                value={createForm.owner_password}
                onChange={e => setCreateForm(f => ({ ...f, owner_password: e.target.value }))}
                placeholder="6 أحرف على الأقل للحساب الجديد"
                dir="ltr"
                helperText="اتركها فارغة إذا كان البريد مسجلاً بالفعل؛ لن تُغيَّر كلمته الحالية"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowCreate(false)
                resetCreateForm()
              }}
            >
              إلغاء
            </Button>
            <Button type="submit" variant="primary" disabled={isCreating}>
              {isCreating ? 'جاري الإنشاء...' : 'إنشاء المحل'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Tenant Modal */}
      <Modal
        isOpen={Boolean(editingTenant)}
        onClose={() => setEditingTenant(null)}
        title={`تعديل «${editingTenant?.name ?? ''}»`}
        size="md"
      >
        <form onSubmit={handleEditTenant} className="space-y-4">
          {editError && (
            <div className="p-3 bg-busy/10 border border-busy/30 rounded-lg text-busy text-xs">
              {editError}
            </div>
          )}
          <Input
            label="اسم المحل"
            value={editForm.name}
            onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
            required
            autoFocus
          />
          <Input
            label="الرابط المختصر"
            value={editForm.slug}
            onChange={e => setEditForm(f => ({ ...f, slug: e.target.value }))}
            dir="ltr"
          />
          <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
            <Button type="button" variant="ghost" onClick={() => setEditingTenant(null)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary" disabled={isEditing}>
              {isEditing ? 'جاري الحفظ...' : 'حفظ التعديلات'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Status Confirmation Modal */}
      <Modal
        isOpen={Boolean(statusTenant)}
        onClose={() => setStatusTenant(null)}
        title={statusTenant?.is_active ? 'إيقاف المحل مؤقتاً' : 'إعادة تفعيل المحل'}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant leading-relaxed">
            {statusTenant?.is_active
              ? `سيتم منع جميع مستخدمي «${statusTenant?.name}» من الدخول. لن يتم حذف أي بيانات أو فواتير أو جلسات، ويمكن إعادة التفعيل في أي وقت.`
              : `سيتمكن مستخدمو «${statusTenant?.name}» من الدخول مرة أخرى بنفس البيانات والصلاحيات.`}
          </p>
          {statusError && <p className="text-xs text-busy">{statusError}</p>}
          <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
            <Button variant="ghost" onClick={() => setStatusTenant(null)}>
              إلغاء
            </Button>
            <Button
              variant={statusTenant?.is_active ? 'danger' : 'primary'}
              onClick={handleChangeStatus}
              isLoading={isChangingStatus}
            >
              {statusTenant?.is_active ? 'إيقاف المحل' : 'تفعيل المحل'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Tenant Details Modal */}
      <Modal
        isOpen={Boolean(detailsTenant)}
        onClose={() => setDetailsTenantId(null)}
        title={detailsTenant ? `تفاصيل «${detailsTenant.name}»` : ''}
        size="xl"
      >
        {detailsTenant && (
          <div className="space-y-5">
            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MiniStat label="الأعضاء" value={String(detailsMembers.length)} />
              <MiniStat label="الأجهزة" value={String(deviceCountByTenant.get(detailsTenant.id) ?? 0)} />
              <MiniStat label="جلسات جارية" value={String(sessionCountByTenant.get(detailsTenant.id) ?? 0)} />
              <MiniStat label="الحالة" value={detailsTenant.is_active ? 'نشط' : 'موقوف'} />
            </div>

            <div className="flex items-center gap-2 text-xs text-on-surface-variant">
              <span className="rounded bg-surface-container-high px-2 py-1 font-mono" dir="ltr">
                {detailsTenant.slug}
              </span>
              <span>·</span>
              <span>أُنشئ {new Date(detailsTenant.created_at).toLocaleDateString('ar-EG')}</span>
              {ownerOf(detailsTenant) && (
                <>
                  <span>·</span>
                  <span>المالك: {ownerOf(detailsTenant)?.name}</span>
                </>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-card-border pb-0">
              <button
                onClick={() => setDetailsTab('members')}
                className={`px-4 py-2 text-xs font-bold border-b-2 -mb-px ${
                  detailsTab === 'members'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-on-surface-variant'
                }`}
              >
                الأعضاء ({detailsMembers.length})
              </button>
              <button
                onClick={() => setDetailsTab('invitations')}
                className={`px-4 py-2 text-xs font-bold border-b-2 -mb-px ${
                  detailsTab === 'invitations'
                    ? 'border-tertiary text-tertiary'
                    : 'border-transparent text-on-surface-variant'
                }`}
              >
                الدعوات ({detailsInvitations.length})
              </button>
            </div>

            {detailsTab === 'members' ? (
              <>
                {/* Add member */}
                <form
                  onSubmit={handleAddMember}
                  className="rounded-xl border border-card-border bg-surface-container-low p-3 space-y-3"
                >
                  <h3 className="flex items-center gap-2 text-sm font-bold text-on-surface">
                    <UserPlus className="w-4 h-4 text-primary" /> إضافة عضو بالبريد
                  </h3>
                  {memberError && <p className="text-xs text-busy">{memberError}</p>}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <Input
                      label="البريد الإلكتروني"
                      type="email"
                      value={memberForm.email}
                      onChange={e => setMemberForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="user@example.com"
                      dir="ltr"
                      required
                    />
                    <Input
                      label="الاسم"
                      value={memberForm.name}
                      onChange={e => setMemberForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="اسم العضو"
                    />
                    <Input
                      label="اسم الدخول"
                      value={memberForm.username}
                      onChange={e => setMemberForm(f => ({ ...f, username: e.target.value }))}
                      placeholder="username"
                      dir="ltr"
                    />
                    <Input
                      label="كلمة المرور (للحساب الجديد)"
                      type="password"
                      value={memberForm.password}
                      onChange={e => setMemberForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="6 أحرف على الأقل"
                      dir="ltr"
                    />
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-semibold text-on-surface-variant">الدور</label>
                      <select
                        value={memberForm.role}
                        onChange={e =>
                          setMemberForm(f => ({ ...f, role: e.target.value as UserRole }))
                        }
                        className="min-h-[44px] rounded-DEFAULT border border-outline-variant bg-surface-container px-3 text-sm text-on-surface focus:border-primary focus:outline-none"
                      >
                        <option value="worker">كاشير</option>
                        <option value="admin">مدير</option>
                        <option value="owner">مالك المحل</option>
                      </select>
                    </div>
                    <div className="flex items-end">
                      <Button type="submit" variant="primary" fullWidth disabled={isAddingMember}>
                        {isAddingMember ? 'جاري الإضافة...' : 'إضافة للمحل'}
                      </Button>
                    </div>
                  </div>
                  <p className="text-[11px] text-on-surface-variant">
                    إن كان البريد مسجلاً في المنصة، سيُعاد استخدام نفس الحساب ولن يتكرر. اترك
                    كلمة المرور فارغة عند إضافة حساب موجود.
                  </p>
                </form>

                {/* Members list */}
                <div className="space-y-2">
                  {detailsMembers.length === 0 ? (
                    <p className="text-center text-sm text-on-surface-variant py-6">
                      لا يوجد أعضاء في هذا المحل بعد
                    </p>
                  ) : (
                    detailsMembers.map(member => (
                      <div
                        key={member.id}
                        className={`rounded-xl border p-3 ${
                          member.role === 'owner'
                            ? 'border-secondary/30 bg-secondary/5'
                            : member.is_active
                              ? 'border-card-border bg-surface-container-low'
                              : 'border-busy/30 bg-busy/5'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0">
                              {member.role === 'owner' ? (
                                <Shield className="w-4 h-4 text-secondary" />
                              ) : member.role === 'admin' ? (
                                <ShieldAlert className="w-4 h-4 text-tertiary" />
                              ) : (
                                <User className="w-4 h-4 text-primary" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-on-surface truncate">
                                {member.profile?.name ?? 'مستخدم'}
                              </p>
                              <p
                                className="text-[11px] font-mono text-on-surface-variant truncate"
                                dir="ltr"
                              >
                                {member.profile?.email || `@${member.profile?.username ?? ''}`}
                              </p>
                            </div>
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                                member.is_active
                                  ? 'bg-available/10 text-available'
                                  : 'bg-busy/10 text-busy'
                              }`}
                            >
                              {member.is_active ? 'مفعّل' : 'موقوف'}
                            </span>
                            {member.profile && !member.profile.is_active && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-busy/15 text-busy font-semibold flex-shrink-0">
                                الحساب موقوف
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => {
                                if (member.user_id === profile?.id) {
                                  setShowChangePassword(true)
                                  return
                                }
                                setPasswordMember(member)
                                setPasswordValue('')
                                setPasswordError('')
                              }}
                              title={
                                member.user_id === profile?.id
                                  ? 'تغيير كلمة مروري'
                                  : 'تغيير كلمة المرور'
                              }
                              className="p-1.5 rounded text-on-surface-variant hover:text-primary hover:bg-primary/10"
                            >
                              <KeyRound className="w-4 h-4" />
                            </button>
                            {member.is_active ? (
                              <button
                                onClick={() => handleMemberActive(member)}
                                disabled={memberActionId === member.id}
                                title="إيقاف العضوية"
                                className="px-2 py-1 text-xs rounded border border-busy/30 text-busy hover:bg-busy/10 flex items-center gap-1 transition-colors"
                              >
                                <Power className="w-3.5 h-3.5" />
                                <span>إيقاف</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => handleMemberActive(member)}
                                disabled={memberActionId === member.id}
                                title="إعادة تفعيل العضوية"
                                className="px-2 py-1 text-xs rounded bg-available hover:bg-available/90 text-white font-bold flex items-center gap-1 transition-colors shadow-sm"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>إعادة التفعيل</span>
                              </button>
                            )}
                            <button
                              onClick={() => handleRemoveMember(member)}
                              disabled={memberActionId === member.id}
                              title="إزالة من المحل"
                              className="p-1.5 rounded text-on-surface-variant hover:text-busy hover:bg-busy/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-card-border/60">
                          <span className="text-[11px] text-on-surface-variant">الدور:</span>
                          {(['worker', 'admin', 'owner'] as UserRole[]).map(role => (
                            <button
                              key={role}
                              disabled={member.role === role || memberActionId === member.id}
                              onClick={() => handleMemberRole(member, role)}
                              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                                member.role === role
                                  ? 'bg-primary/15 border-primary text-primary'
                                  : 'border-outline-variant/60 text-on-surface-variant hover:border-primary/40'
                              }`}
                            >
                              {ROLE_LABEL[role]}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                {detailsInvitations.length === 0 ? (
                  <p className="text-center text-sm text-on-surface-variant py-8">
                    لا توجد دعوات لهذا المحل
                  </p>
                ) : (
                  detailsInvitations.map(inv => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-surface-container-low px-3 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-on-surface truncate" dir="ltr">
                          {inv.email}
                        </p>
                        <p className="text-on-surface-variant mt-0.5">
                          {ROLE_LABEL[inv.role]} ·{' '}
                          {new Date(inv.created_at).toLocaleDateString('ar-EG')}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 ${
                          inv.status === 'accepted'
                            ? 'bg-available/10 text-available'
                            : inv.status === 'pending'
                              ? 'bg-tertiary/10 text-tertiary'
                              : 'bg-busy/10 text-busy'
                        }`}
                      >
                        {inv.status === 'accepted' ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <Clock className="w-3 h-3" />
                        )}
                        {inv.status === 'accepted'
                          ? 'مقبولة'
                          : inv.status === 'pending'
                            ? 'معلقة'
                            : inv.status === 'revoked'
                              ? 'ملغاة'
                              : 'منتهية'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Password reset modal */}
      <Modal
        isOpen={Boolean(passwordMember)}
        onClose={() => setPasswordMember(null)}
        title={`تغيير كلمة المرور لـ «${passwordMember?.profile?.name ?? ''}»`}
        size="sm"
      >
        <form onSubmit={handleResetPassword} className="space-y-4">
          {passwordError && (
            <div className="p-3 bg-busy/10 border border-busy/30 rounded-lg text-busy text-xs">
              {passwordError}
            </div>
          )}
          <p className="text-xs text-on-surface-variant">
            الحساب:{' '}
            <strong className="font-mono text-primary" dir="ltr">
              {passwordMember?.profile?.email || passwordMember?.profile?.username}
            </strong>
          </p>
          <Input
            label="كلمة المرور الجديدة"
            type="password"
            value={passwordValue}
            onChange={e => setPasswordValue(e.target.value)}
            placeholder="6 أحرف على الأقل"
            dir="ltr"
            required
            autoFocus
          />
          <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
            <Button type="button" variant="ghost" onClick={() => setPasswordMember(null)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary" disabled={isResettingPassword}>
              {isResettingPassword ? 'جاري التحديث...' : 'تحديث كلمة المرور'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add existing user to tenant */}
      <Modal
        isOpen={Boolean(addExistingUser)}
        onClose={() => setAddExistingUser(null)}
        title={`إضافة «${addExistingUser?.name ?? ''}» إلى محل`}
        size="md"
      >
        <form onSubmit={handleAddExistingToTenant} className="space-y-4">
          {addExistingError && (
            <div className="p-3 bg-busy/10 border border-busy/30 rounded-lg text-busy text-xs">
              {addExistingError}
            </div>
          )}
          <p className="text-xs text-on-surface-variant">
            سيُربط نفس الحساب العالمي بالمحل المختار. لا يتم إنشاء مستخدم مكرر.
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-on-surface-variant">المحل</label>
            <select
              value={addExistingForm.tenant_id}
              onChange={e =>
                setAddExistingForm(f => ({ ...f, tenant_id: e.target.value }))
              }
              className="min-h-[44px] rounded-DEFAULT border border-outline-variant bg-surface-container px-3 text-sm text-on-surface focus:border-primary focus:outline-none"
              required
            >
              <option value="">اختر المحل</option>
              {tenants.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.is_active ? '' : '(موقوف)'}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-on-surface-variant">الدور</label>
            <select
              value={addExistingForm.role}
              onChange={e =>
                setAddExistingForm(f => ({ ...f, role: e.target.value as UserRole }))
              }
              className="min-h-[44px] rounded-DEFAULT border border-outline-variant bg-surface-container px-3 text-sm text-on-surface focus:border-primary focus:outline-none"
            >
              <option value="worker">كاشير</option>
              <option value="admin">مدير</option>
              <option value="owner">مالك المحل</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
            <Button type="button" variant="ghost" onClick={() => setAddExistingUser(null)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary" disabled={isAddingExisting}>
              {isAddingExisting ? 'جاري الإضافة...' : 'إضافة للمحل'}
            </Button>
          </div>
        </form>
      </Modal>

      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
    </div>
  )
}

// ─── Overview ───────────────────────────────────────────────
function OverviewTab({
  tenants,
  users,
  todayRevenue,
  activeTenants,
  suspendedTenants,
  totalMemberships,
  pendingInvitations,
  deviceCountByTenant,
  sessionCountByTenant,
  ownerOf,
  onOpenTenant,
}: {
  tenants: AdminTenant[]
  users: AdminUser[]
  todayRevenue: number
  activeTenants: number
  suspendedTenants: number
  totalMemberships: number
  pendingInvitations: number
  deviceCountByTenant: Map<string, number>
  sessionCountByTenant: Map<string, number>
  ownerOf: (tenant: AdminTenant) => { name: string; email?: string | null } | null
  onOpenTenant: (id: string) => void
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="إجمالي المحلات"
          value={tenants.length}
          icon={<Building2 className="w-5 h-5 text-primary" />}
          valueClassName="text-primary"
        />
        <StatCard
          title="محلات نشطة"
          value={activeTenants}
          icon={<CheckCircle2 className="w-5 h-5 text-available" />}
          valueClassName="text-available"
        />
        <StatCard
          title="محلات موقوفة"
          value={suspendedTenants}
          icon={<AlertTriangle className="w-5 h-5 text-busy" />}
          valueClassName="text-busy"
        />
        <StatCard
          title="إيراد المنصة اليوم"
          value={formatEGP(todayRevenue)}
          icon={<TrendingUp className="w-5 h-5 text-secondary" />}
          valueClassName="text-secondary"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="الحسابات العالمية"
          value={users.length}
          icon={<Users className="w-5 h-5 text-primary" />}
        />
        <StatCard
          title="العضويات"
          value={totalMemberships}
          icon={<Shield className="w-5 h-5 text-secondary" />}
        />
        <StatCard
          title="أجهزة مفعّلة"
          value={Array.from(deviceCountByTenant.values()).reduce((a, b) => a + b, 0)}
          icon={<Monitor className="w-5 h-5 text-tertiary" />}
        />
        <StatCard
          title="جلسات جارية"
          value={Array.from(sessionCountByTenant.values()).reduce((a, b) => a + b, 0)}
          icon={<Activity className="w-5 h-5 text-busy" />}
          valueClassName="text-busy"
        />
      </div>

      {pendingInvitations > 0 && (
        <div className="rounded-xl border border-tertiary/30 bg-tertiary/10 px-4 py-3 text-xs text-tertiary flex items-center gap-2">
          <Mail className="w-4 h-4" />
          يوجد {pendingInvitations} دعوة معلقة على مستوى المنصة.
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-card-border">
          <h2 className="text-sm font-bold text-on-surface flex items-center gap-2">
            <Store className="w-4 h-4 text-primary" /> أحدث المحلات
          </h2>
          <span className="text-[11px] text-on-surface-variant">{tenants.length} محل</span>
        </div>
        {tenants.length === 0 ? (
          <p className="text-center py-10 text-sm text-on-surface-variant">لا توجد محلات بعد</p>
        ) : (
          <div className="divide-y divide-card-border">
            {tenants.slice(0, 5).map(tenant => {
              const owner = ownerOf(tenant)
              return (
                <button
                  key={tenant.id}
                  onClick={() => onOpenTenant(tenant.id)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-right hover:bg-surface-container-high/60 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Store className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-on-surface truncate">{tenant.name}</p>
                      <p className="text-[11px] text-on-surface-variant truncate">
                        {owner?.name ?? 'بدون مالك'} · {tenant.slug}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[11px] text-on-surface-variant">
                      {deviceCountByTenant.get(tenant.id) ?? 0} جهاز
                    </span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                        tenant.is_active
                          ? 'bg-available/10 text-available'
                          : 'bg-busy/10 text-busy'
                      }`}
                    >
                      {tenant.is_active ? 'نشط' : 'موقوف'}
                    </span>
                    <ChevronLeft className="w-4 h-4 text-on-surface-variant" />
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

// ─── Tenants Tab ────────────────────────────────────────────
function TenantsTab({
  tenants,
  filteredCount,
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  sortBy,
  onSort,
  page,
  pageCount,
  onPage,
  ownerOf,
  activeMemberCount,
  deviceCountByTenant,
  sessionCountByTenant,
  onDetails,
  onEdit,
  onStatus,
  onOpenCreate,
}: {
  tenants: AdminTenant[]
  filteredCount: number
  search: string
  onSearch: (value: string) => void
  statusFilter: TenantStatusFilter
  onStatusFilter: (value: TenantStatusFilter) => void
  sortBy: TenantSort
  onSort: (value: TenantSort) => void
  page: number
  pageCount: number
  onPage: (page: number) => void
  ownerOf: (tenant: AdminTenant) => { name: string; email?: string | null } | null
  activeMemberCount: (tenant: AdminTenant) => number
  deviceCountByTenant: Map<string, number>
  sessionCountByTenant: Map<string, number>
  onDetails: (id: string) => void
  onEdit: (tenant: AdminTenant) => void
  onStatus: (tenant: AdminTenant) => void
  onOpenCreate: () => void
}) {
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-on-surface-variant absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="ابحث باسم المحل، الرابط، المالك، أو البريد..."
            className="w-full min-h-[44px] rounded-DEFAULT border border-card-border bg-surface-container-low pr-9 pl-3 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => onStatusFilter(e.target.value as TenantStatusFilter)}
          className="min-h-[44px] rounded-DEFAULT border border-card-border bg-surface-container-low px-3 text-sm text-on-surface focus:border-primary focus:outline-none"
        >
          <option value="all">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="suspended">موقوف</option>
        </select>
        <select
          value={sortBy}
          onChange={e => onSort(e.target.value as TenantSort)}
          className="min-h-[44px] rounded-DEFAULT border border-card-border bg-surface-container-low px-3 text-sm text-on-surface focus:border-primary focus:outline-none"
        >
          <option value="newest">الأحدث أولاً</option>
          <option value="oldest">الأقدم أولاً</option>
          <option value="name">الاسم (أ-ي)</option>
        </select>
        <Button variant="primary" onClick={onOpenCreate} className="md:w-auto">
          <Plus className="w-4 h-4" /> محل جديد
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-card-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-surface-container-low text-[11px] text-on-surface-variant">
              <tr>
                <th className="px-4 py-3 font-semibold">المحل</th>
                <th className="px-4 py-3 font-semibold">المالك</th>
                <th className="px-4 py-3 font-semibold">الأعضاء</th>
                <th className="px-4 py-3 font-semibold">الأجهزة</th>
                <th className="px-4 py-3 font-semibold">جلسات</th>
                <th className="px-4 py-3 font-semibold">التاريخ</th>
                <th className="px-4 py-3 font-semibold">الحالة</th>
                <th className="px-4 py-3 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border bg-card">
              {tenants.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-on-surface-variant">
                    لا توجد محلات مطابقة
                  </td>
                </tr>
              ) : (
                tenants.map(tenant => {
                  const owner = ownerOf(tenant)
                  return (
                    <tr key={tenant.id} className="hover:bg-surface-container-low/50">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => onDetails(tenant.id)}
                          className="text-right group"
                        >
                          <p className="font-bold text-on-surface group-hover:text-primary transition-colors">
                            {tenant.name}
                          </p>
                          <p className="text-[11px] font-mono text-on-surface-variant" dir="ltr">
                            {tenant.slug}
                          </p>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {owner ? (
                          <div>
                            <p className="text-xs font-semibold text-on-surface">{owner.name}</p>
                            <p
                              className="text-[11px] text-on-surface-variant font-mono"
                              dir="ltr"
                            >
                              {owner.email}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs text-tertiary">بدون مالك</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-on-surface-variant">
                        {activeMemberCount(tenant)}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-on-surface-variant">
                        {deviceCountByTenant.get(tenant.id) ?? 0}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-on-surface-variant">
                        {sessionCountByTenant.get(tenant.id) ?? 0}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-on-surface-variant whitespace-nowrap">
                        {new Date(tenant.created_at).toLocaleDateString('ar-EG')}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                            tenant.is_active
                              ? 'bg-available/10 text-available'
                              : 'bg-busy/10 text-busy'
                          }`}
                        >
                          {tenant.is_active ? 'نشط' : 'موقوف'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => onDetails(tenant.id)}
                            title="التفاصيل"
                            className="p-1.5 rounded text-on-surface-variant hover:text-primary hover:bg-primary/10"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onEdit(tenant)}
                            title="تعديل"
                            className="p-1.5 rounded text-on-surface-variant hover:text-primary hover:bg-primary/10"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onStatus(tenant)}
                            title={tenant.is_active ? 'إيقاف' : 'تفعيل'}
                            className={`p-1.5 rounded ${
                              tenant.is_active
                                ? 'text-on-surface-variant hover:text-busy hover:bg-busy/10'
                                : 'text-on-surface-variant hover:text-available hover:bg-available/10'
                            }`}
                          >
                            <Power className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-on-surface-variant">
        <span>
          عرض {tenants.length} من {filteredCount} محل · صفحة {page} من {pageCount}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <ChevronRight className="w-4 h-4" /> السابق
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
          >
            التالي <ChevronLeft className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Global Users Tab ───────────────────────────────────────
function UsersTab({
  users,
  totalUsers,
  search,
  onSearch,
  onToggleActive,
  onAddToTenant,
}: {
  users: AdminUser[]
  totalUsers: number
  search: string
  onSearch: (value: string) => void
  onToggleActive: (user: AdminUser) => void
  onAddToTenant: (user: AdminUser) => void
}) {
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="w-4 h-4 text-on-surface-variant absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="ابحث بالاسم أو البريد أو اسم الدخول..."
          className="w-full min-h-[44px] rounded-DEFAULT border border-card-border bg-surface-container-low pr-9 pl-3 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary focus:outline-none"
        />
      </div>

      <div className="text-xs text-on-surface-variant">
        عرض {users.length} من {totalUsers} حساب عالمي
      </div>

      {users.length === 0 ? (
        <div className="text-center py-16 text-sm text-on-surface-variant">
          لا توجد حسابات مطابقة
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {users.map(user => (
            <Card key={user.id} className={`flex flex-col gap-3 ${!user.is_active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-on-surface truncate">{user.name}</p>
                    <p className="text-[11px] font-mono text-on-surface-variant truncate" dir="ltr">
                      {user.email || `@${user.username}`}
                    </p>
                  </div>
                </div>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                    user.is_active ? 'bg-available/10 text-available' : 'bg-busy/10 text-busy'
                  }`}
                >
                  {user.is_active ? 'مفعّل' : 'موقوف'}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5 min-h-[24px]">
                {(user.memberships ?? []).length === 0 ? (
                  <span className="text-[11px] text-on-surface-variant">لا يوجد عضويات</span>
                ) : (
                  (user.memberships ?? []).map(m => (
                    <span
                      key={m.id}
                      className={`text-[11px] px-2 py-0.5 rounded-full border ${
                        m.is_active && m.tenant?.is_active
                          ? 'border-primary/30 bg-primary/10 text-primary'
                          : 'border-card-border bg-surface-container text-on-surface-variant'
                      }`}
                    >
                      {m.tenant?.name ?? 'محل'} · {ROLE_LABEL[m.role]}
                      {!m.is_active ? ' · موقوفة' : ''}
                    </span>
                  ))
                )}
              </div>

              <div className="flex items-center gap-2 border-t border-card-border pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onAddToTenant(user)}
                  className="text-xs"
                >
                  <UserPlus className="w-3.5 h-3.5" /> إضافة لمحل
                </Button>
                {user.is_active ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onToggleActive(user)}
                    className="text-xs text-busy hover:bg-busy/10"
                  >
                    <Power className="w-3.5 h-3.5" />
                    إيقاف الحساب
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onToggleActive(user)}
                    className="text-xs bg-available/10 text-available border-available/30 hover:bg-available/20 font-bold"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    إعادة تفعيل الحساب
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-card-border bg-surface-container-low px-3 py-2">
      <p className="text-[10px] text-on-surface-variant">{label}</p>
      <p className="text-sm font-bold text-on-surface mt-0.5">{value}</p>
    </div>
  )
}
