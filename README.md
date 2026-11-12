# MAX — نظام إدارة مطعم · Restaurant Management System

**Good Food Good Mood** — نظام متكامل لإدارة المطاعم، عربي أولاً (RTL) مع دعم العبرية: كاشير، شاشة مطبخ مباشرة، طلبات، مخزون بالوصفات، موظفين ورواتب، تقارير مالية، إعدادات، رفع صور إلى Cloudflare R2، عمل بدون إنترنت، وطباعة إيصالات حرارية.

> **للنشر على Netlify + Supabase اتبع [DEPLOY.md](DEPLOY.md).** · English version below ↓

---

## العربية

### التقنيات
| الطبقة | التقنية |
|---|---|
| الواجهة | React 19 + TypeScript (strict) + Vite + Tailwind CSS v4 + React Router (data router) |
| الحركة والأيقونات | `motion` · `lucide-react` |
| الخادم | Supabase (Postgres + Auth + Realtime + Edge Functions) |
| الصور | Cloudflare R2 عبر Cloudflare Worker (`/worker`) |

لا توجد مكتبات أخرى: الرسوم البيانية SVG مكتوبة يدوياً، الترجمة نظام بسيط مكتوب يدوياً، التصدير إلى Excel عبر CSV مع UTF‑8 BOM، الطباعة عبر iframe مخفي، الصوت عبر Web Audio، والتخزين بدون إنترنت عبر IndexedDB.

### التشغيل محلياً
```bash
npm install
cp .env.example .env      # ثم املأ القيم
npm run dev
```

متغيرات البيئة (`.env`):

| المتغير | الوصف |
|---|---|
| `VITE_SUPABASE_URL` | رابط مشروع Supabase |
| `VITE_SUPABASE_ANON_KEY` | مفتاح anon (عام). **لا تضع مفتاح service role في الواجهة أبداً** |
| `VITE_R2_WORKER_URL` | رابط الـ Worker الخاص برفع الصور |
| `VITE_R2_PUBLIC_URL` | الرابط العام للصور (نطاق R2 المخصص أو `<worker>/object`) |

### إعداد Supabase
محلياً (يتطلب Docker و Supabase CLI):
```bash
npx supabase start
npx supabase db reset          # يطبق كل الـ migrations ثم seed.sql
```

على مشروع سحابي:
```bash
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push --include-seed     # يطبق الـ migrations والبيانات التجريبية
npx supabase functions deploy pin-login --no-verify-jwt
npx supabase secrets set ALLOWED_ORIGINS=https://your-app.netlify.app
```
- دالة `pin-login` تتحقق بنفسها، لذلك تُنشر مع `--no-verify-jwt`. يوفّر Supabase تلقائياً `SUPABASE_URL` و `SUPABASE_ANON_KEY` و `SUPABASE_SERVICE_ROLE_KEY` للدوال.
- إنشاء حسابات الموظفين يتم من داخل التطبيق عبر الدالة `admin_create_user` في قاعدة البيانات (للمالك فقط) — لا يحتاج دالة Edge.
- بديل أسرع بدون CLI: الصق `supabase/setup.sql` في SQL Editor.
- من لوحة Supabase: **Authentication → Providers → Email**: أوقف "Allow new users to sign up" (الموظفون يُنشأون من شاشة الموظفين بواسطة المالك).
- بدون البيانات التجريبية: أول مستخدم يُنشأ من لوحة Supabase يصبح **المالك** تلقائياً.
- إعادة توليد الأنواع بعد أي تعديل على قاعدة البيانات:
  ```bash
  npx supabase gen types typescript --local > src/types/database.ts
  ```

### Cloudflare R2 + Worker
```bash
cd worker
npm install
npx wrangler r2 bucket create max-images
cp wrangler.toml.example wrangler.toml     # املأ SUPABASE_URL و SUPABASE_ANON_KEY و PUBLIC_URL و ALLOWED_ORIGINS
npx wrangler deploy
```
- للعرض العام: اربط نطاقاً مخصصاً بالـ bucket (R2 → Settings → Custom Domains) وضع رابطه في `PUBLIC_URL` و `VITE_R2_PUBLIC_URL`. أو استخدم الـ Worker نفسه: `https://<worker>/object`.
- قواعد الرفع: صور JPEG/PNG/WebP فقط (يُتحقق من محتوى الملف)، حتى 5MB. القائمة والإيصالات: مدير فما فوق؛ المواد الخام: مدير أو مسؤول مخزون؛ الشعار: المالك؛ الصورة الشخصية: أي مستخدم (داخل مجلده فقط).

### النشر على Netlify (أو Cloudflare Pages)
- Netlify: كل الإعدادات في `netlify.toml` — فقط اربط المستودع. التفاصيل في [DEPLOY.md](DEPLOY.md).
- Cloudflare Pages: Build `npm run build` · Output `dist` · أضف متغيرات `VITE_*`. الملف `public/_redirects` يضمن عمل روابط التطبيق.

### حسابات تجريبية
كلمة المرور لجميع الحسابات: **`Max@12345`**

| الدور | البريد | رمز PIN | الشاشة الافتراضية |
|---|---|---|---|
| مالك | owner@max.demo | — | `/` لوحة التحكم |
| مدير | manager@max.demo | — | `/` |
| كاشير (وردية مفتوحة) | cashier@max.demo | `1111` | `/pos` |
| مطبخ | kitchen@max.demo | `2222` | `/kitchen` |
| مسؤول مخزون | inventory@max.demo | `3333` | `/inventory` |
| كاشير 2 (بدون وردية، واجهة عبرية) | cashier2@max.demo | `4444` | `/pos` |

البيانات التجريبية: 6 أقسام، 33 صنفاً بصور، 23 مادة خام بوصفات، 3 موردين، 8 موظفين، و30 يوماً من الطلبات والورديات والمشتريات والمصروفات والحضور.

### الأوامر
```bash
npm run dev        # خادم التطوير
npm run build      # فحص الأنواع + بناء الإنتاج
npm run lint       # ESLint
```

---

## English

### What it is
A production-ready, Arabic-first (RTL) restaurant management system for **MAX**: POS/cashier with shifts and Z‑reports, live kitchen display, orders with void/refund audit, recipe-driven inventory (purchases, stocktake, movement history), employees (shifts, attendance, payroll, permissions), financial reports with print + CSV export, settings with backup/restore, R2 image uploads, offline selling, and 80mm thermal printing. Hebrew is fully supported (also RTL).

### Stack
React 19 · TypeScript (strict) · Vite · Tailwind CSS v4 (`@theme` in `src/index.css`) · React Router data router · `motion` · `lucide-react` · `@supabase/supabase-js`. Everything else (charts, i18n, CSV export, printing, IndexedDB queue, audio chime, form validation) is hand-written.

### Quick start
```bash
npm install
cp .env.example .env
npm run dev
```
See the Arabic section for the env vars table, Supabase CLI commands (`supabase db reset` locally, `supabase db push --include-seed` remotely, `supabase functions deploy … --no-verify-jwt`, `supabase secrets set ALLOWED_ORIGINS=…`), the Worker deploy (`wrangler r2 bucket create`, `wrangler deploy`), Cloudflare Pages settings, and the demo accounts (password `Max@12345`, PINs 1111/2222/3333/4444).

### Architecture
```
src/
  app/          router.tsx, guards, providers (auth, settings, connection/offline sync, notifications, toast, confirm), shell (sidebar, top bar, bottom nav, command palette)
  features/     auth, dashboard, pos, kitchen, orders, menu, inventory, employees, reports, settings
  components/ui Button, Card, Badge, Modal/Drawer, Table, Tabs/Segmented, Toggle, Input/Select/Textarea, Skeleton, EmptyState, StatCard, Chart (line/bar/ring/heatmap/share bars), Keypad, ImageUploader, …
  lib/          supabase, r2, format, dates, errors, validation, offlineQueue + idb, print, sound, csv
  i18n/         ar.ts (source of truth for keys), he.ts (typed against ar), index.tsx
  types/        database.ts (generated shape), models.ts
supabase/       migrations/, setup.sql (one-paste setup), seed.sql (demo data), seed_catalog.sql (starter menu), functions/pin-login, config.toml
worker/         Cloudflare Worker for R2 (upload / delete / public GET)
```

### Security model
- RLS is enabled on every table; policies use `public.current_user_role()` (the spec's `current_role()` — renamed because `current_role` is a reserved SQL keyword). Inactive users resolve to no role.
- All money/stock-changing operations are `SECURITY DEFINER` functions with explicit role checks: `place_order` (server-side pricing, discount limits per role, exact payment matching, idempotent via `client_ref`, recipe stock deduction, low-stock notifications), `void_order` (restores stock; refund variant does not), `advance_kitchen_status`, `open_shift`/`close_shift`/`shift_report`, `receive_purchase_order` (weighted-average cost), `create_stock_count`/`apply_stock_count`, `adjust_stock`, `compute_payroll`, `clock_in`/`clock_out`, `set_pin`, `admin_update_profile`, `admin_create_user`, `admin_set_password`, `import_backup`, plus SQL-aggregated reports (`dashboard_today`, `report_*`).
- `pin_hash` is excluded by column-level grants; ingredient quantity can only change through audited movements. Roles come only from `raw_app_meta_data` (never user-editable metadata). The service role key is used only inside Edge Functions.

### Decisions worth knowing
- Prices are VAT-inclusive (Israel/Palestine retail convention); the receipt shows the VAT portion.
- Recipes may use g/ml while stock is kept in kg/l (conversion in `unit_factor`); carton/piece items convert 1:1 only.
- A refund (served order) does not return stock; a void does.
- Paying a payroll entry automatically records a "salaries" expense so profit reports include it.
- A dedicated **Menu** screen (`/menu`) manages categories and items (with images); recipes live under Inventory → Recipes.
- Cashiers must open a cash shift before selling; managers/owners may sell without one.
- Offline orders keep their original sale time (bounded to 7 days) and are synced oldest-first through `place_order`; the `client_ref` makes retries safe.
