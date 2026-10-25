import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '@/lib/supabase'
import type { Profile, UserRole } from '@/types/database'

interface AuthContextValue {
  profile: Profile | null
  role: UserRole | null
  isLoading: boolean
  isAdmin: boolean
  isOwner: boolean
  isWorker: boolean
  canManagePrices: boolean
  canViewAllRevenue: boolean
  canManageUsers: boolean
  canManageSalaries: boolean
  createProfileWithRole: (role?: UserRole) => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  profile: null,
  role: null,
  isLoading: true,
  isAdmin: false,
  isOwner: false,
  isWorker: false,
  canManagePrices: false,
  canViewAllRevenue: false,
  canManageUsers: false,
  canManageSalaries: false,
  createProfileWithRole: async () => {},
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchProfile = useCallback(async (currentUserId: string, currentUserName: string) => {
    try {
      // 1. Check if user already has a profile
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('clerk_user_id', currentUserId)
        .maybeSingle()

      if (error) {
        console.warn('Profile fetch note:', error.message)
      }

      if (data) {
        setProfile(data)
        setIsLoading(false)
        return
      }

      // 2. If no profile exists, automatically create one:
      // First user in system -> admin
      // Any subsequent new user -> worker (كاشير)
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })

      const assignedRole: UserRole = (count === 0 || count === null) ? 'admin' : 'worker'

      const { data: created, error: insertErr } = await supabase
        .from('profiles')
        .insert({
          clerk_user_id: currentUserId,
          name: currentUserName || (assignedRole === 'admin' ? 'المدير' : 'كاشير'),
          role: assignedRole,
          is_active: true,
        })
        .select()
        .maybeSingle()

      if (!insertErr && created) {
        setProfile(created)
        setIsLoading(false)
        return
      }

      if (insertErr) {
        console.error('Auto profile creation error:', insertErr)
      }

      setProfile(null)
    } catch (err) {
      console.error('Unexpected error in fetchProfile:', err)
      setProfile(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isLoaded) return
    if (!user) {
      setProfile(null)
      setIsLoading(false)
      return
    }

    const displayName = user.fullName || user.firstName || user.username || 'كاشير'
    fetchProfile(user.id, displayName)
  }, [user, isLoaded, fetchProfile])

  const createProfileWithRole = async (targetRole: UserRole = 'worker') => {
    if (!user) return
    setIsLoading(true)
    const displayName = user.fullName || user.firstName || user.username || (targetRole === 'admin' ? 'المدير' : 'كاشير')
    
    // Check if exists first
    const { data: existing } = await supabase
      .from('profiles')
      .select('*')
      .eq('clerk_user_id', user.id)
      .maybeSingle()

    if (existing) {
      setProfile(existing)
      setIsLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .insert({
        clerk_user_id: user.id,
        name: displayName,
        role: targetRole,
        is_active: true,
      })
      .select()
      .maybeSingle()

    if (error) {
      console.error('Failed to create profile:', error)
      alert(`خطأ في إنشاء الحساب: ${error.message}`)
    } else if (data) {
      setProfile(data)
    }
    setIsLoading(false)
  }

  const refreshProfile = async () => {
    if (!user) return
    const displayName = user.fullName || user.firstName || user.username || 'مستخدم'
    await fetchProfile(user.id, displayName)
  }

  const role = profile?.role ?? null

  const value: AuthContextValue = {
    profile,
    role,
    isLoading,
    isAdmin: role === 'admin',
    isOwner: role === 'owner' || role === 'admin',
    isWorker: role === 'worker',
    canManagePrices: role === 'owner' || role === 'admin',
    canViewAllRevenue: role === 'owner' || role === 'admin',
    canManageUsers: role === 'admin',
    canManageSalaries: role === 'owner' || role === 'admin',
    createProfileWithRole,
    refreshProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
