-- ============================================================================
-- 01 — Tenancy schema (tables, tenant_id columns, foreign keys, indexes)
-- ============================================================================
-- Purpose:
--   Introduce the multi-tenant entities (tenants, memberships, platform_admins,
--   invitations) and add a nullable tenant_id to every tenant-scoped table.
--
-- Prerequisites:
--   * Run this on the EXISTING database that already has the tables created by
--     supabase/schema.sql (profiles, settings, devices, products, sessions,
--     orders, order_items, payments, salaries, audit_logs).
--   * Take a full database backup / snapshot before running.
--
-- Execution:
--   Supabase Dashboard → SQL Editor (postgres role). Run one migration file at
--   a time. Never run this from the frontend and never expose a service-role
--   key in the browser.
--
-- Risks:
--   Adds tables, columns, foreign keys and indexes; DDL takes locks while it
--   runs. It does not modify existing rows. A re-run is guarded, but always
--   use a backup on production.
--
-- What it does NOT do:
--   * It does NOT make tenant_id NOT NULL (that is migration 02, after backfill).
--   * It does NOT enable the final RLS policies (that is migration 07).
--   * It does NOT change or delete any existing row.
--
-- Safe to re-run: yes (all objects are guarded).
--
-- Rollback:
--   DROP TABLE IF EXISTS public.invitations;
--   DROP TABLE IF EXISTS public.platform_admins;
--   DROP TABLE IF EXISTS public.memberships;
--   DROP TABLE IF EXISTS public.tenants;
--   ALTER TABLE ... DROP COLUMN IF EXISTS tenant_id;  (for each table below)
--   Only do this on a copy/after a backup; dropping columns loses tenant links.
-- ============================================================================

BEGIN;

-- Supabase installs uuid-ossp/pgcrypto in the `extensions` schema. Bare
-- PostgreSQL installs them in `public`; both are on this search path.
SET LOCAL search_path = public, extensions, pg_temp;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Tenants (customer accounts / systems) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenants (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  slug        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_unique
  ON public.tenants (lower(slug));

-- ─── Memberships (user ↔ tenant relationship + tenant-scoped role) ──────────
-- Role mapping:
--   owner  = Tenant Owner
--   admin  = Tenant Admin
--   worker = Staff
-- Super Admin is NOT stored here; it is stored in platform_admins.
CREATE TABLE IF NOT EXISTS public.memberships (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'worker'
                CHECK (role IN ('owner', 'admin', 'worker')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS memberships_user_idx
  ON public.memberships (user_id);
CREATE INDEX IF NOT EXISTS memberships_tenant_idx
  ON public.memberships (tenant_id);
CREATE INDEX IF NOT EXISTS memberships_tenant_role_idx
  ON public.memberships (tenant_id, role);

-- ─── Platform administrators (Super Admin) ──────────────────────────────────
-- Deliberately a separate table, NOT a role inside memberships, so a tenant
-- owner can never promote themselves to platform level.
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id     uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Invitations (audit-friendly record of users added by email) ────────────
CREATE TABLE IF NOT EXISTS public.invitations (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL DEFAULT 'worker'
                CHECK (role IN ('owner', 'admin', 'worker')),
  token       text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS invitations_tenant_email_unique
  ON public.invitations (tenant_id, lower(email));

-- ─── Add tenant_id to every tenant-scoped table ─────────────────────────────
ALTER TABLE public.settings    ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.devices     ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.products    ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.sessions    ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.orders      ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.payments    ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.salaries    ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.audit_logs  ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- ─── Foreign keys (guarded so this file can be re-run) ──────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'settings', 'devices', 'products', 'sessions', 'orders',
    'order_items', 'payments', 'salaries', 'audit_logs'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = t || '_tenant_id_fkey'
        AND conrelid = ('public.' || t)::regclass
    ) THEN
      -- RESTRICT protects tenant data: suspending is the supported operation,
      -- never deleting a tenant and cascading its financial history away.
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT',
        t, t || '_tenant_id_fkey'
      );
    END IF;
  END LOOP;
END $$;

-- ─── Indexes (tenant-first composite indexes keep queries fast as tenants grow)
CREATE INDEX IF NOT EXISTS settings_tenant_idx    ON public.settings (tenant_id);
CREATE INDEX IF NOT EXISTS devices_tenant_idx     ON public.devices (tenant_id);
CREATE INDEX IF NOT EXISTS products_tenant_idx    ON public.products (tenant_id);
CREATE INDEX IF NOT EXISTS sessions_tenant_idx    ON public.sessions (tenant_id);
CREATE INDEX IF NOT EXISTS sessions_tenant_status_started_idx
  ON public.sessions (tenant_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS orders_tenant_created_idx
  ON public.orders (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_tenant_session_idx
  ON public.orders (tenant_id, session_id);
CREATE INDEX IF NOT EXISTS order_items_tenant_order_idx
  ON public.order_items (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS payments_tenant_created_idx
  ON public.payments (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS salaries_tenant_period_idx
  ON public.salaries (tenant_id, year, month);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_created_idx
  ON public.audit_logs (tenant_id, created_at DESC);

COMMIT;
