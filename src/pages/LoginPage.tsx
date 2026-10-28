import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  User,
  Lock,
  Eye,
  EyeOff,
  LogIn,
  AlertCircle,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import logoImg from '@/assets/logo.png'

export function LoginPage() {
  const { profile, isSuperAdmin, hasTenant, tenantSuspended, login } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  // If already logged in, redirect to the right place.
  useEffect(() => {
    if (!profile) return
    if (!profile.is_active) {
      navigate('/suspended', { replace: true })
    } else if (isSuperAdmin) {
      navigate('/admin', { replace: true })
    } else if (hasTenant && !tenantSuspended) {
      navigate('/', { replace: true })
    } else if (hasTenant) {
      navigate('/suspended', { replace: true })
    } else {
      navigate('/no-tenant', { replace: true })
    }
  }, [profile, hasTenant, tenantSuspended, isSuperAdmin, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage('')

    if (!username.trim()) {
      setErrorMessage('يرجى كتابة اسم المستخدم')
      return
    }
    if (!password) {
      setErrorMessage('يرجى كتابة كلمة المرور')
      return
    }

    setIsLoading(true)
    const result = await login(username, password)
    setIsLoading(false)

    if (result.success) {
      // AuthContext computes this from the fresh get_my_context result, so a
      // Super Admin lands on /admin even when they also belong to a tenant.
      navigate(result.redirectTo ?? '/', { replace: true })
    } else {
      setErrorMessage(result.error || 'فشل تسجيل الدخول')
    }
  }

  return (
    <div className="login-page min-h-screen login-ambient text-slate-100 flex items-center justify-center px-4 py-8 selection:bg-cyan-500 selection:text-white antialiased overflow-x-hidden">
      <main className="w-full max-w-lg flex flex-col items-center">
        {/* Brand header */}
        <div className="mb-8 text-center flex flex-col items-center">
          <div className="login-glow px-7 py-4 rounded-2xl bg-white/95 border border-white flex items-center justify-center transition-transform hover:scale-[1.02] duration-300">
            <img
              src={logoImg}
              alt="KONTROL"
              draggable={false}
              className="h-14 sm:h-16 w-auto object-contain select-none"
            />
          </div>

          <p className="mt-4 text-sm font-normal text-slate-400 tracking-wide max-w-sm">
            نظام متعدد الأنظمة لإدارة الأجهزة، الطلبات، والورديات
          </p>
        </div>

        {/* Login card */}
        <div className="login-glass login-card-shadow w-full rounded-3xl p-7 sm:p-9 border border-slate-700/50 relative overflow-hidden">
          {/* Ambient glow inside the card */}
          <div
            aria-hidden="true"
            className="absolute -top-24 -left-24 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-24 -right-24 w-48 h-48 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"
          />

          <div className="mb-6">
            <h1 className="text-xl font-bold text-white tracking-tight">
              تسجيل الدخول للنظام
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              أدخل بيانات الاعتماد المصرّح بها للوصول إلى لوحة التحكم
            </p>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="mb-5 p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-200 text-sm flex items-start gap-2.5 animate-[fadeIn_0.2s_ease-out]"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="leading-relaxed flex-1">{errorMessage}</div>
            </div>
          )}

          <form
            id="kontrol-login-form"
            onSubmit={handleSubmit}
            className="space-y-5"
          >
            {/* Username / email */}
            <div className="space-y-2">
              <label
                htmlFor="username"
                className="block text-xs font-semibold text-slate-300"
              >
                اسم المستخدم أو البريد الإلكتروني
              </label>
              <div className="relative rounded-xl overflow-hidden">
                <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-slate-400">
                  <User className="w-5 h-5" strokeWidth={1.8} />
                </div>
                <input
                  id="username"
                  name="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="مثال: admin أو admin@kontrol.local"
                  autoComplete="username"
                  autoFocus
                  required
                  dir="ltr"
                  className="login-input block w-full pr-11 pl-4 py-3 bg-[#0b1019]/90 border border-slate-700 text-sm text-slate-100 placeholder-slate-500 rounded-xl focus:outline-none focus:border-cyan-400 transition-all duration-200"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold text-slate-300"
                >
                  كلمة المرور (Password)
                </label>
              </div>
              <div className="relative rounded-xl overflow-hidden">
                <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-5 h-5" strokeWidth={1.8} />
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  dir="ltr"
                  className="login-input block w-full pr-11 pl-11 py-3 bg-[#0b1019]/90 border border-slate-700 text-sm text-slate-100 placeholder-slate-500 rounded-xl focus:outline-none focus:border-cyan-400 tracking-wider transition-all duration-200"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label="إظهار أو إخفاء كلمة المرور"
                  tabIndex={-1}
                  className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 hover:text-cyan-400 focus:outline-none transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" strokeWidth={1.8} />
                  ) : (
                    <Eye className="w-5 h-5" strokeWidth={1.8} />
                  )}
                </button>
              </div>
            </div>

            {/* Remember / forgot */}
            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  id="remember"
                  name="remember"
                  type="checkbox"
                  className="w-4 h-4 rounded bg-[#0b1019] border-slate-700 accent-cyan-500 cursor-pointer"
                />
                <span className="text-slate-300 font-medium">
                  تذكر هذا الجهاز
                </span>
              </label>
              <a
                href="#forgot"
                className="text-cyan-400 hover:text-cyan-300 font-medium transition-colors hover:underline"
              >
                نسيت كلمة المرور؟
              </a>
            </div>

            {/* Submit */}
            <div className="pt-3">
              <button
                type="submit"
                disabled={isLoading}
                className="login-btn-glow w-full py-3.5 px-6 rounded-xl font-bold text-sm tracking-wide text-slate-950 bg-gradient-to-r from-[#00d2ff] via-sky-400 to-[#00a8ff] hover:from-cyan-300 hover:to-sky-400 active:scale-[0.99] transition-all duration-200 flex items-center justify-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-[#06090e] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-slate-900/70 border-t-transparent rounded-full animate-spin" />
                    <span>جاري تسجيل الدخول...</span>
                  </>
                ) : (
                  <>
                    <span>تسجيل الدخول</span>
                    <LogIn className="w-5 h-5 rotate-180" strokeWidth={2.2} />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
