import { cn } from '@/lib/utils'
import { type InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className, id, ...props }, ref) => {
    const inputId = id || label?.replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-semibold text-on-surface-variant">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full px-3 py-2.5 rounded-DEFAULT min-h-[48px]',
            'bg-surface-container border border-outline-variant',
            'text-on-surface placeholder:text-on-surface-variant/50',
            'focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary',
            'transition-colors duration-150',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error && 'border-busy focus:border-busy focus:ring-busy',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-busy">{error}</p>}
        {helperText && !error && (
          <p className="text-xs text-on-surface-variant">{helperText}</p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'
