import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';

// Hand-built SVG charts (no chart library). The x axis runs right-to-left (RTL).

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Rounds the axis maximum up to a "nice" number. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}

/** Catmull-Rom spline through the points, as cubic Bézier segments. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export interface ChartPoint {
  label: string;
  value: number | null;
  sublabel?: string;
}

interface TooltipState {
  index: number;
  x: number;
  y: number;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return (
    <div
      className="glass pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-btn border border-line-strong px-3 py-2 text-xs shadow-panel"
      style={{ left, top: y - 12 }}
      role="status"
    >
      {children}
    </div>
  );
}

const PAD = { top: 16, bottom: 30, start: 56, end: 12 };

export function LineChart({ data, format, formatAxis, height = 260, className, emptyLabel }: {
  data: ChartPoint[];
  format: (n: number) => string;
  formatAxis?: (n: number) => string;
  height?: number;
  className?: string;
  emptyLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const gid = useId().replace(/:/g, '');
  const reduce = useReducedMotion();
  const [tip, setTip] = useState<TooltipState | null>(null);

  const geo = useMemo(() => {
    const values = data.map((d) => d.value ?? 0);
    const max = niceMax(Math.max(...values, 0) * 1.1);
    const innerW = Math.max(0, width - PAD.start - PAD.end);
    const innerH = height - PAD.top - PAD.bottom;
    // RTL: first point on the right
    const xAt = (i: number) => PAD.end + (data.length <= 1 ? innerW / 2 : innerW - (i * innerW) / (data.length - 1));
    const yAt = (v: number) => PAD.top + innerH - (v / max) * innerH;
    const pts = data.map((d, i) => (d.value === null ? null : ([xAt(i), yAt(d.value)] as [number, number])));
    const solid = pts.filter((p): p is [number, number] => p !== null);
    const line = smoothPath(solid);
    const area = solid.length > 1 ? `${line} L${solid[solid.length - 1][0]},${PAD.top + innerH} L${solid[0][0]},${PAD.top + innerH} Z` : '';
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: max * f, y: yAt(max * f) }));
    return { xAt, yAt, pts, line, area, ticks, innerH, max };
  }, [data, width, height]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = -1;
    let dist = Infinity;
    data.forEach((d, i) => {
      if (d.value === null) return;
      const dx = Math.abs(geo.xAt(i) - px);
      if (dx < dist) {
        dist = dx;
        best = i;
      }
    });
    if (best >= 0) setTip({ index: best, x: geo.xAt(best), y: geo.yAt(data[best].value ?? 0) });
  };

  const allEmpty = data.every((d) => !d.value);
  return (
    <div ref={ref} className={cn('relative w-full select-none', className)} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="overflow-visible" onPointerMove={onMove} onPointerLeave={() => setTip(null)} role="img">
          <defs>
            <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E11D2E" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#E11D2E" stopOpacity="0" />
            </linearGradient>
          </defs>
          {geo.ticks.map((tk) => (
            <g key={tk.v}>
              <line x1={PAD.end} x2={width - PAD.start + 8} y1={tk.y} y2={tk.y} stroke="rgba(243,238,230,0.08)" />
              <text x={width - 4} y={tk.y + 4} textAnchor="end" direction="ltr" className="mono fill-fg-3 text-[0.6875rem]">
                {(formatAxis ?? format)(tk.v)}
              </text>
            </g>
          ))}
          {data.map((d, i) => (
            <text key={i} x={geo.xAt(i)} y={height - 8} textAnchor="middle" className={cn('text-[0.6875rem]', tip?.index === i ? 'fill-fg' : 'fill-fg-3')}>
              {d.label}
            </text>
          ))}
          {geo.area && (
            <motion.path
              d={geo.area}
              fill={`url(#fill-${gid})`}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.3 }}
            />
          )}
          {geo.line && (
            <motion.path
              d={geo.line}
              fill="none"
              stroke="#E11D2E"
              strokeWidth={2}
              strokeLinecap="round"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
          {tip && <line x1={tip.x} x2={tip.x} y1={PAD.top} y2={PAD.top + geo.innerH} stroke="rgba(243,238,230,0.18)" />}
          {geo.pts.map((p, i) =>
            p ? (
              <circle key={i} cx={p[0]} cy={p[1]} r={tip?.index === i ? 4.5 : 3} fill="#211d19" stroke="#E11D2E" strokeWidth={2} />
            ) : null,
          )}
        </svg>
      )}
      {tip && data[tip.index] && (
        <Tooltip x={tip.x} y={tip.y} width={width}>
          <div className="text-fg-3">{data[tip.index].sublabel ?? data[tip.index].label}</div>
          <div className="num text-sm font-medium text-fg">{format(data[tip.index].value ?? 0)}</div>
        </Tooltip>
      )}
      {allEmpty && emptyLabel && <div className="absolute inset-0 grid place-items-center text-sm text-fg-3">{emptyLabel}</div>}
    </div>
  );
}

export function BarChart({ data, format, formatAxis, height = 260, className, highlight, emptyLabel }: {
  data: ChartPoint[];
  format: (n: number) => string;
  formatAxis?: (n: number) => string;
  height?: number;
  className?: string;
  /** index of the bar that matters (defaults to the latest); every other bar stays neutral */
  highlight?: number | null;
  color?: 'red' | 'gold' | 'green';
  emptyLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const reduce = useReducedMotion();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const accentIndex = highlight === undefined ? data.length - 1 : highlight;

  const values = data.map((d) => Math.max(d.value ?? 0, 0));
  const max = niceMax(Math.max(...values, 0) * 1.1);
  const innerW = Math.max(0, width - PAD.start - PAD.end);
  const innerH = height - PAD.top - PAD.bottom;
  const slot = data.length ? innerW / data.length : 0;
  const barW = Math.max(4, Math.min(38, slot * 0.6));
  const xCenter = (i: number) => PAD.end + innerW - slot * i - slot / 2; // RTL
  const yAt = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: max * f, y: yAt(max * f) }));
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 44))));

  return (
    <div ref={ref} className={cn('relative w-full select-none', className)} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="overflow-visible" onPointerLeave={() => setTip(null)} role="img">
          {ticks.map((tk) => (
            <g key={tk.v}>
              <line x1={PAD.end} x2={width - PAD.start + 8} y1={tk.y} y2={tk.y} stroke="rgba(243,238,230,0.08)" />
              <text x={width - 4} y={tk.y + 4} textAnchor="end" direction="ltr" className="mono fill-fg-3 text-[0.6875rem]">
                {(formatAxis ?? format)(tk.v)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const v = Math.max(d.value ?? 0, 0);
            const h = Math.max(v > 0 ? 3 : 0, PAD.top + innerH - yAt(v));
            const x = xCenter(i) - barW / 2;
            return (
              <g key={i} onPointerEnter={() => setTip({ index: i, x: xCenter(i), y: yAt(v) })}>
                <rect x={xCenter(i) - slot / 2} y={PAD.top} width={slot} height={innerH} fill="transparent" />
                <motion.rect
                  x={x}
                  width={barW}
                  rx={Math.min(3, barW / 2)}
                  fill={i === accentIndex ? '#E11D2E' : tip?.index === i ? '#b3aa9c' : '#4a423a'}
                  initial={reduce ? false : { y: PAD.top + innerH, height: 0 }}
                  animate={{ y: PAD.top + innerH - h, height: h }}
                  transition={{ duration: 0.5, delay: reduce ? 0 : Math.min(i * 0.02, 0.3), ease: [0.22, 1, 0.36, 1] }}
                />
                {i % labelEvery === 0 && (
                  <text x={xCenter(i)} y={height - 8} textAnchor="middle" className={cn('text-[0.6875rem]', tip?.index === i ? 'fill-fg' : 'fill-fg-3')}>
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {tip && data[tip.index] && (
        <Tooltip x={tip.x} y={tip.y} width={width}>
          <div className="text-fg-3">{data[tip.index].sublabel ?? data[tip.index].label}</div>
          <div className="num text-sm font-medium text-fg">{format(data[tip.index].value ?? 0)}</div>
        </Tooltip>
      )}
      {values.every((v) => v === 0) && emptyLabel && <div className="absolute inset-0 grid place-items-center text-sm text-fg-3">{emptyLabel}</div>}
    </div>
  );
}

export function RingGauge({ value, size = 180, stroke = 16, label, sublabel, format }: {
  value: number;
  size?: number;
  stroke?: number;
  label?: ReactNode;
  sublabel?: ReactNode;
  format: (n: number) => string;
}) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(243,238,230,0.08)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#E11D2E"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={reduce ? false : { strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (pct / 100) * c }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="num text-[2.125rem] leading-none font-medium text-fg">{format(pct)}</span>
        {label && <span className="mt-1 text-xs text-fg-3">{label}</span>}
        {sublabel}
      </div>
    </div>
  );
}

export function Heatmap({ rows, cols, value, format, rowLabel, colLabel }: {
  rows: number[];
  cols: number[];
  value: (row: number, col: number) => number;
  format: (n: number) => string;
  rowLabel: (row: number) => string;
  colLabel: (col: number) => string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => cols.map((c) => value(r, c))));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-[0.6875rem]">
        <thead>
          <tr>
            <th />
            {cols.map((c) => (
              <th key={c} className="num px-0.5 font-medium text-fg-3">
                {colLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th scope="row" className="pe-2 text-start font-medium whitespace-nowrap text-fg-2">
                {rowLabel(r)}
              </th>
              {cols.map((c) => {
                const v = value(r, c);
                const a = v / max;
                return (
                  <td
                    key={c}
                    title={`${rowLabel(r)} ${colLabel(c)} — ${format(v)}`}
                    className="h-7 min-w-7 rounded-[4px]"
                    style={{
                      background: v ? `rgba(225,29,46,${0.1 + a * 0.8})` : 'rgba(243,238,230,0.05)',
                    }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal share bars (payment methods, categories…). */
export function ShareBars({ items, format }: { items: { label: string; value: number; color?: string; icon?: ReactNode }[]; format: (n: number) => string }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <ul className="space-y-3">
      {items.map((it) => {
        const pct = (it.value / total) * 100;
        return (
          <li key={it.label}>
            <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 text-fg-2">
                {it.icon}
                {it.label}
              </span>
              <span className="num font-medium text-fg">
                {format(it.value)} <span className="text-xs font-normal text-fg-3">· {pct.toFixed(0)}%</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-fg/[0.05]">
              <motion.div
                className="h-full rounded-full"
                style={{ background: it.color ?? '#b3aa9c' }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
