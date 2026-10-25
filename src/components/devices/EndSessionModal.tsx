import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { calcSessionPrice, formatEGP, formatTimerLong } from '@/lib/utils'
import type { Device, Session, AppSettings, OrderItem } from '@/types/database'

interface EndSessionModalProps {
  isOpen: boolean
  session: Session
  device: Device
  settings: AppSettings | null
  userId: string
  onClose: () => void
  onSuccess: () => void
}

export function EndSessionModal({
  isOpen,
  session,
  device,
  settings,
  userId,
  onClose,
  onSuccess,
}: EndSessionModalProps) {
  const [paidAmount, setPaidAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [sessionItems, setSessionItems] = useState<OrderItem[]>([])

  // Live timer
  useEffect(() => {
    if (!isOpen) return
    const calc = () =>
      setElapsed(Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000))
    calc()
    const interval = setInterval(calc, 1000)
    return () => clearInterval(interval)
  }, [isOpen, session.started_at])

  // Load existing order items for this session
  useEffect(() => {
    if (!isOpen) return
    const fetchItems = async () => {
      const { data } = await supabase
        .from('order_items')
        .select('*, order:orders!inner(session_id)')
        .eq('order.session_id', session.id)
      if (data) setSessionItems(data as OrderItem[])
    }
    fetchItems()
  }, [isOpen, session.id])

  const timePrice = calcSessionPrice(
    session.started_at,
    null,
    session.hourly_price_snapshot,
    settings?.rounding_mode
  )

  const productsTotal = sessionItems.reduce((sum, item) => sum + item.unit_price_snapshot * item.qty, 0)
  const grandTotal = timePrice + productsTotal
  const paid = parseFloat(paidAmount) || 0
  const remaining = grandTotal - paid

  const handleConfirm = async () => {
    setError('')
    if (paid > grandTotal) {
      setError(`المبلغ المدفوع (${formatEGP(paid)}) أكبر من الإجمالي (${formatEGP(grandTotal)})`)
      return
    }
    if (paid < 0) { setError('المبلغ غير صحيح'); return }

    setIsLoading(true)
    try {
      const now = new Date().toISOString()
      const actualMinutes = Math.ceil(elapsed / 60)

      // End session
      await supabase.from('sessions').update({
        status: 'closed',
        ended_at: now,
        time_amount: timePrice,
      }).eq('id', session.id)

      // Update device to available
      await supabase.from('devices').update({ status: 'available' }).eq('id', device.id)

      // Create order record
      const { data: orderData } = await supabase.from('orders').insert({
        session_id: session.id,
        total: grandTotal,
        paid_amount: paid,
        created_by: userId,
      }).select().single()

      // Record payment if any amount paid
      if (paid > 0 && orderData) {
        await supabase.from('payments').insert({
          session_id: session.id,
          order_id: orderData.id,
          amount: paid,
          created_by: userId,
        })
      }

      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message || 'حدث خطأ، حاول مرة أخرى')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`إنهاء جلسة — ${device.name}`} size="md">
      <div className="flex flex-col gap-4">
        {/* Time */}
        <div className="bg-surface-container rounded-lg p-4 text-center">
          <p className="text-sm text-on-surface-variant mb-1">مدة الجلسة</p>
          <p className="text-3xl font-extrabold tabular-nums text-primary">
            {formatTimerLong(elapsed)}
          </p>
        </div>

        {/* Bill breakdown */}
        <div className="border border-card-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-surface-container-high flex justify-between text-sm">
            <span className="text-on-surface-variant">قيمة الوقت</span>
            <span className="font-semibold tabular-nums">{formatEGP(timePrice)}</span>
          </div>

          {sessionItems.map(item => (
            <div key={item.id} className="px-4 py-2 border-t border-card-border flex justify-between text-sm">
              <span className="text-on-surface-variant">
                {item.product_name_snapshot} × {item.qty}
              </span>
              <span className="tabular-nums">{formatEGP(item.unit_price_snapshot * item.qty)}</span>
            </div>
          ))}

          <div className="px-4 py-3 border-t border-card-border flex justify-between font-bold text-base">
            <span>الإجمالي</span>
            <span className="tabular-nums text-primary">{formatEGP(grandTotal)}</span>
          </div>
        </div>

        {/* Payment input */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-on-surface-variant">المبلغ المدفوع</label>
          <input
            type="number"
            value={paidAmount}
            onChange={e => setPaidAmount(e.target.value)}
            placeholder={`${grandTotal}`}
            min="0"
            max={grandTotal}
            className="w-full px-3 py-3 rounded-DEFAULT bg-surface-container border border-outline-variant
              text-on-surface text-xl font-bold tabular-nums text-center
              focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          {paidAmount && (
            <div className={`flex justify-between text-sm px-1 font-semibold ${remaining > 0 ? 'text-busy' : 'text-available'}`}>
              <span>المتبقي</span>
              <span className="tabular-nums">
                {remaining > 0 ? `${formatEGP(remaining)} متبقي` : '✓ مسدد بالكامل'}
              </span>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-busy">{error}</p>}

        <Button
          variant="primary"
          fullWidth
          size="lg"
          onClick={handleConfirm}
          isLoading={isLoading}
        >
          تأكيد وتسجيل الدفع
        </Button>
      </div>
    </Modal>
  )
}
