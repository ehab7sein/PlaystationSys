import { useEffect, useState, useCallback } from 'react'
import { MonitorPlay, Monitor, Clock, TrendingUp, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { StatCard } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { DeviceCard } from '@/components/devices/DeviceCard'
import { StartSessionModal } from '@/components/devices/StartSessionModal'
import { QuickSaleModal } from '@/components/products/QuickSaleModal'
import { formatEGP } from '@/lib/utils'
import type { Device, Session, AppSettings } from '@/types/database'

export function HomePage() {
  const { profile } = useAuth()
  const [devices, setDevices] = useState<Device[]>([])
  const [activeSessions, setActiveSessions] = useState<Session[]>([])
  const [todayRevenue, setTodayRevenue] = useState(0)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)
  const [showStartSession, setShowStartSession] = useState(false)
  const [showQuickSale, setShowQuickSale] = useState(false)

  const fetchData = useCallback(async () => {
    const [devicesRes, sessionsRes, settingsRes] = await Promise.all([
      supabase.from('devices').select('*').eq('is_active', true).order('name'),
      supabase.from('sessions').select('*, device:devices(*)').eq('status', 'active'),
      supabase.from('settings').select('*').single(),
    ])

    if (devicesRes.data) setDevices(devicesRes.data)
    if (sessionsRes.data) setActiveSessions(sessionsRes.data as Session[])
    if (settingsRes.data) setSettings(settingsRes.data)

    // Fetch today's revenue from payments
    const dayStartHour = settingsRes.data?.day_start_hour ?? 6
    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setHours(dayStartHour, 0, 0, 0)
    if (now.getHours() < dayStartHour) {
      todayStart.setDate(todayStart.getDate() - 1)
    }

    const { data: paymentsData } = await supabase
      .from('payments')
      .select('amount')
      .gte('created_at', todayStart.toISOString())

    const total = paymentsData?.reduce((sum, p) => sum + p.amount, 0) ?? 0
    setTodayRevenue(total)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    fetchData()

    // Supabase Realtime subscriptions
    const deviceChannel = supabase
      .channel('devices-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, fetchData)
      .subscribe()

    return () => { supabase.removeChannel(deviceChannel) }
  }, [fetchData])

  const availableDevices = devices.filter(d => d.status === 'available').length
  const busyDevices = devices.filter(d => d.status === 'busy').length

  const handleDeviceClick = (device: Device) => {
    if (device.status === 'available') {
      setSelectedDevice(device)
      setShowStartSession(true)
    }
  }

  const getDeviceSession = (deviceId: string) =>
    activeSessions.find(s => s.device_id === deviceId)

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
            مرحباً {profile?.name} 👋
          </p>
        </div>
        <Button
          onClick={() => setShowQuickSale(true)}
          size="md"
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          بيع منتج
        </Button>
      </div>

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
          onClose={() => { setShowStartSession(false); setSelectedDevice(null) }}
          onSuccess={fetchData}
          userId={profile?.id ?? ''}
        />
      )}
      <QuickSaleModal
        isOpen={showQuickSale}
        onClose={() => setShowQuickSale(false)}
        userId={profile?.id ?? ''}
        onSuccess={fetchData}
      />
    </div>
  )
}
