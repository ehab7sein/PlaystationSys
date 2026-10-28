import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { translateDbError } from '@/lib/errors'
import { formatEGP } from '@/lib/utils'
import { getActiveProducts, invalidateProductsCache } from '@/lib/data-service'
import type { Product } from '@/types/database'

interface QuickSaleModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

interface CartItem {
  product: Product
  qty: number
}

export function QuickSaleModal({ isOpen, onClose, onSuccess }: QuickSaleModalProps) {
  const { activeTenant } = useAuth()
  const tenantId = activeTenant?.id ?? null

  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [paidAmount, setPaidAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen || !tenantId) return
    getActiveProducts(tenantId).then(setProducts).catch(console.error)
  }, [isOpen, tenantId])

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(c => c.product.id === product.id)
      if (existing) {
        if (existing.qty >= product.stock_qty) return prev
        return prev.map(c =>
          c.product.id === product.id ? { ...c, qty: c.qty + 1 } : c
        )
      }
      if (product.stock_qty === 0) return prev
      return [...prev, { product, qty: 1 }]
    })
  }

  const updateQty = (productId: string, delta: number) => {
    setCart(prev =>
      prev
        .map(c => (c.product.id === productId ? { ...c, qty: c.qty + delta } : c))
        .filter(c => c.qty > 0)
    )
  }

  const total = cart.reduce((sum, c) => sum + c.product.price * c.qty, 0)

  const handleConfirm = async () => {
    if (cart.length === 0) {
      setError('أضف منتجاً واحداً على الأقل')
      return
    }

    setIsLoading(true)
    setError('')
    try {
      // The RPC recomputes the total from DB prices, checks stock, writes the
      // order + items + payment, and logs an audit row — all atomically.
      const { error: rpcError } = await supabase.rpc('quick_sale', {
        p_items: cart.map(c => ({ product_id: c.product.id, qty: c.qty })),
        p_paid: total,
      })

      if (rpcError) throw rpcError

      invalidateProductsCache(tenantId)
      setCart([])
      setPaidAmount('')
      onSuccess()
      onClose()
    } catch (err) {
      setError(translateDbError(err, 'تعذر إتمام البيع'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setCart([])
    setPaidAmount('')
    setError('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="بيع منتج سريع" size="lg">
      <div className="flex flex-col gap-4">
        {/* Products */}
        <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
          {products.map(product => (
            <button
              key={product.id}
              disabled={product.stock_qty === 0}
              onClick={() => addToCart(product)}
              className={`p-2.5 rounded-lg border text-right transition-colors text-sm ${
                product.stock_qty === 0
                  ? 'border-card-border opacity-40 cursor-not-allowed'
                  : 'border-card-border hover:border-primary/50 hover:bg-primary/5 text-on-surface'
              }`}
            >
              <p className="font-semibold truncate">{product.name}</p>
              <p className="text-xs tabular-nums text-primary mt-0.5">
                {formatEGP(product.price)}
              </p>
              {product.stock_qty === 0 && <p className="text-xs text-busy">خلص</p>}
            </button>
          ))}
          {products.length === 0 && (
            <p className="col-span-3 text-sm text-on-surface-variant text-center py-6">
              لا توجد منتجات متاحة
            </p>
          )}
        </div>

        {/* Cart */}
        {cart.length > 0 && (
          <div className="border border-card-border rounded-lg overflow-hidden">
            {cart.map(item => (
              <div
                key={item.product.id}
                className="flex items-center justify-between px-3 py-2 border-b border-card-border last:border-0"
              >
                <span className="text-sm text-on-surface">{item.product.name}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateQty(item.product.id, -1)}
                    className="w-7 h-7 rounded bg-surface-container-high flex items-center justify-center text-sm font-bold"
                  >
                    −
                  </button>
                  <span className="text-sm font-bold tabular-nums w-6 text-center">
                    {item.qty}
                  </span>
                  <button
                    onClick={() => updateQty(item.product.id, 1)}
                    className="w-7 h-7 rounded bg-surface-container-high flex items-center justify-center text-sm font-bold"
                  >
                    +
                  </button>
                  <span className="text-sm tabular-nums w-16 text-left">
                    {formatEGP(item.product.price * item.qty)}
                  </span>
                </div>
              </div>
            ))}
            <div className="flex justify-between px-3 py-2 font-bold bg-surface-container-high">
              <span>الإجمالي</span>
              <span className="tabular-nums text-primary">{formatEGP(total)}</span>
            </div>
          </div>
        )}

        {/* Payment */}
        {cart.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-on-surface-variant">الإجمالي</span>
              <span className="text-xl font-bold tabular-nums text-primary">{formatEGP(total)}</span>
            </div>
            <div className="flex items-center justify-center gap-2 rounded-lg border border-available/30 bg-available/10 px-3 py-2 text-sm font-bold text-available">
              <span>✓</span>
              <span>سيتم سداد المبلغ كاملًا وإضافته للإيراد</span>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-busy">{error}</p>}

        <Button
          variant="primary"
          fullWidth
          size="lg"
          onClick={handleConfirm}
          isLoading={isLoading}
          disabled={cart.length === 0}
        >
          تأكيد البيع
        </Button>
      </div>
    </Modal>
  )
}
