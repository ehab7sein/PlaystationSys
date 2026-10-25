import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Power } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { formatEGP } from '@/lib/utils'
import type { Device, AppSettings, RoundingMode } from '@/types/database'
import { SalariesTab } from '@/components/settings/SalariesTab'
import { UsersTab } from '@/components/settings/UsersTab'

type Tab = 'devices' | 'general' | 'salaries' | 'users'

export function SettingsPage() {
  const { canManageSalaries, canManageUsers, isOwner, isAdmin } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('devices')

  const TABS: { value: Tab; label: string; show: boolean }[] = [
    { value: 'devices', label: 'الأجهزة', show: true },
    { value: 'users', label: 'المستخدمين والصلاحيات', show: isOwner || isAdmin },
    { value: 'general', label: 'الإعدادات العامة', show: true },
    { value: 'salaries', label: 'الرواتب', show: canManageSalaries },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-on-surface">الإعدادات</h1>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-card-border pb-0 overflow-x-auto">
        {TABS.filter(t => t.show).map(tab => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap ${
              activeTab === tab.value
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'devices' && <DevicesTab />}
      {activeTab === 'users' && (isOwner || isAdmin) && <UsersTab />}
      {activeTab === 'general' && <GeneralTab />}
      {activeTab === 'salaries' && canManageSalaries && <SalariesTab />}
    </div>
  )
}

// ─── Devices Tab ─────────────────────────────────────────
function DevicesTab() {
  const [devices, setDevices] = useState<Device[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editDevice, setEditDevice] = useState<Device | null>(null)

  const fetchDevices = useCallback(async () => {
    const { data } = await supabase.from('devices').select('*').order('name')
    if (data) setDevices(data)
  }, [])

  useEffect(() => { fetchDevices() }, [fetchDevices])

  const handleToggle = async (device: Device) => {
    await supabase.from('devices').update({ is_active: !device.is_active }).eq('id', device.id)
    fetchDevices()
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditDevice(null); setShowModal(true) }}>
          <Plus className="w-4 h-4" /> إضافة جهاز
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {devices.map(device => (
          <Card key={device.id} className={`flex flex-col gap-3 ${!device.is_active ? 'opacity-50' : ''}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-on-surface">{device.name}</p>
                <p className="text-sm text-on-surface-variant">{formatEGP(device.hourly_price)} / ساعة</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => { setEditDevice(device); setShowModal(true) }}
                  className="p-1.5 rounded text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => handleToggle(device)}
                  className={`p-1.5 rounded transition-colors ${
                    device.is_active
                      ? 'text-on-surface-variant hover:text-busy hover:bg-busy/10'
                      : 'text-on-surface-variant hover:text-available hover:bg-available/10'
                  }`}>
                  <Power className="w-4 h-4" />
                </button>
              </div>
            </div>
            <span className={`text-xs font-semibold ${device.is_active ? 'text-available' : 'text-on-surface-variant'}`}>
              {device.is_active ? '• مفعّل' : '• موقوف'}
            </span>
          </Card>
        ))}
      </div>

      <DeviceModal
        isOpen={showModal}
        device={editDevice}
        onClose={() => setShowModal(false)}
        onSuccess={() => { fetchDevices(); setShowModal(false) }}
      />
    </div>
  )
}

interface DeviceModalProps {
  isOpen: boolean
  device: Device | null
  onClose: () => void
  onSuccess: () => void
}

function DeviceModal({ isOpen, device, onClose, onSuccess }: DeviceModalProps) {
  const [form, setForm] = useState({ name: '', hourly_price: '' })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (device) {
      setForm({ name: device.name, hourly_price: String(device.hourly_price) })
    } else {
      setForm({ name: '', hourly_price: '' })
    }
    setError('')
  }, [device, isOpen])

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('اسم الجهاز مطلوب'); return }
    if (!form.hourly_price || isNaN(Number(form.hourly_price))) { setError('سعر الساعة غير صحيح'); return }

    setIsLoading(true)
    const payload = { name: form.name.trim(), hourly_price: Number(form.hourly_price) }

    try {
      if (device) {
        await supabase.from('devices').update(payload).eq('id', device.id)
      } else {
        await supabase.from('devices').insert({ ...payload, status: 'available', is_active: true })
      }
      onSuccess()
    } catch (err: any) {
      setError(err.message || 'حدث خطأ')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={device ? 'تعديل جهاز' : 'إضافة جهاز جديد'}>
      <div className="flex flex-col gap-4">
        <Input label="اسم الجهاز" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="مثال: PS5 - 01" />
        <Input label="سعر الساعة (جنيه)" type="number" value={form.hourly_price} onChange={e => setForm(f => ({ ...f, hourly_price: e.target.value }))} placeholder="40" min="0" />
        {error && <p className="text-sm text-busy">{error}</p>}
        <Button fullWidth size="lg" onClick={handleSubmit} isLoading={isLoading}>
          {device ? 'حفظ' : 'إضافة'}
        </Button>
      </div>
    </Modal>
  )
}

// ─── General Settings Tab ──────────────────────────────────
function GeneralTab() {
  const [settings, setSettings] = useState<Partial<AppSettings>>({
    rounding_mode: 'nearest_5_pounds',
    day_start_hour: 6,
    low_stock_threshold: 5,
  })
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    supabase.from('settings').select('*').single()
      .then(({ data }) => { if (data) setSettings(data) })
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    if (settings.id) {
      await supabase.from('settings').update(settings).eq('id', settings.id)
    } else {
      await supabase.from('settings').insert(settings as AppSettings)
    }
    setIsSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const ROUNDING_OPTIONS: { value: RoundingMode; label: string }[] = [
    { value: 'nearest_pound', label: 'أقرب جنيه' },
    { value: 'nearest_5_pounds', label: 'أقرب 5 جنيهات (افتراضي)' },
    { value: 'up_5_minutes', label: 'تقريب لأعلى 5 دقائق' },
  ]

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <label className="text-sm font-semibold text-on-surface-variant block mb-3">طريقة تقريب السعر</label>
        <div className="flex flex-col gap-2">
          {ROUNDING_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-center gap-3 cursor-pointer p-3 rounded-DEFAULT border border-card-border hover:border-primary/50 transition-colors">
              <input type="radio" name="rounding" value={opt.value}
                checked={settings.rounding_mode === opt.value}
                onChange={() => setSettings(s => ({ ...s, rounding_mode: opt.value }))}
                className="accent-primary w-4 h-4" />
              <span className="text-sm text-on-surface">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      <Input
        label="ساعة بداية اليوم المحاسبي"
        type="number"
        value={String(settings.day_start_hour ?? 6)}
        onChange={e => setSettings(s => ({ ...s, day_start_hour: Number(e.target.value) }))}
        helperText="مثال: 6 يعني اليوم يبدأ الساعة 6 صباحاً"
        min="0"
        max="23"
      />

      <Input
        label="حد تنبيه المخزون"
        type="number"
        value={String(settings.low_stock_threshold ?? 5)}
        onChange={e => setSettings(s => ({ ...s, low_stock_threshold: Number(e.target.value) }))}
        helperText="تنبيه عندما تقل الكمية عن هذا الرقم"
        min="1"
      />

      <Button fullWidth size="lg" onClick={handleSave} isLoading={isSaving} variant={saved ? 'secondary' : 'primary'}>
        {saved ? '✓ تم الحفظ' : 'حفظ الإعدادات'}
      </Button>
    </div>
  )
}
