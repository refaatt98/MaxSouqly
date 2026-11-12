import type { TFunction } from '@/i18n';
import type { Formatter } from './format';
import type { OrderFull, OrderType, PaymentMethod, Settings, ShiftReport } from '@/types/models';

// Printing via a hidden iframe + window.print() (no library).

function escapeHtml(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FONT_LINK =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=Heebo:wght@400;600;700&display=swap">';

export function printHtml(body: string, css: string, lang = 'ar'): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      iframe.remove();
      resolve();
      return;
    }
    doc.open();
    doc.write(
      `<!doctype html><html lang="${lang}" dir="rtl"><head><meta charset="utf-8">${FONT_LINK}<style>${css}</style></head><body>${body}</body></html>`,
    );
    doc.close();

    const cleanup = () => {
      setTimeout(() => iframe.remove(), 500);
      resolve();
    };
    const go = async () => {
      try {
        await Promise.race([doc.fonts?.ready, new Promise((r) => setTimeout(r, 1200))]);
        const images = Array.from(doc.images);
        await Promise.race([
          Promise.all(images.map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })))),
          new Promise((r) => setTimeout(r, 1500)),
        ]);
      } catch {
        /* print anyway */
      }
      win.focus();
      win.addEventListener('afterprint', cleanup, { once: true });
      win.print();
      // Safari doesn't always fire afterprint
      setTimeout(cleanup, 60_000);
    };
    if (doc.readyState === 'complete') void go();
    else iframe.addEventListener('load', () => void go(), { once: true });
  });
}

// ---------------------------------------------------------------- receipt
export interface ReceiptData {
  number: string;
  created_at: string;
  cashier_name: string;
  type: OrderType;
  table_no: number | null;
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
  notes?: string;
  items: { name: string; qty: number; unit_price: number; notes?: string }[];
  subtotal: number;
  discount_amount: number;
  total: number;
  vat_amount: number;
  payments: { method: PaymentMethod; amount: number; tendered?: number | null; change?: number }[];
}

export function receiptFromOrder(o: OrderFull): ReceiptData {
  return {
    number: `#${o.order_number}`,
    created_at: o.created_at,
    cashier_name: o.cashier_name ?? '',
    type: o.type,
    table_no: o.table_no,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    customer_address: o.customer_address,
    notes: o.notes,
    items: o.items.map((i) => ({ name: i.name_snapshot, qty: i.quantity, unit_price: Number(i.unit_price_snapshot), notes: i.notes })),
    subtotal: Number(o.subtotal),
    discount_amount: Number(o.discount_amount),
    total: Number(o.total),
    vat_amount: Number(o.vat_amount),
    payments: o.payments.map((p) => ({ method: p.method, amount: Number(p.amount), tendered: p.tendered, change: Number(p.change_given) })),
  };
}

const RECEIPT_CSS = `
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 4mm 3mm 8mm; width: 80mm; font-family: 'IBM Plex Sans Arabic','Heebo',Tahoma,sans-serif; color:#000; font-size: 12px; line-height: 1.45; }
.c { text-align: center; }
.logo { font-size: 30px; font-weight: 800; letter-spacing: 1px; }
.logo span { color: #000; border-bottom: 3px solid #000; }
.logo-img { max-width: 40mm; max-height: 20mm; }
.muted { font-size: 11px; }
hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
table { width: 100%; border-collapse: collapse; }
td, th { padding: 2px 0; vertical-align: top; text-align: start; }
th { font-size: 11px; border-bottom: 1px solid #000; }
.n { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
.note { font-size: 10px; padding-inline-start: 6px; }
.row { display: flex; justify-content: space-between; gap: 8px; font-variant-numeric: tabular-nums; }
.big { font-size: 16px; font-weight: 700; }
.badge { border: 1px solid #000; padding: 1px 6px; border-radius: 4px; font-weight: 700; display: inline-block; }
.footer { margin-top: 8px; font-weight: 700; letter-spacing: .5px; }
`;

export function receiptHtml(
  r: ReceiptData,
  ctx: { t: TFunction; f: Formatter; settings: Settings | null; offline?: boolean; preview?: boolean },
): string {
  const { t, f, settings } = ctx;
  const name = settings?.name ?? 'MAX';
  const head = settings?.logo_url
    ? `<img class="logo-img" src="${escapeHtml(settings.logo_url)}" alt="">`
    : `<div class="logo"><span>${escapeHtml(name)}</span></div>`;
  const items = r.items
    .map(
      (i) => `<tr><td>${escapeHtml(i.name)}${i.notes ? `<div class="note">• ${escapeHtml(i.notes)}</div>` : ''}</td>
      <td class="n">${f.number(i.qty)}</td><td class="n">${f.money(i.unit_price * i.qty)}</td></tr>`,
    )
    .join('');
  const pays = r.payments
    .map(
      (p) => `<div class="row"><span>${t(p.method === 'cash' ? 'payment.cash' : 'payment.card')}</span><span>${f.money(p.method === 'cash' && p.tendered ? p.tendered : p.amount)}</span></div>
      ${p.method === 'cash' && p.change ? `<div class="row"><span>${t('receipt.change')}</span><span>${f.money(p.change)}</span></div>` : ''}`,
    )
    .join('');
  const typeLine =
    r.type === 'dine_in' && r.table_no
      ? `${t('order.type.dine_in')} — ${t('order.table', { table: f.digits(r.table_no) })}`
      : t(`order.type.${r.type}`);
  return `
  <div class="c">${head}
    <div class="muted">${escapeHtml(settings?.slogan ?? 'Good Food Good Mood')}</div>
    ${settings?.address ? `<div class="muted">${escapeHtml(settings.address)}</div>` : ''}
    ${settings?.phone ? `<div class="muted">${escapeHtml(settings.phone)}</div>` : ''}
    ${settings?.receipt_header ? `<div style="margin-top:4px">${escapeHtml(settings.receipt_header)}</div>` : ''}
  </div>
  <hr>
  ${ctx.preview ? `<div class="c badge">${t('receipt.preview')}</div>` : ''}
  ${ctx.offline ? `<div class="c badge">${t('receipt.offline')}</div>` : ''}
  <div class="row"><span>${t('receipt.order')}</span><span class="big">${escapeHtml(f.digits(r.number))}</span></div>
  <div class="row"><span>${t('receipt.date')}</span><span>${f.date(r.created_at)} ${f.time(r.created_at)}</span></div>
  <div class="row"><span>${t('receipt.cashier')}</span><span>${escapeHtml(r.cashier_name)}</span></div>
  <div class="row"><span>${t('pos.orderType')}</span><span>${typeLine}</span></div>
  ${r.customer_name ? `<div class="row"><span>${t('orders.customer')}</span><span>${escapeHtml(r.customer_name)} ${escapeHtml(r.customer_phone ?? '')}</span></div>` : ''}
  ${r.customer_address ? `<div class="muted">${escapeHtml(r.customer_address)}</div>` : ''}
  <hr>
  <table><thead><tr><th>${t('receipt.item')}</th><th class="n">${t('receipt.qty')}</th><th class="n">${t('receipt.amount')}</th></tr></thead><tbody>${items}</tbody></table>
  <hr>
  <div class="row"><span>${t('pos.subtotal')}</span><span>${f.money(r.subtotal)}</span></div>
  ${r.discount_amount > 0 ? `<div class="row"><span>${t('pos.discount')}</span><span>-${f.money(r.discount_amount)}</span></div>` : ''}
  <div class="row big"><span>${t('pos.grandTotal')}</span><span>${f.money(r.total)}</span></div>
  <div class="row muted"><span>${t('receipt.vat', { rate: f.number(Number(settings?.vat_percent ?? 0)) })}</span><span>${f.money(r.vat_amount)}</span></div>
  ${pays ? `<hr>${pays}` : ''}
  ${r.notes ? `<hr><div class="muted">${escapeHtml(r.notes)}</div>` : ''}
  <hr>
  <div class="c">${t('receipt.thanks')}</div>
  <div class="c footer">${escapeHtml(settings?.receipt_footer || 'Good Food Good Mood')}</div>`;
}

export function printReceipt(r: ReceiptData, ctx: Parameters<typeof receiptHtml>[1], lang = 'ar'): Promise<void> {
  return printHtml(receiptHtml(r, ctx), RECEIPT_CSS, lang);
}

// ---------------------------------------------------------- kitchen ticket
const KITCHEN_CSS = `
@page { size: 80mm auto; margin: 0; }
body { margin: 0; padding: 4mm 3mm 8mm; width: 80mm; font-family: 'IBM Plex Sans Arabic','Heebo',Tahoma,sans-serif; color:#000; }
.num { font-size: 34px; font-weight: 800; text-align: center; }
.meta { font-size: 16px; font-weight: 700; text-align: center; }
.time { font-size: 13px; text-align: center; }
hr { border: 0; border-top: 2px dashed #000; margin: 8px 0; }
.item { font-size: 20px; font-weight: 700; display: flex; gap: 8px; margin: 6px 0; }
.qty { min-width: 34px; border: 2px solid #000; border-radius: 6px; text-align: center; }
.note { font-size: 16px; font-weight: 600; padding-inline-start: 44px; }
.onote { font-size: 16px; border: 2px solid #000; padding: 4px; margin-top: 8px; }
`;

export function printKitchenTicket(r: ReceiptData, ctx: { t: TFunction; f: Formatter }, lang = 'ar'): Promise<void> {
  const { t, f } = ctx;
  const body = `
  <div class="num">${escapeHtml(f.digits(r.number))}</div>
  <div class="meta">${t(`order.type.${r.type}`)}${r.table_no ? ` — ${t('order.table', { table: f.digits(r.table_no) })}` : ''}</div>
  <div class="time">${f.time(r.created_at)}</div>
  <hr>
  ${r.items
    .map(
      (i) => `<div class="item"><span class="qty">${f.number(i.qty)}</span><span>${escapeHtml(i.name)}</span></div>${
        i.notes ? `<div class="note">⚠ ${escapeHtml(i.notes)}</div>` : ''
      }`,
    )
    .join('')}
  ${r.notes ? `<div class="onote">${escapeHtml(r.notes)}</div>` : ''}`;
  return printHtml(body, KITCHEN_CSS, lang);
}

// ---------------------------------------------------------------- Z report
export function printZReport(
  rep: ShiftReport,
  ctx: { t: TFunction; f: Formatter; settings: Settings | null },
  lang = 'ar',
): Promise<void> {
  const { t, f } = ctx;
  const s = rep.shift;
  const variance = s.counted_cash !== null ? Number(s.counted_cash) - Number(rep.expected_cash) : null;
  const row = (label: string, value: string) => `<div class="row"><span>${label}</span><span>${value}</span></div>`;
  const body = `
  <div class="c"><div class="logo"><span>${escapeHtml(ctx.settings?.name ?? 'MAX')}</span></div><div class="big">${t('shift.zReport')}</div></div>
  <hr>
  ${row(t('receipt.cashier'), escapeHtml(rep.cashier_name ?? ''))}
  ${row(t('common.from'), f.dateTime(s.opened_at))}
  ${s.closed_at ? row(t('common.to'), f.dateTime(s.closed_at)) : ''}
  <hr>
  ${row(t('shift.ordersCount'), f.number(rep.orders_count))}
  ${row(t('shift.grossTotal'), f.money(rep.gross_total))}
  ${row(t('shift.discounts'), f.money(rep.discount_total))}
  ${row(t('shift.voided'), `${f.number(rep.voided_count)} (${f.money(rep.voided_total)})`)}
  ${rep.by_type.map((b) => row(t(`order.type.${b.type}`), `${f.number(b.orders)} · ${f.money(b.total)}`)).join('')}
  <hr>
  ${row(t('shift.openingFloat'), f.money(Number(s.opening_float)))}
  ${row(t('shift.cashSales'), f.money(rep.cash_sales))}
  ${row(t('shift.cardSales'), f.money(rep.card_sales))}
  <div class="row big"><span>${t('shift.expectedCash')}</span><span>${f.money(rep.expected_cash)}</span></div>
  ${s.counted_cash !== null ? row(t('shift.countedCash'), f.money(Number(s.counted_cash))) : ''}
  ${variance !== null ? `<div class="row big"><span>${t('shift.variance')}</span><span>${f.money(variance)}</span></div>` : ''}
  ${s.notes ? `<hr><div class="muted">${escapeHtml(s.notes)}</div>` : ''}
  <hr><div class="c footer">${escapeHtml(ctx.settings?.receipt_footer || 'Good Food Good Mood')}</div>`;
  return printHtml(body, RECEIPT_CSS, lang);
}

// ------------------------------------------------------------- A4 reports
export interface ReportSection {
  heading: string;
  kpis?: [string, string][];
  table?: { headers: string[]; rows: (string | number)[][] };
}

const A4_CSS = `
@page { size: A4; margin: 14mm; }
body { font-family: 'IBM Plex Sans Arabic','Heebo',Tahoma,sans-serif; color: #111; font-size: 12px; }
header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #E11D2E; padding-bottom: 8px; margin-bottom: 16px; }
.brand { font-size: 28px; font-weight: 800; }
.brand b { color: #E11D2E; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 15px; margin: 18px 0 8px; border-inline-start: 4px solid #E11D2E; padding-inline-start: 8px; }
.meta { color: #555; font-size: 11px; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.kpi { border: 1px solid #ddd; border-radius: 8px; padding: 8px; }
.kpi .l { color: #666; font-size: 11px; }
.kpi .v { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th { background: #f4f4f5; text-align: start; font-size: 11px; }
th, td { border-bottom: 1px solid #e5e5e5; padding: 5px 6px; text-align: start; font-variant-numeric: tabular-nums; }
footer { margin-top: 24px; text-align: center; color: #888; font-size: 10px; }
`;

export function printA4Report(
  title: string,
  meta: string[],
  sections: ReportSection[],
  ctx: { settings: Settings | null },
  lang = 'ar',
): Promise<void> {
  const body = `
  <header>
    <div><div class="brand"><b>/</b>${escapeHtml(ctx.settings?.name ?? 'MAX')}</div><div class="meta">${escapeHtml(ctx.settings?.slogan ?? '')}</div></div>
    <div style="text-align:end"><h1>${escapeHtml(title)}</h1>${meta.map((m) => `<div class="meta">${escapeHtml(m)}</div>`).join('')}</div>
  </header>
  ${sections
    .map(
      (s) => `<h2>${escapeHtml(s.heading)}</h2>
      ${s.kpis ? `<div class="kpis">${s.kpis.map(([l, v]) => `<div class="kpi"><div class="l">${escapeHtml(l)}</div><div class="v">${escapeHtml(v)}</div></div>`).join('')}</div>` : ''}
      ${
        s.table
          ? `<table><thead><tr>${s.table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${s.table.rows
              .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
              .join('')}</tbody></table>`
          : ''
      }`,
    )
    .join('')}
  <footer>MAX v1.0.0 — Powered by MAX</footer>`;
  return printHtml(body, A4_CSS, lang);
}
