import { useState, useEffect, useCallback } from 'react'
import { Plus, CheckCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { formatEGP } from '@/lib/utils'
import { translateDbError } from '@/lib/errors'
import type { Salary, UserRole } from '@/types/database'

interface StaffOption {
  id: string
  name: string
  role: UserRole
}

export function SalariesTab() {
  const { activeTenant } = useAuth()
  const tenantId = activeTenant?.id ?? null
  const [salaries, setSalaries] = useState<Salary[]>([])
  const [profiles, setProfiles] = useState<StaffOption[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editSalary, setEditSalary] = useState<Salary | null>(null)
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    if (!tenantId) {
      setIsLoading(false)
      return
    }
    const [salariesRes, membersRes] = await Promise.all([
      supabase
        .from('salaries')
        .select('*, profile:profiles(*)')
        .eq('tenant_id', tenantId)
        .eq('month', selectedMonth)
        .eq('year', selectedYear)
        .order('created_at', { ascending: false }),
      supabase
        .from('memberships')
        .select('user_id, role, profile:profiles!inner(id, name, is_active)')
        .eq('tenant_id', tenantId)
        .eq('is_active', true),
    ])

    if (salariesRes.data) setSalaries(salariesRes.data as Salary[])
    if (salariesRes.error) {
      setError(translateDbError(salariesRes.error, 'تعذر تحميل الرواتب'))
    }

    if (membersRes.data) {
      const rows = membersRes.data as unknown as Array<{
        user_id: string
        role: UserRole
        profile: { id: string; name: string; is_active: boolean } | null
      }>
      setProfiles(
        rows
          .filter(row => row.profile?.is_active)
          .map(row => ({
            id: row.user_id,
            name: row.profile?.name ?? 'موظف',
            role: row.role,
          }))
      )
    }

    setIsLoading(false)
  }, [selectedMonth, selectedYear, tenantId])

  useEffect(() => { fetchData() }, [fetchData])

  const handleMarkPaid = async (salary: Salary) => {
    if (!tenantId) return
    const { error: updateError } = await supabase
      .from('salaries')
      .update({ paid_at: new Date().toISOString() })
      .eq('id', salary.id)
      .eq('tenant_id', tenantId)
    if (updateError) {
      setError(translateDbError(updateError, 'تعذر تأكيد صرف الراتب'))
      return
    }
    fetchData()
  }

  const totalSalaries = salaries.reduce((sum, s) => sum + s.base_salary + s.bonus - s.deductions, 0)

  const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

  return (
    <div className="space-y-6">
      {/* Month/Year filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={selectedMonth}
          onChange={e => setSelectedMonth(Number(e.target.value))}
          className="px-3 py-2 rounded-DEFAULT bg-surface-container border border-outline-variant text-on-surface focus:outline-none focus:border-primary"
        >
          {MONTHS.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        <select
          value={selectedYear}
          onChange={e => setSelectedYear(Number(e.target.value))}
          className="px-3 py-2 rounded-DEFAULT bg-surface-container border border-outline-variant text-on-surface focus:outline-none focus:border-primary"
        >
          {[2024, 2025, 2026, 2027].map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <Button onClick={() => { setEditSalary(null); setShowModal(true) }}>
          <Plus className="w-4 h-4" /> إضافة راتب
        </Button>
      </div>

      {/* Summary */}
      {error && <p className="text-sm text-busy">{error}</p>}
      <Card className="flex items-center justify-between">
        <span className="text-on-surface-variant">إجمالي الرواتب لـ {MONTHS[selectedMonth - 1]}</span>
        <span className="text-xl font-bold tabular-nums text-busy">{formatEGP(totalSalaries)}</span>
      </Card>

      {/* Salaries list */}
      {isLoading ? (
        <p className="text-on-surface-variant">جاري التحميل...</p>
      ) : salaries.length === 0 ? (
        <p className="text-on-surface-variant text-center py-12">لا توجد رواتب مسجّلة لهذا الشهر</p>
      ) : (
        <div className="flex flex-col gap-3">
          {salaries.map(salary => {
            const net = salary.base_salary + salary.bonus - salary.deductions
            return (
              <Card key={salary.id} className="flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold text-on-surface">
                      {salary.profile?.name ?? 'موظف'}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {salary.profile?.role === 'worker'
                        ? 'كاشير'
                        : salary.profile?.role === 'admin'
                          ? 'مدير'
                          : 'مالك'}
                    </p>
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-lg tabular-nums text-on-surface">{formatEGP(net)}</p>
                    {salary.paid_at ? (
                      <span className="text-xs text-available font-semibold">✓ مدفوع</span>
                    ) : (
                      <span className="text-xs text-busy font-semibold">معلق</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-sm border-t border-card-border pt-3">
                  <div className="text-center">
                    <p className="text-on-surface-variant text-xs">الأساسي</p>
                    <p className="font-semibold tabular-nums">{formatEGP(salary.base_salary)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-on-surface-variant text-xs">مكافأة</p>
                    <p className="font-semibold tabular-nums text-available">+{formatEGP(salary.bonus)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-on-surface-variant text-xs">خصم</p>
                    <p className="font-semibold tabular-nums text-busy">-{formatEGP(salary.deductions)}</p>
                  </div>
                </div>

                {salary.notes && (
                  <p className="text-xs text-on-surface-variant border-t border-card-border pt-2">{salary.notes}</p>
                )}

                {!salary.paid_at && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleMarkPaid(salary)}
                  >
                    <CheckCircle className="w-4 h-4" /> تأكيد الصرف
                  </Button>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <SalaryModal
        isOpen={showModal}
        salary={editSalary}
        profiles={profiles}
        month={selectedMonth}
        year={selectedYear}
        onClose={() => setShowModal(false)}
        onSuccess={() => { fetchData(); setShowModal(false) }}
      />
    </div>
  )
}

// ─── Salary Modal ─────────────────────────────────────────
interface SalaryModalProps {
  isOpen: boolean
  salary: Salary | null
  profiles: StaffOption[]
  month: number
  year: number
  onClose: () => void
  onSuccess: () => void
}

function SalaryModal({ isOpen, salary, profiles, month, year, onClose, onSuccess }: SalaryModalProps) {
  const { profile, activeTenant } = useAuth()
  const tenantId = activeTenant?.id ?? null
  const [form, setForm] = useState({
    user_id: '',
    base_salary: '',
    bonus: '0',
    deductions: '0',
    notes: '',
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (salary) {
      setForm({
        user_id: salary.user_id,
        base_salary: String(salary.base_salary),
        bonus: String(salary.bonus),
        deductions: String(salary.deductions),
        notes: salary.notes ?? '',
      })
    } else {
      setForm({ user_id: '', base_salary: '', bonus: '0', deductions: '0', notes: '' })
    }
    setError('')
  }, [salary, isOpen])

  const handleSubmit = async () => {
    if (!form.user_id) { setError('اختر الموظف'); return }
    if (!form.base_salary) { setError('الراتب الأساسي مطلوب'); return }

    setIsLoading(true)
    const basePayload = {
      user_id: form.user_id,
      month,
      year,
      base_salary: Number(form.base_salary),
      bonus: Number(form.bonus) || 0,
      deductions: Number(form.deductions) || 0,
      notes: form.notes || null,
      paid_at: salary?.paid_at ?? null,
    }

    try {
      if (!tenantId) throw new Error('لا يوجد محل نشط')
      if (salary) {
        // created_by is immutable after insert (enforced by a DB trigger).
        const { error: updateError } = await supabase
          .from('salaries')
          .update(basePayload)
          .eq('id', salary.id)
          .eq('tenant_id', tenantId)
        if (updateError) throw updateError
      } else {
        const { error: insertError } = await supabase
          .from('salaries')
          .insert({
            ...basePayload,
            tenant_id: tenantId,
            created_by: profile?.id ?? null,
          })
        if (insertError) throw insertError
      }
      onSuccess()
    } catch (err: any) {
      setError(translateDbError(err, 'حدث خطأ أثناء حفظ الراتب'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={salary ? 'تعديل راتب' : 'إضافة راتب'}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-on-surface-variant">الموظف</label>
          <select
            value={form.user_id}
            onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
            className="w-full px-3 py-2.5 rounded-DEFAULT bg-surface-container border border-outline-variant
              text-on-surface focus:outline-none focus:border-primary min-h-[48px]"
          >
            <option value="">اختر موظفاً</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.role === 'worker' ? 'كاشير' : p.role === 'owner' ? 'مالك' : 'مدير'})</option>
            ))}
          </select>
        </div>

        <Input label="الراتب الأساسي (جنيه)" type="number" value={form.base_salary}
          onChange={e => setForm(f => ({ ...f, base_salary: e.target.value }))} placeholder="3000" min="0" />
        <Input label="المكافأة (جنيه)" type="number" value={form.bonus}
          onChange={e => setForm(f => ({ ...f, bonus: e.target.value }))} placeholder="0" min="0" />
        <Input label="الخصومات (جنيه)" type="number" value={form.deductions}
          onChange={e => setForm(f => ({ ...f, deductions: e.target.value }))} placeholder="0" min="0" />
        <Input label="ملاحظات" value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="أي ملاحظات إضافية..." />

        {error && <p className="text-sm text-busy">{error}</p>}

        <Button fullWidth size="lg" onClick={handleSubmit} isLoading={isLoading}>
          {salary ? 'حفظ' : 'إضافة الراتب'}
        </Button>
      </div>
    </Modal>
  )
}
