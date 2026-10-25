-- =============================================
-- PlayStation Shop Management System
-- Database Schema + RLS Policies
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── PROFILES ─────────────────────────────────────────────
CREATE TABLE profiles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_user_id   TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin', 'owner', 'worker')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── SETTINGS ─────────────────────────────────────────────
CREATE TABLE settings (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rounding_mode         TEXT NOT NULL DEFAULT 'nearest_5_pounds'
                          CHECK (rounding_mode IN ('nearest_pound', 'nearest_5_pounds', 'up_5_minutes')),
  day_start_hour        INT NOT NULL DEFAULT 6 CHECK (day_start_hour BETWEEN 0 AND 23),
  low_stock_threshold   INT NOT NULL DEFAULT 5
);

-- Insert default settings row
INSERT INTO settings (rounding_mode, day_start_hour, low_stock_threshold)
VALUES ('nearest_5_pounds', 6, 5);

-- ─── DEVICES ──────────────────────────────────────────────
CREATE TABLE devices (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  hourly_price  NUMERIC(10,2) NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available', 'busy', 'maintenance')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── PRODUCTS ─────────────────────────────────────────────
CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  price       NUMERIC(10,2) NOT NULL DEFAULT 0,
  stock_qty   INT NOT NULL DEFAULT 0,
  category    TEXT NOT NULL DEFAULT 'other'
                CHECK (category IN ('drinks', 'snacks', 'other')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── SESSIONS ─────────────────────────────────────────────
CREATE TABLE sessions (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id               UUID NOT NULL REFERENCES devices(id),
  mode                    TEXT NOT NULL CHECK (mode IN ('open', 'fixed')),
  planned_minutes         INT,
  hourly_price_snapshot   NUMERIC(10,2) NOT NULL,
  started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at                TIMESTAMPTZ,
  time_amount             NUMERIC(10,2),
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'closed')),
  created_by              UUID REFERENCES profiles(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce: only one active session per device
CREATE UNIQUE INDEX sessions_device_active_unique
  ON sessions (device_id)
  WHERE status = 'active';

-- ─── ORDERS ───────────────────────────────────────────────
CREATE TABLE orders (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID REFERENCES sessions(id),   -- NULL for standalone sales
  total       NUMERIC(10,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── ORDER ITEMS ──────────────────────────────────────────
CREATE TABLE order_items (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id            UUID NOT NULL REFERENCES products(id),
  product_name_snapshot TEXT NOT NULL,
  unit_price_snapshot   NUMERIC(10,2) NOT NULL,
  qty                   INT NOT NULL DEFAULT 1 CHECK (qty > 0)
);

-- ─── PAYMENTS ─────────────────────────────────────────────
CREATE TABLE payments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID REFERENCES sessions(id),
  order_id    UUID REFERENCES orders(id),
  amount      NUMERIC(10,2) NOT NULL,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── SALARIES ─────────────────────────────────────────────
CREATE TABLE salaries (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES profiles(id),
  month       INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year        INT NOT NULL,
  base_salary NUMERIC(10,2) NOT NULL DEFAULT 0,
  bonus       NUMERIC(10,2) NOT NULL DEFAULT 0,
  deductions  NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes       TEXT,
  paid_at     TIMESTAMPTZ,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, month, year)
);

-- =============================================
-- RLS POLICIES
-- =============================================

-- Helper function: get current user's profile
CREATE OR REPLACE FUNCTION get_my_profile()
RETURNS profiles
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT * FROM profiles
  WHERE clerk_user_id = auth.jwt()->>'sub'
    AND is_active = true
  LIMIT 1;
$$;

-- Enable RLS on all tables
ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE salaries       ENABLE ROW LEVEL SECURITY;

-- ─── PROFILES policies ────────────────────────────────────
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (clerk_user_id = auth.jwt()->>'sub');

CREATE POLICY "profiles_select_admin_owner"
  ON profiles FOR SELECT
  USING ((get_my_profile()).role IN ('admin', 'owner'));

CREATE POLICY "profiles_update_admin"
  ON profiles FOR UPDATE
  USING ((get_my_profile()).role = 'admin');

-- ─── SETTINGS policies ────────────────────────────────────
CREATE POLICY "settings_select_all"
  ON settings FOR SELECT
  USING ((get_my_profile()) IS NOT NULL);

CREATE POLICY "settings_modify_admin_owner"
  ON settings FOR ALL
  USING ((get_my_profile()).role IN ('admin', 'owner'));

-- ─── DEVICES policies ─────────────────────────────────────
CREATE POLICY "devices_select_all"
  ON devices FOR SELECT
  USING ((get_my_profile()) IS NOT NULL);

CREATE POLICY "devices_modify_admin_owner"
  ON devices FOR ALL
  USING ((get_my_profile()).role IN ('admin', 'owner'));

CREATE POLICY "devices_update_worker"
  ON devices FOR UPDATE
  USING ((get_my_profile()).role = 'worker');

-- ─── PRODUCTS policies ────────────────────────────────────
CREATE POLICY "products_select_all"
  ON products FOR SELECT
  USING ((get_my_profile()) IS NOT NULL);

CREATE POLICY "products_modify_admin_owner"
  ON products FOR ALL
  USING ((get_my_profile()).role IN ('admin', 'owner'));

CREATE POLICY "products_update_worker"
  ON products FOR UPDATE
  USING ((get_my_profile()).role = 'worker');

-- ─── SESSIONS policies ────────────────────────────────────
CREATE POLICY "sessions_select_all"
  ON sessions FOR SELECT
  USING ((get_my_profile()) IS NOT NULL);

CREATE POLICY "sessions_insert_all"
  ON sessions FOR INSERT
  WITH CHECK ((get_my_profile()) IS NOT NULL);

CREATE POLICY "sessions_update_all"
  ON sessions FOR UPDATE
  USING ((get_my_profile()) IS NOT NULL);

-- ─── ORDERS policies ──────────────────────────────────────
CREATE POLICY "orders_select_worker_today"
  ON orders FOR SELECT
  USING (
    (get_my_profile()).role IN ('admin', 'owner')
    OR (
      (get_my_profile()).role = 'worker'
      AND created_at >= CURRENT_DATE
    )
  );

CREATE POLICY "orders_insert_all"
  ON orders FOR INSERT
  WITH CHECK ((get_my_profile()) IS NOT NULL);

CREATE POLICY "orders_update_admin_owner"
  ON orders FOR UPDATE
  USING ((get_my_profile()).role IN ('admin', 'owner'));

-- ─── ORDER_ITEMS policies ─────────────────────────────────
CREATE POLICY "order_items_select_all"
  ON order_items FOR SELECT
  USING ((get_my_profile()) IS NOT NULL);

CREATE POLICY "order_items_insert_all"
  ON order_items FOR INSERT
  WITH CHECK ((get_my_profile()) IS NOT NULL);

CREATE POLICY "order_items_delete_admin_owner"
  ON order_items FOR DELETE
  USING ((get_my_profile()).role IN ('admin', 'owner'));

-- ─── PAYMENTS policies ────────────────────────────────────
CREATE POLICY "payments_select_worker_today"
  ON payments FOR SELECT
  USING (
    (get_my_profile()).role IN ('admin', 'owner')
    OR (
      (get_my_profile()).role = 'worker'
      AND created_at >= CURRENT_DATE
    )
  );

CREATE POLICY "payments_insert_all"
  ON payments FOR INSERT
  WITH CHECK ((get_my_profile()) IS NOT NULL);

-- ─── SALARIES policies ────────────────────────────────────
CREATE POLICY "salaries_select_admin_owner"
  ON salaries FOR SELECT
  USING ((get_my_profile()).role IN ('admin', 'owner'));

CREATE POLICY "salaries_modify_admin_owner"
  ON salaries FOR ALL
  USING ((get_my_profile()).role IN ('admin', 'owner'));
