import { useState, useEffect, useCallback } from 'react'
import { 
  TrendingUp, 
  DollarSign, 
  AlertTriangle, 
  CheckCircle2, 
  ShieldAlert, 
  Clock, 
  User, 
  Check, 
  Receipt
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { StatCard, Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { formatEGP } from '@/lib/utils'
import { translateDbError } from '@/lib/errors'
import { getTenantSettings } from '@/lib/data-service'
import type { AppSettings, Order, AuditLog } from '@/types/database'

type FilterType = 'today' | 'yesterday' | 'week' | 'custom'
type ViewTab = 'summary' | 'discrepancies' | 'audit_logs'

interface PaymentRecord {
  id: string
  created_at: string
  amount: number
  session_id: string | null
  order_id: string | null
  creator?: { name: string }
}

export function RevenuePage() {
  const { canViewAllRevenue, activeTenant } = useAuth()
  const tenantId = activeTenant?.id ?? null
  const [filter, setFilter] = useState<FilterType>('today')
  const [activeTab, setActiveTab] = useState<ViewTab>('summary')

  // Financial figures
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [sessionRevenue, setSessionRevenue] = useState(0)
  const [productRevenue, setProductRevenue] = useState(0)
  const [totalBilled, setTotalBilled] = useState(0)
  const [actualCashCollected, setActualCashCollected] = useState(0)
  const [totalShortage, setTotalShortage] = useState(0)

  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [settings, setSettings] = useState<AppSettings | null>(null)

  // Partial payment settlement removed - full payment only

  const fetchData = useCallback(async (currentSettings?: AppSettings | null) => {
    if (!tenantId) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setLoadError('')

    // Resolve settings: use the argument if provided, fall back to state.
    // This avoids a stale-closure race when settings just arrived.
    const resolvedSettings = currentSettings !== undefined ? currentSettings : settings

    // Compute date range using the resolved settings value.
    const dayStartHour = resolvedSettings?.day_start_hour ?? 6
    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setHours(dayStartHour, 0, 0, 0)
    if (now.getHours() < dayStartHour) todayStart.setDate(todayStart.getDate() - 1)

    let from: string
    let to: string
    if (filter === 'today') {
      from = todayStart.toISOString()
      to = now.toISOString()
    } else if (filter === 'yesterday') {
      const start = new Date(todayStart)
      start.setDate(start.getDate() - 1)
      from = start.toISOString()
      to = todayStart.toISOString()
    } else if (filter === 'week') {
      const start = new Date(todayStart)
      start.setDate(start.getDate() - 7)
      from = start.toISOString()
      to = now.toISOString()
    } else {
      from = todayStart.toISOString()
      to = now.toISOString()
    }

    // Run all three fetches in parallel.
    const [paymentsRes, ordersRes, logsRes] = await Promise.all([
      supabase
        .from('payments')
        .select('*, creator:profiles(name)')
        .eq('tenant_id', tenantId)
        .gte('created_at', from)
        .lte('created_at', to)
        .order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select('*, session:sessions(*, device:devices(name)), creator:profiles(name)')
        .eq('tenant_id', tenantId)
        .gte('created_at', from)
        .lte('created_at', to)
        .order('created_at', { ascending: false }),
      supabase
        .from('audit_logs')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('created_at', from)
        .lte('created_at', to)
        .order('created_at', { ascending: false }),
    ])

    if (paymentsRes.error || ordersRes.error) {
      setLoadError(
        translateDbError(
          paymentsRes.error ?? ordersRes.error,
          'تعذر تحميل تقرير الإيرادات'
        )
      )
      setIsLoading(false)
      return
    }

    if (logsRes.error) {
      setLoadError(translateDbError(logsRes.error, 'تعذر تحميل سجل الرقابة'))
    } else {
      setAuditLogs((logsRes.data ?? []) as AuditLog[])
    }

    const paymentsData = paymentsRes.data ?? []
    setPayments(paymentsData as PaymentRecord[])
    const sessionsCash = paymentsData.filter(p => p.session_id !== null)
    const productsCash = paymentsData.filter(p => p.session_id === null)
    setSessionRevenue(sessionsCash.reduce((s, p) => s + p.amount, 0))
    setProductRevenue(productsCash.reduce((s, p) => s + p.amount, 0))
    setActualCashCollected(paymentsData.reduce((s, p) => s + p.amount, 0))

    const ordersData = ordersRes.data ?? []
    setOrders(ordersData as Order[])
    setTotalBilled(ordersData.reduce((s, o) => s + o.total, 0))
    setTotalShortage(
      ordersData.reduce((s, o) => {
        const diff = o.total - o.paid_amount
        return diff > 0 ? s + diff : s
      }, 0)
    )

    setIsLoading(false)
  }, [filter, settings, tenantId])

  // Load settings once per tenant, then immediately fetch report data so
  // everything happens in a single round-trip sequence instead of two.
  useEffect(() => {
    if (!tenantId) return
    getTenantSettings(tenantId)
      .then(s => {
        setSettings(s)
        fetchData(s)
      })
      .catch(error => {
        setLoadError(translateDbError(error, 'تعذر تحميل إعدادات المحل'))
        fetchData(null)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  // Re-fetch whenever the filter changes (settings are already loaded).
  useEffect(() => {
    if (!tenantId) return
    // Skip the very first render — the effect above already kicked off the
    // initial load together with the settings fetch.
    if (settings === null) return
    fetchData()
  // fetchData is stable when filter/settings/tenantId don't change.
  }, [filter, fetchData, settings, tenantId])

  // Partial payments disabled - full payment only
  const uncollectedOrders: Order[] = []

  const FILTERS: { value: FilterType; label: string }[] = [
    { value: 'today', label: 'اليوم' },
    ...(canViewAllRevenue
      ? [
          { value: 'yesterday' as const, label: 'أمس' },
          { value: 'week' as const, label: 'آخر 7 أيام' },
        ]
      : []),
  ]

  return (
    <div className="space-y-6">
      {/* Header & Date Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-on-surface">تقرير الإيرادات ومطابقة الخزنة</h1>
          <p className="text-xs text-on-surface-variant mt-0.5">
            متابعة تحصيل الورديات، مقارنة المستحق الفعلي بالخزنة، والرقابة على فروق العمال
          </p>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                filter === f.value
                  ? 'bg-primary text-primary-dark shadow-md shadow-primary/20'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {f.label}
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => fetchData()} disabled={isLoading}>
            تحديث
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-busy/30 bg-busy/10 px-4 py-3 text-sm text-busy">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Main Reconciliation KPI Cards (مقارنة الخزنة) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Total Calculated / Billed */}
        <StatCard
          title="إجمالي المستحق تلقائياً"
          value={formatEGP(totalBilled)}
          icon={<Receipt className="w-5 h-5 text-primary" />}
          valueClassName="text-primary font-mono"
        />

        {/* 2. Actual Cash in Drawer */}
        <StatCard
          title="النقدية المحصلة بالخزنة"
          value={formatEGP(actualCashCollected)}
          icon={<DollarSign className="w-5 h-5 text-available" />}
          valueClassName="text-available font-mono"
        />

        {/* 3. Shortage / Discrepancy */}
        <Card className={`flex flex-col justify-between ${totalShortage > 0 ? 'border-busy/40 bg-busy/5' : 'border-available/30 bg-available/5'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-on-surface-variant">
              {totalShortage > 0 ? 'عجز / متبقي لم يُحصّل' : 'حالة مطابقة الخزنة'}
            </span>
            {totalShortage > 0 ? (
              <AlertTriangle className="w-5 h-5 text-busy" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-available" />
            )}
          </div>
          <div>
            <p className={`text-2xl font-black font-mono tabular-nums ${totalShortage > 0 ? 'text-busy' : 'text-available'}`}>
              {totalShortage > 0 ? formatEGP(totalShortage) : 'مطابقة 100%'}
            </p>
            <p className="text-[11px] text-on-surface-variant mt-1">
              {totalShortage > 0 ? `يوجد ${uncollectedOrders.length} فواتير معلقة` : 'لا توجد أي فروقات نقدية'}
            </p>
          </div>
        </Card>

        {/* 4. Total Operations */}
        <StatCard
          title="إجمالي عدد العمليات"
          value={`${orders.length} عملية`}
          icon={<TrendingUp className="w-5 h-5 text-secondary" />}
        />
      </div>

      {/* Tabs navigation */}
      <div className="flex items-center gap-2 border-b border-card-border pb-0 overflow-x-auto">
        <button
          onClick={() => setActiveTab('summary')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors -mb-px flex items-center gap-1.5 ${
            activeTab === 'summary'
              ? 'border-primary text-primary'
              : 'border-transparent text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>سجل المقبوضات النقدية ({payments.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('discrepancies')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors -mb-px flex items-center gap-1.5 ${
            activeTab === 'discrepancies'
              ? 'border-busy text-busy font-black'
              : 'border-transparent text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <AlertTriangle className="w-4 h-4 text-busy" />
          <span>فروق التحصيل والآجل ({uncollectedOrders.length})</span>
          {uncollectedOrders.length > 0 && (
            <span className="px-1.5 py-0.2 bg-busy text-white rounded-full text-[10px]">
              {uncollectedOrders.length}
            </span>
          )}
        </button>

        {canViewAllRevenue && (
          <button
            onClick={() => setActiveTab('audit_logs')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors -mb-px flex items-center gap-1.5 ${
              activeTab === 'audit_logs'
                ? 'border-tertiary text-tertiary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <ShieldAlert className="w-4 h-4 text-tertiary" />
            <span>سجل الرقابة والتعديلات (Audit Log)</span>
          </button>
        )}
      </div>

      {/* TAB 1: Cash Payments List */}
      {activeTab === 'summary' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-on-surface">سجل النقدية المدفوعة فعلياً بالخزنة</h2>
            <div className="text-xs text-on-surface-variant flex gap-4">
              <span>الجلسات: <strong className="text-on-surface font-mono">{formatEGP(sessionRevenue)}</strong></span>
              <span>المنتجات: <strong className="text-on-surface font-mono">{formatEGP(productRevenue)}</strong></span>
            </div>
          </div>

          {isLoading ? (
            <p className="text-center py-8 text-on-surface-variant text-sm">جاري تحميل سجل النقدية...</p>
          ) : payments.length === 0 ? (
            <p className="text-on-surface-variant text-center py-12 text-sm">لا توجد عمليات مسجلة في هذه الفترة</p>
          ) : (
            <div className="flex flex-col gap-2">
              {payments.map(record => (
                <div
                  key={record.id}
                  className="flex items-center justify-between bg-surface-container rounded-xl px-4 py-3 border border-card-border hover:border-card-border/80 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center text-primary font-bold">
                      {record.session_id ? '🎮' : '🛒'}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-on-surface">
                        {record.session_id ? 'تحصيل جلسة بلايستيشن' : 'تحصيل بيع منتجات / كافتيريا'}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-on-surface-variant mt-0.5">
                        <Clock className="w-3 h-3 text-on-surface-variant/70" />
                        <span>{new Date(record.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>•</span>
                        <User className="w-3 h-3 text-on-surface-variant/70" />
                        <span>المسؤول: {record.creator?.name || 'كاشير'}</span>
                      </div>
                    </div>
                  </div>
                  <span className="font-black text-lg tabular-nums text-available font-mono">
                    + {formatEGP(record.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Discrepancies & Partial Payments (نظام كشف التلاعب والعجز) */}
      {activeTab === 'discrepancies' && (
        <div className="space-y-4">
          <div className="p-4 bg-surface-container rounded-xl border border-card-border flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-busy flex-shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed text-on-surface-variant">
              <strong className="text-on-surface block font-bold mb-0.5">
                نظام الرقابة على العجز والتحصيل الجزئي:
              </strong>
              يعرض هذا الجدول جميع الفواتير التي قام الكاشير بتسجيل تحصيل جزئي لها دون سداد كامل المبلغ المحسوب تلقائياً. 
              يظل الفارق مسجلاً كعجز أو دين آجل على العميل حتى يتم تحصيله وتسويته.
            </div>
          </div>

          {uncollectedOrders.length === 0 ? (
            <div className="text-center py-12 bg-surface-container/50 rounded-2xl border border-dashed border-card-border">
              <CheckCircle2 className="w-10 h-10 text-available mx-auto mb-2 opacity-80" />
              <p className="font-bold text-on-surface text-sm">لا توجد أي فروقات أو جلسات معلقة!</p>
              <p className="text-xs text-on-surface-variant mt-1">جميع الفواتير في هذه الفترة تم سدادها بالكامل في الخزنة.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {uncollectedOrders.map(order => {
                const diff = order.total - order.paid_amount
                const deviceName = (order as any)?.session?.device?.name || 'جلسة غير محددة'
                const cashierName = (order as any)?.creator?.name || 'كاشير'

                return (
                  <Card key={order.id} className="border-busy/30 bg-busy/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-on-surface">{deviceName}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-busy/20 text-busy">
                          تحصيل جزئي
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-on-surface-variant">
                        <span>الوقت: {new Date(order.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>•</span>
                        <span>الكاشير: <strong>{cashierName}</strong></span>
                      </div>
                      {order.notes && (
                        <p className="text-xs text-busy/90 mt-1 font-medium bg-surface-container px-2.5 py-1 rounded-md border border-busy/20">
                          📝 ملاحظة: {order.notes}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-6 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-card-border">
                      <div className="text-left font-mono">
                        <div className="text-xs text-on-surface-variant">المستحق: {formatEGP(order.total)}</div>
                        <div className="text-xs text-available">المحصّل: {formatEGP(order.paid_amount)}</div>
                        <div className="text-sm font-black text-busy">العجز / المتبقي: {formatEGP(diff)}</div>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Audit Logs (سجل الرقابة غير القابل للتعديل) */}
      {activeTab === 'audit_logs' && canViewAllRevenue && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-on-surface flex items-center gap-1.5">
              <ShieldAlert className="w-5 h-5 text-tertiary" />
              سجل تدقيق العمليات الحساسة (غير قابل للحذف أو التعديل)
            </h2>
            <span className="text-xs text-on-surface-variant font-mono">
              إجمالي السجلات: {auditLogs.length}
            </span>
          </div>

          {auditLogs.length === 0 ? (
            <p className="text-center py-12 text-on-surface-variant text-sm">
              لا توجد سجلات رقابة مسجلة في هذه الفترة بعد.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {auditLogs.map(log => (
                <div
                  key={log.id}
                  className="p-3 bg-surface-container rounded-xl border border-card-border text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                        log.action_type === 'discount_applied'
                          ? 'bg-tertiary/20 text-tertiary'
                          : log.action_type === 'partial_payment'
                          ? 'bg-busy/20 text-busy'
                          : log.action_type === 'debt_settlement'
                          ? 'bg-secondary/20 text-secondary'
                          : 'bg-primary/20 text-primary'
                      }`}>
                        {log.action_type === 'discount_applied'
                          ? '🏷️ تطبيق خصم'
                          : log.action_type === 'partial_payment'
                          ? '⚠️ تحصيل جزئي'
                          : log.action_type === 'debt_settlement'
                          ? '💵 تسوية متبقي'
                          : '🎮 إنهاء جلسة'}
                      </span>
                      <span className="font-bold text-on-surface">{log.device_name || 'جهاز'}</span>
                      <span className="text-on-surface-variant">بواسطة: <strong>{log.user_name}</strong></span>
                    </div>
                    {log.notes && (
                      <p className="text-on-surface-variant">{log.notes}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-left font-mono">
                    <div>
                      <span className="text-[11px] text-on-surface-variant block">المتوقع / المحصل:</span>
                      <span className="font-bold text-on-surface">{formatEGP(log.expected_amount)} / <strong className="text-available">{formatEGP(log.paid_amount)}</strong></span>
                    </div>
                    {log.remaining_amount > 0 && (
                      <div>
                        <span className="text-[11px] text-busy block">العجز:</span>
                        <span className="font-bold text-busy">{formatEGP(log.remaining_amount)}</span>
                      </div>
                    )}
                    <span className="text-on-surface-variant text-[11px] whitespace-nowrap">
                      {new Date(log.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Debt settlement disabled - full payment only */}
    </div>
  )
}
