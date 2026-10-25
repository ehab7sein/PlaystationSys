import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { StatCard } from '@/components/ui/Card'
import { formatEGP } from '@/lib/utils'
import { TrendingUp, ShoppingBag, DollarSign } from 'lucide-react'
import type { AppSettings } from '@/types/database'

type FilterType = 'today' | 'yesterday' | 'week' | 'custom'

interface RevenueRecord {
  id: string
  created_at: string
  amount: number
  session_id: string | null
  order_id: string | null
}

export function RevenuePage() {
  const { canViewAllRevenue } = useAuth()
  const [filter, setFilter] = useState<FilterType>('today')
  const [records, setRecords] = useState<RevenueRecord[]>([])
  const [sessionRevenue, setSessionRevenue] = useState(0)
  const [productRevenue, setProductRevenue] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [settings, setSettings] = useState<AppSettings | null>(null)

  const getDateRange = useCallback(
    (f: FilterType): [string, string] => {
      const dayStartHour = settings?.day_start_hour ?? 6
      const now = new Date()
      const todayStart = new Date(now)
      todayStart.setHours(dayStartHour, 0, 0, 0)
      if (now.getHours() < dayStartHour) todayStart.setDate(todayStart.getDate() - 1)

      if (f === 'today') {
        return [todayStart.toISOString(), now.toISOString()]
      }
      if (f === 'yesterday') {
        const start = new Date(todayStart)
        start.setDate(start.getDate() - 1)
        return [start.toISOString(), todayStart.toISOString()]
      }
      if (f === 'week') {
        const start = new Date(todayStart)
        start.setDate(start.getDate() - 7)
        return [start.toISOString(), now.toISOString()]
      }
      return [todayStart.toISOString(), now.toISOString()]
    },
    [settings]
  )

  const fetchRevenue = useCallback(async () => {
    if (!settings && filter !== 'today') return
    const [from, to] = getDateRange(filter)

    const { data: payments } = await supabase
      .from('payments')
      .select('*')
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at', { ascending: false })

    if (payments) {
      setRecords(payments)
      const sessions = payments.filter(p => p.session_id !== null)
      const products = payments.filter(p => p.session_id === null)
      setSessionRevenue(sessions.reduce((s, p) => s + p.amount, 0))
      setProductRevenue(products.reduce((s, p) => s + p.amount, 0))
    }
    setIsLoading(false)
  }, [filter, getDateRange, settings])

  useEffect(() => {
    supabase.from('settings').select('*').single()
      .then(({ data }) => { if (data) setSettings(data) })
  }, [])

  useEffect(() => { fetchRevenue() }, [fetchRevenue])

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
      <h1 className="text-2xl font-bold text-on-surface">الإيرادات</h1>

      {/* Filter chips */}
      <div className="flex gap-2">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
              filter === f.value
                ? 'bg-primary text-primary-dark'
                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="إيراد الجلسات"
          value={formatEGP(sessionRevenue)}
          icon={<TrendingUp className="w-5 h-5 text-primary" />}
        />
        <StatCard
          title="إيراد المنتجات"
          value={formatEGP(productRevenue)}
          icon={<ShoppingBag className="w-5 h-5 text-secondary" />}
        />
        <StatCard
          title="الإجمالي"
          value={formatEGP(sessionRevenue + productRevenue)}
          icon={<DollarSign className="w-5 h-5 text-tertiary" />}
          valueClassName="text-tertiary"
        />
      </div>

      {/* Records list */}
      <div>
        <h2 className="text-lg font-semibold text-on-surface mb-4">سجل العمليات</h2>
        {isLoading ? (
          <p className="text-on-surface-variant">جاري التحميل...</p>
        ) : records.length === 0 ? (
          <p className="text-on-surface-variant text-center py-12">لا توجد عمليات في هذه الفترة</p>
        ) : (
          <div className="flex flex-col gap-2">
            {records.map(record => (
              <div
                key={record.id}
                className="flex items-center justify-between bg-surface-container rounded-lg px-4 py-3 border border-card-border"
              >
                <div>
                  <p className="text-sm font-semibold text-on-surface">
                    {record.session_id ? '🎮 جلسة' : '🛒 بيع منفصل'}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    {new Date(record.created_at).toLocaleString('ar-EG')}
                  </p>
                </div>
                <span className="font-bold text-lg tabular-nums text-available">
                  + {formatEGP(record.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
