import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { translateDbError } from '@/lib/errors'
import { formatEGP } from '@/lib/utils'
import { getActiveProducts, invalidateProductsCache } from '@/lib/data-service'
import type { Product } from '@/types/database'

interface AddProductToSessionModalProps {
  isOpen: boolean
  sessionId: string
  onClose: () => void
  onSuccess: () => void
}

export function AddProductToSessionModal({
  isOpen,
  sessionId,
  onClose,
  onSuccess,
}: AddProductToSessionModalProps) {
  const { activeTenant } = useAuth()
  const tenantId = activeTenant?.id ?? null

  const [products, setProducts] = useState<Product[]>([])
  const [selected, setSelected] = useState<Product | null>(null)
  const [qty, setQty] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen || !tenantId) return
    getActiveProducts(tenantId).then(setProducts).catch(console.error)
  }, [isOpen, tenantId])

  const handleAdd = async () => {
    if (!selected) {
      setError('اختر منتجاً أولاً')
      return
    }
    if (qty < 1) {
      setError('الكمية يجب أن تكون 1 على الأقل')
      return
    }
    if (selected.stock_qty < qty) {
      setError(`الكمية المتاحة ${selected.stock_qty} فقط`)
      return
    }

    setIsLoading(true)
    setError('')
    try {
      // The RPC creates/reuses the session order, snapshots the product price,
      // deducts stock, and validates the tenant — atomically.
      const { error: rpcError } = await supabase.rpc('add_product_to_session', {
        p_session_id: sessionId,
        p_product_id: selected.id,
        p_qty: qty,
      })

      if (rpcError) throw rpcError

      invalidateProductsCache(tenantId)
      setSelected(null)
      setQty(1)
      onSuccess()
      onClose()
    } catch (err) {
      setError(translateDbError(err, 'تعذر إضافة المنتج'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setSelected(null)
    setQty(1)
    setError('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="إضافة منتج للجلسة">
      <div className="flex flex-col gap-4">
        {/* Products grid */}
        <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
          {products.map(product => {
            const outOfStock = product.stock_qty === 0
            return (
              <button
                key={product.id}
                disabled={outOfStock}
                onClick={() => {
                  setSelected(product)
                  setQty(1)
                }}
                className={`p-3 rounded-lg border text-right transition-colors ${
                  selected?.id === product.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : outOfStock
                      ? 'border-card-border opacity-40 cursor-not-allowed text-on-surface-variant'
                      : 'border-card-border hover:border-primary/50 text-on-surface'
                }`}
              >
                <p className="font-semibold text-sm">{product.name}</p>
                <p className="text-xs mt-0.5 tabular-nums">{formatEGP(product.price)}</p>
                {outOfStock ? (
                  <p className="text-xs text-busy mt-0.5">خلص</p>
                ) : (
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    متاح: {product.stock_qty}
                  </p>
                )}
              </button>
            )
          })}
          {products.length === 0 && (
            <p className="col-span-2 text-sm text-on-surface-variant text-center py-6">
              لا توجد منتجات متاحة
            </p>
          )}
        </div>

        {/* Quantity */}
        {selected && (
          <div className="flex items-center justify-between bg-surface-container rounded-lg p-3">
            <span className="text-sm font-semibold text-on-surface">{selected.name}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setQty(q => Math.max(1, q - 1))}
                className="w-9 h-9 rounded-DEFAULT bg-surface-container-high flex items-center justify-center
                  text-lg font-bold hover:bg-surface-container-highest"
              >
                −
              </button>
              <span className="text-lg font-bold tabular-nums w-8 text-center">{qty}</span>
              <button
                onClick={() => setQty(q => Math.min(selected.stock_qty, q + 1))}
                className="w-9 h-9 rounded-DEFAULT bg-surface-container-high flex items-center justify-center
                  text-lg font-bold hover:bg-surface-container-highest"
              >
                +
              </button>
            </div>
          </div>
        )}

        {selected && (
          <p className="text-sm text-on-surface-variant text-center">
            الإجمالي:{' '}
            <span className="font-bold text-on-surface tabular-nums">
              {formatEGP(selected.price * qty)}
            </span>
          </p>
        )}

        {error && <p className="text-sm text-busy">{error}</p>}

        <Button
          variant="primary"
          fullWidth
          onClick={handleAdd}
          isLoading={isLoading}
          disabled={!selected}
        >
          إضافة للجلسة
        </Button>
      </div>
    </Modal>
  )
}
