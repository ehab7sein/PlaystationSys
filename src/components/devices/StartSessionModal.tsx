import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { translateDbError } from '@/lib/errors'
import type { Device } from '@/types/database'

interface StartSessionModalProps {
  isOpen: boolean
  device: Device
  onClose: () => void
  onSuccess: (mode: SessionMode, plannedMinutes: number | null, sessionId?: string) => void
}

type SessionMode = 'open' | 'fixed'
type PlayType = 'single' | 'multi'
const FIXED_DURATIONS = [30, 60, 120] as const

export function StartSessionModal({
  isOpen,
  device,
  onClose,
  onSuccess,
}: StartSessionModalProps) {
  const [mode, setMode] = useState<SessionMode>('open')
  const [playType, setPlayType] = useState<PlayType>('single')
  const [plannedMinutes, setPlannedMinutes] = useState<number | null>(null)
  const [customMinutes, setCustomMinutes] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const hasMultiPrice = device.hourly_price_multi && Number(device.hourly_price_multi) > 0
  const currentPrice = playType === 'multi' && hasMultiPrice ? Number(device.hourly_price_multi) : Number(device.hourly_price)

  const handleStart = async () => {
    setError('')
    let finalMinutes: number | null = null

    if (mode === 'fixed') {
      finalMinutes = plannedMinutes ?? (customMinutes ? parseInt(customMinutes) : null)
      if (!finalMinutes || finalMinutes < 1) {
        setError('اختر مدة الجلسة')
        return
      }
    }

    setIsLoading(true)
    try {
      // The RPC reads the hourly price and tenant from the device row, so the
      // browser can never start a session at a tampered price or in another
      // tenant.
      const { data: newSessionId, error: rpcError } = await supabase.rpc('start_session', {
        p_device_id: device.id,
        p_mode: mode,
        p_planned_minutes: finalMinutes,
        p_hourly_price: currentPrice,
      } as any)

      if (rpcError) throw rpcError

      onSuccess(mode, finalMinutes, newSessionId as string)
      onClose()
    } catch (err) {
      setError(translateDbError(err, 'تعذر بدء الجلسة، حاول مرة أخرى'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setMode('open')
    setPlayType('single')
    setPlannedMinutes(null)
    setCustomMinutes('')
    setError('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`بدء جلسة — ${device.name}`}>
      <div className="flex flex-col gap-5">
        {/* Session type */}
        <div>
          <p className="text-sm font-semibold text-on-surface-variant mb-3">نوع الجلسة</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: 'open' as const, label: '⏱ وقت مفتوح' },
              { value: 'fixed' as const, label: '⏰ مدة محددة' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => {
                  setMode(opt.value)
                  setPlannedMinutes(null)
                }}
                className={`py-3 rounded-lg font-semibold border transition-colors ${
                  mode === opt.value
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'border-outline-variant text-on-surface-variant hover:border-primary/50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Play type */}
        <div>
          <p className="text-sm font-semibold text-on-surface-variant mb-3">نوع اللعب</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: 'single' as const, label: 'فردي' },
              { value: 'multi' as const, label: 'متعدد / مالتي' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setPlayType(opt.value)}
                disabled={opt.value === 'multi' && !hasMultiPrice}
                className={`py-3 rounded-lg font-semibold border transition-colors ${
                  playType === opt.value
                    ? 'bg-primary/10 border-primary text-primary'
                    : opt.value === 'multi' && !hasMultiPrice
                    ? 'border-outline-variant text-on-surface-variant/40 cursor-not-allowed'
                    : 'border-outline-variant text-on-surface-variant hover:border-primary/50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {playType === 'multi' && hasMultiPrice && (
            <p className="text-xs text-primary mt-2">سيتم الحساب بسعر متعدد اللاعبين</p>
          )}
        </div>

        {/* Duration selection */}
        {mode === 'fixed' && (
          <div>
            <p className="text-sm font-semibold text-on-surface-variant mb-3">المدة</p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {FIXED_DURATIONS.map(d => (
                <button
                  key={d}
                  onClick={() => {
                    setPlannedMinutes(d)
                    setCustomMinutes('')
                  }}
                  className={`py-3 rounded-lg font-semibold border transition-colors text-sm ${
                    plannedMinutes === d
                      ? 'bg-primary/10 border-primary text-primary'
                      : 'border-outline-variant text-on-surface-variant hover:border-primary/50'
                  }`}
                >
                  {d < 60 ? `${d} دقيقة` : `${d / 60} ساعة`}
                </button>
              ))}
            </div>
            <input
              type="number"
              placeholder="أو أدخل دقائق مخصصة..."
              value={customMinutes}
              onChange={e => {
                setCustomMinutes(e.target.value)
                setPlannedMinutes(null)
              }}
              min="1"
              className="w-full px-3 py-2.5 rounded-DEFAULT bg-surface-container border border-outline-variant
                text-on-surface placeholder:text-on-surface-variant/50
                focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
        )}

        {/* Price info */}
        <div className="bg-surface-container rounded-lg px-4 py-3 text-sm text-on-surface-variant">
          سعر الساعة ({playType === 'multi' ? 'متعدد اللاعبين' : 'فردي'}):{' '}
          <span className="font-bold text-on-surface">{currentPrice} جنيه</span>
        </div>

        {error && <p className="text-sm text-busy">{error}</p>}

        <Button
          variant="secondary"
          fullWidth
          size="lg"
          onClick={handleStart}
          isLoading={isLoading}
        >
          ابدأ الجلسة
        </Button>
      </div>
    </Modal>
  )
}
