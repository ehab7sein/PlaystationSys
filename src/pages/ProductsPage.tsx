import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Eye, EyeOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { formatEGP } from '@/lib/utils'
import { translateDbError } from '@/lib/errors'
import { invalidateProductsCache } from '@/lib/data-service'
import type { Product, ProductCategory } from '@/types/database'

const CATEGORIES: { value: ProductCategory; label: string }[] = [
  { value: 'drinks', label: 'مشروبات' },
  { value: 'snacks', label: 'سناكس' },
  { value: 'other', label: 'أخرى' },
]

export function ProductsPage() {
  const { canManagePrices, activeTenant } = useAuth()
  const tenantId = activeTenant?.id ?? null
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editProduct, setEditProduct] = useState<Product | null>(null)

  const fetchProducts = useCallback(async () => {
    if (!tenantId) {
      setIsLoading(false)
      return
    }
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('name')
    if (data) setProducts(data as Product[])
    setIsLoading(false)
  }, [tenantId])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  const handleToggleActive = async (product: Product) => {
    if (!tenantId) return
    const { error } = await supabase
      .from('products')
      .update({ is_active: !product.is_active })
      .eq('id', product.id)
      .eq('tenant_id', tenantId)
    if (error) {
      console.error('Failed to toggle product:', error)
    } else {
      invalidateProductsCache(tenantId)
    }
    fetchProducts()
  }

  const openEdit = (product: Product) => {
    setEditProduct(product)
    setShowModal(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-on-surface">المنتجات</h1>
        {canManagePrices && (
          <Button onClick={() => { setEditProduct(null); setShowModal(true) }}>
            <Plus className="w-4 h-4" /> إضافة منتج
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-on-surface-variant">جاري التحميل...</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.map(product => (
            <Card key={product.id} className={`flex flex-col gap-2 ${!product.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-on-surface">{product.name}</p>
                  <p className="text-xs text-on-surface-variant">
                    {CATEGORIES.find(c => c.value === product.category)?.label ?? 'أخرى'}
                  </p>
                </div>
                {canManagePrices && (
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(product)}
                      className="p-1.5 rounded text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleToggleActive(product)}
                      className="p-1.5 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors">
                      {product.is_active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-auto">
                <p className="text-xl font-bold tabular-nums text-primary">{formatEGP(product.price)}</p>
                <p className={`text-xs mt-1 ${product.stock_qty === 0 ? 'text-busy font-semibold' : 'text-on-surface-variant'}`}>
                  {product.stock_qty === 0 ? 'خلص' : `المخزون: ${product.stock_qty}`}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ProductModal
        isOpen={showModal}
        product={editProduct}
        onClose={() => setShowModal(false)}
        onSuccess={() => { fetchProducts(); setShowModal(false) }}
      />
    </div>
  )
}

// ─── Product Add/Edit Modal ───────────────────────────────
interface ProductModalProps {
  isOpen: boolean
  product: Product | null
  onClose: () => void
  onSuccess: () => void
}

function ProductModal({ isOpen, product, onClose, onSuccess }: ProductModalProps) {
  const { activeTenant } = useAuth()
  const tenantId = activeTenant?.id ?? null
  const [form, setForm] = useState({
    name: '',
    price: '',
    stock_qty: '',
    category: 'other' as ProductCategory,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name,
        price: String(product.price),
        stock_qty: String(product.stock_qty),
        category: product.category,
      })
    } else {
      setForm({ name: '', price: '', stock_qty: '', category: 'other' })
    }
    setError('')
  }, [product, isOpen])

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('اسم المنتج مطلوب'); return }
    if (!form.price || isNaN(Number(form.price))) { setError('السعر غير صحيح'); return }
    if (form.stock_qty === '' || isNaN(Number(form.stock_qty))) { setError('الكمية غير صحيحة'); return }

    setIsLoading(true)
    setError('')
    const payload = {
      name: form.name.trim(),
      price: Number(form.price),
      stock_qty: Number(form.stock_qty),
      category: form.category,
    }

    try {
      if (!tenantId) throw new Error('لا يوجد محل نشط')
      if (product) {
        const { error: updateError } = await supabase
          .from('products')
          .update(payload)
          .eq('id', product.id)
          .eq('tenant_id', tenantId)
        if (updateError) throw updateError
      } else {
        const { error: insertError } = await supabase
          .from('products')
          .insert({ ...payload, tenant_id: tenantId, is_active: true })
        if (insertError) throw insertError
      }
      invalidateProductsCache(tenantId)
      onSuccess()
    } catch (err: any) {
      setError(translateDbError(err, 'حدث خطأ أثناء حفظ المنتج'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={product ? 'تعديل منتج' : 'إضافة منتج جديد'}>
      <div className="flex flex-col gap-4">
        <Input
          label="اسم المنتج"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="مثال: بيبسي"
        />
        <Input
          label="السعر (جنيه)"
          type="number"
          value={form.price}
          onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
          placeholder="10"
          min="0"
        />
        <Input
          label="الكمية في المخزون"
          type="number"
          value={form.stock_qty}
          onChange={e => setForm(f => ({ ...f, stock_qty: e.target.value }))}
          placeholder="50"
          min="0"
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-on-surface-variant">التصنيف</label>
          <div className="flex gap-2">
            {CATEGORIES.map(cat => (
              <button
                key={cat.value}
                onClick={() => setForm(f => ({ ...f, category: cat.value }))}
                className={`flex-1 py-2 rounded-DEFAULT border text-sm font-semibold transition-colors ${
                  form.category === cat.value
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'border-outline-variant text-on-surface-variant hover:border-primary/50'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-busy">{error}</p>}

        <Button fullWidth size="lg" onClick={handleSubmit} isLoading={isLoading}>
          {product ? 'حفظ التعديلات' : 'إضافة المنتج'}
        </Button>
      </div>
    </Modal>
  )
}
