import { useMemo, useState } from 'react'
import type { Recording, Win, Candidate } from '../data'
import { fmtT } from '../data'
import { Tex } from './Math'

export const C = { blue: '#2563eb', teal: '#0d9488', amber: '#d97706', red: '#dc2626', ink: '#1c1917', mute: '#78716c', grid: '#e7e5e4' }
const W = 860

// ── Signal explorer ─────────────────────────────────────────────────────────
export function SignalExplorer({ rec, t, span, channels, onScrub }: { rec: Recording; t: number; span: number; channels: Record<string, boolean>; onScrub: (t: number) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const H = 240, DUR = rec.series.at(-1)?.t ?? 360, t1 = Math.max(0, Math.min(t - span / 2, DUR - span)), t2 = t1 + span
  const pts = rec.series.filter(p => p.t >= t1 && p.t <= t2)
  const X = (tt: number) => ((tt - t1) / span) * W
  const ch = [
    { key: 'ir', label: 'Infrared PPG', color: C.blue, vals: pts.map(p => p.ir), show: channels.ir },
    { key: 'red', label: 'Red PPG', color: '#7c3aed', vals: pts.map(p => p.red), show: channels.red },
    { key: 'acc', label: 'Accelerometer |a|', color: C.amber, vals: pts.map(p => p.acc), show: channels.acc },
  ].filter(c => c.show)
  const laneH = ch.length ? (H - 30) / ch.length : H
  const refPts = pts.filter((_, i) => i % 2 === 0)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none cursor-crosshair"
        onMouseMove={e => { const r = (e.target as SVGSVGElement).getBoundingClientRect(); setHover(t1 + ((e.clientX - r.left) / r.width) * span) }}
        onMouseLeave={() => setHover(null)}
        onClick={e => { const r = (e.target as SVGSVGElement).getBoundingClientRect(); onScrub(t1 + ((e.clientX - r.left) / r.width) * span) }}>
        {ch.map((c, li) => {
          const mn = Math.min(...c.vals), mx = Math.max(...c.vals), rg = (mx - mn) || 1, y0 = 8 + li * laneH
          const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.t).toFixed(1)},${(y0 + laneH - 18 - ((c.vals[i] - mn) / rg) * (laneH - 34)).toFixed(1)}`).join(' ')
          return <g key={c.key}>
            <text x={6} y={y0 + 12} fontSize={10} fontWeight={600} fill={c.color}>{c.label}</text>
            <line x1={0} x2={W} y1={y0 + laneH - 8} y2={y0 + laneH - 8} stroke={C.grid} />
            <path d={path} fill="none" stroke={c.color} strokeWidth={1.4} />
            {/* selected-window shading */}
            <rect x={X(Math.floor(t / 30) * 30)} y={y0 + 2} width={X(Math.floor(t / 30) * 30 + 30) - X(Math.floor(t / 30) * 30)} height={laneH - 12} fill={C.blue} opacity={0.05} />
          </g>
        })}
        {/* reference HR lane (evaluation target only) */}
        {channels.ref && <g>
          <text x={6} y={H - 18} fontSize={10} fontWeight={600} fill={C.teal}>Reference HR (eval only)</text>
          {refPts.map((p, i) => <circle key={i} cx={X(p.t)} cy={H - 12 - (p.refHR - 50) * 0.12} r={1.6} fill={C.teal} opacity={0.7} />)}
        </g>}
        <line x1={X(t)} x2={X(t)} y1={0} y2={H} stroke={C.ink} strokeWidth={1.2} />
        {hover !== null && <g><line x1={X(hover)} x2={X(hover)} y1={0} y2={H} stroke={C.mute} strokeDasharray="3 3" /><text x={Math.min(X(hover) + 6, W - 70)} y={14} fontSize={11} fill={C.ink}>{fmtT(hover)}</text></g>}
      </svg>
      <div className="flex justify-between text-[11px] text-stone-500 font-mono"><span>{fmtT(t1)}</span><span>playhead {fmtT(t)} · click chart to scrub · shaded = selected 30 s window</span><span>{fmtT(t2)}</span></div>
    </div>
  )
}

// ── PSD / autocorr ──────────────────────────────────────────────────────────
// Label decluttering: candidate labels are sorted by x, then greedily packed
// into horizontal tiers (like interval-graph colouring). A label joins the
// first tier whose previous label it clears by GAP px; otherwise it opens a
// new tier 20 px higher. Any label whose tier or clamped x moves it away from
// its marker gets a thin leader line back to the marker, so every number stays
// readable and traceable — no two label boxes ever intersect.
const LABEL_H = 18, LABEL_GAP = 5, TIER_H = 20
export function layoutCandidateLabels<T extends { id: string; x: number; y: number; w: number }>(items: T[], chartW: number) {
  const boxes: { left: number; right: number; top: number; bottom: number }[] = []
  const hits = (left: number, top: number, w: number) => boxes.some(b => left < b.right + LABEL_GAP && left + w + LABEL_GAP > b.left && top < b.bottom + 2 && top + LABEL_H + 2 > b.top)
  return [...items].sort((a, b) => a.x - b.x).map(it => {
    const cx = Math.min(Math.max(it.x, it.w / 2 + 2), chartW - it.w / 2 - 2) // clamp: never clipped at 35 / 220 edges
    const left = cx - it.w / 2
    let top = it.y - 10 - LABEL_H, tier = 0
    // Shift up one tier at a time until the box is collision-free; markers fanned
    // out vertically (same HR) therefore cannot re-introduce label overlap.
    while (hits(left, top, it.w) && top - TIER_H >= 30) { top -= TIER_H; tier++ }
    if (hits(left, top, it.w)) { // no room above (would hit the reference row): stack below the marker
      top = it.y + 12; tier = -1
      while (hits(left, top, it.w)) { top += TIER_H; tier-- }
    }
    boxes.push({ left, right: left + it.w, top, bottom: top + LABEL_H })
    return { ...it, labelX: cx, labelTop: top, tier, displaced: Math.abs(cx - it.x) > 2 || tier !== 0 }
  })
}

/** KaTeX typeset text inside SVG (foreignObject), centred on x, non-interactive. */
function SvgTex({ x, y, w, tex, color, size = 11, bold = false, align = 'center' }: { x: number; y: number; w: number; tex: string; color: string; size?: number; bold?: boolean; align?: 'center' | 'left' }) {
  return (
    <foreignObject x={align === 'center' ? x - w / 2 : x} y={y} width={w} height={LABEL_H + 4} style={{ overflow: 'visible', pointerEvents: 'none' }}>
      <div style={{ display: 'flex', justifyContent: align === 'center' ? 'center' : 'flex-start', color, fontSize: size, fontWeight: bold ? 700 : 600, whiteSpace: 'nowrap' }}>
        <span className="psd-label"><Tex tex={tex} /></span>
      </div>
    </foreignObject>
  )
}

export function PsdChart({ rec, win, sel, onSel }: { rec: Recording; win: Win; sel: Candidate | null; onSel: (c: Candidate) => void }) {
  const H = 302, PAD = 30, TOP = 58, BASE = H - 44 // inner padding keeps edge labels/ticks fully inside the viewBox
  const X = (b: number) => PAD + ((b - 35) / 185) * (W - PAD * 2), Y = (v: number) => BASE - (Math.min(v, 1.05) / 1.05) * (BASE - TOP)
  const area = (key: 'ir' | 'red') => rec.psd.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.bpm).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(' ') + ` L${X(220)},${BASE} L${X(35)},${BASE} Z`
  const line = rec.autocorr.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.lagBPM).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')
  // Candidates from different estimator families can share an HR (e.g. two at 130):
  // fan coincident markers out vertically by 13 px so neither hides the other.
  const rawItems = win.candidates.slice(0, 12).map(c => {
    const v = rec.psd.reduce((b, p) => Math.abs(p.bpm - c.hr) < Math.abs(b.bpm - c.hr) ? p : b, rec.psd[0]).ir
    return { id: c.id, x: X(c.hr), y: Y(Math.max(v, 0.06)), w: c.hr >= 100 ? 36 : 28, c }
  })
  const coincident = new Map<string, number>()
  rawItems.forEach(it => { const k = `${Math.round(it.x)}:${Math.round(it.y)}`; const n = coincident.get(k) ?? 0; coincident.set(k, n + 1); it.y += n * 13 })
  const placed = layoutCandidateLabels(rawItems, W)
  const byId = new Map(placed.map(p => [p.id, p]))
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Welch PSD and autocorrelation with candidate heart-rate markers; labels are staggered to avoid overlap">
        {[35, 80, 120, 160, 200, 220].map(b => <g key={b}>
          <line x1={X(b)} x2={X(b)} y1={TOP - 18} y2={BASE} stroke={C.grid} />
          <SvgTex x={X(b)} y={BASE + 6} w={42} tex={String(b)} color={C.mute} size={10} />
        </g>)}
        <path d={area('ir')} fill={C.blue} opacity={0.13} /><path d={area('red')} fill="#7c3aed" opacity={0.10} />
        <path d={line} fill="none" stroke={C.amber} strokeWidth={1.6} strokeDasharray="5 3" />
        {/* leader lines first, so markers and labels paint over them */}
        {placed.filter(p => p.displaced).map(p => <line key={`lead-${p.id}`} x1={p.x} y1={p.tier < 0 ? p.y + 7 : p.y - 7} x2={p.labelX} y2={p.tier < 0 ? p.labelTop : p.labelTop + LABEL_H} stroke={p.c.isMotionPeak ? C.red : C.blue} strokeWidth={0.8} opacity={0.45} />)}
        <line x1={X(win.trueHR)} x2={X(win.trueHR)} y1={26} y2={BASE} stroke={C.teal} strokeWidth={2} />
        <SvgTex x={X(win.trueHR) + 76} y={2} w={148} tex={`\\text{reference }${win.trueHR}\\ \\mathrm{BPM}`} color={C.teal} size={11} bold />
        {win.motionFreqBPM > 0 && <g>
          <line x1={X(win.motionFreqBPM)} x2={X(win.motionFreqBPM)} y1={26} y2={BASE} stroke={C.red} strokeWidth={1.4} strokeDasharray="4 3" />
          <SvgTex x={X(win.motionFreqBPM) + 68} y={22} w={132} tex={`\\text{motion }${win.motionFreqBPM}\\ \\mathrm{BPM}`} color={C.red} size={11} />
        </g>}
        {win.candidates.slice(0, 12).map(c => {
          const p = byId.get(c.id)!
          const picked = sel?.id === c.id
          return <g key={c.id} onClick={() => onSel(c)} className="cursor-pointer">
            <circle cx={p.x} cy={p.y} r={16} fill="transparent" />{/* generous hit area, independent of label position */}
            {picked && <circle cx={p.x} cy={p.y} r={12} fill={c.isMotionPeak ? C.red : C.blue} opacity={0.18} />}
            <circle cx={p.x} cy={p.y} r={picked ? 8 : 5.5} fill={c.isMotionPeak ? C.red : C.blue} stroke="#fff" strokeWidth={2} />
            <SvgTex x={p.labelX} y={p.labelTop} w={p.w} tex={String(c.hr)} color={c.isMotionPeak ? C.red : C.blue} size={11} bold />
          </g>
        })}
      </svg>
      <p className="text-center text-[11px] text-stone-500 -mt-1">Candidate HR (<Tex tex="\mathrm{BPM}" />) · solid fill = Welch PSD (IR / red) · dashed amber = autocorrelation</p>
      <p className="text-xs text-stone-500 mt-1.5">Click a marker to inspect it. Under motion the <span className="text-red-600 font-semibold">tallest peak is limb-motion frequency</span>, not the pulse — the core ambiguity CITRUS resolves by scoring all hypotheses, not picking the max.</p>
    </div>
  )
}

// ── Viterbi graph ───────────────────────────────────────────────────────────
export function ViterbiGraph({ rec, upto, showIndep, showVit, showGT }: { rec: Recording; upto: number; showIndep: boolean; showVit: boolean; showGT: boolean }) {
  const H = 330, X = (i: number) => 56 + (i / Math.max(1, rec.windows.length - 1)) * (W - 90), Y = (hr: number) => H - 34 - ((hr - 35) / 185) * (H - 60)
  const path = (get: (w: Win) => number, color: string, uptoN: number, dash = '') => (
    <path d={rec.windows.slice(0, uptoN + 1).map((w, i) => `${i === 0 ? 'M' : 'L'}${X(i)},${Y(get(w))}`).join(' ')} fill="none" stroke={color} strokeWidth={2.4} strokeDasharray={dash} strokeLinejoin="round" />)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {[40, 80, 120, 160, 200].map(b => <g key={b}><line x1={52} x2={W - 20} y1={Y(b)} y2={Y(b)} stroke={C.grid} /><text x={46} y={Y(b) + 4} fontSize={10} textAnchor="end" fill={C.mute}>{b}</text></g>)}
      {/* edges: plausible transitions into the frontier window */}
      {upto > 0 && rec.windows[upto - 1].candidates.slice(0, 5).map(a => rec.windows[upto].candidates.slice(0, 5).map(b => {
        const pen = 0.012 * (a.hr - b.hr) ** 2
        return <line key={a.id + b.id} x1={X(upto - 1)} y1={Y(a.hr)} x2={X(upto)} y2={Y(b.hr)} stroke={pen > 18 ? '#fca5a5' : C.teal} strokeWidth={pen > 18 ? 0.7 : 1.3} opacity={pen > 18 ? 0.35 : 0.5} />
      }))}
      {rec.windows.map((w, i) => <g key={i} opacity={i <= upto ? 1 : 0.22}>
        {w.candidates.slice(0, 5).map(c => <circle key={c.id} cx={X(i)} cy={Y(c.hr)} r={i === upto ? 5 : 3.6} fill={c.isMotionPeak ? C.red : '#fff'} stroke={c.isMotionPeak ? C.red : C.blue} strokeWidth={1.6} />)}
        <text x={X(i)} y={H - 12} fontSize={10} textAnchor="middle" fill={C.mute}>w{i + 1}</text>
      </g>)}
      {showIndep && path(w => w.independentHR, C.red, upto, '5 4')}
      {showVit && path(w => w.viterbiHR, C.teal, upto)}
      {showGT && path(w => w.trueHR, C.ink, upto, '2 3')}
      <text x={56} y={16} fontSize={11} fill={C.mute}>Top-5 candidates per window · red dashed = independent · teal = Viterbi · black dotted = reference</text>
    </svg>
  )
}

// ── HR comparison timeline ──────────────────────────────────────────────────
export function HrTimeline({ rec, upto, decisions }: { rec: Recording; upto: number; decisions?: { reported: number | null }[] }) {
  const H = 170, X = (i: number) => 48 + (i / Math.max(1, rec.windows.length - 1)) * (W - 80), Y = (hr: number) => H - 30 - ((hr - 35) / 185) * (H - 52)
  const line = (get: (w: Win) => number | null, color: string, dash = '') => {
    let d = '', pen = false
    rec.windows.slice(0, upto + 1).forEach((w, i) => { const v = get(w); if (v === null) { pen = false; return } d += `${pen ? 'L' : 'M'}${X(i)},${Y(v)} `; pen = true })
    return <path d={d} fill="none" stroke={color} strokeWidth={2.2} strokeDasharray={dash} strokeLinejoin="round" />
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {[60, 100, 140, 180].map(b => <g key={b}><line x1={44} x2={W - 16} y1={Y(b)} y2={Y(b)} stroke={C.grid} /><text x={38} y={Y(b) + 4} fontSize={10} textAnchor="end" fill={C.mute}>{b}</text></g>)}
      {line(w => w.trueHR, C.ink, '2 3')}{line(w => w.independentHR, C.red, '5 4')}{line(w => w.viterbiHR, C.teal)}
      {decisions && decisions.slice(0, upto + 1).map((d, i) => d.reported !== null ? <circle key={i} cx={X(i)} cy={Y(d.reported)} r={4} fill={C.amber} stroke="#fff" strokeWidth={1.5} /> : <text key={i} x={X(i)} y={H - 14} fontSize={12} textAnchor="middle" fill={C.red}>✕</text>)}
      <text x={48} y={14} fontSize={11} fill={C.mute}>BPM · amber dot = value actually reported (accept/hold) · ✕ = rejected window</text>
    </svg>
  )
}

export function useMemoOnce<T>(fn: () => T): T { return useMemo(fn, []) }
