import { useEffect, useMemo, useReducer, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useAuth } from '@/app/providers/AuthProvider';
import { homeFor, usePermissions } from '@/app/providers/PermissionsProvider';
import { AnimatePresence, motion } from 'motion/react';
import { Armchair, Bike, Check, ChefHat, CircleCheck, Clock, Minus, Pencil, Plus, Search, ShoppingBag, UserRound, Utensils, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { BrandMark } from '@/app/shell/BrandMark';
import { LanguageSwitcher } from '@/app/shell/LanguageSwitcher';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Input';
import { Segmented } from '@/components/ui/Tabs';
import { Modal } from '@/components/ui/Modal';
import { FoodImage } from '@/components/ui/FoodImage';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonGrid } from '@/components/ui/Skeleton';
import { ProductGrid } from '@/features/pos/components/ProductGrid';
import { CategoryTabs } from '@/features/pos/components/CategoryTabs';
import { OptionsModal } from '@/features/pos/components/OptionsModal';
import { cartReducer, lineOptions, newCart, optionLabel, unitPrice, type CartLine, type CartOption } from '@/features/pos/cart';
import { fromJson, type MenuItem, type MenuItemOption } from '@/types/models';

interface PublicMenu {
  settings: { name: string; slogan: string; logo_url: string | null; currency_symbol: string; table_count: number; enabled: boolean } | null;
  categories: { id: string; name_ar: string; name_he: string; icon: string; image_url: string | null }[];
  items: { id: string; category_id: string; name_ar: string; name_he: string; description: string; price: number; image_url: string | null; is_available: boolean }[];
  options: { id: string; menu_item_id: string; name_ar: string; name_he: string; price: number; kind: string; max_qty: number; is_active: boolean }[];
  out_of_stock: string[];
}

interface OrderStatus {
  order_number: number;
  status: 'new' | 'preparing' | 'ready' | 'served' | 'cancelled' | 'refunded';
  total: number;
  payment_status: 'paid' | 'partial' | 'unpaid';
  table_no: number | null;
  type: 'dine_in' | 'delivery' | 'takeaway';
  items: { name: string; name_he: string; qty: number; options: unknown; notes: string }[];
}

const GUEST_KEY = 'max.guest';
const ORDERS_KEY = 'max.guest.orders';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: the page still works, it just won't remember */
  }
}

/**
 * Ordering from the table, without an account: the guest browses the menu, chooses the meat type, extras and notes,
 * enters name, phone and table, and sends the order to the kitchen and the cashier. Payment happens at the cashier.
 */
export default function CustomerOrderPage() {
  const { t } = useI18n();
  const { f } = useSettings();
  const toast = useToast();
  const [params] = useSearchParams();
  const { status, role } = useAuth();
  const { can, ready } = usePermissions();

  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [menuError, setMenuError] = useState<unknown>(null);
  const loadMenu = async () => {
    setMenuError(null);
    const { data, error } = await supabase.rpc('public_menu');
    if (error) return setMenuError(error);
    setMenu(fromJson<PublicMenu>(data));
  };
  useEffect(() => {
    void loadMenu();
    const id = window.setInterval(() => void loadMenu(), 60_000); // availability and sold-out stay current
    return () => window.clearInterval(id);
  }, []);

  const items = useMemo(() => (menu?.items ?? []) as unknown as MenuItem[], [menu]);
  const optionsByItem = useMemo(() => {
    const m = new Map<string, MenuItemOption[]>();
    for (const o of (menu?.options ?? []) as unknown as MenuItemOption[]) m.set(o.menu_item_id, [...(m.get(o.menu_item_id) ?? []), o]);
    return m;
  }, [menu]);
  const soldOut = useMemo(() => new Set(menu?.out_of_stock ?? []), [menu]);

  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const q = search.trim();
    return items.filter((i) => (!category || i.category_id === category) && (!q || i.name_ar.includes(q) || i.name_he.includes(q)));
  }, [items, category, search]);

  const [cart, dispatch] = useReducer(cartReducer, undefined, newCart);
  const count = cart.lines.reduce((s, l) => s + l.qty, 0);
  const total = cart.lines.reduce((s, l) => s + unitPrice(l) * l.qty, 0);

  const [picking, setPicking] = useState<{ item: MenuItem; lineId?: string; initial?: { options: CartOption[]; notes: string } } | null>(null);
  const addItem = (item: MenuItem) => {
    if (!item.is_available) return;
    if (optionsByItem.has(item.id)) setPicking({ item });
    else dispatch({ type: 'add', item: { id: item.id, name_ar: item.name_ar, name_he: item.name_he, price: item.price, image_url: item.image_url }, qty: 1 });
  };

  const [cartOpen, setCartOpen] = useState(false);
  const guest = readJson<{ name: string; phone: string; address?: string }>(GUEST_KEY, { name: '', phone: '' });
  const [guestName, setGuestName] = useState(guest.name);
  const [phone, setPhone] = useState(guest.phone);
  const [table, setTable] = useState(params.get('table') ?? '');
  const [address, setAddress] = useState(guest.address ?? '');
  const [type, setType] = useState<'dine_in' | 'delivery' | 'takeaway'>(params.get('table') ? 'dine_in' : 'delivery');
  const [orderNotes, setOrderNotes] = useState('');
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const tableCount = menu?.settings?.table_count ?? 0;
  const nameOk = guestName.trim().length >= 2;
  const phoneOk = /^[0-9+\- ]{7,20}$/.test(phone.trim());
  const tableN = Number(table);
  const tableOk = type !== 'dine_in' || (Number.isInteger(tableN) && tableN >= 1 && (tableCount === 0 || tableN <= tableCount));
  const addressOk = type !== 'delivery' || address.trim().length >= 4;

  const [tracking, setTracking] = useState<string | null>(() => readJson<string[]>(ORDERS_KEY, [])[0] ?? null);

  const send = async () => {
    setTried(true);
    if (!nameOk || !phoneOk || !tableOk || !addressOk || cart.lines.length === 0 || sending) return;
    setSending(true);
    const payload = {
      client_ref: cart.clientRef,
      customer_name: guestName.trim(),
      customer_phone: phone.trim(),
      type,
      table_no: type === 'dine_in' ? tableN : null,
      customer_address: type === 'delivery' ? address.trim() : '',
      notes: orderNotes.trim(),
      items: cart.lines.map((l) => ({ menu_item_id: l.item.id, quantity: l.qty, notes: l.notes.trim(), ...lineOptions(l) })),
    };
    const { error } = await supabase.rpc('place_customer_order', { payload: payload as never });
    setSending(false);
    if (error) return toast.error(errorMessage(t, error));
    writeJson(GUEST_KEY, { name: guestName.trim(), phone: phone.trim(), address: address.trim() || guest.address || '' });
    writeJson(ORDERS_KEY, [cart.clientRef, ...readJson<string[]>(ORDERS_KEY, [])].slice(0, 5));
    setTracking(cart.clientRef);
    setCartOpen(false);
    setOrderNotes('');
    setTried(false);
    dispatch({ type: 'reset' });
  };

  // the phone app opens here; a team member who is already signed in goes straight to their screens
  if (params.get('start') === 'app' && status === 'signedIn' && role && ready) return <Navigate to={homeFor(role, can)} replace />;
  if (tracking) return <OrderTracker clientRef={tracking} onNew={() => setTracking(null)} />;

  return (
    <div className="min-h-dvh bg-bg pb-28">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <BrandMark size="sm" />
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="flex h-10 items-center gap-1.5 rounded-btn border border-line px-3 text-xs text-fg-2 transition-colors hover:border-line-strong hover:text-fg"
            >
              <UserRound className="size-4" /> {t('guest.staffLogin')}
            </Link>
            <LanguageSwitcher compact className="w-24" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4">
        <section className="pattern relative my-4 overflow-hidden rounded-card border border-line bg-surface px-5 py-6">
          <p className="text-xs text-brand">{menu?.settings?.name || 'MAX'}</p>
          <h1 className="mt-1 text-2xl font-medium text-fg">{t('guest.title')}</h1>
          <p className="mt-1 text-sm text-fg-2">{t('guest.subtitle')}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-fg-2">
            <span className="flex items-center gap-1.5 rounded-full bg-fg/[0.06] px-3 py-1"><Utensils className="size-3.5" /> {t('guest.step1')}</span>
            <span className="flex items-center gap-1.5 rounded-full bg-fg/[0.06] px-3 py-1"><ShoppingBag className="size-3.5" /> {t('guest.step2')}</span>
            <span className="flex items-center gap-1.5 rounded-full bg-fg/[0.06] px-3 py-1"><ChefHat className="size-3.5" /> {t('guest.step3')}</span>
          </div>
        </section>

        {menuError && !menu ? (
          <ErrorState message={errorMessage(t, menuError)} onRetry={() => void loadMenu()} retryLabel={t('common.retry')} />
        ) : !menu ? (
          <SkeletonGrid count={9} />
        ) : !menu.settings?.enabled ? (
          <EmptyState icon={<Utensils className="size-6" />} title={t('guest.closed')} body={t('guest.closedHint')} />
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('guest.search')}
                aria-label={t('guest.search')}
                className="h-12 w-full rounded-card border border-line bg-card ps-10 pe-3 text-sm placeholder:text-fg-3 focus:border-fg-3 focus:outline-none"
              />
            </div>
            <CategoryTabs categories={menu.categories} value={category} onChange={setCategory} hotkeys={false} />
            <ProductGrid
              items={visible}
              selectedId={cart.lastAddedId}
              onAdd={addItem}
              priceFrom={(i) => {
                const v = (optionsByItem.get(i.id) ?? []).filter((o) => o.kind === 'variant' && o.is_active).map((o) => Number(o.price));
                return v.length ? Math.min(...v) : null;
              }}
            />
          </div>
        )}
      </main>

      {/* cart bar */}
      <AnimatePresence>
        {count > 0 && (
          <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="mx-auto flex h-14 w-full max-w-xl items-center justify-between gap-3 rounded-card bg-brand px-4 text-white shadow-lg transition-colors hover:bg-brand-hover"
            >
              <span className="grid size-8 place-items-center rounded-full bg-white/20 text-sm font-medium num">{f.number(count)}</span>
              <span className="text-base font-medium">{t('guest.viewCart')}</span>
              <span className="num text-base font-medium">{f.money(total)}</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* cart + details */}
      <Modal
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        size="md"
        title={t('guest.yourOrder')}
        footer={
          <div className="flex w-full items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-fg-3">{t(type === 'delivery' ? 'guest.payOnDelivery' : 'guest.payAtCashier')}</p>
              <p className="num text-xl font-medium text-fg">{f.money(total)}</p>
            </div>
            <Button variant="primary" size="lg" loading={sending} onClick={() => void send()} disabled={cart.lines.length === 0}>
              {t('guest.send')}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <ul className="space-y-2">
            {cart.lines.map((l) => (
              <GuestLine
                key={l.lineId}
                line={l}
                onQty={(q) => dispatch({ type: 'setQty', lineId: l.lineId, qty: q })}
                onRemove={() => dispatch({ type: 'remove', lineId: l.lineId })}
                onEdit={
                  optionsByItem.has(l.item.id)
                    ? () => {
                        const item = items.find((i) => i.id === l.item.id);
                        if (item) setPicking({ item, lineId: l.lineId, initial: { options: l.options ?? [], notes: l.notes } });
                      }
                    : undefined
                }
              />
            ))}
            {cart.lines.length === 0 && <p className="rounded-card border border-dashed border-line p-6 text-center text-sm text-fg-3">{t('pos.cartEmpty')}</p>}
          </ul>

          <section className="space-y-3 rounded-card border border-line bg-card p-3.5">
            <h3 className="text-[0.9375rem] font-medium text-fg">{t('guest.howTo')}</h3>
            <Segmented
              className="w-full"
              layoutId="guest-type"
              value={type}
              onChange={setType}
              items={[
                { key: 'delivery', label: t('order.type.delivery'), icon: <Bike className="size-4" /> },
                { key: 'takeaway', label: t('guest.pickup'), icon: <ShoppingBag className="size-4" /> },
                { key: 'dine_in', label: t('guest.atTable'), icon: <Armchair className="size-4" /> },
              ]}
            />
            <p className="text-xs text-fg-3">{t(`guest.typeHint.${type}` as 'guest.typeHint.delivery')}</p>
            <h3 className="pt-1 text-[0.9375rem] font-medium text-fg">{t('guest.details')}</h3>
            <TextInput label={t('guest.name')} value={guestName} onChange={(e) => setGuestName(e.target.value)} autoComplete="name" maxLength={60} error={tried && !nameOk ? t('guest.nameError') : null} />
            <div className={cn('grid gap-3', type === 'dine_in' && 'grid-cols-[1fr_7rem]')}>
              <TextInput label={t('guest.phone')} type="tel" inputMode="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={20} error={tried && !phoneOk ? t('validation.phone') : null} />
              {type === 'dine_in' && <TextInput
                label={t('guest.table')}
                type="number"
                inputMode="numeric"
                min={1}
                max={tableCount || undefined}
                value={table}
                onChange={(e) => setTable(e.target.value)}
                error={tried && !tableOk ? t('errors.INVALID_TABLE') : null}
              />}
            </div>
            {type === 'delivery' && (
              <TextInput
                label={t('guest.address')}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                autoComplete="street-address"
                maxLength={300}
                placeholder={t('guest.addressHint')}
                error={tried && !addressOk ? t('errors.DELIVERY_DETAILS_REQUIRED') : null}
              />
            )}
            <TextInput label={t('guest.orderNotes')} value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} maxLength={300} placeholder={t('guest.orderNotesHint')} />
            <p className="text-xs text-fg-3">{t('guest.privacy')} <a href="/privacy.html" target="_blank" rel="noreferrer" className="underline">{t('guest.privacyLink')}</a></p>
          </section>
        </div>
      </Modal>

      <OptionsModal
        item={picking?.item ?? null}
        qty={1}
        options={picking ? optionsByItem.get(picking.item.id) ?? [] : []}
        soldOut={soldOut}
        initial={picking?.initial ?? null}
        onClose={() => setPicking(null)}
        onAdd={(opts, notes) => {
          if (!picking) return;
          if (picking.lineId) dispatch({ type: 'editLine', lineId: picking.lineId, options: opts, notes });
          else dispatch({ type: 'add', item: { id: picking.item.id, name_ar: picking.item.name_ar, name_he: picking.item.name_he, price: picking.item.price, image_url: picking.item.image_url }, qty: 1, options: opts, notes });
          setPicking(null);
        }}
      />
    </div>
  );
}

/** One line of the guest's cart. */
function GuestLine({ line, onQty, onRemove, onEdit }: { line: CartLine; onQty: (q: number) => void; onRemove: () => void; onEdit?: () => void }) {
  const { t } = useI18n();
  const { f, name } = useSettings();
  const variant = (line.options ?? []).find((o) => o.kind === 'variant');
  const extras = (line.options ?? []).filter((o) => o.kind !== 'variant');
  return (
    <li className="flex gap-3 rounded-card border border-line bg-card p-3">
      <FoodImage src={line.item.image_url} alt="" className="size-16 shrink-0 rounded-btn" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-fg">{name(line.item)}</p>
          <button type="button" onClick={onRemove} aria-label={t('pos.remove')} className="grid size-7 shrink-0 place-items-center rounded-btn text-fg-3 hover:text-danger">
            <X className="size-4" />
          </button>
        </div>
        {variant && <p className="text-xs text-fg">{name(variant)}</p>}
        {extras.length > 0 && <p className="text-xs text-fg-2">+ {extras.map((o) => optionLabel(name(o), o.qty)).join('، ')}</p>}
        {line.notes && <p className="text-xs text-warning">• {line.notes}</p>}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center rounded-btn border border-line bg-surface" dir="ltr">
            <button type="button" onClick={() => onQty(line.qty - 1)} className="grid size-9 place-items-center text-fg-2" aria-label="-1">
              <Minus className="size-4" />
            </button>
            <span className="num w-7 text-center text-sm">{f.number(line.qty)}</span>
            <button type="button" onClick={() => onQty(line.qty + 1)} className="grid size-9 place-items-center text-fg-2" aria-label="+1">
              <Plus className="size-4" />
            </button>
          </div>
          {onEdit && (
            <button type="button" onClick={onEdit} className="flex h-9 items-center gap-1 rounded-btn px-2 text-xs text-fg-2 hover:text-fg">
              <Pencil className="size-3.5" /> {t('common.edit')}
            </button>
          )}
          <span className="num text-sm font-medium text-fg">{f.money(unitPrice(line) * line.qty)}</span>
        </div>
      </div>
    </li>
  );
}

const STEPS: OrderStatus['status'][] = ['new', 'preparing', 'ready', 'served'];

/** After sending: the order number and where it is now (refreshes every few seconds). */
function OrderTracker({ clientRef, onNew }: { clientRef: string; onNew: () => void }) {
  const { t } = useI18n();
  const { f } = useSettings();
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase.rpc('customer_order_status', { p_client_ref: clientRef });
      if (!alive || error) return;
      if (!data) return setMissing(true);
      setOrder(fromJson<OrderStatus>(data));
    };
    void load();
    const id = window.setInterval(() => void load(), 8000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [clientRef]);

  useEffect(() => {
    if (missing) onNew();
  }, [missing, onNew]);

  const step = order ? Math.max(0, STEPS.indexOf(order.status)) : 0;
  const cancelled = order?.status === 'cancelled' || order?.status === 'refunded';
  const icons = [Check, ChefHat, CircleCheck, Utensils];

  return (
    <div className="pattern flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md rounded-card border border-line bg-surface p-6 text-center">
        <BrandMark size="sm" className="justify-center" />
        {!order ? (
          <p className="mt-10 text-sm text-fg-3">{t('guest.loading')}</p>
        ) : (
          <>
            <div className="mx-auto mt-6 grid size-16 place-items-center rounded-full bg-success/15 text-success">
              <CircleCheck className="size-8" />
            </div>
            <h1 className="mt-4 text-xl font-medium text-fg">{t('guest.sent')}</h1>
            <p className="mt-1 text-sm text-fg-2">{t('guest.orderNo')}</p>
            <p className="num mt-1 text-5xl font-medium text-fg">#{order.order_number}</p>
            <p className="mt-2 text-sm text-fg-3">
              {order.type === 'dine_in' ? t('guest.tableN', { table: f.number(order.table_no ?? 0) }) : order.type === 'delivery' ? t('order.type.delivery') : t('guest.pickup')} ·{' '}
              <span className="num">{f.money(Number(order.total))}</span>
            </p>

            {cancelled ? (
              <p className="mt-6 rounded-card bg-danger/10 p-3 text-sm text-danger">{t('guest.cancelled')}</p>
            ) : (
              <ol className="mt-6 grid grid-cols-4 gap-2">
                {STEPS.map((s, i) => {
                  const Icon = icons[i];
                  const done = i <= step;
                  return (
                    <li key={s} className="flex flex-col items-center gap-1.5">
                      <span className={cn('grid size-10 place-items-center rounded-full border-2 transition-colors', done ? 'border-brand bg-brand text-white' : 'border-line text-fg-3', i === step && 'animate-pulse')}>
                        <Icon className="size-4" />
                      </span>
                      <span className={cn('text-[0.6875rem]', done ? 'text-fg' : 'text-fg-3')}>{t(`guest.step.${s}` as 'guest.step.new')}</span>
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="mt-6 rounded-card border border-line bg-card p-3 text-start">
              {order.items.map((i, idx) => (
                <p key={idx} className="text-sm text-fg-2">
                  <span className="num text-fg">{f.number(i.qty)}×</span> {i.name}
                </p>
              ))}
            </div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-sm text-fg-2">
              <Clock className="size-4" /> {order.payment_status === 'paid' ? t('guest.paid') : t(order.type === 'delivery' ? 'guest.payOnDelivery' : 'guest.payAtCashier')}
            </p>
            <Button className="mt-6 w-full" size="lg" variant="secondary" icon={<Plus className="size-4" />} onClick={onNew}>
              {t('guest.newOrder')}
            </Button>
          </>
        )}
      </motion.div>
    </div>
  );
}
