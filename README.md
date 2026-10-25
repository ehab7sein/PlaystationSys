# 🎮 نظام إدارة محل بلايستيشن

نظام POS متكامل لإدارة أجهزة البلايستيشن والمبيعات والإيرادات.

## التقنيات
- **React + Vite + TypeScript**
- **Tailwind CSS** (RTL, Dark Mode)
- **Supabase** (Postgres + Realtime + RLS)
- **Clerk** (Auth & User Management)

## الأدوار
| الدور | الصلاحيات |
|-------|-----------|
| Admin | كل الصلاحيات |
| Owner | إدارة الأجهزة والأسعار والمنتجات والرواتب |
| Worker | الجلسات والمبيعات وملخص اليوم |

## تشغيل المشروع

```bash
npm install
npm run dev
```

## متغيرات البيئة

أنشئ ملف `.env.local`:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_CLERK_PUBLISHABLE_KEY=your_clerk_key
```
