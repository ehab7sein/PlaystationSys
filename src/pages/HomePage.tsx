import { useEffect, useState, useCallback } from 'react'
import { MonitorPlay, Monitor, Clock, TrendingUp, Plus, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { StatCard } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { DeviceCard } from '@/components/devices/DeviceCard'
import { StartSessionModal } from '@/components/devices/StartSessionModal'
import { QuickSaleModal } from '@/components/products/QuickSaleModal'
import { formatEGP } from '@/lib/utils'
import { translateDbError } from '@/lib/errors'
import type { Device, Session, AppSettings, SessionMode } from '@/types/database'

export function HomePage() {
  const { profile, activeTenant } = useAuth()
  const tenantId = activeTenant?.id ?? null

  const [devices, setDevices] = useState<Device[]>([])
  const [activeSessions, setActiveSessions] = useState<Session[]>([])
  const [todayRevenue, setTodayRevenue] = useState(0)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)
  const [showStartSession, setShowStartSession] = useState(false)
  const [showQuickSale, setShowQuickSale] = useState(false)

  const fetchData = useCallback(async () => {
    if (!tenantId) {
      setIsLoading(false)
      return
    }

    setLoadError('')
    try {
      // All 4 queries run in parallel — no sequential waterfall.
      // The day_start_hour for the revenue window defaults to 6 if settings
      // haven't loaded yet; after the first load the correct value is used.
      const dayStartHour = settings?.day_start_hour ?? 6
      const now = new Date()
      const todayStart = new Date(now)
      todayStart.setHours(dayStartHour, 0, 0, 0)
      if (now.getHours() < dayStartHour) {
        todayStart.setDate(todayStart.getDate() - 1)
      }

      const [devicesRes, sessionsRes, settingsRes, paymentsRes] = await Promise.all([
        supabase
          .from('devices')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('sessions')
          .select('*, device:devices(*), price_periods:session_price_history(*)')
          .eq('tenant_id', tenantId)
          .eq('status', 'active'),
        supabase.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
        supabase
          .from('payments')
          .select('amount')
          .eq('tenant_id', tenantId)
          .gte('created_at', todayStart.toISOString()),
      ])

      if (devicesRes.error) throw devicesRes.error
      if (sessionsRes.error) throw sessionsRes.error
      if (settingsRes.error) throw settingsRes.error
      if (paymentsRes.error) throw paymentsRes.error

      setDevices((devicesRes.data ?? []) as Device[])
      setActiveSessions((sessionsRes.data ?? []) as Session[])
      setSettings((settingsRes.data ?? null) as AppSettings | null)

      const total = (paymentsRes.data ?? []).reduce((sum, p) => sum + (p.amount ?? 0), 0)
      setTodayRevenue(total)
    } catch (err) {
      setLoadError(translateDbError(err, 'تعذر تحميل بيانات الأجهزة والإيرادات'))
      setDevices([])
      setActiveSessions([])
      setTodayRevenue(0)
    } finally {
      setIsLoading(false)
    }
  }, [tenantId, settings?.day_start_hour])

  useEffect(() => {
    if (!tenantId) return
    fetchData()

    // Coalesce rapid multi-table change events (e.g. session end updates
    // both sessions, devices, and payments within milliseconds) into a single fetch.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const debouncedFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        fetchData()
      }, 150)
    }

    // Realtime is also filtered by tenant so a device change in another shop
    // can never trigger a refresh here. RLS enforces this server-side too.
    const channel = supabase
      .channel(`devices-realtime-${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'devices',
          filter: `tenant_id=eq.${tenantId}`,
        },
        debouncedFetch
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sessions',
          filter: `tenant_id=eq.${tenantId}`,
        },
        debouncedFetch
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_price_history',
          filter: `tenant_id=eq.${tenantId}`,
        },
        debouncedFetch
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payments',
          filter: `tenant_id=eq.${tenantId}`,
        },
        debouncedFetch
      )
      .subscribe()

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      supabase.removeChannel(channel)
    }
  }, [tenantId, fetchData])

  const availableDevices = devices.filter(d => d.status === 'available').length
  const busyDevices = devices.filter(d => d.status === 'busy').length

  const handleDeviceClick = useCallback((device: Device) => {
    if (device.status === 'available') {
      setSelectedDevice(device)
      setShowStartSession(true)
    }
  }, [])

  // Optimistic session start: updates card and starts timer immediately (0ms lag)
  const handleSessionStarted = useCallback(
    (
      deviceId: string,
      mode: SessionMode,
      plannedMinutes: number | null,
      sessionId?: string
    ) => {
      const nowIso = new Date().toISOString()
      const targetDevice = devices.find(d => d.id === deviceId)
      if (!targetDevice) {
        fetchData()
        return
      }

      setDevices(prev =>
        prev.map(d => (d.id === deviceId ? { ...d, status: 'busy' } : d))
      )

      const optimisticSession: Session = {
        id: sessionId || `opt-${Date.now()}`,
        tenant_id: tenantId || '',
        device_id: deviceId,
        mode,
        planned_minutes: plannedMinutes,
        hourly_price_snapshot: targetDevice.hourly_price,
        started_at: nowIso,
        ended_at: null,
        time_amount: null,
        status: 'active',
        created_by: profile?.id ?? null,
        created_at: nowIso,
        device: targetDevice,
        price_periods: [
          {
            id: `opt-sph-${Date.now()}`,
            tenant_id: tenantId || '',
            session_id: sessionId || `opt-${Date.now()}`,
            play_type: 'single',
            hourly_price: targetDevice.hourly_price,
            started_at: nowIso,
            ended_at: null,
            created_by: profile?.id ?? null,
            created_at: nowIso,
          },
        ],
      }

      setActiveSessions(prev => [
        ...prev.filter(s => s.device_id !== deviceId),
        optimisticSession,
      ])

      fetchData()
    },
    [devices, tenantId, profile, fetchData]
  )

  // Optimistic session end: frees device card immediately
  const handleSessionEnded = useCallback(
    (deviceId: string) => {
      setDevices(prev =>
        prev.map(d => (d.id === deviceId ? { ...d, status: 'available' } : d))
      )
      setActiveSessions(prev => prev.filter(s => s.device_id !== deviceId))
      fetchData()
    },
    [fetchData]
  )

  const getDeviceSession = useCallback(
    (deviceId: string) => activeSessions.find(s => s.device_id === deviceId),
    [activeSessions]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-on-surface-variant">جاري تحميل البيانات...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">الرئيسية</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            مرحباً {profile?.name} 👋 — {activeTenant?.name}
          </p>
        </div>
        <Button onClick={() => setShowQuickSale(true)} size="md" className="gap-2">
          <Plus className="w-4 h-4" />
          بيع منتج
        </Button>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-busy/30 bg-busy/10 px-4 py-3 text-sm text-busy">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="أجهزة متاحة"
          value={availableDevices}
          icon={<Monitor className="w-5 h-5 text-available" />}
          valueClassName="text-available"
        />
        <StatCard
          title="أجهزة مشغولة"
          value={busyDevices}
          icon={<MonitorPlay className="w-5 h-5 text-busy" />}
          valueClassName="text-busy"
        />
        <StatCard
          title="جلسات جارية"
          value={activeSessions.length}
          icon={<Clock className="w-5 h-5 text-primary" />}
          valueClassName="text-primary"
        />
        <StatCard
          title="إيراد اليوم"
          value={formatEGP(todayRevenue)}
          icon={<TrendingUp className="w-5 h-5 text-secondary" />}
          valueClassName="text-secondary"
        />
      </div>

      {/* Devices Grid */}
      <div>
        <h2 className="text-lg font-semibold text-on-surface mb-4">الأجهزة</h2>
        {devices.length === 0 ? (
          <div className="text-center py-16 text-on-surface-variant">
            <MonitorPlay className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>لا توجد أجهزة مضافة بعد</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {devices.map(device => (
              <DeviceCard
                key={device.id}
                device={device}
                session={getDeviceSession(device.id)}
                settings={settings}
                onStartSession={() => handleDeviceClick(device)}
                onRefresh={fetchData}
                onSessionEnded={handleSessionEnded}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedDevice && (
        <StartSessionModal
          isOpen={showStartSession}
          device={selectedDevice}
          onClose={() => {
            setShowStartSession(false)
            setSelectedDevice(null)
          }}
          onSuccess={(mode, plannedMinutes, newSessionId) => {
            handleSessionStarted(selectedDevice.id, mode, plannedMinutes, newSessionId)
            setShowStartSession(false)
            setSelectedDevice(null)
          }}
        />
      )}
      <QuickSaleModal
        isOpen={showQuickSale}
        onClose={() => setShowQuickSale(false)}
        onSuccess={fetchData}
      />
    </div>
  )
}
