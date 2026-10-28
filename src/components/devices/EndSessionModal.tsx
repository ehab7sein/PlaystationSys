import { useState, useEffect } from 'react'
import {
  Clock,
  Receipt,
  CheckCircle2,
  AlertTriangle,
  Tag,
  Lock,
  ShieldCheck,
  Banknote,
  Coins,
  FileText,
  Gamepad2,
  ArrowLeftRight,
  Users,
  User,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { translateDbError } from '@/lib/errors'
import {
  calcSessionPrice,
  calcSessionPeriodsBreakdown,
  formatEGP,
  formatTimerLong,
  getElapsedSeconds,
} from '@/lib/utils'
import type { Device, Session, AppSettings, OrderItem, SessionPricePeriod } from '@/types/database'

interface EndSessionModalProps {
  isOpen: boolean
  session: Session
  device: Device
  settings: AppSettings | null
  onClose: () => void
  onSuccess: () => void
}

interface ManagerOption {
  id: string
  name: string
  role: 'owner' | 'admin'
}

export function EndSessionModal({
  isOpen,
  session,
  device,
  settings,
  onClose,
  onSuccess,
}: EndSessionModalProps) {
  const { profile: currentProfile, canManagePrices, activeTenant } = useAuth()
  const tenantId = activeTenant?.id ?? null

  // Live timer & data
  const [elapsed, setElapsed] = useState(() => getElapsedSeconds(session.started_at))
  const [sessionItems, setSessionItems] = useState<OrderItem[]>([])
  const [managers, setManagers] = useState<ManagerOption[]>([])
  const [pricePeriods, setPricePeriods] = useState<SessionPricePeriod[]>([])

  // Payment calculation states
  const [receivedInput, setReceivedInput] = useState('')
  const [customerNote, setCustomerNote] = useState('')

  // Discount states
  const [showDiscount, setShowDiscount] = useState(false)
  const [discountVal, setDiscountVal] = useState('')
  const [discountReason, setDiscountReason] = useState('')
  const [managerId, setManagerId] = useState('')
  const [managerPass, setManagerPass] = useState('')
  const [discountApproved, setDiscountApproved] = useState(false)
  const [approvedByName, setApprovedByName] = useState('')
  const [approvalError, setApprovalError] = useState('')

  // Loading & error
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Live timer
  useEffect(() => {
    if (!isOpen) return
    const calc = () => setElapsed(getElapsedSeconds(session.started_at))
    calc()
    const interval = setInterval(calc, 500)
    return () => clearInterval(interval)
  }, [isOpen, session.started_at])

  // Load existing order items for this session
  useEffect(() => {
    if (!isOpen || !tenantId) return
    const fetchItems = async () => {
      const { data } = await supabase
        .from('order_items')
        .select('*, order:orders!inner(session_id)')
        .eq('tenant_id', tenantId)
        .eq('order.session_id', session.id)
      if (data) setSessionItems(data as OrderItem[])
    }
    fetchItems()
  }, [isOpen, session.id, tenantId])

  // Load price periods for breakdown display
  useEffect(() => {
    if (!isOpen || !tenantId) return
    const fetchPeriods = async () => {
      const { data } = await supabase
        .from('session_price_history')
        .select('*')
        .eq('session_id', session.id)
        .order('started_at', { ascending: true })
      if (data) setPricePeriods(data as SessionPricePeriod[])
    }
    fetchPeriods()
  }, [isOpen, session.id, tenantId])

  // Load managers for discount approval (workers only)
  useEffect(() => {
    if (!isOpen || !tenantId || canManagePrices) return
    const fetchManagers = async () => {
      const { data } = await supabase
        .from('memberships')
        .select('user_id, role, profile:profiles!inner(id, name, is_active)')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('role', ['admin', 'owner'])

      const rows = (data ?? []) as unknown as Array<{
        user_id: string
        role: 'owner' | 'admin'
        profile: { id: string; name: string; is_active: boolean } | null
      }>

      const options = rows
        .filter(row => row.profile?.is_active)
        .map(row => ({
          id: row.user_id,
          name: row.profile?.name ?? 'مدير',
          role: row.role,
        }))

      setManagers(options)
      if (options.length > 0) setManagerId(options[0].id)
    }
    fetchManagers()
  }, [isOpen, tenantId, canManagePrices])

  // Reset states on open/close
  useEffect(() => {
    if (isOpen) {
      setReceivedInput('')
      setCustomerNote('')
      setShowDiscount(false)
      setDiscountVal('')
      setDiscountReason('')
      setDiscountApproved(false)
      setApprovedByName('')
      setApprovalError('')
      setError('')
    }
  }, [isOpen])

  // 1. Calculations strictly done by system - حساب حسب فترات السعر
  const [timePrice, setTimePrice] = useState(0)

  useEffect(() => {
    if (!isOpen || !tenantId) return
    const fetchPrice = async () => {
      try {
        const { data } = await supabase.rpc('calc_session_total_by_periods', {
          p_session_id: session.id,
          p_rounding_mode: settings?.rounding_mode || 'nearest_5_pounds',
          p_end_time: new Date().toISOString(),
        })
        if (typeof data === 'number') {
          setTimePrice(data)
        } else {
          const breakdown = calcSessionPeriodsBreakdown(pricePeriods, session.started_at, session.hourly_price_snapshot)
          setTimePrice(breakdown.totalCost)
        }
      } catch {
        const breakdown = calcSessionPeriodsBreakdown(pricePeriods, session.started_at, session.hourly_price_snapshot)
        setTimePrice(breakdown.totalCost)
      }
    }
    fetchPrice()
    const interval = setInterval(fetchPrice, 1000)
    return () => clearInterval(interval)
  }, [isOpen, session.id, tenantId, settings?.rounding_mode, pricePeriods, session.started_at, session.hourly_price_snapshot])
  const productsTotal = sessionItems.reduce(
    (sum, item) => sum + item.unit_price_snapshot * item.qty,
    0
  )
  const grossTotal = timePrice + productsTotal

  // Discount calculation. Managers can discount directly; workers must have
  // a manager approve it (and the RPC verifies the password again on submit).
  const isManager = canManagePrices
  const parsedDiscount = parseFloat(discountVal) || 0
  const validDiscount =
    discountApproved || isManager ? Math.min(parsedDiscount, grossTotal) : 0
  const netDue = Math.max(0, grossTotal - validDiscount)

  // Received cash & reconciliation
  const receivedCash = netDue // سداد كامل فقط
  const actualCashCollected = netDue // يدخل الخزنة كامل المبلغ
  const changeToCustomer = 0
  const remainingDebt = 0

  // Manager approval for a cashier's discount
  const handleApproveDiscount = async () => {
    setApprovalError('')
    if (parsedDiscount <= 0) {
      setApprovalError('يرجى تحديد قيمة الخصم')
      return
    }
    if (!discountReason.trim()) {
      setApprovalError('يرجى كتابة سبب الخصم')
      return
    }

    if (isManager) {
      setDiscountApproved(true)
      setApprovedByName(currentProfile?.name || 'المدير')
      return
    }

    if (!managerId || !managerPass.trim()) {
      setApprovalError('يرجى اختيار المدير وإدخال كلمة المرور للاعتماد')
      return
    }

    // The RPC checks the bcrypt hash, same-tenant membership and manager role.
    const { data, error: verifyError } = await supabase.rpc('verify_manager_password', {
      p_manager_id: managerId,
      p_password: managerPass.trim(),
    })

    const result = data as { ok?: boolean; name?: string } | null
    if (verifyError || !result?.ok) {
      setApprovalError('كلمة مرور المدير غير صحيحة!')
      return
    }

    setDiscountApproved(true)
    setApprovedByName(result.name || 'مدير')
    // Keep managerPass: close_session verifies it again server-side.
  }

  // Handle final submission
  const handleConfirm = async () => {
    setError('')

    if (parsedDiscount > 0 && !isManager && !discountApproved) {
      setError('يجب اعتماد الخصم من المدير قبل الإغلاق')
      return
    }
    if (parsedDiscount > 0 && !discountReason.trim()) {
      setError('يرجى كتابة سبب الخصم')
      return
    }

    setIsLoading(true)
    try {
      // One atomic RPC: recalculates time + products from the database,
      // verifies the manager password, updates the order, records cash,
      // frees the device and writes the immutable audit log.
      const { error: rpcError } = await supabase.rpc('close_session', {
        p_session_id: session.id,
        p_received: netDue,
        p_discount: validDiscount,
        p_discount_reason: validDiscount > 0 ? discountReason.trim() : null,
        p_manager_id: validDiscount > 0 && !isManager ? managerId : null,
        p_manager_password: validDiscount > 0 && !isManager ? managerPass.trim() : null,
        p_note: customerNote.trim() || null,
      })

      if (rpcError) throw rpcError

      onSuccess()
      onClose()
    } catch (err) {
      setError(translateDbError(err, 'حدث خطأ أثناء إنهاء الجلسة، حاول مرة أخرى'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="إنهاء الجلسة والتحصيل"
      size="xl"
      footer={
        <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-baseline justify-between sm:justify-start gap-2">
            <span className="text-xs font-semibold text-on-surface-variant">الصافي المطلوب</span>
            <span className="text-2xl font-extrabold tabular-nums font-mono text-primary">
              {formatEGP(netDue)}
            </span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button variant="ghost" onClick={onClose} disabled={isLoading} className="flex-1 sm:flex-none">
              إلغاء
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={handleConfirm}
              disabled={isLoading}
              className="flex-1 sm:flex-none sm:min-w-[240px]"
            >
              {isLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-primary-dark border-t-transparent rounded-full animate-spin" />
                  <span>جاري الإغلاق...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  <span>تأكيد الإغلاق والتحصيل</span>
                </>
              )}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">

        {/* ── Hero: live timer + time charge ─────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-card-border bg-surface-container-low px-4 py-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant">
              <Clock className="w-3.5 h-3.5 text-primary" /> مدة اللعب
            </span>
            <p className="mt-1 text-[28px] leading-8 font-extrabold tabular-nums font-mono text-primary">
              {formatTimerLong(elapsed)}
            </p>
          </div>
          <div className="rounded-lg border border-card-border bg-surface-container-low px-4 py-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant">
              <Gamepad2 className="w-3.5 h-3.5 text-secondary" />
              <span className="truncate">{device.name}</span>
            </span>
            <p className="mt-1 text-[28px] leading-8 font-extrabold tabular-nums font-mono text-on-surface">
              {formatEGP(timePrice)}
            </p>
            <p className="text-[11px] text-on-surface-variant">
              {pricePeriods.length > 1
                ? `${pricePeriods.length} فترات لعب منفصلة · ${Math.floor(elapsed / 900)} فترات مكتملة (${Math.floor(elapsed / 60)} د)`
                : `${formatEGP(session.hourly_price_snapshot)} / ساعة · ${Math.floor(elapsed / 900)} فترات مكتملة (15 د)${
                    device.hourly_price_multi && Number(session.hourly_price_snapshot) === Number(device.hourly_price_multi)
                      ? ' · مالتي'
                      : ' · فردي'
                  }`}
            </p>
          </div>
        </div>

        {/* ── Price periods breakdown (when switched mid-session) ── */}
        {pricePeriods.length > 1 && (
          <div className="rounded-lg border border-card-border bg-surface-container-low overflow-hidden">
            <div className="flex items-center justify-between border-b border-card-border bg-surface-container/60 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-bold text-on-surface">تفصيل فترات اللعب (فردي / مالتي)</span>
              </div>
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-bold text-primary">
                {pricePeriods.length} فترات
              </span>
            </div>
            <div className="divide-y divide-card-border/60">
              {pricePeriods.map((period, idx) => {
                const pStart = new Date(period.started_at).getTime()
                const pEnd = period.ended_at ? new Date(period.ended_at).getTime() : Date.now()
                const pSeconds = Math.max(0, Math.floor((pEnd - pStart) / 1000))
                const periodMins = Math.floor(pSeconds / 60)
                const periodSecs = pSeconds % 60
                const completedPeriods = Math.floor(pSeconds / 900)
                const periodCost = calcSessionPrice(
                  period.started_at,
                  period.ended_at,
                  period.hourly_price
                )
                const isMulti = period.play_type === 'multi'

                return (
                  <div key={period.id || idx} className="flex items-center justify-between px-4 py-2.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded text-[11px] ${
                        isMulti ? 'bg-primary/15 text-primary' : 'bg-surface-container text-on-surface-variant'
                      }`}>
                        {isMulti ? <Users className="w-3 h-3" /> : <User className="w-3 h-3" />}
                        {isMulti ? 'مالتي' : 'فردي'}
                      </span>
                      <span className="text-on-surface-variant tabular-nums">
                        {periodMins > 0 ? `${periodMins} د` : ''}{periodSecs > 0 ? ` ${periodSecs} ث` : ''}{periodMins === 0 && periodSecs === 0 ? '0 د' : ''} ({formatEGP(period.hourly_price)}/س) · {completedPeriods} فترات (15 د)
                      </span>
                      {!period.ended_at && (
                        <span className="text-[10px] bg-available/15 text-available px-1.5 py-0.2 rounded font-semibold">
                          الفترة الحالية
                        </span>
                      )}
                    </div>
                    <span className="font-bold tabular-nums text-on-surface">
                      {formatEGP(periodCost)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* ── Itemized bill ──────────────────────────────── */}
          <section className="flex flex-col overflow-hidden rounded-lg border border-card-border bg-card">
            <header className="flex items-center justify-between border-b border-card-border bg-surface-container/60 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-bold text-on-surface">
                <Receipt className="w-4 h-4 text-primary" /> تفاصيل الحساب
              </span>
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary">
                حساب تلقائي
              </span>
            </header>

            <div className="flex-1 divide-y divide-card-border/60 text-sm">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary" />
                  <span className="text-on-surface">وقت اللعب</span>
                  <span className="text-xs text-on-surface-variant">({Math.ceil(elapsed / 60)} د)</span>
                </div>
                <span className="font-bold tabular-nums text-on-surface">{formatEGP(timePrice)}</span>
              </div>

              {sessionItems.map(item => (
                <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-2 h-2 shrink-0 rounded-full bg-tertiary" />
                    <span className="truncate text-on-surface">{item.product_name_snapshot}</span>
                    <span className="shrink-0 rounded bg-surface-container-high px-1.5 py-0.5 text-[11px] tabular-nums text-on-surface-variant">
                      ×{item.qty}
                    </span>
                  </div>
                  <span className="tabular-nums text-on-surface-variant">
                    {formatEGP(item.unit_price_snapshot * item.qty)}
                  </span>
                </div>
              ))}

              {sessionItems.length === 0 && (
                <p className="px-4 py-3 text-xs text-on-surface-variant">
                  لا توجد طلبات كافيه على هذه الجلسة
                </p>
              )}
            </div>

            <div className="space-y-2 border-t border-card-border bg-surface-container-low px-4 py-3">
              <div className="flex items-center justify-between text-xs text-on-surface-variant">
                <span>الإجمالي الأساسي</span>
                <span className="font-semibold tabular-nums text-on-surface">{formatEGP(grossTotal)}</span>
              </div>

              {validDiscount > 0 && (
                <div className="flex items-center justify-between text-xs font-semibold text-tertiary">
                  <span className="flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5" /> خصم معتمد
                  </span>
                  <span className="tabular-nums">- {formatEGP(validDiscount)}</span>
                </div>
              )}

              <div className="flex items-end justify-between border-t border-card-border/70 pt-2">
                <span className="text-xs font-semibold text-on-surface-variant">الصافي للتحصيل</span>
                <span className="text-2xl font-extrabold tabular-nums font-mono text-primary">
                  {formatEGP(netDue)}
                </span>
              </div>
            </div>
          </section>

          {/* ── Cash collection ────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <div className="space-y-3 rounded-lg border border-card-border bg-surface-container-low p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-bold text-on-surface">
                  <Banknote className="w-4 h-4 text-available" /> المبلغ المحصّل نقدًا
                </span>
                <span className="text-[11px] text-on-surface-variant">الخزنة الفعلية</span>
              </div>

              <div className="relative">
                <input
                  type="number"
                  value={receivedInput}
                  onChange={e => setReceivedInput(e.target.value)}
                  placeholder="0"
                  min="0"
                  step="any"
                  autoFocus
                  className="w-full min-h-[56px] rounded-DEFAULT border-2 border-outline-variant bg-surface-container px-12 text-center text-3xl font-extrabold tabular-nums font-mono text-on-surface transition-colors placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-on-surface-variant">
                  ج.م
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setReceivedInput(String(netDue))}
                  className="col-span-2 flex min-h-[44px] items-center justify-center gap-1.5 rounded-DEFAULT border border-primary/40 bg-primary/15 text-sm font-bold text-primary transition-colors hover:bg-primary/25 active:scale-[0.98]"
                >
                  <CheckCircle2 className="w-4 h-4" /> سداد كامل ({formatEGP(netDue)})
                </button>
                {[50, 100, 200, 500].map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setReceivedInput(String(val))}
                    className="min-h-[44px] rounded-DEFAULT border border-card-border bg-surface-container text-sm font-bold tabular-nums text-on-surface-variant transition-colors hover:border-outline-variant hover:text-on-surface active:scale-[0.98]"
                  >
                    {val} ج
                  </button>
                ))}
              </div>

              {receivedInput !== '' && (
                <div className="space-y-2">
                  {changeToCustomer > 0 && (
                    <div className="flex items-center justify-between rounded-DEFAULT border border-available/30 bg-available/10 px-3 py-2 text-sm font-bold text-available">
                      <span className="flex items-center gap-1.5">
                        <Coins className="w-4 h-4" /> الباقي للعميل
                      </span>
                      <span className="tabular-nums font-mono">{formatEGP(changeToCustomer)}</span>
                    </div>
                  )}

                  {remainingDebt === 0 ? (
                    <div className="flex items-center justify-between rounded-DEFAULT border border-available/30 bg-available/10 px-3 py-2 text-xs font-bold text-available">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" /> مدفوعة بالكامل
                      </span>
                      <span className="tabular-nums">داخل الخزنة {formatEGP(actualCashCollected)}</span>
                    </div>
                  ) : (
                    <div className="space-y-1 rounded-DEFAULT border border-busy/40 bg-busy/10 px-3 py-2.5 text-busy">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span className="flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4" /> تحصيل جزئي
                        </span>
                        <span className="text-sm font-extrabold tabular-nums font-mono">
                          {formatEGP(remainingDebt)}
                        </span>
                      </div>
                      <p className="text-[11px] leading-4 opacity-90">
                        سيتم تسجيل الفارق في تقرير فروق الخزنة حتى تسويته.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2 rounded-lg border border-card-border bg-surface-container-low p-4">
              <label className="flex items-center gap-1.5 text-xs font-bold text-on-surface-variant">
                <FileText className="w-3.5 h-3.5" />
                <span>ملاحظات إضافية (اختياري)</span>
              </label>
              <input
                type="text"
                value={customerNote}
                onChange={e => setCustomerNote(e.target.value)}
                placeholder="أي ملاحظة على الفاتورة"
                className="min-h-[48px] w-full rounded-DEFAULT border border-outline-variant bg-surface-container px-3 text-sm text-on-surface transition-colors placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:border-primary focus:ring-primary/20"
              />
            </div>

            {/* Discount with manager approval */}
            <div className="overflow-hidden rounded-lg border border-card-border bg-surface-container-low">
              <button
                type="button"
                onClick={() => setShowDiscount(!showDiscount)}
                className="flex min-h-[48px] w-full items-center justify-between px-4 text-sm font-bold text-on-surface transition-colors hover:bg-surface-container"
              >
                <span className="flex items-center gap-1.5">
                  <Tag className="w-4 h-4 text-tertiary" /> خصم على الفاتورة
                </span>
                {discountApproved ? (
                  <span className="flex items-center gap-1 rounded-full bg-available/15 px-2.5 py-0.5 text-[11px] font-bold text-available">
                    <ShieldCheck className="w-3.5 h-3.5" /> {approvedByName}
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-on-surface-variant">
                    {showDiscount ? 'إغلاق' : 'إضافة'}
                  </span>
                )}
              </button>

              {showDiscount && (
                <div className="space-y-3 border-t border-card-border p-4">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-on-surface-variant">
                        قيمة الخصم (ج.م)
                      </label>
                      <input
                        type="number"
                        value={discountVal}
                        disabled={discountApproved}
                        onChange={e => {
                          setDiscountVal(e.target.value)
                          setDiscountApproved(false)
                        }}
                        placeholder="0"
                        min="1"
                        max={grossTotal}
                        className="min-h-[44px] w-full rounded-DEFAULT border border-outline-variant bg-surface-container px-3 text-sm tabular-nums text-on-surface focus:border-primary focus:outline-none disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-on-surface-variant">
                        سبب الخصم (إلزامي)
                      </label>
                      <input
                        type="text"
                        value={discountReason}
                        disabled={discountApproved}
                        onChange={e => setDiscountReason(e.target.value)}
                        placeholder="عميل مميز / تعويض"
                        className="min-h-[44px] w-full rounded-DEFAULT border border-outline-variant bg-surface-container px-3 text-sm text-on-surface focus:border-primary focus:outline-none disabled:opacity-60"
                      />
                    </div>
                  </div>

                  {!discountApproved && (
                    <div className="space-y-2 rounded-DEFAULT border border-card-border bg-surface-container p-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-on-surface">
                        <Lock className="w-3.5 h-3.5 text-tertiary" />
                        اعتماد الإدارة مطلوب لصلاحية العامل
                      </div>

                      {isManager ? (
                        <div className="flex items-center justify-between gap-2 text-[11px] text-available">
                          <span>لديك صلاحية اعتماد الخصم</span>
                          <Button size="sm" variant="outline" onClick={handleApproveDiscount}>
                            تأكيد الخصم
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <select
                            value={managerId}
                            onChange={e => setManagerId(e.target.value)}
                            className="min-h-[44px] w-full rounded-DEFAULT border border-outline-variant bg-surface-container-high px-2 text-xs text-on-surface focus:border-primary focus:outline-none"
                          >
                            {managers.map(m => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.role === 'admin' ? 'مدير' : 'مالك'})
                              </option>
                            ))}
                          </select>
                          <input
                            type="password"
                            placeholder="كلمة مرور المدير"
                            value={managerPass}
                            onChange={e => setManagerPass(e.target.value)}
                            className="min-h-[44px] w-full rounded-DEFAULT border border-outline-variant bg-surface-container-high px-2 text-xs text-on-surface focus:border-primary focus:outline-none"
                          />
                          <Button size="sm" variant="primary" fullWidth onClick={handleApproveDiscount}>
                            اعتماد الخصم
                          </Button>
                        </div>
                      )}

                      {approvalError && <p className="text-[11px] text-busy">{approvalError}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-DEFAULT border border-busy/30 bg-busy/10 px-3 py-2.5 text-xs font-semibold text-busy">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}
