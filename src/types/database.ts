// ─────────────────────────────────────────────
// Supabase Database Type Definitions
// ─────────────────────────────────────────────
// Role mapping:
//   platform_admins            → Super Admin (platform-wide)
//   memberships.role = owner   → Tenant Owner
//   memberships.role = admin   → Tenant Admin
//   memberships.role = worker  → Staff
// ─────────────────────────────────────────────

export type UserRole = 'admin' | 'owner' | 'worker'
export type MembershipRole = UserRole
export type DeviceStatus = 'available' | 'busy' | 'maintenance'
export type SessionMode = 'open' | 'fixed'
export type SessionStatus = 'active' | 'closed'
export type ProductCategory = 'drinks' | 'snacks' | 'other'
export type RoundingMode = 'nearest_pound' | 'nearest_5_pounds' | 'up_5_minutes'
export type PlayType = 'single' | 'multi'

export interface Tenant {
  id: string
  name: string
  slug: string
  is_active: boolean
  created_at: string
  updated_at?: string
}

export interface Profile {
  id: string
  username: string
  /** Legacy plaintext column. Removed by migration 09 and never read by the app. */
  password?: string | null
  clerk_user_id?: string | null
  email?: string | null
  name: string
  /** Global legacy role. Authorization uses memberships.role instead. */
  role: UserRole
  is_active: boolean
  created_at: string
}

export interface Membership {
  id: string
  tenant_id: string
  user_id: string
  role: MembershipRole
  is_active: boolean
  created_at: string
  // Joined
  tenant?: Tenant
  profile?: Profile
}

export interface Invitation {
  id: string
  tenant_id: string
  email: string
  role: MembershipRole
  token: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invited_by: string | null
  expires_at: string
  accepted_at: string | null
  created_at: string
}

export interface Device {
  id: string
  tenant_id: string
  name: string
  hourly_price: number
  hourly_price_multi?: number | null
  status: DeviceStatus
  is_active: boolean
  created_at: string
}

export interface Product {
  id: string
  tenant_id: string
  name: string
  price: number
  stock_qty: number
  category: ProductCategory
  is_active: boolean
  created_at: string
}

export interface Session {
  id: string
  tenant_id: string
  device_id: string
  mode: SessionMode
  planned_minutes: number | null
  hourly_price_snapshot: number
  started_at: string
  ended_at: string | null
  time_amount: number | null
  status: SessionStatus
  created_by: string | null
  created_at: string
  // Joined
  device?: Device
  price_periods?: SessionPricePeriod[]
}

export interface Order {
  id: string
  tenant_id: string
  session_id: string | null
  total: number
  paid_amount: number
  discount_amount?: number
  notes?: string | null
  created_by: string | null
  created_at: string
  // Joined
  order_items?: OrderItem[]
  session?: Session
  creator?: Profile
}

export type AuditActionType =
  | 'end_session'
  | 'discount_applied'
  | 'partial_payment'
  | 'debt_settlement'
  | 'price_change'
  | 'general'
  | 'quick_sale'
  | 'tenant_created'
  | 'tenant_updated'
  | 'tenant_activated'
  | 'tenant_suspended'
  | 'user_added'
  | 'user_removed'
  | 'membership_role_changed'
  | 'membership_activated'
  | 'membership_suspended'

export interface AuditLog {
  id: string
  tenant_id: string
  action_type: AuditActionType | string
  session_id?: string | null
  device_name?: string | null
  user_id?: string | null
  user_name: string
  expected_amount: number
  paid_amount: number
  discount_amount: number
  remaining_amount: number
  notes?: string | null
  created_at: string
}

export interface OrderItem {
  id: string
  tenant_id: string
  order_id: string
  product_id: string
  product_name_snapshot: string
  unit_price_snapshot: number
  qty: number
}

export interface Payment {
  id: string
  tenant_id: string
  session_id: string | null
  order_id: string | null
  amount: number
  created_by: string | null
  created_at: string
  // Joined
  creator?: Pick<Profile, 'name'>
}

export interface AppSettings {
  id: string
  tenant_id: string
  rounding_mode: RoundingMode
  day_start_hour: number
  low_stock_threshold: number
}

/** One price period within a session (created when switching Single ↔ Multi). */
export interface SessionPricePeriod {
  id: string
  tenant_id: string
  session_id: string
  play_type: PlayType
  hourly_price: number
  started_at: string
  ended_at: string | null
  created_by: string | null
  created_at: string
}

export interface Salary {
  id: string
  tenant_id: string
  user_id: string
  month: number
  year: number
  base_salary: number
  bonus: number
  deductions: number
  notes: string | null
  paid_at: string | null
  created_by: string | null
  created_at: string
  // Joined
  profile?: Profile
}

// ─── RPC result shapes ─────────────────────────────────────────────────────
export interface MyContext {
  profile: Profile | null
  is_platform_admin: boolean
  memberships: Membership[]
}

export interface CloseSessionResult {
  order_id: string
  time_amount: number
  products_total: number
  gross_total: number
  discount: number
  net_due: number
  collected: number
  remaining: number
  manager?: string | null
}

export interface QuickSaleResult {
  order_id: string
  total: number
  paid: number
  remaining: number
}

export interface SettleDebtResult {
  order_id: string
  paid_amount: number
  remaining: number
}

export interface ManagerVerification {
  ok: boolean
  name?: string
  role?: MembershipRole
}

// ─── Tenant dashboard row (joined) ─────────────────────────────────────────
export interface TenantWithMembers extends Tenant {
  memberships?: Array<
    Pick<Membership, 'id' | 'role' | 'is_active' | 'user_id'> & {
      profile?: Pick<Profile, 'id' | 'name' | 'email' | 'username' | 'is_active'>
    }
  >
}

// ─── Supabase Database schema type for the client ──────────────────────────
type TableDef<Row, Insert, Update> = {
  Row: Row & Record<string, unknown>
  Insert: Insert & Record<string, unknown>
  Update: Update & Record<string, unknown>
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      profiles: TableDef<
        Profile,
        Omit<Profile, 'id' | 'created_at'> & { id?: string },
        Partial<Omit<Profile, 'id' | 'created_at'>>
      >
      tenants: TableDef<
        Tenant,
        Omit<Tenant, 'id' | 'created_at' | 'updated_at'> & { id?: string },
        Partial<Omit<Tenant, 'id' | 'created_at' | 'updated_at'>>
      >
      memberships: TableDef<
        Membership,
        Omit<Membership, 'id' | 'created_at' | 'tenant' | 'profile'> & { id?: string },
        Partial<Pick<Membership, 'role' | 'is_active'>>
      >
      invitations: TableDef<
        Invitation,
        Omit<Invitation, 'id' | 'created_at' | 'token' | 'expires_at' | 'accepted_at'> & {
          id?: string
          token?: string
          expires_at?: string
          accepted_at?: string | null
        },
        Partial<Pick<Invitation, 'status' | 'role' | 'accepted_at'>>
      >
      devices: TableDef<
        Device,
        Omit<Device, 'id' | 'created_at'> & { id?: string; created_at?: string },
        Partial<Omit<Device, 'id' | 'created_at'>>
      >
      products: TableDef<
        Product,
        Omit<Product, 'id' | 'created_at'> & { id?: string; created_at?: string },
        Partial<Omit<Product, 'id' | 'created_at'>>
      >
      sessions: TableDef<
        Session,
        Omit<Session, 'id' | 'created_at' | 'device'> & { id?: string },
        Partial<Omit<Session, 'id' | 'created_at' | 'device'>>
      >
      orders: TableDef<
        Order,
        Omit<Order, 'id' | 'created_at' | 'order_items' | 'session' | 'creator'> & { id?: string },
        Partial<Omit<Order, 'id' | 'created_at' | 'order_items' | 'session' | 'creator'>>
      >
      order_items: TableDef<
        OrderItem,
        Omit<OrderItem, 'id'> & { id?: string },
        Partial<Omit<OrderItem, 'id'>>
      >
      payments: TableDef<
        Payment,
        Omit<Payment, 'id' | 'created_at' | 'creator'> & { id?: string },
        Partial<Omit<Payment, 'id' | 'created_at' | 'creator'>>
      >
      settings: TableDef<
        AppSettings,
        Omit<AppSettings, 'id'> & { id?: string },
        Partial<Omit<AppSettings, 'id'>>
      >
      salaries: TableDef<
        Salary,
        Omit<Salary, 'id' | 'created_at' | 'profile'> & { id?: string },
        Partial<Omit<Salary, 'id' | 'created_at' | 'profile'>>
      >
      audit_logs: TableDef<
        AuditLog,
        Omit<AuditLog, 'id' | 'created_at'> & { id?: string },
        Partial<Omit<AuditLog, 'id' | 'created_at'>>
      >
      session_price_history: TableDef<
        SessionPricePeriod,
        Omit<SessionPricePeriod, 'id' | 'created_at'> & { id?: string },
        Partial<Omit<SessionPricePeriod, 'id' | 'created_at'>>
      >
    }
    Views: Record<string, never>
    Functions: {
      is_platform_admin: { Args: Record<string, never>; Returns: boolean }
      resolve_login_email: { Args: { p_identifier: string }; Returns: string | null }
      get_my_context: { Args: Record<string, never>; Returns: MyContext }
      create_tenant: {
        Args: {
          p_name: string
          p_slug: string
          p_owner_email: string
          p_owner_password: string
          p_owner_name: string
          p_owner_username?: string | null
        }
        Returns: string
      }
      update_tenant: {
        Args: { p_tenant_id: string; p_name: string; p_slug: string }
        Returns: undefined
      }
      set_tenant_status: {
        Args: { p_tenant_id: string; p_is_active: boolean }
        Returns: undefined
      }
      admin_create_tenant_user: {
        Args: {
          p_tenant_id: string
          p_email: string
          p_password: string
          p_name: string
          p_username: string
          p_role?: MembershipRole
        }
        Returns: string
      }
      admin_set_membership_role: {
        Args: { p_membership_id: string; p_role: MembershipRole }
        Returns: undefined
      }
      admin_set_membership_active: {
        Args: { p_membership_id: string; p_is_active: boolean }
        Returns: undefined
      }
      admin_remove_membership: { Args: { p_membership_id: string }; Returns: undefined }
      admin_set_profile_active: {
        Args: { p_user_id: string; p_is_active: boolean }
        Returns: undefined
      }
      admin_set_user_password: {
        Args: { p_user_id: string; p_new_password: string }
        Returns: undefined
      }
      change_my_password: {
        Args: { p_old_password: string; p_new_password: string }
        Returns: undefined
      }
      verify_manager_password: {
        Args: { p_manager_id: string; p_password: string }
        Returns: ManagerVerification | null
      }
      start_session: {
        Args: { p_device_id: string; p_mode: SessionMode; p_planned_minutes?: number | null; p_hourly_price?: number | null }
        Returns: string
      }
      add_product_to_session: {
        Args: { p_session_id: string; p_product_id: string; p_qty: number }
        Returns: string
      }
      quick_sale: {
        Args: { p_items: Array<{ product_id: string; qty: number }>; p_paid?: number }
        Returns: QuickSaleResult
      }
      close_session: {
        Args: {
          p_session_id: string
          p_received: number
          p_discount?: number
          p_discount_reason?: string | null
          p_manager_id?: string | null
          p_manager_password?: string | null
          p_note?: string | null
        }
        Returns: CloseSessionResult
      }
      settle_debt: {
        Args: { p_order_id: string; p_amount: number }
        Returns: SettleDebtResult
      }
      set_device_status: {
        Args: { p_device_id: string; p_status: 'available' | 'maintenance' }
        Returns: undefined
      }
      change_session_price: {
        Args: { p_session_id: string; p_hourly_price: number }
        Returns: { ok: boolean; hourly_price_snapshot: number; play_type?: string; skipped?: boolean }
      }
      calc_session_total_by_periods: {
        Args: { p_session_id: string; p_rounding_mode?: string; p_end_time?: string }
        Returns: number
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
