import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-3xl',
}

export function Modal({ isOpen, onClose, title, children, footer, size = 'md', className }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Prevent scroll when open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  if (!isOpen) return null

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.68)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div
        className={cn(
          'w-full bg-[#1E2638] rounded-xl overflow-hidden',
          'border border-card-border flex flex-col max-h-[92vh]',
          'shadow-[0_24px_64px_rgba(0,0,0,0.55)]',
          'animate-[modalIn_0.18s_ease-out]',
          SIZES[size],
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-card-border shrink-0">
          <h2 className="text-lg font-bold text-on-surface">{title}</h2>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-DEFAULT text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {/* Content */}
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
        {/* Footer */}
        {footer && (
          <div className="px-6 py-4 border-t border-card-border bg-surface-container-low/60 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

interface ConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  isLoading?: boolean
  danger?: boolean
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'تأكيد',
  isLoading,
  danger = false,
}: ConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="flex flex-col gap-6">
        <p className="text-on-surface-variant leading-relaxed">{message}</p>
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            إلغاء
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            isLoading={isLoading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
