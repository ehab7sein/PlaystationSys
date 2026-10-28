import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { clearAllCache } from '@/lib/cache'
import type { Session as SupabaseSession } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type {
  Membership,
  MembershipRole,
  MyContext,
  Profile,
  Tenant,
  UserRole,
} from '@/types/database'

const ACTIVE_TENANT_KEY = 'ps_active_tenant'

interface AuthContextValue {
  profile: Profile | null
  role: UserRole | null
  isLoading: boolean
  isSuperAdmin: boolean
  isAdmin: boolean
  isOwner: boolean
  isWorker: boolean
  isTenantOwner: boolean
  canManagePrices: boolean
  canViewAllRevenue: boolean
  canManageUsers: boolean
  canManageSalaries: boolean
  memberships: Membership[]
  activeMembership: Membership | null
  activeTenant: Tenant | null
  tenantSuspended: boolean
  hasTenant: boolean
  login: (
    identifier: string,
    password: string
  ) => Promise<{ success: boolean; error?: string; redirectTo?: string }>
  logout: () => Promise<void>
  refreshProfile: () => Promise<void>
  switchTenant: (tenantId: string) => void
}

function pickActiveMembership(
  memberships: Membership[],
  storedTenantId: string | null
): Membership | null {
  return (
    memberships.find(m => m.tenant_id === storedTenantId && m.is_active) ??
    memberships.find(m => m.is_active && m.tenant?.is_active) ??
    memberships.find(m => m.is_active) ??
    null
  )
}

const EMPTY_CONTEXT: AuthContextValue = {
  profile: null,
  role: null,
  isLoading: true,
  isSuperAdmin: false,
  isAdmin: false,
  isOwner: false,
  isWorker: false,
  isTenantOwner: false,
  canManagePrices: false,
  canViewAllRevenue: false,
  canManageUsers: false,
  canManageSalaries: false,
  memberships: [],
  activeMembership: null,
  activeTenant: null,
  tenantSuspended: false,
  hasTenant: false,
  login: async () => ({ success: false }),
  logout: async () => {},
  refreshProfile: async () => {},
  switchTenant: () => {},
}

const AuthContext = createContext<AuthContextValue>(EMPTY_CONTEXT)

function isMissingRpc(error: { code?: string; message?: string } | null) {
  if (!error) return false
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /could not find the function|function .* does not exist/i.test(error.message ?? '')
  )
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [activeTenantId, setActiveTenantId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_TENANT_KEY)
    } catch {
      return null
    }
  })
  const [isLoading, setIsLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const applyContext = useCallback((ctx: MyContext) => {
    const nextProfile = ctx?.profile ?? null
    const nextMemberships = Array.isArray(ctx?.memberships) ? ctx.memberships : []
    const nextSuper = !!ctx?.is_platform_admin

    setProfile(nextProfile)
    setMemberships(nextMemberships)
    setIsSuperAdmin(nextSuper)

    if (!nextProfile) {
      setActiveTenantId(null)
      localStorage.removeItem(ACTIVE_TENANT_KEY)
      return
    }

    // Pick the active tenant:
    //  1. the one saved in this browser, if the user still has an active membership
    //  2. otherwise the first active membership in an active tenant
    //  3. otherwise the first active membership (a suspended tenant is kept so
    //     the app can explain the suspension instead of silently switching).
    const stored = (() => {
      try {
        return localStorage.getItem(ACTIVE_TENANT_KEY)
      } catch {
        return null
      }
    })()

    const chosen = pickActiveMembership(nextMemberships, stored)

    if (!chosen) {
      setActiveTenantId(null)
      localStorage.removeItem(ACTIVE_TENANT_KEY)
      return
    }

    setActiveTenantId(chosen.tenant_id)
    localStorage.setItem(ACTIVE_TENANT_KEY, chosen.tenant_id)
  }, [])

  const loadContext = useCallback(async (): Promise<MyContext | null> => {
    const { data, error } = await supabase.rpc('get_my_context')
    if (error) {
      if (isMissingRpc(error)) {
        throw new Error(
          'قاعدة البيانات لم تُحدَّث بعد للنظام متعدد الأنظمة. شغّل ملفات SQL في supabase/migrations بالترتيب.'
        )
      }
      throw new Error(error.message)
    }
    if (!data) {
      setProfile(null)
      setMemberships([])
      setIsSuperAdmin(false)
      setActiveTenantId(null)
      localStorage.removeItem(ACTIVE_TENANT_KEY)
      return null
    }
    const context = data as MyContext
    applyContext(context)
    return context
  }, [applyContext])

  const bootstrap = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        if (!mountedRef.current) return
        setProfile(null)
        setMemberships([])
        setIsSuperAdmin(false)
        return
      }
      // Realtime respects RLS, so the socket must carry the same access token
      // as the REST client. Without this, postgres_changes events are filtered
      // out for authenticated members.
      if (sessionData.session.access_token) {
        supabase.realtime.setAuth(sessionData.session.access_token)
      }
      await loadContext()
    } catch (err) {
      console.error('Auth bootstrap failed:', err)
      if (!mountedRef.current) return
      setProfile(null)
      setMemberships([])
      setIsSuperAdmin(false)
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [loadContext])

  useEffect(() => {
    bootstrap()

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event: string, session: SupabaseSession | null) => {
        // Supabase warns against awaiting inside this callback; defer the work.
        if (event === 'SIGNED_OUT' || !session) {
          setProfile(null)
          setMemberships([])
          setIsSuperAdmin(false)
          setActiveTenantId(null)
          localStorage.removeItem(ACTIVE_TENANT_KEY)
          setIsLoading(false)
          return
        }
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
          if (session.access_token) {
            supabase.realtime.setAuth(session.access_token)
          }
          setTimeout(() => {
            loadContext()
              .catch(err => console.error('Auth refresh failed:', err))
              .finally(() => {
                if (mountedRef.current) setIsLoading(false)
              })
          }, 0)
        }
      }
    )

    return () => {
      subscription.subscription.unsubscribe()
    }
  }, [bootstrap, loadContext])

  const login = async (
    identifier: string,
    password: string
  ): Promise<{ success: boolean; error?: string; redirectTo?: string }> => {
    const cleanId = identifier.trim()
    if (!cleanId || !password) {
      return { success: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور' }
    }

    try {
      // 1. Resolve username/email → the email stored in Supabase Auth.
      const { data: email, error: resolveError } = await supabase.rpc('resolve_login_email', {
        p_identifier: cleanId,
      })

      if (resolveError) {
        if (isMissingRpc(resolveError)) {
          return {
            success: false,
            error:
              'قاعدة البيانات لم تُحدَّث بعد. شغّل ملفات SQL في supabase/migrations بالترتيب ثم أعد المحاولة.',
          }
        }
        return { success: false, error: `تعذر الاتصال بقاعدة البيانات: ${resolveError.message}` }
      }

      if (!email) {
        return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }
      }

      // 2. Real Supabase Auth sign-in (bcrypt password check happens server-side).
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        if (/invalid login credentials/i.test(signInError.message)) {
          return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }
        }
        if (/email not confirmed/i.test(signInError.message)) {
          return { success: false, error: 'البريد الإلكتروني لهذا الحساب غير مؤكد. راجع إدارة المنصة.' }
        }
        return { success: false, error: signInError.message }
      }

      // 3. Load profile + memberships under RLS.
      const context = await loadContext()

      // Validate profile active status using the context already fetched —
      // avoids a second round-trip to the profiles table.
      const loadedProfile = context?.profile ?? null
      if (!loadedProfile) {
        await supabase.auth.signOut()
        setProfile(null)
        setMemberships([])
        setIsSuperAdmin(false)
        setActiveTenantId(null)
        localStorage.removeItem(ACTIVE_TENANT_KEY)
        return { success: false, error: 'لا يوجد ملف مستخدم مرتبط بهذا الحساب. راجع إدارة المنصة.' }
      }

      if (!loadedProfile.is_active) {
        await supabase.auth.signOut()
        setProfile(null)
        setMemberships([])
        setIsSuperAdmin(false)
        setActiveTenantId(null)
        localStorage.removeItem(ACTIVE_TENANT_KEY)
        return { success: false, error: 'هذا الحساب موقوف، يرجى مراجعة إدارة المنصة' }
      }

      // Decide the landing page from the freshly loaded context. This is more
      // reliable than relying on a render after navigate(), which unmounts the
      // login page before its redirect effect can run.
      const memberships = Array.isArray(context?.memberships) ? context.memberships : []
      const chosen = pickActiveMembership(
        memberships,
        (() => {
          try {
            return localStorage.getItem(ACTIVE_TENANT_KEY)
          } catch {
            return null
          }
        })()
      )
      const redirectTo = context?.is_platform_admin
        ? '/admin'
        : chosen
          ? chosen.tenant?.is_active
            ? '/'
            : '/suspended'
          : '/no-tenant'

      return { success: true, redirectTo }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع'
      return { success: false, error: message }
    }
  }

  const logout = async () => {
    try {
      await supabase.auth.signOut()
    } catch {
      // Local cleanup must still happen if the network is down.
    }
    clearAllCache()
    setProfile(null)
    setMemberships([])
    setIsSuperAdmin(false)
    setActiveTenantId(null)
    localStorage.removeItem(ACTIVE_TENANT_KEY)
  }

  const refreshProfile = async () => {
    try {
      await loadContext()
    } catch (err) {
      console.warn('Failed to refresh profile:', err)
    }
  }

  const switchTenant = (tenantId: string) => {
    const target = memberships.find(m => m.tenant_id === tenantId && m.is_active)
    if (!target) return
    clearAllCache()
    localStorage.setItem(ACTIVE_TENANT_KEY, tenantId)
    setActiveTenantId(tenantId)
    // Reload so every page re-queries with the new tenant scope and no stale
    // rows from the previous tenant remain in memory.
    window.location.assign('/')
  }

  const activeMembership = useMemo(
    () => memberships.find(m => m.tenant_id === activeTenantId && m.is_active) ?? null,
    [memberships, activeTenantId]
  )

  const activeTenant = activeMembership?.tenant ?? null
  const role: MembershipRole | null = activeMembership?.role ?? null
  const isManager = role === 'owner' || role === 'admin'
  const tenantSuspended = !!activeTenant && !activeTenant.is_active

  // Memoize the context value so consumers only re-render when the actual
  // data they care about changes, not on every AuthProvider render.
  const value: AuthContextValue = useMemo(() => ({
    profile,
    role,
    isLoading,
    isSuperAdmin,
    isAdmin: role === 'admin',
    isOwner: isManager,
    isWorker: role === 'worker',
    isTenantOwner: role === 'owner',
    canManagePrices: isManager,
    canViewAllRevenue: isManager,
    canManageUsers: isManager,
    canManageSalaries: isManager,
    memberships,
    activeMembership,
    activeTenant,
    tenantSuspended,
    hasTenant: !!activeTenant,
    login,
    logout,
    refreshProfile,
    switchTenant,
  // login/logout/refreshProfile/switchTenant are defined inline or via useCallback
  // so we include them to satisfy exhaustive-deps while keeping stability.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [profile, role, isLoading, isSuperAdmin, isManager, memberships, activeMembership, activeTenant, tenantSuspended])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
