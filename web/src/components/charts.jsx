import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Measure the container so the chart can lay out in real pixels. */
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(640);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)));
    ro.observe(el);
    setW(Math.max(260, el.clientWidth || 640));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function Tooltip({ at, children }) {
  if (!at) return null;
  const style = {
    left: Math.min(at.x + 14, window.innerWidth - 250),
    top: Math.max(8, at.y - 12),
  };
  return <div className="tip" style={style}>{children}</div>;
}

function niceMax(v) {
  if (v <= 0) return 4;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

/**
 * Horizontal bar chart. One series, so magnitude is the whole job: a single
 * sequential hue, no legend (the title names the measure), and a direct label
 * on every bar because there are few enough for that to stay readable.
 */
export function BarChart({ data, valueKey = 'value', labelKey = 'label', unit = '', height = null }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState(null);

  const rows = data || [];
  const rowH = 26;
  const gap = 6;
  const padL = 46;
  const padR = 44;
  const padT = 4;
  const h = height || rows.length * (rowH + gap) + padT + 4;
  const max = niceMax(Math.max(1, ...rows.map((d) => d[valueKey] || 0)));
  const plotW = Math.max(40, w - padL - padR);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg className="chart" width={w} height={h} role="img">
        {rows.map((d, i) => {
          const v = d[valueKey] || 0;
          const bw = Math.max(v > 0 ? 3 : 0, (v / max) * plotW);
          const y = padT + i * (rowH + gap);
          return (
            <g
              key={d[labelKey]}
              onMouseMove={(e) => setHover({ d, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'default' }}
            >
              {/* Full-row hit target, larger than the mark itself. */}
              <rect x={0} y={y - gap / 2} width={w} height={rowH + gap} fill="transparent" />
              <text x={padL - 8} y={y + rowH / 2} textAnchor="end" dominantBaseline="central" className="axis-label" style={{ fontWeight: 600 }}>
                {d[labelKey]}
              </text>
              <rect x={padL} y={y + 4} width={plotW} height={rowH - 8} rx={4} fill="var(--surface-2)" />
              <rect
                x={padL} y={y + 4} width={bw} height={rowH - 8} rx={4}
                fill="var(--series-1)"
                opacity={hover && hover.d === d ? 0.85 : 1}
              />
              <text
                x={padL + bw + 7} y={y + rowH / 2}
                dominantBaseline="central" className="axis-label"
                style={{ fontWeight: 700, fill: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}
              >
                {v}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip at={hover}>
        {hover && (
          <>
            <div className="tip-h">{hover.d[labelKey]}</div>
            <div className="tip-r"><span>{unit || 'Value'}</span><span>{hover.d[valueKey]}</span></div>
            {hover.d.note && <div className="tiny muted" style={{ marginTop: 3 }}>{hover.d.note}</div>}
          </>
        )}
      </Tooltip>
    </div>
  );
}

/**
 * Line chart with a dashed projected segment.
 *
 * Two series, so a legend is always present and both are directly labelled at
 * the end of their line. One y-axis only - the actual and projected counts are
 * the same measure, which is exactly why they may share a scale.
 */
export function LineChart({ history, forecast, yLabel = 'units', height = 190 }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState(null);

  const all = [...(history || []), ...(forecast || [])];
  if (!all.length) return <div className="empty">No series to plot.</div>;

  const padL = 34, padR = 16, padT = 10, padB = 24;
  const plotW = Math.max(40, w - padL - padR);
  const plotH = height - padT - padB;
  const max = niceMax(Math.max(1, ...all.map((p) => p.value)));
  const x = (i) => padL + (all.length === 1 ? plotW / 2 : (i / (all.length - 1)) * plotW);
  const y = (v) => padT + plotH - (v / max) * plotH;

  const line = (pts, offset) =>
    pts.map((p, i) => (i === 0 ? 'M' : 'L') + x(i + offset).toFixed(1) + ' ' + y(p.value).toFixed(1)).join(' ');

  const hLen = (history || []).length;
  // Join the dashed projection onto the last observed point so there is no gap.
  const fcPts = hLen > 0 && forecast?.length ? [history[hLen - 1], ...forecast] : forecast || [];
  const fcOffset = hLen > 0 && forecast?.length ? hLen - 1 : hLen;

  const ticks = [0, max / 2, max];

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = e.clientX - box.left - padL;
    const i = Math.round((rel / plotW) * (all.length - 1));
    const idx = Math.max(0, Math.min(all.length - 1, i));
    setHover({ idx, point: all[idx], x: e.clientX, y: e.clientY });
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="legend">
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--series-1)' }} />
          Units issued (observed)
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--series-2)' }} />
          Projected demand
        </span>
      </div>
      <svg className="chart" width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line className="gridline" x1={padL} x2={padL + plotW} y1={y(t)} y2={y(t)} />
            <text x={padL - 7} y={y(t)} textAnchor="end" dominantBaseline="central" className="axis-label">
              {Math.round(t)}
            </text>
          </g>
        ))}
        <line className="baseline" x1={padL} x2={padL + plotW} y1={y(0)} y2={y(0)} />

        {fcPts.length > 1 && (
          <path d={line(fcPts, fcOffset)} fill="none" stroke="var(--series-2)" strokeWidth="2"
            strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {history?.length > 1 && (
          <path d={line(history, 0)} fill="none" stroke="var(--series-1)" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
        )}

        {hover && (
          <>
            <line className="baseline" x1={x(hover.idx)} x2={x(hover.idx)} y1={padT} y2={y(0)} strokeDasharray="3 3" />
            <circle cx={x(hover.idx)} cy={y(hover.point.value)} r="5"
              fill={hover.point.projected ? 'var(--series-2)' : 'var(--series-1)'}
              stroke="var(--surface-1)" strokeWidth="2" />
          </>
        )}

        <text x={padL} y={height - 5} className="axis-label">{all[0].date?.slice(5)}</text>
        <text x={padL + plotW} y={height - 5} textAnchor="end" className="axis-label">{all[all.length - 1].date?.slice(5)}</text>
      </svg>
      <Tooltip at={hover}>
        {hover && (
          <>
            <div className="tip-h">{hover.point.date}</div>
            <div className="tip-r">
              <span>{hover.point.projected ? 'Projected' : 'Issued'}</span>
              <span>{hover.point.value} {yLabel}</span>
            </div>
          </>
        )}
      </Tooltip>
    </div>
  );
}

/** Compact stacked meter for one group's component mix. */
export function StockMeter({ segments, total }) {
  const sum = total || segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div style={{ display: 'flex', gap: 2, height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--surface-2)' }}>
      {segments.filter((s) => s.value > 0).map((s) => (
        <div key={s.label} title={s.label + ': ' + s.value}
          style={{ width: (s.value / sum) * 100 + '%', background: s.color, borderRadius: 2 }} />
      ))}
    </div>
  );
}

/** Pure CSS sparkline-style delta indicator used in stat tiles. */
export function Trend({ value, suffix = '' }) {
  if (value == null) return <span className="muted">-</span>;
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}{suffix}</span>;
}

export { useWidth };
