import { useEffect, useState } from 'react'
import { KeyRound, CheckCircle2, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { translateDbError } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

interface ChangePasswordModalProps {
  isOpen: boolean
  onClose: () => void
}

export function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps) {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setOldPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError('')
    setSuccess(false)
    setIsLoading(false)
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)

    if (!oldPassword) {
      setError('اكتب كلمة المرور الحالية')
      return
    }
    if (newPassword.length < 6) {
      setError('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين')
      return
    }
    if (newPassword === oldPassword) {
      setError('اختر كلمة مرور مختلفة عن الحالية')
      return
    }

    setIsLoading(true)
    const { error: rpcError } = await supabase.rpc('change_my_password', {
      p_old_password: oldPassword,
      p_new_password: newPassword,
    })
    setIsLoading(false)

    if (rpcError) {
      setError(translateDbError(rpcError, 'تعذر تغيير كلمة المرور'))
      return
    }

    setOldPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setSuccess(true)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="تغيير كلمة المرور" size="sm">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2.5 text-xs text-on-surface-variant">
          <KeyRound className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
          <span>تُغيَّر كلمة مرور حسابك الحالي فقط، ولن تؤثر على عضويتك في أي محل.</span>
        </div>

        {success && (
          <div className="flex items-start gap-2 rounded-lg border border-available/30 bg-available/10 px-3 py-2.5 text-xs text-available">
            <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>تم تغيير كلمة المرور بنجاح. استخدم الكلمة الجديدة في تسجيل الدخول القادم.</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-busy/30 bg-busy/10 px-3 py-2.5 text-xs text-busy">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Input
          label="كلمة المرور الحالية"
          type="password"
          value={oldPassword}
          onChange={e => setOldPassword(e.target.value)}
          autoComplete="current-password"
          dir="ltr"
          required
          disabled={isLoading || success}
        />
        <Input
          label="كلمة المرور الجديدة"
          type="password"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          autoComplete="new-password"
          dir="ltr"
          helperText="6 أحرف على الأقل"
          required
          disabled={isLoading || success}
        />
        <Input
          label="تأكيد كلمة المرور الجديدة"
          type="password"
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          dir="ltr"
          required
          disabled={isLoading || success}
        />

        <div className="flex gap-3 justify-end pt-1">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading}>
            {success ? 'إغلاق' : 'إلغاء'}
          </Button>
          {!success && (
            <Button type="submit" variant="primary" isLoading={isLoading}>
              تغيير كلمة المرور
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}
