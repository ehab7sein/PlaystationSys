-- =============================================
-- PlayStation Shop Management System
-- Database Schema + RLS Policies
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── PROFILES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_user_id   TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'worker' CHECK (role IN ('admin', 'owner', 'worker')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── SETTINGS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rounding_mode         TEXT NOT NULL DEFAULT 'nearest_5_pounds'
                          CHECK (rounding_mode IN ('nearest_pound', 'nearest_5_pounds', 'up_5_minutes')),
  day_start_hour        INT NOT NULL DEFAULT 6 CHECK (day_start_hour BETWEEN 0 AND 23),
  low_stock_threshold   INT NOT NULL DEFAULT 5
);

-- Insert default settings row if table is empty
INSERT INTO settings (rounding_mode, day_start_hour, low_stock_threshold)
SELECT 'nearest_5_pounds', 6, 5
WHERE NOT EXISTS (SELECT 1 FROM settings);

-- ─── DEVICES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  hourly_price  NUMERIC(10,2) NOT NULL DEFAULT 40,
  status        TEXT NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available', 'busy', 'maintenance')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sample starter devices if table is empty
INSERT INTO devices (name, hourly_price, status, is_active)
SELECT d.name, d.hourly_price, 'available', true
FROM (VALUES
  ('جهاز PS5 - 01', 50),
  ('جهاز PS5 - 02', 50),
  ('جهاز PS4 - 01', 30),
  ('جهاز PS4 - 02', 30)
) AS d(name, hourly_price)
WHERE NOT EXISTS (SELECT 1 FROM devices);

-- ─── PRODUCTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  price       NUMERIC(10,2) NOT NULL DEFAULT 0,
  stock_qty   INT NOT NULL DEFAULT 0,
  category    TEXT NOT NULL DEFAULT 'other'
                CHECK (category IN ('drinks', 'snacks', 'other')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sample starter products if table is empty
INSERT INTO products (name, price, stock_qty, category, is_active)
SELECT p.name, p.price, p.stock_qty, p.category, true
FROM (VALUES
  ('بيبسي كانز', 15, 24, 'drinks'),
  ('شيبسي عائلي', 12, 30, 'snacks'),
  ('مياه معدنية', 7, 40, 'drinks'),
  ('شاي / قهوة', 10, 50, 'drinks')
) AS p(name, price, stock_qty, category)
WHERE NOT EXISTS (SELECT 1 FROM products);

-- ─── SESSIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
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
CREATE UNIQUE INDEX IF NOT EXISTS sessions_device_active_unique
  ON sessions (device_id)
  WHERE status = 'active';

-- ─── ORDERS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID REFERENCES sessions(id),   -- NULL for standalone sales
  total       NUMERIC(10,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── ORDER ITEMS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id            UUID NOT NULL REFERENCES products(id),
  product_name_snapshot TEXT NOT NULL,
  unit_price_snapshot   NUMERIC(10,2) NOT NULL,
  qty                   INT NOT NULL DEFAULT 1 CHECK (qty > 0)
);

-- ─── PAYMENTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID REFERENCES sessions(id),
  order_id    UUID REFERENCES orders(id),
  amount      NUMERIC(10,2) NOT NULL,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── SALARIES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salaries (
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
-- POLICIES (Allowing operations from the client)
-- =============================================

-- Enable RLS
ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE salaries       ENABLE ROW LEVEL SECURITY;

-- Drop any previous restrictive policies to prevent errors
DO $$
BEGIN
  -- Drop existing policies if they exist
  DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
  DROP POLICY IF EXISTS "profiles_insert_all" ON profiles;
  DROP POLICY IF EXISTS "profiles_update_all" ON profiles;
  DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
  DROP POLICY IF EXISTS "profiles_select_admin_owner" ON profiles;
  DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;

  DROP POLICY IF EXISTS "settings_all" ON settings;
  DROP POLICY IF EXISTS "settings_select_all" ON settings;
  DROP POLICY IF EXISTS "settings_modify_admin_owner" ON settings;

  DROP POLICY IF EXISTS "devices_all" ON devices;
  DROP POLICY IF EXISTS "devices_select_all" ON devices;
  DROP POLICY IF EXISTS "devices_modify_admin_owner" ON devices;
  DROP POLICY IF EXISTS "devices_update_worker" ON devices;

  DROP POLICY IF EXISTS "products_all" ON products;
  DROP POLICY IF EXISTS "products_select_all" ON products;
  DROP POLICY IF EXISTS "products_modify_admin_owner" ON products;
  DROP POLICY IF EXISTS "products_update_worker" ON products;

  DROP POLICY IF EXISTS "sessions_all" ON sessions;
  DROP POLICY IF EXISTS "sessions_select_all" ON sessions;
  DROP POLICY IF EXISTS "sessions_insert_all" ON sessions;
  DROP POLICY IF EXISTS "sessions_update_all" ON sessions;

  DROP POLICY IF EXISTS "orders_all" ON orders;
  DROP POLICY IF EXISTS "orders_select_worker_today" ON orders;
  DROP POLICY IF EXISTS "orders_insert_all" ON orders;
  DROP POLICY IF EXISTS "orders_update_admin_owner" ON orders;

  DROP POLICY IF EXISTS "order_items_all" ON order_items;
  DROP POLICY IF EXISTS "order_items_select_all" ON order_items;
  DROP POLICY IF EXISTS "order_items_insert_all" ON order_items;
  DROP POLICY IF EXISTS "order_items_delete_admin_owner" ON order_items;

  DROP POLICY IF EXISTS "payments_all" ON payments;
  DROP POLICY IF EXISTS "payments_select_worker_today" ON payments;
  DROP POLICY IF EXISTS "payments_insert_all" ON payments;

  DROP POLICY IF EXISTS "salaries_all" ON salaries;
  DROP POLICY IF EXISTS "salaries_select_admin_owner" ON salaries;
  DROP POLICY IF EXISTS "salaries_modify_admin_owner" ON salaries;
END $$;

-- Permissive policies for the app client
CREATE POLICY "profiles_select_all" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert_all" ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "profiles_update_all" ON profiles FOR UPDATE USING (true);

CREATE POLICY "settings_all"    ON settings    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "devices_all"     ON devices     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "products_all"    ON products    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "sessions_all"    ON sessions    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "orders_all"      ON orders      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "order_items_all" ON order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "payments_all"    ON payments    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "salaries_all"    ON salaries    FOR ALL USING (true) WITH CHECK (true);

-- Enable Supabase Realtime for devices and sessions
ALTER PUBLICATION supabase_realtime ADD TABLE devices;
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE payments;
