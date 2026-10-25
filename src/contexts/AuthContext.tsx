import React, { createContext, useContext, useEffect, useState } from 'react'
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
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!isLoaded) return
    if (!user) {
      setProfile(null)
      setIsLoading(false)
      return
    }

    const fetchProfile = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('clerk_user_id', user.id)
        .single()

      if (error) {
        console.error('Error fetching profile:', error)
        setProfile(null)
      } else {
        setProfile(data)
      }
      setIsLoading(false)
    }

    fetchProfile()
  }, [user, isLoaded])

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
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
