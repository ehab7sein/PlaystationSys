-- ============================================================
-- KONTROL — ترقية نظام إنهاء الجلسات والرقابة (Anti-Fraud)
-- ============================================================
-- طريقة التنفيذ:
--   1) افتح مشروعك على https://supabase.com
--   2) من القائمة الجانبية: SQL Editor → New query
--   3) الصق محتوى الملف ده كامل → اضغط Run
--   4) لو ظهر "Success. No rows returned" يبقى تمام
--
-- الملف آمن: تقدر تشغّله أكتر من مرة بدون ما يبوّظ أي بيانات.
-- ============================================================

-- ─── 1) أعمدة الخصم والملاحظات في جدول الفواتير ─────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes           TEXT;

-- ─── 2) جدول سجل الرقابة (Audit Log) ────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action_type       TEXT NOT NULL,
  session_id        UUID REFERENCES sessions(id) ON DELETE SET NULL,
  device_name       TEXT,
  user_id           UUID REFERENCES profiles(id) ON DELETE SET NULL,
  user_name         TEXT NOT NULL,
  expected_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
  paid_amount       NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
  remaining_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3) فهارس لسرعة التقارير ────────────────────────────────
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_session_id_idx ON audit_logs (session_id);
CREATE INDEX IF NOT EXISTS orders_session_id_idx     ON orders (session_id);

-- ─── 4) صلاحيات الجدول: قراءة + إضافة فقط (بدون تعديل أو حذف) ─
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_all"    ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;

-- التطبيق يقدر يقرأ السجل ويضيف سطر جديد… ومش يقدر يعدّل أو يمسح سطر قديم.
CREATE POLICY "audit_logs_select" ON audit_logs FOR SELECT USING (true);
CREATE POLICY "audit_logs_insert" ON audit_logs FOR INSERT WITH CHECK (true);

-- ─── 5) تأكيد إن الصلاحيات متفعّلة على باقي الجداول ──────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- ─── 6) تحديث كاش الـ API عشان الجداول الجديدة تظهر فوراً ─────
NOTIFY pgrst, 'reload schema';

-- ─── 7) فحص سريع بعد التنفيذ (اختياري) ──────────────────────
-- المفروض يرجّع 0 صفوف من غير أي Error
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 1;
