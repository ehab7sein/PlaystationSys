// ─────────────────────────────────────────────
// Supabase Database Type Definitions
// ─────────────────────────────────────────────

export type UserRole = 'admin' | 'owner' | 'worker'
export type DeviceStatus = 'available' | 'busy' | 'maintenance'
export type SessionMode = 'open' | 'fixed'
export type SessionStatus = 'active' | 'closed'
export type ProductCategory = 'drinks' | 'snacks' | 'other'
export type RoundingMode = 'nearest_pound' | 'nearest_5_pounds' | 'up_5_minutes'

export interface Profile {
  id: string
  clerk_user_id: string
  name: string
  role: UserRole
  is_active: boolean
  created_at: string
}

export interface Device {
  id: string
  name: string
  hourly_price: number
  status: DeviceStatus
  is_active: boolean
  created_at: string
}

export interface Product {
  id: string
  name: string
  price: number
  stock_qty: number
  category: ProductCategory
  is_active: boolean
  created_at: string
}

export interface Session {
  id: string
  device_id: string
  mode: SessionMode
  planned_minutes: number | null
  hourly_price_snapshot: number
  started_at: string
  ended_at: string | null
  time_amount: number | null
  status: SessionStatus
  created_by: string
  created_at: string
  // Joined
  device?: Device
}

export interface Order {
  id: string
  session_id: string | null
  total: number
  paid_amount: number
  created_by: string
  created_at: string
  // Joined
  order_items?: OrderItem[]
  session?: Session
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  product_name_snapshot: string
  unit_price_snapshot: number
  qty: number
}

export interface Payment {
  id: string
  session_id: string | null
  order_id: string | null
  amount: number
  created_by: string
  created_at: string
}

export interface AppSettings {
  id: string
  rounding_mode: RoundingMode
  day_start_hour: number
  low_stock_threshold: number
}

export interface Salary {
  id: string
  user_id: string
  month: number
  year: number
  base_salary: number
  bonus: number
  deductions: number
  notes: string | null
  paid_at: string | null
  created_by: string
  created_at: string
  // Joined
  profile?: Profile
}

// Supabase Database schema type for the client
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Omit<Profile, 'id' | 'created_at'>
        Update: Partial<Omit<Profile, 'id' | 'created_at'>>
      }
      devices: {
        Row: Device
        Insert: Omit<Device, 'id' | 'created_at'>
        Update: Partial<Omit<Device, 'id' | 'created_at'>>
      }
      products: {
        Row: Product
        Insert: Omit<Product, 'id' | 'created_at'>
        Update: Partial<Omit<Product, 'id' | 'created_at'>>
      }
      sessions: {
        Row: Session
        Insert: Omit<Session, 'id' | 'created_at' | 'device'>
        Update: Partial<Omit<Session, 'id' | 'created_at' | 'device'>>
      }
      orders: {
        Row: Order
        Insert: Omit<Order, 'id' | 'created_at' | 'order_items' | 'session'>
        Update: Partial<Omit<Order, 'id' | 'created_at' | 'order_items' | 'session'>>
      }
      order_items: {
        Row: OrderItem
        Insert: Omit<OrderItem, 'id'>
        Update: Partial<Omit<OrderItem, 'id'>>
      }
      payments: {
        Row: Payment
        Insert: Omit<Payment, 'id' | 'created_at'>
        Update: Partial<Omit<Payment, 'id' | 'created_at'>>
      }
      settings: {
        Row: AppSettings
        Insert: Omit<AppSettings, 'id'>
        Update: Partial<Omit<AppSettings, 'id'>>
      }
      salaries: {
        Row: Salary
        Insert: Omit<Salary, 'id' | 'created_at' | 'profile'>
        Update: Partial<Omit<Salary, 'id' | 'created_at' | 'profile'>>
      }
    }
  }
}
