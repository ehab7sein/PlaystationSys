import { useEffect, useState, useCallback } from 'react'
import { formatTimerLong, formatEGP, calcSessionPrice } from '@/lib/utils'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { supabase } from '@/lib/supabase'
import { EndSessionModal } from './EndSessionModal'
import { AddProductToSessionModal } from '../products/AddProductToSessionModal'
import { ConfirmModal } from '@/components/ui/Modal'
import type { Device, Session, AppSettings } from '@/types/database'
import { useAuth } from '@/contexts/AuthContext'

interface DeviceCardProps {
  device: Device
  session?: Session
  settings: AppSettings | null
  onStartSession: () => void
  onRefresh: () => void
}

export function DeviceCard({
  device,
  session,
  settings,
  onStartSession,
  onRefresh,
}: DeviceCardProps) {
  const { canManagePrices, profile } = useAuth()
  const [elapsed, setElapsed] = useState(0)
  const [showEndSession, setShowEndSession] = useState(false)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [showMaintenanceConfirm, setShowMaintenanceConfirm] = useState(false)
  const [isTogglingMaintenance, setIsTogglingMaintenance] = useState(false)

  // Live timer
  useEffect(() => {
    if (!session) { setElapsed(0); return }
    const calc = () => {
      setElapsed(Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000))
    }
    calc()
    const interval = setInterval(calc, 1000)
    return () => clearInterval(interval)
  }, [session])

  const isOverSixHours = elapsed > 6 * 3600
  const isNearEnd =
    session?.mode === 'fixed' &&
    session.planned_minutes &&
    elapsed > (session.planned_minutes * 60 - 600) // 10 min warning

  const currentPrice = session
    ? calcSessionPrice(
        session.started_at,
        null,
        session.hourly_price_snapshot,
        settings?.rounding_mode
      )
    : 0

  const handleToggleMaintenance = async () => {
    setIsTogglingMaintenance(true)
    const newStatus = device.status === 'maintenance' ? 'available' : 'maintenance'
    await supabase.from('devices').update({ status: newStatus }).eq('id', device.id)
    setIsTogglingMaintenance(false)
    setShowMaintenanceConfirm(false)
    onRefresh()
  }

  const getBorderColor = () => {
    if (isOverSixHours && session) return 'border-busy'
    if (isNearEnd) return 'border-maintenance'
    if (device.status === 'available') return 'border-available/30'
    if (device.status === 'busy') return 'border-busy/40'
    if (device.status === 'maintenance') return 'border-maintenance/40'
    return 'border-card-border'
  }

  return (
    <>
      <Card className={`flex flex-col gap-4 ${getBorderColor()}`}>
        {/* Device name & status */}
        <div className="flex items-start justify-between">
          <h3 className="font-bold text-on-surface">{device.name}</h3>
          <StatusBadge status={device.status} />
        </div>

        {/* Timer or idle info */}
        {session ? (
          <div className="text-center py-2">
            <div
              className={`text-3xl font-extrabold tabular-nums ${
                isNearEnd ? 'text-maintenance' : isOverSixHours ? 'text-busy' : 'text-primary'
              }`}
            >
              {formatTimerLong(elapsed)}
            </div>
            {isNearEnd && (
              <p className="text-xs text-maintenance mt-1">⚠️ الوقت المحدد قارب على الانتهاء</p>
            )}
            {isOverSixHours && (
              <p className="text-xs text-busy mt-1">⚠️ الجلسة تعدت 6 ساعات</p>
            )}
            <div className="flex justify-between mt-3 text-sm text-on-surface-variant">
              <span>الجلسة</span>
              <span className="font-semibold text-on-surface tabular-nums">
                {formatEGP(currentPrice)}
              </span>
            </div>
            <div className="flex justify-between text-sm text-on-surface-variant">
              <span>النوع</span>
              <span>{session.mode === 'open' ? 'وقت مفتوح' : `${session.planned_minutes} د`}</span>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 text-on-surface-variant text-sm">
            {device.status === 'maintenance' ? '🔧 الجهاز في الصيانة' : '✅ الجهاز جاهز'}
          </div>
        )}

        {/* Price per hour */}
        <div className="text-xs text-on-surface-variant text-center">
          {formatEGP(device.hourly_price)} / ساعة
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2">
          {device.status === 'available' && (
            <Button variant="secondary" fullWidth onClick={onStartSession}>
              ▶ ابدأ جلسة
            </Button>
          )}
          {device.status === 'busy' && session && (
            <>
              <Button
                variant="ghost"
                fullWidth
                onClick={() => setShowAddProduct(true)}
                className="border border-outline-variant"
              >
                + أضف منتج
              </Button>
              <Button variant="danger" fullWidth onClick={() => setShowEndSession(true)}>
                ⏹ إنهاء الجلسة
              </Button>
            </>
          )}
          {device.status !== 'busy' && (
            <Button
              variant="ghost"
              size="sm"
              fullWidth
              onClick={() => setShowMaintenanceConfirm(true)}
              className="text-xs border border-outline-variant"
            >
              {device.status === 'maintenance' ? '✅ إلغاء الصيانة' : '🔧 صيانة'}
            </Button>
          )}
        </div>
      </Card>

      {/* End Session Modal */}
      {session && (
        <EndSessionModal
          isOpen={showEndSession}
          session={session}
          device={device}
          settings={settings}
          userId={profile?.id ?? ''}
          onClose={() => setShowEndSession(false)}
          onSuccess={onRefresh}
        />
      )}

      {/* Add Product to Session Modal */}
      {session && (
        <AddProductToSessionModal
          isOpen={showAddProduct}
          sessionId={session.id}
          userId={profile?.id ?? ''}
          onClose={() => setShowAddProduct(false)}
          onSuccess={onRefresh}
        />
      )}

      {/* Maintenance confirm */}
      <ConfirmModal
        isOpen={showMaintenanceConfirm}
        onClose={() => setShowMaintenanceConfirm(false)}
        onConfirm={handleToggleMaintenance}
        title="تغيير حالة الجهاز"
        message={
          device.status === 'maintenance'
            ? `هل تريد إتاحة "${device.name}" مرة أخرى؟`
            : `هل تريد وضع "${device.name}" في الصيانة؟`
        }
        confirmLabel={device.status === 'maintenance' ? 'نعم، أتحه' : 'نعم، صيانة'}
        isLoading={isTogglingMaintenance}
      />
    </>
  )
}
