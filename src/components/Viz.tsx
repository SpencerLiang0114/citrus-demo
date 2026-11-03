import { useEffect, useMemo, useRef, useState } from 'react'
import type { Recording, Win, Candidate } from '../data'
import { fmtT } from '../data'

export const C = { blue: '#2563eb', teal: '#0d9488', amber: '#d97706', red: '#dc2626', ink: '#1c1917', mute: '#78716c', grid: '#e7e5e4' }
const W = 860

// ── Hero animated canvas ────────────────────────────────────────────────────
export function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current!, ctx = cv.getContext('2d')!
    let raf = 0, t0 = performance.now()
    const draw = (now: number) => {
      const t = (now - t0) / 1000, w = cv.width, h = cv.height
      ctx.clearRect(0, 0, w, h)
      // noisy PPG (left -> pipeline)
      ctx.lineWidth = 2
      const wave = (x: number, tt: number) => h * 0.30 + 16 * Math.sin(x * 0.05 + tt * 2) * Math.pow(Math.max(0, Math.sin(x * 0.028 + tt * 1.4)), 2) + 12 * Math.sin(x * 0.11 + tt * 3.1) + 5 * Math.sin(x * 0.31 + tt * 7)
      ctx.strokeStyle = C.blue; ctx.beginPath()
      for (let x = 0; x < w * 0.34; x += 3) { const y = wave(x, t); x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) } ctx.stroke()
      ctx.fillStyle = C.mute; ctx.font = '600 11px Inter,sans-serif'; ctx.fillText('NOISY PPG + ACC', 8, 18)
      // candidate cloud
      const cx = w * 0.52
      ctx.fillText('≈140 CANDIDATES / WINDOW', cx - 70, 18)
      const truth = h * 0.52
      for (let i = 0; i < 26; i++) {
        const yy = truth + Math.sin(i * 12.9898) * h * 0.30, xx = cx + Math.sin(i * 78.233 + t * 0.6) * 46
        const isTruth = Math.abs(yy - truth) < 9
        ctx.fillStyle = isTruth ? C.teal : i % 5 === 0 ? C.red : C.blue
        ctx.globalAlpha = isTruth ? 1 : 0.55; ctx.beginPath(); ctx.arc(xx, yy, isTruth ? 5 : 3.5, 0, 7); ctx.fill()
      }
      ctx.globalAlpha = 1
      // decoded path
      ctx.strokeStyle = C.teal; ctx.lineWidth = 2.5; ctx.beginPath()
      for (let x = w * 0.66; x < w * 0.97; x += 4) { const y = h * 0.52 + 10 * Math.sin(x * 0.02 + t * 1.2); x === w * 0.66 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) } ctx.stroke()
      ctx.fillStyle = C.teal; ctx.fillText('DECODED HR → ACCEPT / HOLD / REJECT', w * 0.66, 18)
      const phase = (t % 3) / 3
      const bx = w * 0.97, by = h * 0.52 + 10 * Math.sin(bx * 0.02 + t * 1.2)
      ctx.fillStyle = phase < 0.6 ? C.teal : phase < 0.8 ? C.amber : C.red
      ctx.beginPath(); ctx.arc(bx, by, 6 + 2 * Math.sin(t * 4), 0, 7); ctx.fill()
      // connectors
      ctx.strokeStyle = '#d6d3d1'; ctx.lineWidth = 1; ctx.setLineDash([4, 4])
      ctx.beginPath(); ctx.moveTo(w * 0.34, h * 0.3); ctx.lineTo(cx - 55, h * 0.45); ctx.moveTo(cx + 55, h * 0.5); ctx.lineTo(w * 0.66, h * 0.52); ctx.stroke(); ctx.setLineDash([])
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} width={1160} height={190} className="w-full h-auto block" aria-label="Animated CITRUS pipeline: noisy PPG to candidates to decoded HR" />
}

// ── Signal explorer ─────────────────────────────────────────────────────────
export function SignalExplorer({ rec, t, span, channels, onScrub }: { rec: Recording; t: number; span: number; channels: Record<string, boolean>; onScrub: (t: number) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const H = 240, t1 = Math.max(0, Math.min(t - span / 2, 360 - span)), t2 = t1 + span
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
export function PsdChart({ rec, win, sel, onSel }: { rec: Recording; win: Win; sel: Candidate | null; onSel: (c: Candidate) => void }) {
  const H = 230
  const X = (b: number) => ((b - 35) / 185) * W, Y = (v: number) => H - 26 - v * (H - 50)
  const area = (key: 'ir' | 'red') => rec.psd.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.bpm).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(' ') + ` L${W},${H - 26} L0,${H - 26} Z`
  const line = rec.autocorr.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.lagBPM).toFixed(1)},${(Y(p.v) - 0).toFixed(1)}`).join(' ')
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 30}`} className="w-full h-auto">
        {[35, 80, 120, 160, 200, 220].map(b => <g key={b}><line x1={X(b)} x2={X(b)} y1={0} y2={H - 26} stroke={C.grid} /><text x={X(b)} y={H - 8} fontSize={10} textAnchor={b === 35 ? 'start' : b === 220 ? 'end' : 'middle'} fill={C.mute}>{b}</text></g>)}
        <path d={area('ir')} fill={C.blue} opacity={0.13} /><path d={area('red')} fill="#7c3aed" opacity={0.10} />
        <path d={line} fill="none" stroke={C.amber} strokeWidth={1.6} strokeDasharray="5 3" />
        <line x1={X(win.trueHR)} x2={X(win.trueHR)} y1={6} y2={H - 26} stroke={C.teal} strokeWidth={2} />
        <text x={X(win.trueHR) + 5} y={16} fontSize={11} fontWeight={700} fill={C.teal}>reference {win.trueHR} BPM</text>
        {win.motionFreqBPM > 0 && <g><line x1={X(win.motionFreqBPM)} x2={X(win.motionFreqBPM)} y1={6} y2={H - 26} stroke={C.red} strokeWidth={1.4} strokeDasharray="4 3" /><text x={X(win.motionFreqBPM) + 5} y={30} fontSize={11} fontWeight={600} fill={C.red}>motion {win.motionFreqBPM} BPM</text></g>}
        {win.candidates.slice(0, 12).map(c => {
          const v = rec.psd.reduce((b, p) => Math.abs(p.bpm - c.hr) < Math.abs(b.bpm - c.hr) ? p : b, rec.psd[0]).ir
          return <g key={c.id} onClick={() => onSel(c)} className="cursor-pointer">
            <circle cx={X(c.hr)} cy={Y(Math.max(v, 0.06))} r={sel?.id === c.id ? 8 : 5.5} fill={c.isMotionPeak ? C.red : C.blue} stroke="#fff" strokeWidth={2} />
            <text x={X(c.hr)} y={Y(Math.max(v, 0.06)) - 11} fontSize={10} textAnchor="middle" fontWeight={600} fill={c.isMotionPeak ? C.red : C.blue}>{c.hr}</text>
          </g>
        })}
        <text x={W / 2} y={H + 12} fontSize={11} textAnchor="middle" fill={C.mute}>Candidate HR (BPM) · solid fill = Welch PSD (IR / red) · dashed amber = autocorrelation</text>
      </svg>
      <p className="text-xs text-stone-500 mt-1">Click a marker to inspect it. Under motion the <span className="text-red-600 font-semibold">tallest peak is limb-motion frequency</span>, not the pulse — the core ambiguity CITRUS resolves by scoring all hypotheses, not picking the max.</p>
    </div>
  )
}

// ── Viterbi graph ───────────────────────────────────────────────────────────
export function ViterbiGraph({ rec, upto, showIndep, showVit, showGT }: { rec: Recording; upto: number; showIndep: boolean; showVit: boolean; showGT: boolean }) {
  const H = 330, X = (i: number) => 56 + (i / (rec.windows.length - 1)) * (W - 90), Y = (hr: number) => H - 34 - ((hr - 35) / 185) * (H - 60)
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
  const H = 170, X = (i: number) => 48 + (i / (rec.windows.length - 1)) * (W - 80), Y = (hr: number) => H - 30 - ((hr - 35) / 185) * (H - 52)
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
