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
  createAdminProfile: () => Promise<void>
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
  createAdminProfile: async () => {},
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchProfile = useCallback(async (currentUserId: string, currentUserName: string) => {
    try {
      // Use maybeSingle to avoid 406 error when row does not exist
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

      // If no profile found, check if this is the first user in the whole system
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })

      // If database has 0 profiles, auto-provision this first user as admin!
      if (count === 0 || count === null) {
        const { data: created, error: insertErr } = await supabase
          .from('profiles')
          .insert({
            clerk_user_id: currentUserId,
            name: currentUserName || 'مدير النظام',
            role: 'admin',
            is_active: true,
          })
          .select()
          .maybeSingle()

        if (!insertErr && created) {
          setProfile(created)
          setIsLoading(false)
          return
        }
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

    const displayName = user.fullName || user.firstName || user.username || 'مدير النظام'
    fetchProfile(user.id, displayName)
  }, [user, isLoaded, fetchProfile])

  const createAdminProfile = async () => {
    if (!user) return
    setIsLoading(true)
    const displayName = user.fullName || user.firstName || user.username || 'مدير النظام'
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        clerk_user_id: user.id,
        name: displayName,
        role: 'admin',
        is_active: true,
      })
      .select()
      .maybeSingle()

    if (error) {
      console.error('Failed to create admin profile:', error)
      alert(`خطأ في إنشاء الحساب: ${error.message}\nتأكد من تشغيل ملف RLS policies في Supabase SQL editor.`)
    } else if (data) {
      setProfile(data)
    }
    setIsLoading(false)
  }

  const refreshProfile = async () => {
    if (!user) return
    const displayName = user.fullName || user.firstName || user.username || 'مدير النظام'
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
    createAdminProfile,
    refreshProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
