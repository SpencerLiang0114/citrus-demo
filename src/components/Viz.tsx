import { useMemo, useState } from 'react'
import type { Recording, Win, Candidate, ReplayWin } from '../data'
import { fmtT } from '../data'
import { Tex } from './Math'

export const C = { blue: '#2563eb', teal: '#0d9488', amber: '#d97706', red: '#dc2626', ink: '#1c1917', mute: '#78716c', grid: '#e7e5e4' }
const W = 860

// ── Signal explorer ─────────────────────────────────────────────────────────
// Light lanes as elsewhere on the page; the three accelerometer axes are
// overlaid as separate traces on one common scale in a single lane.
const ACC_AXES = [
  { key: 'ax', color: C.red, tip: '#fca5a5' }, { key: 'ay', color: C.teal, tip: '#5eead4' }, { key: 'az', color: C.amber, tip: '#fcd34d' },
] as const
export function SignalExplorer({ rec, t, span, channels, onScrub }: { rec: Recording; t: number; span: number; channels: Record<string, boolean>; onScrub: (t: number) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const H = 240, DUR = rec.series.at(-1)?.t ?? 360, t1 = Math.max(0, Math.min(t - span / 2, DUR - span)), t2 = t1 + span
  const pts = rec.series.filter(p => p.t >= t1 && p.t <= t2)
  const X = (tt: number) => ((tt - t1) / span) * W
  const lanes = [
    { key: 'ir', label: 'Infrared PPG · band-passed', show: channels.ir, traces: [{ key: 'ir', label: '', color: C.blue, vals: pts.map(p => p.ir) }] },
    { key: 'red', label: 'Red PPG · band-passed', show: channels.red, traces: [{ key: 'red', label: '', color: '#7c3aed', vals: pts.map(p => p.red) }] },
    { key: 'acc', label: 'Accelerometer · band-passed', show: channels.acc, traces: ACC_AXES.map(a => ({ key: a.key, label: a.key, color: a.color, vals: pts.map(p => p[a.key]) })) },
  ].filter(l => l.show)
  const laneH = lanes.length ? (H - 18) / lanes.length : H
  // Common scale within a lane so overlaid traces (the ACC axes) stay comparable.
  const laneScale = lanes.map(l => { const all = l.traces.flatMap(tr => tr.vals); const mn = Math.min(...all); return { mn, rg: (Math.max(...all) - mn) || 1 } })
  const laneY = (li: number, v: number) => { const { mn, rg } = laneScale[li]; return 8 + li * laneH + laneH - 18 - ((v - mn) / rg) * (laneH - 34) }
  // Nearest stored sample to the cursor — the tooltip reports its preprocessed values, not interpolated ones.
  let hovIdx = -1
  if (hover !== null && pts.length) { let best = Infinity; pts.forEach((p, i) => { const d = Math.abs(p.t - hover); if (d < best) { best = d; hovIdx = i } }) }
  const hov = hovIdx >= 0 ? pts[hovIdx] : null
  const hovPct = hov ? ((hov.t - t1) / span) * 100 : 0
  const fromEvent = (e: React.MouseEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); return t1 + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * span }
  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none cursor-crosshair block"
          onMouseMove={e => setHover(fromEvent(e))}
          onMouseLeave={() => setHover(null)}
          onClick={e => onScrub(fromEvent(e))}>
          {lanes.map((l, li) => {
            const { mn, rg } = laneScale[li], y0 = 8 + li * laneH
            return <g key={l.key}>
              <rect x={0} y={y0 + 2} width={W} height={laneH - 10} rx={6} fill="#fff" stroke={C.grid} />
              <text x={8} y={y0 + 14} fontSize={10} fontWeight={600} fill={l.traces[0].color}>{l.label}</text>
              {/* overlaid-trace legend (ACC axes) at the lane's top right */}
              {l.traces.length > 1 && l.traces.map((tr, ti) => <g key={`lg-${tr.key}`}>
                <line x1={W - 118 + ti * 40} x2={W - 106 + ti * 40} y1={y0 + 11} y2={y0 + 11} stroke={tr.color} strokeWidth={2} />
                <text x={W - 103 + ti * 40} y={y0 + 14.5} fontSize={9.5} fontWeight={600} fill={tr.color}>{tr.label}</text>
              </g>)}
              <line x1={0} x2={W} y1={y0 + laneH - 8} y2={y0 + laneH - 8} stroke={C.grid} />
              {l.traces.map(tr => <path key={tr.key} d={pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.t).toFixed(1)},${(y0 + laneH - 18 - ((tr.vals[i] - mn) / rg) * (laneH - 34)).toFixed(1)}`).join(' ')} fill="none" stroke={tr.color} strokeWidth={1.5} strokeLinejoin="round" />)}
            </g>
          })}
          <line x1={X(t)} x2={X(t)} y1={0} y2={H} stroke={C.ink} strokeWidth={1.2} />
          {hov && <g>
            <line x1={X(hov.t)} x2={X(hov.t)} y1={0} y2={H} stroke={C.mute} strokeDasharray="3 3" />
            {lanes.map((l, li) => l.traces.map(tr => <circle key={tr.key} cx={X(hov.t)} cy={laneY(li, tr.vals[hovIdx])} r={4} fill={tr.color} stroke="#fff" strokeWidth={1.6} />))}
          </g>}
        </svg>
        {hov && (
          <div className="absolute top-1 z-10 pointer-events-none bg-stone-900/95 text-white rounded-lg px-3 py-2 shadow-lg min-w-[168px]" style={{ left: `${hovPct}%`, transform: `translateX(${hovPct > 68 ? 'calc(-100% - 10px)' : '10px'})` }} role="status">
            <p className="text-[11px] font-bold text-stone-300">{fmtT(hov.t)} · t = {hov.t.toFixed(2)} s</p>
            <div className="mt-1 space-y-0.5 text-[12px]">
              {channels.ir && <p className="flex justify-between gap-4"><span style={{ color: '#93c5fd' }}>Infrared PPG</span><b className="font-mono font-semibold">{hov.ir.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</b></p>}
              {channels.red && <p className="flex justify-between gap-4"><span style={{ color: '#c4b5fd' }}>Red PPG</span><b className="font-mono font-semibold">{hov.red.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</b></p>}
              {channels.acc && ACC_AXES.map(a => <p key={a.key} className="flex justify-between gap-4"><span style={{ color: a.tip }}>Accelerometer {a.key}</span><b className="font-mono font-semibold">{hov[a.key].toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</b></p>)}
            </div>
            <p className="text-[10px] text-stone-400 mt-1">nearest sample · all channels band-passed {rec.ppgBandHz[0]}–{rec.ppgBandHz[1]} Hz</p>
          </div>
        )}
      </div>
      <div className="flex justify-between text-[11px] text-stone-500"><span>{fmtT(t1)}</span><span>{fmtT(t2)}</span></div>
    </div>
  )
}

/** Ranked candidates collapsed to one representative per 2.5 BPM cluster (max `limit`, from the top `pool`). Shared by the Stage 2 chart and its chip list so they always show the same hypotheses. */
export function clusterRepresentatives<T extends { hr: number }>(candidates: T[], limit = 6, pool = 12): { rep: T; count: number }[] {
  const ranked = candidates.slice(0, pool)
  const out: { rep: T; count: number }[] = []
  for (const c of ranked) {
    const cl = out.find(o => Math.abs(o.rep.hr - c.hr) <= 2.5)
    if (cl) cl.count++
    else if (out.length < limit) out.push({ rep: c, count: 1 })
  }
  return out
}

// ── PSD / autocorr ──────────────────────────────────────────────────────────
// Candidate labels: sorted by x, packed into tiers; displaced labels get a leader line.
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
  // One marker per HR cluster (see clusterRepresentatives) — coincident
  // dots are never drawn, and labels cannot stack on the same HR.
  const clustered = clusterRepresentatives(win.candidates)
  const reps = clustered.map(o => o.rep)
  const rawItems = reps.map(c => {
    const v = rec.psd.reduce((b, p) => Math.abs(p.bpm - c.hr) < Math.abs(b.bpm - c.hr) ? p : b, rec.psd[0]).ir
    return { id: c.id, x: X(c.hr), y: Y(Math.max(v, 0.06)), w: c.hr >= 100 ? 62 : 54, c }
  })
  const clusters = rawItems.map((it, i) => ({ rep: it, count: clustered[i].count }))
  const placed = layoutCandidateLabels(clusters.map(cl => ({ ...cl.rep, w: cl.rep.w + (cl.count > 1 ? 22 : 0), count: cl.count })), W)
  const byId = new Map(rawItems.map(p => [p.id, p]))
  const clampLabel = (x: number, w: number) => Math.min(Math.max(x, w / 2 + 4), W - w / 2 - 4)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Welch PSD and autocorrelation with candidate heart-rate markers; labels are staggered to avoid overlap">
        {[35, 80, 120, 160, 200, 220].map(b => <g key={b}>
          <line x1={X(b)} x2={X(b)} y1={TOP - 18} y2={BASE} stroke={C.grid} />
          <SvgTex x={X(b)} y={BASE + 6} w={42} tex={String(b)} color={C.mute} size={10} />
        </g>)}
        <path d={area('ir')} fill={C.blue} opacity={0.12} /><path d={area('red')} fill="#7c3aed" opacity={0.06} />
        <path d={line} fill="none" stroke={C.amber} strokeWidth={1.4} strokeDasharray="5 3" opacity={0.85} />
        <line x1={PAD} x2={W - PAD} y1={BASE} y2={BASE} stroke="#d6d3d1" strokeWidth={1} />
        {/* leader lines first, so markers and labels paint over them */}
        {placed.filter(p => p.displaced).map(p => <line key={`lead-${p.id}`} x1={p.x} y1={p.tier < 0 ? p.y + 7 : p.y - 7} x2={p.labelX} y2={p.tier < 0 ? p.labelTop : p.labelTop + LABEL_H} stroke={p.c.isMotionPeak ? C.red : C.blue} strokeWidth={0.8} opacity={0.45} />)}
        <line x1={X(win.trueHR)} x2={X(win.trueHR)} y1={26} y2={BASE} stroke={C.teal} strokeWidth={2} />
        <SvgTex x={clampLabel(X(win.trueHR) + 76, 148)} y={2} w={148} tex={`\\text{reference }${win.trueHR.toFixed(2)}\\ \\mathrm{BPM}`} color={C.teal} size={11} bold />
        {win.motionFreqBPM > 0 && <g>
          <line x1={X(win.motionFreqBPM)} x2={X(win.motionFreqBPM)} y1={26} y2={BASE} stroke={C.red} strokeWidth={1.4} strokeDasharray="4 3" />
          <SvgTex x={clampLabel(X(win.motionFreqBPM) - 68, 132)} y={22} w={132} tex={`\\text{motion }${win.motionFreqBPM.toFixed(2)}\\ \\mathrm{BPM}`} color={C.red} size={11} />
        </g>}
        {/* one marker per cluster representative (numbers live in the chips below) */}
        {reps.map(c => {
          const p = byId.get(c.id)!
          const picked = sel?.id === c.id
          return <g key={c.id} onClick={() => onSel(c)} className="cursor-pointer">
            <circle cx={p.x} cy={p.y} r={16} fill="transparent" />{/* generous hit area, independent of label position */}
            {picked && <circle cx={p.x} cy={p.y} r={12} fill={c.isMotionPeak ? C.red : C.blue} opacity={0.18} />}
            <circle cx={p.x} cy={p.y} r={picked ? 8 : 4.5} fill={c.isMotionPeak ? C.red : C.blue} stroke="#fff" strokeWidth={2} opacity={picked ? 1 : 0.75} />
          </g>
        })}
        {/* one label per HR cluster — guaranteed non-overlapping by layoutCandidateLabels */}
        {placed.map(p => <SvgTex key={`lab-${p.id}`} x={p.labelX} y={p.labelTop} w={p.w} tex={p.count > 1 ? `${p.c.hr.toFixed(2)}\\,\\text{×}${p.count}` : p.c.hr.toFixed(2)} color={p.c.isMotionPeak ? C.red : C.blue} size={11} bold />)}
      </svg>
    </div>
  )
}

// ── Replay (sequential) charts: Stage 4 decoder + Stage 5 reliability ──────
// Axis numbers are KaTeX (SvgTex).
const topByDp = (w: ReplayWin, n = 5) => [...w.candidates].sort((a, b) => a.dpCost - b.dpCost).slice(0, n)

export function ReplayViterbiGraph({ windows, upto, reveal = 5, showIndep, showVit, showGT }: { windows: ReplayWin[]; upto: number; reveal?: number; showIndep: boolean; showVit: boolean; showGT: boolean }) {
  const H = 330, X = (i: number) => 56 + (i / Math.max(1, windows.length - 1)) * (W - 90)
  const hrs = windows.flatMap(w => [w.trueHR, w.independentHR, w.viterbiHR, ...topByDp(w).map(c => c.hr)])
  const lo = Math.floor((Math.min(...hrs) - 8) / 10) * 10, hi = Math.ceil((Math.max(...hrs) + 8) / 10) * 10
  const Y = (hr: number) => H - 34 - ((hr - lo) / (hi - lo)) * (H - 64)
  const ticks = [0, 1, 2, 3, 4].map(i => Math.round(lo + (i * (hi - lo)) / 4))
  const path = (get: (w: ReplayWin) => number, color: string, uptoN: number, dash = '') => (
    <path d={windows.slice(0, uptoN + 1).map((w, i) => `${i === 0 ? 'M' : 'L'}${X(i)},${Y(get(w))}`).join(' ')} fill="none" stroke={color} strokeWidth={2.4} strokeDasharray={dash} strokeLinejoin="round" />)
  const frontier = windows[upto]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Causal Viterbi decoding over five consecutive replay windows">
      {ticks.map(b => <g key={b}><line x1={52} x2={W - 20} y1={Y(b)} y2={Y(b)} stroke={C.grid} /><SvgTex x={30} y={Y(b) - 9} w={36} tex={String(b)} color={C.mute} size={10} /></g>)}
      {/* frontier guide — the only vertical; no predecessor spaghetti */}
      <line x1={X(upto)} x2={X(upto)} y1={24} y2={H - 34} stroke={C.teal} strokeWidth={1} strokeDasharray="3 4" opacity={0.45} />
      {windows.map((w, i) => <g key={i} opacity={i <= upto ? 1 : 0.18}>
        {(i < upto ? topByDp(w) : i === upto ? topByDp(w).slice(0, reveal) : []).map(c => <circle key={c.id} cx={X(i)} cy={Y(c.hr)} r={c.causal && i <= upto ? 5.5 : 3.2} fill={c.causal && i <= upto ? C.teal : '#fff'} stroke={c.causal && i <= upto ? C.teal : '#93c5fd'} strokeWidth={1.4} />)}
        <SvgTex x={X(i)} y={H - 20} w={30} tex={`w_{${i + 1}}`} color={i === upto ? C.teal : C.mute} size={10} bold={i === upto} />
      </g>)}
      {showIndep && path(w => w.independentHR, C.red, upto, '5 4')}
      {showVit && path(w => w.viterbiHR, C.teal, upto)}
      {showGT && path(w => w.trueHR, C.ink, upto, '2 3')}
      {/* frontier value callouts */}
      {showVit && <g><circle cx={X(upto)} cy={Y(frontier.viterbiHR)} r={9} fill="none" stroke={C.teal} strokeWidth={1.4} opacity={0.5} /><SvgTex x={Math.min(X(upto) + 52, W - 60)} y={Y(frontier.viterbiHR) - 24} w={104} tex={`${frontier.viterbiHR.toFixed(2)}\\ \\mathrm{BPM}`} color={C.teal} size={10} bold /></g>}
      <SvgTex x={270} y={2} w={300} tex={'\\text{top-5 by } \\tilde{D}_t(k)'} color={C.mute} size={10} align="left" />
    </svg>
  )
}

export function ReplayTimeline({ windows, upto, decisions }: { windows: ReplayWin[]; upto: number; decisions?: { reported: number | null }[] }) {
  const H = 190, X = (i: number) => 48 + (i / Math.max(1, windows.length - 1)) * (W - 80)
  const hrs = windows.flatMap(w => [w.trueHR, w.independentHR, w.viterbiHR])
  const lo = Math.floor((Math.min(...hrs) - 8) / 10) * 10, hi = Math.ceil((Math.max(...hrs) + 8) / 10) * 10
  const Y = (hr: number) => H - 32 - ((hr - lo) / (hi - lo)) * (H - 58)
  const ticks = [0, 1, 2, 3].map(i => Math.round(lo + (i * (hi - lo)) / 3))
  const line = (get: (w: ReplayWin) => number | null, color: string, dash = '') => {
    let d = '', pen = false
    windows.slice(0, upto + 1).forEach((w, i) => { const v = get(w); if (v === null) { pen = false; return } d += `${pen ? 'L' : 'M'}${X(i)},${Y(v)} `; pen = true })
    return <path d={d} fill="none" stroke={color} strokeWidth={2.2} strokeDasharray={dash} strokeLinejoin="round" />
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Heart-rate timeline: reference, independent, Viterbi and reported values">
      {ticks.map(b => <g key={b}><line x1={44} x2={W - 16} y1={Y(b)} y2={Y(b)} stroke={C.grid} /><SvgTex x={26} y={Y(b) - 9} w={32} tex={String(b)} color={C.mute} size={10} /></g>)}
      {line(w => w.trueHR, C.ink, '2 3')}{line(w => w.independentHR, C.red, '5 4')}{line(w => w.viterbiHR, C.teal)}
      {windows.slice(0, upto + 1).map((w, i) => <g key={i}><circle cx={X(i)} cy={Y(w.viterbiHR)} r={3.5} fill={C.teal} stroke="#fff" strokeWidth={1.2} /><SvgTex x={X(i)} y={H - 22} w={30} tex={`w_{${i + 1}}`} color={C.mute} size={10} /></g>)}
      {decisions && decisions.slice(0, upto + 1).map((d, i) => d.reported !== null
        ? <circle key={i} cx={X(i)} cy={Y(d.reported)} r={5} fill={C.amber} stroke="#fff" strokeWidth={1.5} />
        : <SvgTex key={i} x={X(i)} y={H - 22} w={20} tex={'\\times'} color={C.red} size={13} bold />)}
      {decisions && <SvgTex x={300} y={0} w={500} tex={'\\mathrm{BPM}\\ \\cdot\\ \\text{amber} = \\text{reported (accept/hold)}'} color={C.mute} size={10} align="left" />}
    </svg>
  )
}

/** Stage 5 figure: per-window reliability r_t against the active policy threshold. */
export function ReliabilityChart({ windows, thresh, decisions, selected, onSelect }: { windows: ReplayWin[]; thresh: number; decisions: { d: string }[]; selected: number; onSelect: (i: number) => void }) {
  const H = 250, X = (i: number) => 70 + (i / Math.max(1, windows.length - 1)) * (W - 130), Y = (r: number) => H - 48 - r * (H - 78), BW = 64
  const col = (d: string) => d === 'accept' ? C.teal : d === 'hold' ? C.amber : '#dc2626'
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Reliability per replay window against the reporting threshold">
      {[0, 0.25, 0.5, 0.75, 1].map(r => <g key={r}><line x1={52} x2={W - 20} y1={Y(r)} y2={Y(r)} stroke={C.grid} /><SvgTex x={30} y={Y(r) - 9} w={36} tex={r.toFixed(2)} color={C.mute} size={10} /></g>)}
      <line x1={52} x2={W - 20} y1={Y(thresh)} y2={Y(thresh)} stroke={C.amber} strokeWidth={2} strokeDasharray="6 4" />
      <SvgTex x={W - 150} y={Y(thresh) - 22} w={220} tex={`\\text{policy threshold } ${thresh.toFixed(2)}`} color={C.amber} size={10} bold />
      {windows.map((w, i) => <g key={i} onClick={() => onSelect(i)} className="cursor-pointer">
        <rect x={X(i) - BW / 2} y={Y(w.reliability)} width={BW} height={Y(0) - Y(w.reliability)} rx={3} fill={col(decisions[i].d)} opacity={i === selected ? 1 : 0.72} stroke={i === selected ? C.ink : 'none'} strokeWidth={i === selected ? 1.6 : 0} />
        <SvgTex x={X(i)} y={Y(w.reliability) - 24} w={52} tex={`r_{${i + 1}}=${w.reliability.toFixed(2)}`} color={col(decisions[i].d)} size={11} bold />
        <SvgTex x={X(i)} y={H - 30} w={52} tex={`w_{${i + 1}}`} color={C.mute} size={10} />
        <SvgTex x={X(i)} y={H - 16} w={86} tex={`\\text{${w.isMotion ? 'motion' : 'static'}}`} color={C.mute} size={9} />
      </g>)}
    </svg>
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
