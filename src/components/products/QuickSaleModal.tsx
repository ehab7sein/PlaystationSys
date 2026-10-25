import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { formatEGP } from '@/lib/utils'
import type { Product } from '@/types/database'

interface QuickSaleModalProps {
  isOpen: boolean
  userId: string
  onClose: () => void
  onSuccess: () => void
}

interface CartItem {
  product: Product
  qty: number
}

export function QuickSaleModal({ isOpen, userId, onClose, onSuccess }: QuickSaleModalProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [paidAmount, setPaidAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    supabase.from('products').select('*').eq('is_active', true).order('name')
      .then(({ data }) => { if (data) setProducts(data) })
  }, [isOpen])

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(c => c.product.id === product.id)
      if (existing) {
        if (existing.qty >= product.stock_qty) return prev
        return prev.map(c => c.product.id === product.id ? { ...c, qty: c.qty + 1 } : c)
      }
      if (product.stock_qty === 0) return prev
      return [...prev, { product, qty: 1 }]
    })
  }

  const updateQty = (productId: string, delta: number) => {
    setCart(prev =>
      prev
        .map(c => c.product.id === productId ? { ...c, qty: c.qty + delta } : c)
        .filter(c => c.qty > 0)
    )
  }

  const total = cart.reduce((sum, c) => sum + c.product.price * c.qty, 0)
  const paid = parseFloat(paidAmount) || 0
  const remaining = total - paid

  const handleConfirm = async () => {
    if (cart.length === 0) { setError('أضف منتجاً واحداً على الأقل'); return }
    if (paid > total) { setError(`المبلغ المدفوع أكبر من الإجمالي (${formatEGP(total)})`); return }

    setIsLoading(true)
    setError('')
    try {
      // Create order (no session)
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({ session_id: null, total, paid_amount: paid, created_by: userId })
        .select()
        .single()
      if (orderError) throw orderError

      // Insert order items & deduct stock
      for (const item of cart) {
        await supabase.from('order_items').insert({
          order_id: order.id,
          product_id: item.product.id,
          product_name_snapshot: item.product.name,
          unit_price_snapshot: item.product.price,
          qty: item.qty,
        })
        await supabase
          .from('products')
          .update({ stock_qty: item.product.stock_qty - item.qty })
          .eq('id', item.product.id)
      }

      // Record payment if any paid
      if (paid > 0) {
        await supabase.from('payments').insert({
          session_id: null,
          order_id: order.id,
          amount: paid,
          created_by: userId,
        })
      }

      setCart([])
      setPaidAmount('')
      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message || 'حدث خطأ')
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
              <p className="text-xs tabular-nums text-primary mt-0.5">{formatEGP(product.price)}</p>
              {product.stock_qty === 0 && <p className="text-xs text-busy">خلص</p>}
            </button>
          ))}
        </div>

        {/* Cart */}
        {cart.length > 0 && (
          <div className="border border-card-border rounded-lg overflow-hidden">
            {cart.map(item => (
              <div key={item.product.id} className="flex items-center justify-between px-3 py-2 border-b border-card-border last:border-0">
                <span className="text-sm text-on-surface">{item.product.name}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => updateQty(item.product.id, -1)}
                    className="w-7 h-7 rounded bg-surface-container-high flex items-center justify-center text-sm font-bold">−</button>
                  <span className="text-sm font-bold tabular-nums w-6 text-center">{item.qty}</span>
                  <button onClick={() => updateQty(item.product.id, 1)}
                    className="w-7 h-7 rounded bg-surface-container-high flex items-center justify-center text-sm font-bold">+</button>
                  <span className="text-sm tabular-nums w-16 text-left">{formatEGP(item.product.price * item.qty)}</span>
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
            <label className="text-sm font-semibold text-on-surface-variant">المبلغ المدفوع</label>
            <input
              type="number"
              value={paidAmount}
              onChange={e => setPaidAmount(e.target.value)}
              placeholder={String(total)}
              className="w-full px-3 py-2.5 rounded-DEFAULT bg-surface-container border border-outline-variant
                text-on-surface text-xl font-bold tabular-nums text-center
                focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            {paidAmount && (
              <p className={`text-sm text-center font-semibold ${remaining > 0 ? 'text-busy' : 'text-available'}`}>
                {remaining > 0 ? `متبقي: ${formatEGP(remaining)}` : '✓ مسدد بالكامل'}
              </p>
            )}
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
