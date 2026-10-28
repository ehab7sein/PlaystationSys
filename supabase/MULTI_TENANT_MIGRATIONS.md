# دليل تنفيذ ترحيل تعدد المحلات (Multi-Tenant) — KONTROL

> **حالة هذا الملف:** هذه تعليمات تشغيل يدوية. لم يتم تنفيذ أي SQL من داخل المستودع أو من خلال الوكيل، ولا يوجد في الواجهة أي مفتاح `service_role`.
>
> **مكان التنفيذ:** Supabase Dashboard → **SQL Editor** (بصلاحية `postgres`)، ملفاً واحداً في كل مرة وبالترتيب. لا تنفّذ هذه الملفات من المتصفح، ولا تضع `service_role` في `.env` الخاص بـ Vite.

---

## 1. ما الذي يحدث؟

الترحيل يحوّل قاعدة البيانات الحالية إلى قاعدة بيانات متعددة المحلات (multi-tenant) مع الحفاظ على البيانات الحالية:

- كل صف في الجداول التشغيلية يحصل على `tenant_id`.
- يوجد محل واحد للبيانات القديمة اسمه **«KONTROL»** (`kontrol`). الترحيل 02 ينشئه، والترحيل 11 يوحّد أي قاعدة قديمة فيها `kontrol-default` إلى الاسم/الرابط العاديين. هو محل عادي وليس تابعاً للوحة المنصة.
- الترحيل 12 يفصل حساب المنصة `admin` كـ Super Admin عن محل `KONTROL`، ويُبقي `ehab` مالكاً للمحل. عدّل أسماء المستخدمين داخله لو كانت مختلفة.
- كل مستخدم قديم يصبح له حساب Supabase Auth حقيقي بنفس الـ UUID الموجود في `profiles`.
- كلمات المرور القديمة النصية تُحوَّل إلى bcrypt داخل `auth.users`، ثم تُلغى من `profiles` في الترحيل 07، وتُحذف نهائياً في الترحيل 09 الاختياري.
- يتم تفعيل RLS وسياسات العزل، وتُسحب صلاحيات `anon` من الجداول.
- تُضاف أدوار المنصة: `Super Admin`، `Tenant Owner`، `Tenant Admin`، `Staff` مع إبقاء `owner` / `admin` / `worker` كأسماء متوافقة.

**لا يتم حذف أي جدول أو صف تلقائياً، ولا يُعاد إنشاء قاعدة البيانات.**

---

## 2. الملفات والترتيب

| # | الملف | الغرض | هل يعطّل الواجهة القديمة؟ |
|---|-------|-------|---------------------------|
| 01 | `20261026_01_tenancy_schema.sql` | إنشاء `tenants`, `memberships`, `platform_admins`, `invitations`، وإضافة أعمدة `tenant_id` القابلة للفراغ | لا (القراءة والكتابة القديمة تعمل) |
| 02 | `20261026_02_backfill_default_tenant.sql` | ربط البيانات القديمة بمحل `KONTROL`، وإنشاء العضويات، وجعل `tenant_id` إلزامياً، وإضافة القيود | **نعم للكتابة**: أي `INSERT` قديم بدون `tenant_id` سيفشل |
| 03 | `20261026_03_helpers.sql` | دوال الصلاحيات: `tenant_role`, `is_platform_admin`, `can_access_tenant` ... | لا |
| 04 | `20261026_04_auth_migration.sql` | إنشاء `auth.users` و`auth.identities` لكل `profiles`، تعبئة `profiles.email` | لا (تسجيل الدخول القديم النصي ما زال يعمل) |
| 05 | `20261026_05_rpc_admin.sql` | RPCs إدارة المحلات والمستخدمين والأدوار وكلمات المرور | لا (الواجهة القديمة لا تستخدمها) |
| 06 | `20261026_06_rpc_pos.sql` | RPCs الجلسات والبيع وإنهاء الجلسة وتسوية الدين | لا (الواجهة القديمة لا تستخدمها) |
| 07 | `20261026_07_rls_policies.sql` | **نقطة القطع**: RLS النهائية، سحب صلاحيات `anon`, إلغاء كلمات المرور النصية، Realtime | **نعم تماماً** |
| 08 | `20261026_08_platform_admin.sql` | تعيين أول Super Admin (الافتراضي `admin` ثم `ehab`) | لا (لكنه يتطلب 07) |
| 09 | `20261026_09_drop_plaintext_passwords.sql` | حذف عمود `profiles.password` نهائياً | لا (اختياري ومتأخر) |
| 10 | `20261026_10_fix_tenants_rls_recursion.sql` | إصلاح recursion بين سياسة `tenants` و`memberships` (hotfix بعد 07) | لا |
| 11 | `20261026_11_normalize_default_tenant.sql` | تحويل `kontrol-default` إلى محل عادي باسم `KONTROL` ورابط `kontrol` | لا |
| 12 | `20261026_12_separate_platform_admin.sql` | فصل حساب `admin` كـ Super Admin عن محل `KONTROL` وإبقاء `ehab` مالكاً | لا |

**الترتيب إلزامي: 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 10 → 11 → 12، ثم 09 بعد التأكد من تسجيل دخول الجميع.**

> إذا كنت نفّذت نسخة قديمة من الترحيل 07 ظهرت معها رسالة `infinite recursion detected in policy for relation "memberships"`، نفّذ الترحيل 10 فوراً بعد 07. الملف آمن لإعادة التنفيذ، ولا يغيّر أي بيانات.

---

## 3. قبل البدء — Preflight

### 3.1 نسخة احتياطية

1. Supabase Dashboard → **Database** → **Backups**.
2. أنشئ نسخة يدوية (Manual backup) أو نزّل نسخة كاملة.
3. تأكد أن النسخة قابلة للاستعادة على مشروع staging/محلي قبل لمس الإنتاج.
4. احتفظ بالنسخة خارج Supabase أيضاً إن أمكن.

بديل محلي إن كان لديك اتصال PostgreSQL مباشر:

```bash
pg_dump "postgresql://postgres:YOUR_DB_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres" \
  -Fc -f kontrol_before_multi_tenant.dump
```

> لا تضع كلمة مرور قاعدة البيانات أو أي مفتاح في Git.

### 3.2 فحص بنية قاعدة البيانات القديمة

نفّذ هذه الاستعلامات في SQL Editor **قبل** الترحيل:

```sql
-- هل الجداول القديمة موجودة؟
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles','settings','devices','products','sessions',
    'orders','order_items','payments','salaries','audit_logs'
  )
order by table_name;

-- هل أعمدة مكافحة الغش موجودة؟ (إن لم تكن موجودة نفّذ MIGRATION_anti_fraud.sql أولاً)
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name in ('discount_amount','notes');

-- هل يوجد عمود tenant_id من قبل؟
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and column_name = 'tenant_id'
order by table_name;
```

إذا كان `audit_logs` أو أعمدة `orders.discount_amount` / `orders.notes` غير موجودة، فهذا يعني أن قاعدة البيانات لم تُنفّذ عليها ترقية مكافحة الغش القديمة. نفّذ `supabase/MIGRATION_anti_fraud.sql` أولاً، ثم أعد الفحص. قاعدة البيانات الحالية لهذا المشروع تحتوي هذه الأعمدة بالفعل، لكن هذا الفحص ضروري لأي نسخة أخرى.

### 3.3 فحص البيانات التي قد توقف الترحيل 02

الترحيل 02 **يرفض** المتابعة بدل حذف بيانات. افحص هذه الحالات:

```sql
-- جلسات نشطة مكررة لنفس الجهاز (يجب أن تكون 0)
select tenant_id, device_id, count(*)
from public.sessions
where status = 'active'
group by 1,2
having count(*) > 1;

-- رواتب مكررة لنفس الموظف/الشهر/السنة (يجب أن تكون 0)
select user_id, month, year, count(*)
from public.salaries
group by 1,2,3
having count(*) > 1;

-- صفوف settings قديمة متعددة (يجب أن تكون 0 قبل الترحيل، أو صف واحد فقط)
select count(*) from public.settings;

-- بريد إلكتروني مكرر بأحرف كبيرة/صغيرة (يجب أن تكون 0)
select lower(email), count(*)
from public.profiles
where email is not null
group by 1
having count(*) > 1;

-- أسماء دخول مكررة (النظام القديم يمنعها، لكن افحص)
select lower(username), count(*)
from public.profiles
where username is not null
group by 1
having count(*) > 1;
```

### 3.4 تجهيز الواجهة الجديدة

- جهّز build جديداً قبل نافذة الصيانة: `npm ci && npm run build`.
- `.env` يجب أن يحتوي فقط:
  ```env
  VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
  VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
  ```
- **لا يوجد** `VITE_SERVICE_ROLE_KEY` ولا `VITE_CLERK_PUBLISHABLE_KEY`.
- جهّز خطة نشر تسمح بتبديل الواجهة فوراً بعد الترحيل 07.

### 3.5 إعدادات Supabase Auth الموصى بها

Dashboard → **Authentication** → **Providers**:

- أوقف **Allow new users to sign up** إن لم تكن تريد تسجيلاً عاماً. الحسابات تُنشأ من لوحة Super Admin أو من الترحيل.
- لا تحتاج تفعيل تأكيد البريد لهذا النظام؛ الترحيل يضع `email_confirmed_at` مباشرة، والحسابات الجديدة تُنشأ مؤكدة.
- لا تضع `service_role` في الواجهة أو في أي متغير يبدأ بـ `VITE_`.

---

## 4. نافذة الصيانة والقطع

الترحيل 02 يمنع الكتابة من الواجهة القديمة، والترحيل 07 يمنع حتى القراءة ويسحب كلمات المرور النصية. لذلك **نفّذ 01–07 في نافذة صيانة واحدة**، ولا تترك النظام مفتوحاً بينها.

الترتيب الموصى به:

1. أوقف الوصول للنظام (صفحة صيانة أو إيقاف النشر القديم).
2. خذ نسخة احتياطية نهائية.
3. نفّذ 01.
4. نفّذ 02.
5. نفّذ 03.
6. نفّذ 04.
7. نفّذ 05.
8. نفّذ 06.
9. انشر الواجهة الجديدة (أو جهّزها للنشر الفوري). الواجهة القديمة لم تعد قادرة على الكتابة منذ 02.
10. نفّذ 07 فوراً.
11. نفّذ 08.
12. نفّذ اختبارات القبول أدناه، ثم افتح النظام.
13. بعد أن يسجّل كل المستخدمين دخولهم بنجاح، نفّذ 09 الاختياري.

> يمكن عكس 9 و10 إذا كانت عملية النشر ستستغرق وقتاً: نفّذ 07 ثم انشر الواجهة مباشرة. المهم ألا يُفتح النظام للعامة بين 07 والنشر.

---

## 5. التنفيذ خطوة بخطوة في SQL Editor

لكل ملف:

1. افتح **SQL Editor** → **New query**.
2. الصق محتوى الملف **كاملاً**.
3. اضغط **Run**.
4. اقرأ النتيجة:
   - `Success. No rows returned` طبيعي.
   - `NOTICE` طبيعي، واقرأه.
   - أي `ERROR` = **توقف فوراً**. لا تصلح يدوياً بشكل عشوائي، ولا تنتقل للملف التالي. راجع الخطأ، استعد النسخة إن لزم، ثم أعد المحاولة.
5. لا تنفّذ أكثر من ملف في نفس الـ query إلا إذا كان الملف نفسه يحتوي على معاملات.

### 5.1 الترحيل 01

```
supabase/migrations/20261026_01_tenancy_schema.sql
```

التحقق:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('tenants','memberships','platform_admins','invitations')
order by table_name;

select table_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and column_name = 'tenant_id'
order by table_name;
```

يجب أن تظهر الجداول الأربعة، وكل `tenant_id` يكون `is_nullable = YES` في هذه المرحلة.

### 5.2 الترحيل 02

```
supabase/migrations/20261026_02_backfill_default_tenant.sql
```

التحقق:

```sql
-- المحل الافتراضي
select id, name, slug, is_active from public.tenants order by created_at;

-- لا يوجد صف بدون tenant_id
select 'settings' as table_name, count(*) from public.settings where tenant_id is null
union all select 'devices', count(*) from public.devices where tenant_id is null
union all select 'products', count(*) from public.products where tenant_id is null
union all select 'sessions', count(*) from public.sessions where tenant_id is null
union all select 'orders', count(*) from public.orders where tenant_id is null
union all select 'order_items', count(*) from public.order_items where tenant_id is null
union all select 'payments', count(*) from public.payments where tenant_id is null
union all select 'salaries', count(*) from public.salaries where tenant_id is null
union all select 'audit_logs', count(*) from public.audit_logs where tenant_id is null;

-- كل الملفات الشخصية لها عضوية في المحل الافتراضي
select count(*) as profiles_without_membership
from public.profiles p
left join public.memberships m on m.user_id = p.id
where m.id is null;

-- لا توجد عضويات مكررة
select tenant_id, user_id, count(*)
from public.memberships
group by 1,2
having count(*) > 1;

-- tenant_id أصبح NOT NULL
select table_name, is_nullable
from information_schema.columns
where table_schema = 'public' and column_name = 'tenant_id'
order by table_name;
```

كل عدادات `NULL` يجب أن تكون 0، و`is_nullable` يجب أن تكون `NO`.

### 5.3 الترحيل 03

```
supabase/migrations/20261026_03_helpers.sql
```

التحقق:

```sql
select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'is_platform_admin','is_tenant_member','tenant_role',
    'is_tenant_manager','is_tenant_owner','can_access_tenant',
    'shares_tenant_with','touch_updated_at'
  )
order by proname;
```

### 5.4 الترحيل 04 — الأكثر حساسية

```
supabase/migrations/20261026_04_auth_migration.sql
```

هذا الملف يُنشئ صفوفاً في `auth.users` و`auth.identities` مباشرة من SQL. Supabase لا يضمن أن يكون هذا هو المسار الرسمي لإنشاء المستخدمين، لكنه المسار المتاح بدون `service_role`. الملف يعبّئ الأعمدة النصية المطلوبة بقيم فارغة بدلاً من `NULL` لتجنب أخطاء Auth.

التحقق:

```sql
-- لا يوجد profile بدون auth user
select count(*) as profiles_without_auth_user
from public.profiles p
left join auth.users u on u.id = p.id
where u.id is null;

-- لا يوجد auth user بلا profile (بعد الترحيل)
select count(*) as auth_users_without_profile
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- كل profile له بريد
select count(*) from public.profiles where email is null or trim(email) = '';

-- كل auth user له identity
select count(*) as users_without_identity
from auth.users u
left join auth.identities i on i.user_id = u.id
where i.id is null;

-- عينة من البريد وكلمة المرور المشفرة (لا تُظهر الهاش في الإنتاج)
select p.username, p.email, u.email_confirmed_at is not null as confirmed
from public.profiles p
join auth.users u on u.id = p.id
order by p.created_at
limit 10;
```

كل عدادات المشاكل يجب أن تكون 0.

**اختبار دخول مبكر:** بعد 04 فقط، الواجهة الجديدة يمكنها تسجيل الدخول عبر Supabase Auth. جرّب حساباً واحداً على staging أو على مشروع اختبار. لا تنفّذ 07 قبل التأكد من أن `resolve_login_email` يعمل.

إذا فشل إدخال `auth.users`:

- لا تكرر المحاولة بشكل أعمى ولا تعدّل `auth.users` يدوياً صفاً بصف.
- سجّل رسالة الخطأ الكاملة.
- استعد النسخة الاحتياطية إن كان هناك أي أثر جزئي.
- راجع أن `auth.identities` يحتوي `provider_id` (Supabase الحديث)، وأن `pgcrypto` مثبتة في `extensions`، وأن `search_path` للدالة يتضمن `extensions`.
- إن كان المشروع قديماً جداً ولا يحتوي `provider_id`، أبلغ المطوّر لتعديل الترحيل 04 لنسخة المخطط لديك. لا تحذف العمود ولا تغيّر مخطط `auth` يدوياً.

### 5.5 الترحيل 05

```
supabase/migrations/20261026_05_rpc_admin.sql
```

التحقق:

```sql
select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'resolve_login_email','get_my_context','create_tenant','update_tenant',
    'set_tenant_status','admin_create_tenant_user','admin_set_user_role',
    'admin_set_membership_active','admin_remove_membership',
    'admin_set_profile_active','admin_set_user_password','change_my_password',
    'verify_manager_password'
  )
order by proname;

-- anon يجب أن يملك resolve_login_email فقط
select has_function_privilege('anon', 'public.resolve_login_email(text)', 'EXECUTE') as anon_can_resolve;
select has_function_privilege('anon', 'public.get_my_context()', 'EXECUTE') as anon_can_get_context;
select has_function_privilege('anon', 'public.create_tenant(text,text,text,text,text,text)', 'EXECUTE') as anon_can_create_tenant;
```

المتوقع: `anon_can_resolve = true`, والاثنان الآخران `false`.

### 5.6 الترحيل 06

```
supabase/migrations/20261026_06_rpc_pos.sql
```

التحقق:

```sql
select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'start_session','add_product_to_session','quick_sale',
    'close_session','settle_debt','set_device_status'
  )
order by proname;
```

### 5.7 الترحيل 07 — نقطة القطع

```
supabase/migrations/20261026_07_rls_policies.sql
```

بعد هذا الملف:

- `anon` لا يقرأ أي جدول.
- كلمات المرور النصية في `profiles.password` تصبح `NULL`.
- الواجهة القديمة تتوقف تماماً.
- يجب أن تكون الواجهة الجديدة منشورة أو جاهزة للنشر فوراً.

التحقق:

```sql
-- المتوقع false: anon لا يقرأ tenants
select has_table_privilege('anon', 'public.tenants', 'SELECT');

-- المتوقع false: anon لا يقرأ profiles
select has_table_privilege('anon', 'public.profiles', 'SELECT');

-- المتوقع true: authenticated يقرأ devices (RLS هي التي تصفّي الصفوف)
select has_table_privilege('authenticated', 'public.devices', 'SELECT');

-- المتوقع false: authenticated لا يكتب sessions مباشرة (RPC فقط)
select has_table_privilege('authenticated', 'public.sessions', 'INSERT');

-- المتوقع false: platform_admins غير مكشوف
select has_table_privilege('authenticated', 'public.platform_admins', 'SELECT');

-- كلمات المرور النصية أُلغيت
select count(*) from public.profiles where password is not null;

-- سياسات RLS
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

إذا كان مشروعك لا يملك صلاحية إضافة جداول إلى `supabase_realtime`، سيظهر `NOTICE` ويجب إضافتها يدوياً:
Dashboard → **Database** → **Replication** → Publication `supabase_realtime` → أضف:
`devices`, `sessions`, `payments`, `orders`, `order_items`.

الملف يرسل أيضاً `NOTIFY pgrst, 'reload schema'` في النهاية. لو ظهرت في الواجهة أخطاء علاقات/أعمدة غير موجودة رغم نجاح الترحيل، نفّذ يدوياً في SQL Editor ثم أعد تحميل الصفحة:

```sql
NOTIFY pgrst, 'reload schema';
```

**إصلاح recursion في سياسة `memberships`:** إذا ظهرت الرسالة:

```text
infinite recursion detected in policy for relation "memberships"
```

فنفّذ الملف التالي بعد 07:

```
supabase/migrations/20261026_10_fix_tenants_rls_recursion.sql
```

هذا الملف يستبدل سياسة `tenants_select` فقط، ويستخدم الدالة `is_tenant_member` الآمنة (`SECURITY DEFINER`) بدلاً من الاستعلام المباشر عن `memberships`. آمن لإعادة التنفيذ ولا يغيّر أي بيانات.

### 5.8 الترحيل 08 — تعيين Super Admin

```
supabase/migrations/20261026_08_platform_admin.sql
```

قبل التنفيذ، عدّل السطر:

```sql
v_username text := 'admin';  -- ← اسم دخول حساب المنصة المنفصل
```

أو اتركه؛ الملف يجرّب `admin` أولاً، ثم `ehab`، ثم أقدم `owner`/`admin` نشط. **تأكد من الشخص قبل التنفيذ.**

التحقق:

```sql
select pa.user_id, p.username, p.name, p.email
from public.platform_admins pa
join public.profiles p on p.id = pa.user_id;
```

على قاعدة البيانات الحالية نفّذ الترحيل 12 بعد 11 حتى يصبح `admin` هو Super Admin فقط، ويبقى `ehab` مالكاً لمحل `KONTROL`.

### 5.8.1 الترحيل 11 — جعل محل KONTROL عادياً

```
supabase/migrations/20261026_11_normalize_default_tenant.sql
```

هذا الملف يحوّل `kontrol-default` / «KONTROL — النظام الحالي» إلى:

```text
name = KONTROL
slug = kontrol
```

ولا يغيّر المالك أو العضويات أو البيانات. راجعه أولاً؛ لو رابط `kontrol` مستخدم بالفعل سيتوقف ويطلب اختيار رابط آخر.

### 5.8.2 الترحيل 12 — فصل حساب Super Admin

```
supabase/migrations/20261026_12_separate_platform_admin.sql
```

الافتراضي في الملف:

```sql
v_admin_username := 'admin';   -- Super Admin
v_owner_username := 'ehab';    -- مالك KONTROL
v_shop_slug      := 'kontrol';
```

ماذا يفعل:

- يضيف `admin` إلى `platform_admins`.
- يشيل `ehab` من `platform_admins`.
- يوقف عضوية `admin` داخل `KONTROL` فقط (بدون حذفها).
- يتأكد أن `ehab` مالك نشط قبل أي تغيير، وإلا يتوقف.

بعد التنفيذ:

- `admin` يسجّل الدخول → `/admin` وليس صفحة المحل.
- `ehab` يسجّل الدخول → `/` كمالك KONTROL.
- محل KONTROL يبقى عادياً بكل بياناته.

التحقق:

```sql
select p.username, p.name
from public.platform_admins pa
join public.profiles p on p.id = pa.user_id;

select p.username, t.name, m.role, m.is_active
from public.memberships m
join public.profiles p on p.id = m.user_id
join public.tenants t on t.id = m.tenant_id
where lower(t.slug) = 'kontrol';

-- يجب أن يكون 0: لا عضوية نشطة لحساب المنصة داخل المحل
select count(*) as admin_active_memberships
from public.memberships m
join public.profiles p on p.id = m.user_id
join public.tenants t on t.id = m.tenant_id
where lower(p.username) = lower('admin')
  and lower(t.slug) = 'kontrol'
  and m.is_active;

-- يجب أن يكون 0: ehab لم يعد Super Admin
select count(*) as ehab_platform_admin_rows
from public.platform_admins pa
join public.profiles p on p.id = pa.user_id
where lower(p.username) = lower('ehab');
```

### 5.9 الترحيل 09 — اختياري ومتأخر

```
supabase/migrations/20261026_09_drop_plaintext_passwords.sql
```

**لا تنفّذه إلا بعد:**

1. كل المستخدمين سجّلوا دخولاً بنجاح عبر Supabase Auth.
2. `profiles.password` أصبح `NULL` للجميع (من 07).
3. أخذت نسخة احتياطية نهائية.
4. لا توجد حاجة للرجوع للواجهة القديمة.

التحقق قبل التنفيذ:

```sql
select count(*)
from public.profiles p
left join auth.users u on u.id = p.id
where u.id is null;  -- يجب أن يكون 0
```

بعد التنفيذ:

```sql
select count(*)
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name = 'password';  -- يجب أن يكون 0
```

---

## 6. الاختبارات الإلزامية

### 6.1 اختبارات SQL للعزل

الملف:

```
supabase/tests/tenant_isolation.sql
```

**خصائصه:**

- يبدأ بـ `BEGIN` وينتهي بـ `ROLLBACK`، فلا يترك بيانات اختبار.
- يحتاج صلاحية `postgres` لأنه ينشئ مستخدمي Auth تجريبيين ويستخدم `SET LOCAL role`.
- يستخدم UUIDs وslug ثابتة؛ لذلك **لا تشغّله على الإنتاج** إلا إذا كنت متأكداً أن لا تعارض، والأفضل على نسخة staging مستعادة من النسخة الاحتياطية.
- المطلوب أن تظهر في النهاية:
  ```
  NOTICE: ✓ ALL TENANT ISOLATION TESTS PASSED
  ROLLBACK
  ```

ما يغطيه:

- منع قراءة وكتابة بيانات محل آخر، بما في ذلك تغيير `id` في الطلب.
- منع العامل من قراءة الرواتب أو تعديل الأسعار أو كتابة سجل الرقابة.
- منع عضو محل موقوف من القراءة والكتابة ومن استدعاء `start_session`.
- بقاء Super Admin قادراً على رؤية المحل الموقوف.
- فقدان العضو المحذوف للوصول فوراً.
- عمليات CRUD المشروعة لمدير المحل.
- سحب صلاحيات `anon`.
- منع مالك المحل من إنشاء محل أو إيقاف محل أو تعطيل حساب عالمي أو تغيير كلمة مرور مالك آخر.
- إنشاء Super Admin لمحل وإضافة عضو وتعديل المحل.

### 6.2 اختبارات قبول يدوية بعد النشر

1. **Super Admin:** سجّل دخول `ehab` (أو الحساب المختار) → يجب أن يفتح `/admin`.
2. **لوحة المنصة:** أرقام المحلات والمستخدمين والأجهزة والإيرادات تطابق قاعدة البيانات.
3. **إنشاء محل:** أنشئ محلاً جديداً بمالك جديد → يظهر في القائمة، ويمكن للمالك الدخول ورؤية محله فقط.
4. **إضافة عضو موجود:** أضف بريد مستخدم موجود إلى محل آخر → لا يُنشأ حساب مكرر، وتظهر عضويته الجديدة.
5. **العزل:** سجّل دخول مالك المحل A وحاول فتح تقرير أو جهاز يخص المحل B (عبر تعديل `id` في الشبكة) → يجب أن يعيد 0 صفوف أو خطأ صلاحية.
6. **الإيقاف:** أوقف محلاً من لوحة المنصة → أعضاؤه يرون `/suspended` ولا يستطيعون القراءة أو الكتابة، والبيانات تبقى موجودة ويعودون بعد التفعيل.
7. **الجلسات:** ابدأ جلسة، أضف منتجاً، أنهِ الجلسة، سجّل مبلغاً جزئياً → يظهر المتبقي كدين حتى التسوية، ويظهر في سجل الرقابة.
8. **الخصم:** جرّب خصماً من حساب عامل بدون موافقة مدير → يُرفض. ثم بموافقة مدير وسبب → يُسجّل في `audit_logs`.
9. **كلمة المرور:** غيّر كلمة مرور مستخدم من لوحة المنصة، وسجّل دخولاً بها. (لا تُظهر كلمة المرور في السجلات.)
10. **الواجهة القديمة:** تأكد أنها لم تعد تعمل، وأنه لا توجد نسخة قديمة منشورة تستخدم `anon` مباشرة.

---

## 7. المخاطر ونقاط الفشل المعروفة

1. **الإدخال المباشر في `auth.users` / `auth.identities`** هو أكبر خطر. Supabase يدير مخطط `auth` وقد يتغير. تم تعبئة الأعمدة النصية المطلوبة، لكن يجب اختبار 04 على staging أولاً. لا تنفّذ 07 قبل نجاح تسجيل الدخول.
2. **الترحيل 02 يوقف الكتابة القديمة** لأن `tenant_id` يصبح `NOT NULL` بدون default. هذا مقصود. لا تفعله أثناء ساعات العمل.
3. **الترحيل 07 يلغي كلمات المرور النصية ويسحب `anon`**. إن فشل نشر الواجهة الجديدة بعده، سيتوقف النظام حتى تصلح النشر. جهّز الواجهة مسبقاً.
4. **RLS ليست حلاً وحيداً**: كل RPC يعيد التحقق من `auth.uid()` والعضوية والمحل. لا تعتمد على فلترة الواجهة.
5. **`service_role` ممنوع في الواجهة**. أي كود يستخدمه في المتصفح يلغي كل العزل.
6. **البريد المكرر** قد يوقف 04 عند `profiles.email` أو `auth.users.email`. افحص قبل التنفيذ.
7. **الجلسات/الرواتب المكررة** توقف 02. افحص قبل التنفيذ.
8. **Realtime** قد يحتاج إضافة يدوية للجداول. بدونها تعمل البيانات لكن لا تتحدث تلقائياً.
9. **النسخ الاحتياطي هو خطة الرجوع الحقيقية**. الملفات تحتوي ملاحظات rollback جزئية، لكن استعادة قاعدة البيانات كاملة هي الأضمن.
10. **الاختبارات لا تُثبت أن الترحيل نُفّذ**. يجب تشغيلها فعلياً على قاعدة بيانات staging أو بعد الترحيل في نافذة مراجعة.

### خطأ معروف في الترحيل 04

إذا ظهر:

```text
ERROR: 42702: column reference "p.id" is ambiguous
```

فهذا تعارض بين متغير `p` داخل `DO $$` وبين alias الجدول `p` في استعلام التحقق. تم إصلاحه في النسخة الحالية من الملف (استُخدم alias `pr`). أعد تنفيذ **الملف 04 كاملاً** من أوله. بما أن الملف داخل `BEGIN/COMMIT`، فإن المحاولة الفاشلة لا تُثبّت بياناتها. إذا ظهرت رسالة أن المعاملة الحالية aborted، نفّذ `ROLLBACK;` في نافذة جديدة ثم أعد 04.

---

## 8. الرجوع (Rollback)

### قبل 07

- الأفضل: استعادة النسخة الاحتياطية كاملة.
- يمكن التراجع عن 08 بحذف صف `platform_admins`، لكن ذلك لا يعيد كلمات المرور أو يلغي تغييرات 02.
- لا تحاول حذف `tenant_id` من الجداول وأنت في الإنتاج؛ ستفقد الربط بين البيانات.

### بعد 07

- الرجوع يعني استعادة النسخة الاحتياطية قبل 07 ثم إعادة نشر الواجهة القديمة. هذا يفقد أي بيانات أُنشئت بعد 07.
- لا يوجد rollback آمن لـ 09؛ حذف العمود نهائي. لذلك 09 مؤجل ومختار.

### ملاحظة عن الأوامر

ملاحظات `Rollback` داخل كل ملف هي إرشادية وليست سكربتاً جاهزاً للتنفيذ الآمن. لا تشغّلها ككتلة واحدة على الإنتاج. استخدم نسخة احتياطية أو بيئة staging.

---

## 9. ما لا يفعله هذا المستودع

- لا ينفّذ SQL تلقائياً.
- لا يملك `service_role`.
- لا ينشئ مشروع Supabase.
- لا يفعّل النسخ الاحتياطي.
- لا يضمن أن مخطط `auth` في مشروعك مطابق للمخطط المتوقع.
- لا يحذف بيانات قديمة.
- لا يعيد تصميم قاعدة البيانات من الصفر.

---

## 10. بعد الترحيل

- راجع `README.md` للتشغيل والصلاحيات وبيانات البيئة.
- راقب `audit_logs` يومياً.
- لا تمنح `platform_admins` إلا لمن يدير المنصة فعلاً.
- احتفظ بنسخة من هذا الملف مع سجل تاريخ التنفيذ (التاريخ، من نفّذ، رقم النسخة الاحتياطية).
