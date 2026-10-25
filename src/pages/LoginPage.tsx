import { SignIn } from '@clerk/react'

export function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-xl flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🎮</span>
          </div>
          <h1 className="text-2xl font-bold text-on-surface">إدارة محل البلايستيشن</h1>
          <p className="text-on-surface-variant mt-2">سجّل دخولك للمتابعة</p>
        </div>
        <div className="flex justify-center">
          <SignIn routing="hash" />
        </div>
      </div>
    </div>
  )
}
