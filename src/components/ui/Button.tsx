import { cn } from '@/lib/utils'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
  fullWidth?: boolean
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-dark font-bold hover:bg-primary/90 active:scale-[0.98]',
  secondary:
    'bg-available text-white font-bold hover:bg-available/90 active:scale-[0.98]',
  danger:
    'bg-busy text-white font-bold hover:bg-busy/90 active:scale-[0.98]',
  ghost:
    'bg-transparent text-on-surface-variant hover:bg-surface-container-high active:scale-[0.98]',
  outline:
    'border border-outline-variant text-on-surface hover:bg-surface-container-high active:scale-[0.98]',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 text-sm rounded-DEFAULT min-h-[36px]',
  md: 'px-4 py-2.5 text-base rounded-DEFAULT min-h-[48px]',
  lg: 'px-6 py-3 text-lg rounded-lg min-h-[52px]',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      fullWidth = false,
      className,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-semibold transition-all duration-150 select-none',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none',
          VARIANTS[variant],
          SIZES[size],
          fullWidth && 'w-full',
          className
        )}
        {...props}
      >
        {isLoading ? (
          <>
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            جاري التحميل...
          </>
        ) : (
          children
        )}
      </button>
    )
  }
)

Button.displayName = 'Button'
