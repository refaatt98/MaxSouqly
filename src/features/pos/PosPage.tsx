import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { HandCoins, LockKeyhole, Plus, ReceiptText, ScanBarcode, Search, ShoppingBag, WifiOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { enqueueOrder } from '@/lib/offlineQueue';
import { printOrderBundle, printReceipt, receiptFromOrder, type ReceiptData } from '@/lib/print';
import { playSuccess, unlockAudio } from '@/lib/sound';
import { useQuery } from '@/hooks/useQuery';
import { useLiveRefetch } from '@/hooks/useRealtime';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useBarcodeScanner } from './hooks/useBarcodeScanner';
import { useAuth } from '@/app/providers/AuthProvider';
import { usePermissions } from '@/app/providers/PermissionsProvider';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useConnection } from '@/app/providers/ConnectionProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { SkeletonGrid } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import type { CashShift, MenuItem, MenuItemOption, OrderFull } from '@/types/models';
import { fetchCatalog, fetchOpenShift, logCartCancel, placeOrder } from './api';
import { buildPayload, optionLabel, cartReducer, cartTotals, loadHeld, newCart, saveHeld, unitPrice, validateCart, type CartOption, type HeldOrder } from './cart';
import { OptionsModal } from './components/OptionsModal';
import { AdvanceModal } from './components/AdvanceModal';
import { UnpaidOrdersModal, fetchUnpaid } from './components/UnpaidOrdersModal';
import { CategoryTabs } from './components/CategoryTabs';
import { ProductGrid } from './components/ProductGrid';
import { CartPanel } from './components/CartPanel';
import { PaymentModal, type PaymentResult } from './components/PaymentModal';
import { CloseShiftModal, OpenShiftPanel } from './components/ShiftPanels';
import { CancelCartModal, CustomQtyModal, HeldOrdersModal, SuccessOverlay, type SuccessInfo } from './components/PosDialogs';

const SHIFT_CACHE = 'max.pos.shift';

export default function PosPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { profile, role } = useAuth();
  const { can } = usePermissions();
  const { settings, name, f } = useSettings();
  const { online } = useConnection();
  const [params, setParams] = useSearchParams();

  // ------------------------------------------------------------ catalog
  const catalog = useQuery(fetchCatalog, []);
  useLiveRefetch(['menu_items', 'categories', 'menu_item_options', 'menu_option_recipes', 'ingredients', 'printers'], catalog.refetch, 1500);
  const soldOut = useMemo(() => new Set(catalog.data?.outOfStock ?? []), [catalog.data]);
  const optionsByItem = useMemo(() => {
    const m = new Map<string, MenuItemOption[]>();
    for (const o of catalog.data?.options ?? []) m.set(o.menu_item_id, [...(m.get(o.menu_item_id) ?? []), o]);
    return m;
  }, [catalog.data]);

  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState(() => params.get('q') ?? '');
  const [multiplier, setMultiplier] = useState(1);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = params.get('q');
    if (q !== null) {
      setSearch(q);
      setCategory(null);
      params.delete('q');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const categories = useMemo(() => catalog.data?.categories ?? [], [catalog.data]);
  const visibleItems = useMemo(() => {
    const all = catalog.data?.items ?? [];
    const needle = search.trim().toLowerCase();
    const activeCats = new Set(categories.map((c) => c.id));
    return all.filter((i) => {
      if (!activeCats.has(i.category_id)) return false;
      if (needle) return i.name_ar.toLowerCase().includes(needle) || i.name_he.toLowerCase().includes(needle) || (i.barcode ?? '') === needle;
      return category === null || i.category_id === category;
    });
  }, [catalog.data, categories, category, search]);

  // ------------------------------------------------------------ shift
  const [shift, setShift] = useState<CashShift | null | undefined>(undefined);
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);
  const [openShiftOpen, setOpenShiftOpen] = useState(false);
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    fetchOpenShift(profile.id)
      .then((s) => {
        if (cancelled) return;
        setShift(s);
        try {
          if (s) localStorage.setItem(SHIFT_CACHE, JSON.stringify(s));
          else localStorage.removeItem(SHIFT_CACHE);
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        // offline: trust the last known shift so selling can continue
        if (cancelled) return;
        try {
          const cached = localStorage.getItem(SHIFT_CACHE);
          setShift(cached ? (JSON.parse(cached) as CashShift) : null);
        } catch {
          setShift(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);
  const needsShift = role === 'cashier' && shift === null;

  // ------------------------------------------------------------ cart
  const [cart, dispatch] = useReducer(cartReducer, undefined, newCart);
  const vat = Number(settings?.vat_percent ?? 0);
  const totals = useMemo(() => cartTotals(cart, vat), [cart, vat]);
  const maxDiscount =
    role === 'owner' ? 100 : role === 'manager' ? Number(settings?.max_discount_manager_percent ?? 100) : Number(settings?.max_discount_cashier_percent ?? 0);
  const tableCount = settings?.table_count ?? 0;
  const issue = validateCart(cart, totals, maxDiscount, tableCount);
  const [showIssue, setShowIssue] = useState(false);

  // items with extras open a picker first; the rest go straight into the cart
  const [picking, setPicking] = useState<{ item: MenuItem; qty: number; lineId?: string; initial?: { options: CartOption[]; notes: string } } | null>(null);
  const pushItem = useCallback((item: MenuItem, qty: number, options: CartOption[] = [], notes = '') => {
    dispatch({ type: 'add', item: { id: item.id, name_ar: item.name_ar, name_he: item.name_he, price: item.price, image_url: item.image_url }, qty, options, notes });
    setMultiplier(1);
  }, []);
  const addItem = useCallback(
    (item: MenuItem, qty?: number) => {
      if (!item.is_available) return;
      void unlockAudio();
      const n = qty ?? multiplier;
      if (optionsByItem.has(item.id)) setPicking({ item, qty: n });
      else pushItem(item, n);
    },
    [multiplier, optionsByItem, pushItem],
  );

  const addByBarcode = useCallback(
    (code: string) => {
      const item = catalog.data?.items.find((i) => i.barcode === code);
      if (item) {
        addItem(item, 1);
        setSearch('');
      } else toast.error(t('common.noResults'));
    },
    [catalog.data, addItem, toast, t],
  );

  // ------------------------------------------------------------ held orders
  const [held, setHeld] = useState<HeldOrder[]>(loadHeld);
  const [heldOpen, setHeldOpen] = useState(false);
  const holdCurrent = () => {
    if (cart.lines.length === 0) return;
    const next = [{ id: crypto.randomUUID(), created_at: new Date().toISOString(), cart }, ...held];
    setHeld(next);
    saveHeld(next);
    dispatch({ type: 'reset' });
    toast.info(t('pos.heldSaved'));
  };
  const resumeHeld = (h: HeldOrder) => {
    let next = held.filter((x) => x.id !== h.id);
    // park the current cart instead of losing it
    if (cart.lines.length > 0) next = [{ id: crypto.randomUUID(), created_at: new Date().toISOString(), cart }, ...next];
    setHeld(next);
    saveHeld(next);
    dispatch({ type: 'load', state: h.cart });
    setHeldOpen(false);
  };
  const discardHeld = (h: HeldOrder) => {
    const next = held.filter((x) => x.id !== h.id);
    setHeld(next);
    saveHeld(next);
  };

  // ------------------------------------------------------------ cancel / print
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const confirmCancel = async (reason: string) => {
    setCancelPending(true);
    try {
      if (online) await logCartCancel(reason, totals.count, totals.total);
    } catch {
      /* audit is best effort — never block clearing the screen */
    } finally {
      setCancelPending(false);
      setCancelOpen(false);
      dispatch({ type: 'reset' });
      toast.info(t('pos.cartCleared'));
    }
  };

  const receiptFromCart = (number: string, payments: ReceiptData['payments']): ReceiptData => ({
    number,
    created_at: new Date().toISOString(),
    cashier_name: profile?.full_name ?? '',
    type: cart.type,
    table_no: cart.type === 'dine_in' ? Number(cart.tableNo) || null : null,
    customer_name: cart.customerName,
    customer_phone: cart.customerPhone,
    customer_address: cart.customerAddress,
    notes: cart.notes,
    items: cart.lines.map((l) => ({
      name: l.item.name_ar,
      qty: l.qty,
      unit_price: unitPrice(l),
      notes: l.notes,
      options: (l.options ?? []).map((o) => optionLabel(o.name_ar, o.qty)),
      menu_item_id: l.item.id,
    })),
    subtotal: totals.subtotal,
    discount_amount: totals.discount,
    total: totals.total,
    vat_amount: totals.vat,
    payments,
  });

  /** Receipt for the customer plus one kitchen ticket per station (printer set on the item or its category). */
  const printSent = (r: ReceiptData, extra: { offline?: boolean } = {}) => {
    const ctx = { t, f, settings, ...extra };
    if (!settings?.print_kitchen_on_send) return void printReceipt(r, ctx, lang);
    const items = catalog.data?.items ?? [];
    const cats = new Map((catalog.data?.categories ?? []).map((c) => [c.id, c]));
    const printers = (catalog.data?.printers ?? []).filter((p) => p.kind === 'kitchen');
    const byId = new Map(printers.map((p) => [p.id, p]));
    const groups = new Map<string, ReceiptData['items']>();
    for (const line of r.items) {
      const mi = items.find((i) => i.id === line.menu_item_id);
      const pid = mi?.printer_id ?? (mi ? cats.get(mi.category_id)?.printer_id : null) ?? null;
      const key = pid && byId.has(pid) ? pid : '';
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    const stations = [...groups.entries()].map(([pid, lines]) => ({ name: byId.get(pid)?.name ?? t('kitchen.title'), items: lines }));
    void printOrderBundle(r, ctx, stations, lang);
  };

  const printPreview = () => {
    if (cart.lines.length === 0) return;
    void printReceipt(receiptFromCart('—', []), { t, f, settings, preview: true }, lang);
  };

  // ------------------------------------------------------------ payment
  const [payOpen, setPayOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);

  const openPayment = () => {
    if (cart.lines.length === 0) return;
    if (cart.staffMeal) return void sendOrder();
    setShowIssue(true);
    if (issue === 'table') return toast.error(t('errors.INVALID_TABLE'));
    if (issue === 'delivery') return toast.error(t('errors.DELIVERY_DETAILS_REQUIRED'));
    if (issue === 'discount') return toast.error(t('errors.DISCOUNT_LIMIT', { detail: f.number(maxDiscount) }));
    if (issue === 'phone') return toast.error(t('validation.phone'));
    setPayOpen(true);
  };

  const completeSale = async ({ payments, change }: PaymentResult) => {
    const payload = buildPayload(cart, totals, payments);
    setPaying(true);
    const queueOffline = async () => {
      const q = await enqueueOrder(payload);
      printSent(receiptFromCart(q.temp_number, payments.map((p) => ({ ...p, change: p.method === 'cash' ? Math.max((p.tendered ?? p.amount) - p.amount, 0) : 0 }))), { offline: true });
      setSuccess({ number: q.temp_number, change, total: totals.total, offline: true });
    };
    try {
      if (!online && settings?.offline_mode) {
        await queueOffline();
      } else {
        const order = await placeOrder(payload);
        printSent(receiptFromOrder(order));
        setSuccess({ number: `#${order.order_number}`, change, total: Number(order.total), offline: false });
      }
      playSuccess();
      setPayOpen(false);
      setShowIssue(false);
      dispatch({ type: 'reset' });
    } catch (err) {
      if (isNetworkError(err) && settings?.offline_mode) {
        try {
          await queueOffline();
          setPayOpen(false);
          dispatch({ type: 'reset' });
          return;
        } catch {
          /* fall through to the error toast */
        }
      }
      toast.error(errorMessage(t, err));
    } finally {
      setPaying(false);
    }
  };

  // ------------------------------------------------------------ send now, pay later
  const [sending, setSending] = useState(false);
  const sendOrder = async () => {
    if (cart.lines.length === 0 || sending) return;
    setShowIssue(true);
    if (issue === 'table') return toast.error(t('errors.INVALID_TABLE'));
    if (issue === 'delivery') return toast.error(t('errors.DELIVERY_DETAILS_REQUIRED'));
    if (issue === 'discount') return toast.error(t('errors.DISCOUNT_LIMIT', { detail: f.number(maxDiscount) }));
    if (issue === 'phone') return toast.error(t('validation.phone'));
    if (issue === 'staff') return toast.error(t('pos.chooseEmployee'));
    const payload = buildPayload(cart, totals, [], true);
    setSending(true);
    const queueOffline = async () => {
      const q = await enqueueOrder(payload);
      printSent({ ...receiptFromCart(q.temp_number, []), due: totals.total }, { offline: true });
      setSuccess({ number: q.temp_number, change: 0, total: totals.total, offline: true, unpaid: !payload.staff_employee_id });
    };
    try {
      if (!online && settings?.offline_mode) await queueOffline();
      else {
        const order: OrderFull = await placeOrder(payload);
        printSent(receiptFromOrder(order));
        setSuccess({ number: `#${order.order_number}`, change: 0, total: Number(order.total), offline: false, unpaid: !payload.staff_employee_id });
      }
      playSuccess();
      setShowIssue(false);
      dispatch({ type: 'reset' });
      setMobileCart(false);
      void unpaid.refetch();
    } catch (err) {
      if (isNetworkError(err) && settings?.offline_mode) {
        try {
          await queueOffline();
          dispatch({ type: 'reset' });
          return;
        } catch {
          /* fall through */
        }
      }
      toast.error(errorMessage(t, err));
    } finally {
      setSending(false);
    }
  };
  const [unpaidOpen, setUnpaidOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const unpaid = useQuery(fetchUnpaid, []);
  useLiveRefetch(['orders', 'payments'], unpaid.refetch, 1200);

  // ------------------------------------------------------------ keyboard
  const [qtyOpen, setQtyOpen] = useState(false);
  const [mobileCart, setMobileCart] = useState(false);
  const anyDialog = payOpen || cancelOpen || heldOpen || qtyOpen || closeShiftOpen || openShiftOpen || mobileCart || success !== null || picking !== null || unpaidOpen || advanceOpen;
  const hotkeys = useMemo(() => {
    const map: Record<string, () => void> = {
      Enter: () => openPayment(),
      Escape: () => {
        if (search) setSearch('');
        else if (cart.lines.length > 0) setCancelOpen(true);
      },
      '/': () => searchRef.current?.focus(),
    };
    for (let i = 0; i < 6; i++) map[`F${i + 1}`] = () => categories[i] && (setSearch(''), setCategory(categories[i].id));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, search, cart, issue, totals]);
  useHotkeys(hotkeys, !anyDialog && !needsShift);
  useBarcodeScanner(addByBarcode, !anyDialog && !needsShift);


  const cartPanel = (
    <CartPanel
      state={cart}
      dispatch={dispatch}
      totals={totals}
      maxDiscount={maxDiscount}
      vatPercent={vat}
      tableCount={tableCount}
      issue={issue}
      showIssue={showIssue}
      heldCount={held.length}
      onPay={openPayment}
      onSend={() => void sendOrder()}
      sending={sending}
      onCancel={() => setCancelOpen(true)}
      onPrint={printPreview}
      onHold={holdCurrent}
      onOpenHeld={() => setHeldOpen(true)}
      canEdit={(l) => optionsByItem.has(l.item.id)}
      onEditLine={(l) => {
        const item = catalog.data?.items.find((i) => i.id === l.item.id);
        if (item) setPicking({ item, qty: l.qty, lineId: l.lineId, initial: { options: l.options ?? [], notes: l.notes } });
      }}
    />
  );

  if (shift === undefined || (catalog.loading && !catalog.data)) {
    return (
      <div className="p-4 md:p-6">
        <SkeletonGrid count={12} />
      </div>
    );
  }
  if (needsShift) return <OpenShiftPanel onOpened={setShift} />;
  if (catalog.error && !catalog.data) {
    return <ErrorState message={errorMessage(t, catalog.error)} onRetry={() => void catalog.refetch()} retryLabel={t('common.retry')} />;
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] md:h-[calc(100dvh-5rem)]">
      {/* Products */}
      <section className="flex min-w-0 flex-1 flex-col" aria-label={t('pos.title')}>
        <div className="space-y-3 border-b border-line px-4 pt-4 pb-3 md:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-medium">{t('pos.title')}</h1>
            <Badge tone="neutral">{t('pos.cashier', { name: profile?.full_name ?? '' })}</Badge>
            {shift && (
              <button type="button" onClick={() => setCloseShiftOpen(true)} className="inline-flex items-center gap-1.5 rounded-[6px] border border-line px-2 py-0.5 text-xs text-fg-2 transition-colors hover:text-fg">
                <LockKeyhole className="size-3" />
                {t('shift.openedAt', { time: f.time(shift.opened_at) })} · {t('shift.close')}
              </button>
            )}
            {!shift && (
              <button type="button" onClick={() => setOpenShiftOpen(true)} className="inline-flex items-center gap-1.5 rounded-[6px] border border-line px-2 py-0.5 text-xs text-fg-2 transition-colors hover:text-fg">
                <LockKeyhole className="size-3" />
                {t('shift.open')}
              </button>
            )}
            <button type="button" onClick={() => setUnpaidOpen(true)} className="inline-flex items-center gap-1.5 rounded-[6px] border border-line px-2 py-0.5 text-xs text-fg-2 transition-colors hover:text-fg">
              <ReceiptText className="size-3" />
              {t('pos.unpaidTitle')}
              {(unpaid.data?.length ?? 0) > 0 && <span className="num rounded bg-warning/20 px-1 text-warning">{f.number(unpaid.data?.length ?? 0)}</span>}
            </button>
            {can('advance') && <button type="button" onClick={() => setAdvanceOpen(true)} className="inline-flex items-center gap-1.5 rounded-[6px] border border-line px-2 py-0.5 text-xs text-fg-2 transition-colors hover:text-fg">
              <HandCoins className="size-3" />
              {t('advance.title')}
            </button>}
            {catalog.data?.fromCache && (
              <Badge tone="amber" icon={<WifiOff className="size-3" />}>
                {t('topbar.offline')}
              </Badge>
            )}
            <span className="ms-auto hidden text-xs text-fg-3 xl:block">{t('pos.shortcuts')}</span>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-fg-3" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && search.trim()) {
                  e.preventDefault();
                  e.stopPropagation();
                  const exact = catalog.data?.items.find((i) => i.barcode === search.trim());
                  if (exact) addByBarcode(search.trim());
                  else if (visibleItems.length === 1) {
                    addItem(visibleItems[0]);
                    setSearch('');
                  }
                } else if (e.key === 'Escape') setSearch('');
              }}
              placeholder={t('pos.search')}
              aria-label={t('pos.search')}
              className="h-11 w-full rounded-btn border border-line-strong bg-surface ps-11 pe-11 text-base sm:h-12 placeholder:text-fg-3 focus:border-fg-3 focus:ring-2 focus:ring-black/10 focus:outline-none"
            />
            <ScanBarcode className="pointer-events-none absolute end-3.5 top-1/2 size-5 -translate-y-1/2 text-fg-3" />
          </div>
          <CategoryTabs
            categories={categories}
            value={search ? null : category}
            onChange={(id) => {
              setSearch('');
              setCategory(id);
            }}
          />
          <div className="flex items-center gap-2">
            <span className="text-[0.8125rem] text-fg-3">{t('pos.multiplier')}</span>
            {[1, 2, 3].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMultiplier(m)}
                aria-pressed={multiplier === m}
                className={cn(
                  'mono h-9 min-w-11 rounded-btn border px-2.5 text-[0.9375rem] transition-colors sm:h-11 sm:min-w-14 sm:px-3',
                  multiplier === m ? 'border-line-strong bg-elevated text-fg shadow-glow-sm' : 'border-line bg-card text-fg-3 hover:border-line-strong hover:text-fg-2',
                )}
              >
                {f.digits(m)}x
              </button>
            ))}
            <button
              type="button"
              onClick={() => setQtyOpen(true)}
              aria-label={t('pos.customQty')}
              className={cn(
                'mono grid h-9 min-w-11 place-items-center rounded-btn border px-2.5 transition-colors sm:h-11 sm:min-w-14 sm:px-3',
                multiplier > 3 ? 'border-line-strong bg-elevated text-fg shadow-glow-sm' : 'border-line bg-card text-fg-3 hover:border-line-strong hover:text-fg-2',
              )}
            >
              {multiplier > 3 ? `${f.digits(multiplier)}x` : <Plus className="size-5" />}
            </button>
            <span className="num ms-auto text-xs text-fg-3">{t('pos.productsCount', { count: f.number(visibleItems.length) })}</span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-28 md:p-5 lg:pb-5">
          <ProductGrid
            items={visibleItems}
            selectedId={cart.lastAddedId}
            onAdd={(i) => addItem(i)}
            priceFrom={(i) => {
              const v = (optionsByItem.get(i.id) ?? []).filter((o) => o.kind === 'variant' && o.is_active).map((o) => Number(o.price));
              return v.length ? Math.min(...v) : null;
            }}
          />
        </div>
      </section>

      {/* Cart (desktop / tablet) */}
      <aside className="hidden w-[23.75rem] shrink-0 border-s border-line bg-surface lg:block xl:w-[26.25rem]">{cartPanel}</aside>

      {/* Cart (mobile) */}
      <AnimatePresence>
        {cart.lines.length > 0 && (
          <motion.button
            type="button"
            initial={{ y: 80 }}
            animate={{ y: 0 }}
            exit={{ y: 80 }}
            onClick={() => setMobileCart(true)}
            className="fixed inset-x-4 bottom-20 z-30 flex h-14 items-center justify-between rounded-card bg-brand px-5 font-medium text-white shadow-panel lg:hidden"
          >
            <span className="flex items-center gap-2">
              <ShoppingBag className="size-5" /> {t('pos.cart')} · <span className="num">{f.number(totals.count)}</span>
            </span>
            <span className="num text-lg">{f.money(totals.total)}</span>
          </motion.button>
        )}
      </AnimatePresence>
      <Modal open={mobileCart} onClose={() => setMobileCart(false)} size="md" className="h-[92dvh]">
        <div className="-mx-5 -my-4 h-[calc(92dvh-5rem)]">{cartPanel}</div>
      </Modal>

      <PaymentModal open={payOpen} due={totals.total} onClose={() => setPayOpen(false)} onConfirm={(r) => void completeSale(r)} pending={paying} />
      <OptionsModal
        item={picking?.item ?? null}
        qty={picking?.qty ?? 1}
        options={picking ? optionsByItem.get(picking.item.id) ?? [] : []}
        soldOut={soldOut}
        onClose={() => setPicking(null)}
        initial={picking?.initial ?? null}
        onAdd={(opts, notes) => {
          if (picking?.lineId) dispatch({ type: 'editLine', lineId: picking.lineId, options: opts, notes });
          else if (picking) pushItem(picking.item, picking.qty, opts, notes);
          setPicking(null);
        }}
      />
      <UnpaidOrdersModal open={unpaidOpen} onClose={() => setUnpaidOpen(false)} />
      <AdvanceModal open={advanceOpen} onClose={() => setAdvanceOpen(false)} />
      <CancelCartModal open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={(r) => void confirmCancel(r)} pending={cancelPending} />
      <CustomQtyModal
        open={qtyOpen}
        onClose={() => setQtyOpen(false)}
        onConfirm={(q) => {
          setMultiplier(q);
          setQtyOpen(false);
        }}
      />
      <HeldOrdersModal open={heldOpen} onClose={() => setHeldOpen(false)} held={held} onResume={resumeHeld} onDiscard={discardHeld} />
      <CloseShiftModal
        open={closeShiftOpen}
        onClose={() => setCloseShiftOpen(false)}
        onClosed={() => {
          setCloseShiftOpen(false);
          setShift(null);
          try {
            localStorage.removeItem(SHIFT_CACHE);
          } catch {
            /* ignore */
          }
        }}
      />
      <Modal open={openShiftOpen} onClose={() => setOpenShiftOpen(false)} size="sm">
        <OpenShiftPanel
          onOpened={(s) => {
            setShift(s);
            setOpenShiftOpen(false);
          }}
        />
      </Modal>
      <SuccessOverlay info={success} onDone={() => setSuccess(null)} />
      {/* name() is used for screen readers in the grid; keep catalog names localised */}
      <span className="sr-only" aria-live="polite">
        {cart.lastAddedId ? name(catalog.data?.items.find((i) => i.id === cart.lastAddedId) ?? { name_ar: '' }) : ''}
      </span>
    </div>
  );
}
