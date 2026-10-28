import { memo, useEffect, useState } from 'react'
import { Wrench, Play, Square, Plus, CheckCircle2, ArrowLeftRight, Users, User } from 'lucide-react'
import {
  formatTimer,
  formatTimerLong,
  formatEGP,
  calcSessionPeriodsBreakdown,
  getElapsedSeconds,
} from '@/lib/utils'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { supabase } from '@/lib/supabase'
import { translateDbError } from '@/lib/errors'
import { EndSessionModal } from './EndSessionModal'
import { AddProductToSessionModal } from '../products/AddProductToSessionModal'
import { ConfirmModal } from '@/components/ui/Modal'
import type { Device, Session, AppSettings } from '@/types/database'

interface DeviceCardProps {
  device: Device
  session?: Session
  settings: AppSettings | null
  onStartSession: () => void
  onRefresh: () => void
  onSessionEnded?: (deviceId: string) => void
}

export const DeviceCard = memo(function DeviceCard({
  device,
  session,
  settings,
  onStartSession,
  onRefresh,
  onSessionEnded,
}: DeviceCardProps) {
  const [elapsed, setElapsed] = useState(() => (session ? getElapsedSeconds(session.started_at) : 0))
  const [showEndSession, setShowEndSession] = useState(false)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [showMaintenanceConfirm, setShowMaintenanceConfirm] = useState(false)
  const [isTogglingMaintenance, setIsTogglingMaintenance] = useState(false)
  const [showSwitchPrice, setShowSwitchPrice] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [error, setError] = useState('')

  // Live timer — ticks every 500 ms so elapsed seconds never lag by more than half a second
  useEffect(() => {
    if (!session) {
      setElapsed(0)
      return
    }
    const calc = () => { setElapsed(getElapsedSeconds(session.started_at)) }
    calc()
    const interval = setInterval(calc, 500)
    return () => clearInterval(interval)
  }, [session])

  const isOverSixHours = elapsed > 6 * 3600
  const isNearEnd =
    session?.mode === 'fixed' &&
    session.planned_minutes &&
    elapsed > session.planned_minutes * 60 - 600 // 10-min warning

  const breakdown = session
    ? calcSessionPeriodsBreakdown(
        session.price_periods,
        session.started_at,
        session.hourly_price_snapshot
      )
    : null

  const currentPrice = breakdown?.totalCost ?? 0
  const completedPeriods = breakdown?.totalCompletedPeriods ?? 0
  const secondsUntilNext = breakdown?.secondsUntilNext ?? 900

  // Determine current play type by comparing snapshot price to device's multi price
  const hasMultiPrice = device.hourly_price_multi && Number(device.hourly_price_multi) > 0
  const isCurrentlyMulti =
    hasMultiPrice &&
    session &&
    Math.abs(Number(session.hourly_price_snapshot) - Number(device.hourly_price_multi)) < 0.01

  const currentPlayType = isCurrentlyMulti ? 'multi' : 'single'
  const targetPrice = isCurrentlyMulti
    ? Number(device.hourly_price)
    : Number(device.hourly_price_multi ?? 0)

  const handleToggleMaintenance = async () => {
    setIsTogglingMaintenance(true)
    setError('')
    const newStatus = device.status === 'maintenance' ? 'available' : 'maintenance'
    try {
      const { error: rpcError } = await supabase.rpc('set_device_status', {
        p_device_id: device.id,
        p_status: newStatus,
      })
      if (rpcError) throw rpcError
      setShowMaintenanceConfirm(false)
      onRefresh()
    } catch (err) {
      setError(translateDbError(err, 'تعذر تغيير حالة الجهاز'))
      setShowMaintenanceConfirm(false)
    } finally {
      setIsTogglingMaintenance(false)
    }
  }

  const handleSwitchPrice = async () => {
    if (!session || !hasMultiPrice) return
    // Guard against double-click / rapid taps
    if (isSwitching) return

    setIsSwitching(true)
    setError('')
    try {
      const { error: rpcError } = await supabase.rpc('change_session_price', {
        p_session_id: session.id,
        p_hourly_price: targetPrice,
      })
      if (rpcError) throw rpcError
      setShowSwitchPrice(false)
      onRefresh()
    } catch (err) {
      setError(translateDbError(err, 'تعذر تغيير سعر الجلسة'))
    } finally {
      setIsSwitching(false)
    }
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
            <div className="text-[11px] text-on-surface-variant font-medium mt-0.5">
              مدة اللعب الفعلية
            </div>
            {isNearEnd && (
              <p className="text-xs text-maintenance mt-1">⚠️ الوقت المحدد قارب على الانتهاء</p>
            )}
            {isOverSixHours && (
              <p className="text-xs text-busy mt-1">⚠️ الجلسة تعدت 6 ساعات</p>
            )}

            {/* Session Stats Grid */}
            <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-card-border/60 text-xs">
              <div className="rounded-lg bg-surface-container-low border border-card-border/80 p-2 text-right">
                <span className="block text-[11px] text-on-surface-variant">المبلغ المستحق</span>
                <span className="text-base font-extrabold text-primary tabular-nums">
                  {formatEGP(currentPrice)}
                </span>
              </div>
              <div className="rounded-lg bg-surface-container-low border border-card-border/80 p-2 text-right">
                <span className="block text-[11px] text-on-surface-variant">فترات مكتملة (15 د)</span>
                <span className="text-base font-bold text-on-surface tabular-nums">
                  {completedPeriods}{' '}
                  <span className="text-[10px] font-normal text-on-surface-variant">
                    ({completedPeriods * 15} د)
                  </span>
                </span>
              </div>
            </div>

            {/* Next period countdown & Play type */}
            <div className="mt-2.5 space-y-1.5 text-xs text-on-surface-variant">
              <div className="flex items-center justify-between">
                <span>المتبقي للفترة القادمة</span>
                <span className="font-mono font-bold text-on-surface tabular-nums">
                  {formatTimer(secondsUntilNext)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>التعريفة الحالية</span>
                <span className="flex items-center gap-1.5">
                  {session.mode === 'open' ? 'وقت مفتوح' : `${session.planned_minutes} د`}
                  {' • '}
                  {currentPlayType === 'multi' ? (
                    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-primary bg-primary/10 rounded px-1.5 py-0.5">
                      <Users className="w-3 h-3" /> مالتي
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-on-surface-variant bg-surface-container rounded px-1.5 py-0.5">
                      <User className="w-3 h-3" /> فردي
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        ) : device.status === 'maintenance' ? (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-on-surface-variant">
            <Wrench className="w-4 h-4 text-maintenance" />
            <span>الجهاز في الصيانة</span>
          </div>
        ) : (
          <div className="flex items-center justify-center py-2">
            <span className="ps-icon h-24 w-24 text-available/30" aria-hidden="true" />
          </div>
        )}

        {/* Price per hour */}
        <div className="text-xs text-on-surface-variant text-center">
          فردي: {formatEGP(device.hourly_price)} / ساعة
          {device.hourly_price_multi ? ` | مالتي: ${formatEGP(device.hourly_price_multi)} / ساعة` : ''}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2">
          {device.status === 'available' && (
            <Button variant="secondary" fullWidth onClick={onStartSession}>
              <Play className="w-4 h-4" /> ابدأ جلسة
            </Button>
          )}
          {device.status === 'busy' && session && (
            <>
              {hasMultiPrice && (
                <Button
                  variant="ghost"
                  fullWidth
                  onClick={() => { setError(''); setShowSwitchPrice(true) }}
                  className="border border-outline-variant text-xs"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  {' '}تحويل إلى {currentPlayType === 'multi' ? 'فردي' : 'مالتي'}
                </Button>
              )}
              <Button
                variant="ghost"
                fullWidth
                onClick={() => setShowAddProduct(true)}
                className="border border-outline-variant"
              >
                <Plus className="w-4 h-4" /> أضف منتج
              </Button>
              <Button variant="danger" fullWidth onClick={() => setShowEndSession(true)}>
                <Square className="w-4 h-4" /> إنهاء الجلسة
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
              {device.status === 'maintenance' ? (
                <>
                  <CheckCircle2 className="w-4 h-4" /> إلغاء الصيانة
                </>
              ) : (
                <>
                  <Wrench className="w-4 h-4" /> صيانة
                </>
              )}
            </Button>
          )}
          {error && <p className="text-xs text-busy text-center">{error}</p>}
        </div>
      </Card>

      {/* End Session Modal */}
      {session && (
        <EndSessionModal
          isOpen={showEndSession}
          session={session}
          device={device}
          settings={settings}
          onClose={() => setShowEndSession(false)}
          onSuccess={() => {
            onSessionEnded?.(device.id)
            onRefresh()
          }}
        />
      )}

      {/* Add Product to Session Modal */}
      {session && (
        <AddProductToSessionModal
          isOpen={showAddProduct}
          sessionId={session.id}
          onClose={() => setShowAddProduct(false)}
          onSuccess={onRefresh}
        />
      )}

      {/* Switch Mode Modal — shows current & target play type clearly */}
      {session && hasMultiPrice && (
        <Modal
          isOpen={showSwitchPrice}
          onClose={() => { setShowSwitchPrice(false); setError('') }}
          title="تحويل نوع اللعب"
          size="sm"
        >
          <div className="flex flex-col gap-4">
            {/* Current mode */}
            <div className="rounded-lg bg-surface-container-low border border-card-border p-3">
              <p className="text-[11px] font-semibold text-on-surface-variant mb-1.5">الوضع الحالي</p>
              <div className="flex items-center gap-2">
                {currentPlayType === 'multi'
                  ? <Users className="w-4 h-4 text-primary" />
                  : <User className="w-4 h-4 text-on-surface-variant" />
                }
                <span className="font-bold text-on-surface">
                  {currentPlayType === 'multi' ? 'مالتي (متعدد اللاعبين)' : 'فردي'}
                </span>
                <span className="mr-auto text-sm text-on-surface-variant tabular-nums">
                  {formatEGP(session.hourly_price_snapshot)} / ساعة
                </span>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex items-center justify-center text-on-surface-variant">
              <ArrowLeftRight className="w-5 h-5" />
            </div>

            {/* Target mode */}
            <div className="rounded-lg bg-primary/5 border border-primary/30 p-3">
              <p className="text-[11px] font-semibold text-on-surface-variant mb-1.5">سيتم التحويل إلى</p>
              <div className="flex items-center gap-2">
                {currentPlayType === 'single'
                  ? <Users className="w-4 h-4 text-primary" />
                  : <User className="w-4 h-4 text-on-surface-variant" />
                }
                <span className="font-bold text-primary">
                  {currentPlayType === 'single' ? 'مالتي (متعدد اللاعبين)' : 'فردي'}
                </span>
                <span className="mr-auto text-sm text-primary tabular-nums">
                  {formatEGP(targetPrice)} / ساعة
                </span>
              </div>
            </div>

            {/* Explanation */}
            <p className="text-[11px] text-on-surface-variant bg-surface-container rounded-lg p-2.5 text-center leading-5">
              ⏱ العداد يستمر دون توقف<br />
              الوقت المنقضي يُحسب بالسعر القديم — الوقت الجديد بالسعر الجديد
            </p>

            {error && <p className="text-xs text-busy">{error}</p>}

            <div className="flex gap-2">
              <Button
                variant="ghost"
                fullWidth
                onClick={() => { setShowSwitchPrice(false); setError('') }}
                disabled={isSwitching}
              >
                إلغاء
              </Button>
              <Button
                variant="primary"
                fullWidth
                onClick={handleSwitchPrice}
                disabled={isSwitching}
                isLoading={isSwitching}
              >
                {currentPlayType === 'single' ? 'تحويل إلى مالتي' : 'تحويل إلى فردي'}
              </Button>
            </div>
          </div>
        </Modal>
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
})
