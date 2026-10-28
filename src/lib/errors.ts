// Maps the stable error codes raised by the SQL RPCs to Arabic UI messages.
// The SQL functions raise plain codes (e.g. 'FORBIDDEN') so the UI never has
// to show a raw Postgres error.

const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى',
  FORBIDDEN: 'ليس لديك صلاحية لتنفيذ هذا الإجراء',
  INVALID_MODE: 'نوع الجلسة غير صحيح',
  PLANNED_MINUTES_REQUIRED: 'اختر مدة الجلسة',
  DEVICE_NOT_FOUND: 'الجهاز غير موجود',
  DEVICE_INACTIVE: 'هذا الجهاز غير مفعّل',
  DEVICE_NOT_AVAILABLE: 'هذا الجهاز غير متاح الآن',
  DEVICE_ALREADY_BUSY: 'هذا الجهاز مشغول بالفعل',
  DEVICE_HAS_ACTIVE_SESSION: 'لا يمكن تغيير حالة جهاز عليه جلسة جارية',
  DEVICE_STATUS_REQUIRES_SESSION: 'لا يمكن تغيير حالة الجهاز إلا من خلال جلسة',
  INVALID_STATUS: 'حالة الجهاز غير صحيحة',
  SESSION_NOT_FOUND: 'الجلسة غير موجودة',
  SESSION_NOT_ACTIVE: 'هذه الجلسة ليست نشطة',
  SESSION_ALREADY_CLOSED: 'تم إغلاق هذه الجلسة بالفعل',
  PRODUCT_NOT_FOUND: 'المنتج غير موجود',
  PRODUCT_INACTIVE: 'هذا المنتج غير مفعّل',
  PRODUCT_TENANT_MISMATCH: 'المنتج لا يتبع نفس المحل',
  INSUFFICIENT_STOCK: 'الكمية المتوفرة غير كافية',
  INVALID_QTY: 'الكمية غير صحيحة',
  EMPTY_CART: 'أضف منتجاً واحداً على الأقل',
  INVALID_AMOUNT: 'المبلغ غير صحيح',
  AMOUNT_EXCEEDS_REMAINING: 'المبلغ أكبر من المتبقي على الطلب',
  ORDER_NOT_FOUND: 'الطلب غير موجود',
  MANAGER_APPROVAL_REQUIRED: 'هذا الإجراء يحتاج اعتماد مدير',
  INVALID_MANAGER_APPROVAL: 'بيانات اعتماد المدير غير صحيحة',
  DISCOUNT_REASON_REQUIRED: 'اكتب سبب الخصم',
  NOTE_REQUIRED_FOR_PARTIAL: 'اكتب ملاحظة توضح سبب عدم اكتمال الدفع',
  TENANT_NAME_REQUIRED: 'اسم المحل مطلوب',
  SLUG_ALREADY_USED: 'الرابط المختصر مستخدم بالفعل',
  TENANT_NOT_FOUND: 'المحل غير موجود',
  MEMBERSHIP_NOT_FOUND: 'العضوية غير موجودة',
  PROFILE_NOT_FOUND: 'المستخدم غير موجود',
  AUTH_USER_NOT_FOUND: 'حساب الدخول غير موجود',
  INVALID_ROLE: 'الدور غير صحيح',
  ONLY_PLATFORM_ADMIN_CAN_ASSIGN_OWNER: 'تعيين مالك المحل متاح لإدارة المنصة فقط',
  CANNOT_MODIFY_TENANT_OWNER: 'لا يمكن تعديل حساب مالك المحل',
  OWNER_CAN_ONLY_CREATE_STAFF: 'مالك المحل يمكنه إضافة كاشير فقط',
  OWNER_CAN_ONLY_MANAGE_STAFF: 'مالك المحل يمكنه إدارة الكاشيرين فقط',
  OWNER_CANNOT_MODIFY_ADMIN: 'مالك المحل لا يمكنه تعديل مدير',
  CANNOT_REMOVE_LAST_OWNER: 'لا يمكن إزالة آخر مالك للمحل',
  CANNOT_SUSPEND_LAST_OWNER: 'لا يمكن إيقاف آخر مالك للمحل',
  CANNOT_REMOVE_YOURSELF: 'لا يمكنك إزالة نفسك من المحل',
  CANNOT_SUSPEND_YOURSELF: 'لا يمكنك إيقاف حسابك بنفسك',
  EMAIL_ALREADY_USED: 'هذا البريد مستخدم بالفعل',
  INVALID_EMAIL: 'البريد الإلكتروني غير صحيح',
  PASSWORD_TOO_SHORT: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
  INVALID_OLD_PASSWORD: 'كلمة المرور الحالية غير صحيحة',
  USE_CHANGE_MY_PASSWORD: 'استخدم خيار تغيير كلمة المرور الخاصة بحسابك',
  SALARY_USER_NOT_IN_TENANT: 'الموظف ليس عضواً نشطاً في هذا المحل',
  SALARY_CREATED_BY_IS_IMMUTABLE: 'لا يمكن تغيير منشئ سجل الراتب',
  AUDIT_LOG_IS_APPEND_ONLY: 'سجل الرقابة غير قابل للتعديل',
  TENANT_ID_IS_IMMUTABLE: 'لا يمكن نقل السجل إلى محل آخر',
  FORBIDDEN_DEVICE_FIELDS: 'لا يمكنك تعديل سعر أو اسم الجهاز',
  INVALID_PRICE: 'السعر المدخل غير صحيح',
  SAME_PRICE_SWITCH: 'الجلسة تعمل بالفعل على هذا السعر',
}

export function translateDbError(err: unknown, fallback = 'حدث خطأ، حاول مرة أخرى'): string {
  if (!err) return fallback
  const raw =
    typeof err === 'string'
      ? err
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message ?? '')
        : ''

  if (!raw) return fallback

  // The RPC raises exactly the code, but PostgREST may wrap it.
  const firstLine = raw.split('\n')[0].trim()
  if (MESSAGES[firstLine]) return MESSAGES[firstLine]

  for (const [code, message] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return message
  }

  // RLS / missing privilege
  if (raw.includes('row-level security') || raw.includes('permission denied')) {
    return 'ليس لديك صلاحية للوصول إلى هذه البيانات'
  }
  if (raw.includes('duplicate key')) {
    return 'هذا السجل موجود بالفعل'
  }
  if (raw.includes('JWT') || raw.includes('token')) {
    return 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى'
  }

  return fallback
}
