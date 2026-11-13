import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Phone, UserRound, X } from 'lucide-react';
import { useT } from '@/i18n';
import { useSettings } from '@/app/providers/SettingsProvider';
import { useConnection } from '@/app/providers/ConnectionProvider';
import { TextInput } from '@/components/ui/Input';
import { findCustomers, type CustomerMatch } from '../api';
import type { CartAction, CartState } from '../cart';

/**
 * Name + phone of the customer. Typing a phone number or a name looks up returning customers
 * (only the few matches needed to serve this order); picking one fills name, phone and address.
 */
export function CustomerField({ state, dispatch, delivery, phoneError, addressError }: {
  state: CartState;
  dispatch: (a: CartAction) => void;
  delivery: boolean;
  phoneError?: string | null;
  addressError?: string | null;
}) {
  const t = useT();
  const { f } = useSettings();
  const { online } = useConnection();
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<CustomerMatch | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const phone = state.customerPhone.trim();
  const custName = state.customerName.trim();
  const query = phone.replace(/[^0-9]/g, '').length >= 3 ? phone : custName.length >= 2 ? custName : '';

  useEffect(() => {
    if (!query || !online || (picked && picked.phone === phone.replace(/[^0-9+]/g, ''))) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      findCustomers(query)
        .then((m) => {
          if (cancelled) return;
          setMatches(m);
          setOpen(m.length > 0);
        })
        .catch(() => !cancelled && setMatches([]));
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query, online, picked, phone]);

  // a new order starts without a picked customer
  useEffect(() => {
    if (!state.customerPhone && !state.customerName) setPicked(null);
  }, [state.customerPhone, state.customerName]);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const pick = (c: CustomerMatch) => {
    setPicked(c);
    setOpen(false);
    dispatch({ type: 'field', field: 'customerPhone', value: c.phone });
    dispatch({ type: 'field', field: 'customerName', value: c.name });
    if (c.address) dispatch({ type: 'field', field: 'customerAddress', value: c.address });
  };

  const clear = () => {
    setPicked(null);
    dispatch({ type: 'field', field: 'customerPhone', value: '' });
    dispatch({ type: 'field', field: 'customerName', value: '' });
    dispatch({ type: 'field', field: 'customerAddress', value: '' });
  };

  return (
    <div ref={boxRef} className="relative space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <TextInput
          placeholder={delivery ? t('pos.customerPhone') : t('pos.phoneOptional')}
          aria-label={t('pos.customerPhone')}
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="off"
          value={state.customerPhone}
          onFocus={() => matches.length > 0 && setOpen(true)}
          onChange={(e) => {
            setPicked(null);
            dispatch({ type: 'field', field: 'customerPhone', value: e.target.value });
          }}
          error={phoneError}
        />
        <TextInput
          placeholder={delivery ? t('pos.customerName') : t('pos.nameOptional')}
          aria-label={t('pos.customerName')}
          autoComplete="off"
          value={state.customerName}
          onFocus={() => matches.length > 0 && setOpen(true)}
          onChange={(e) => dispatch({ type: 'field', field: 'customerName', value: e.target.value })}
        />
      </div>
      {delivery && (
        <TextInput
          placeholder={t('pos.customerAddress')}
          aria-label={t('pos.customerAddress')}
          value={state.customerAddress}
          onChange={(e) => dispatch({ type: 'field', field: 'customerAddress', value: e.target.value })}
          error={addressError}
        />
      )}

      {picked && (
        <div className="flex items-start gap-2 rounded-btn border border-line bg-elevated px-3 py-2 text-xs text-fg-2">
          <UserRound className="mt-0.5 size-4 shrink-0 text-fg-3" />
          <div className="min-w-0 flex-1">
            <p className="text-fg">
              {t('pos.returningCustomer', { count: f.number(picked.orders_count) })}
              {picked.last_order_at && <span className="text-fg-3"> · {f.date(picked.last_order_at)}</span>}
            </p>
            {picked.favorites.length > 0 && <p className="truncate">{t('pos.usualOrder')}: {picked.favorites.join('، ')}</p>}
            {picked.notes && <p className="text-warning">{picked.notes}</p>}
            {!delivery && picked.address && <p className="truncate text-fg-3">{picked.address}</p>}
          </div>
          <button type="button" onClick={clear} aria-label={t('common.clear')} className="grid size-6 place-items-center rounded text-fg-3 hover:text-fg">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <AnimatePresence>
        {open && matches.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute inset-x-0 top-12 z-30 overflow-hidden rounded-card border border-line-strong bg-card shadow-panel"
            role="listbox"
            aria-label={t('pos.customerMatches')}
          >
            {matches.map((c) => (
              <li key={c.id}>
                <button type="button" role="option" aria-selected={false} onClick={() => pick(c)} className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-elevated">
                  <Phone className="size-4 shrink-0 text-fg-3" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{c.name || t('common.unknown')}</span>
                    <span className="num block text-xs text-fg-3" dir="ltr">{c.phone}</span>
                  </span>
                  <span className="num shrink-0 text-xs text-fg-3">{t('pos.ordersCount', { count: f.number(c.orders_count) })}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
