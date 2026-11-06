import { useEffect, useMemo, useRef, useState } from 'react'
import { RECORDINGS, REPLAY, POLICIES, PUBLISHED, decide, fmtT, type Candidate, type PolicyKey } from './data'
import { SignalExplorer, PsdChart, ReplayViterbiGraph, ReplayTimeline, ReliabilityChart, clusterRepresentatives, C } from './components/Viz'
import { Tex, MathNumbers, toTexExpr } from './components/Math'

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
const SectionHead = ({ title, lede }: { kicker?: string; title: string; lede?: React.ReactNode }) => (
  <div className="mb-8">
    <h2 className="font-serif text-3xl md:text-4xl font-medium text-stone-900">{title}</h2>
    {lede && <p className="text-stone-600 mt-3 max-w-3xl leading-relaxed">{lede}</p>}
  </div>
)

// ══════════════ INTERACTIVE PLAYGROUND (shared state) ══════════════
function Playground() {
  const [recId, setRecId] = useState('squats')
  const rec = RECORDINGS.find(r => r.id === recId)!
  const [t, setT] = useState(15)
  const [playing, setPlaying] = useState(false)
  const [span, setSpan] = useState(30)
  const [channels, setChannels] = useState({ ir: true, red: true, acc: true, ref: true })
  const [selCand, setSelCand] = useState<Candidate | null>(null)
  const [scorer, setScorer] = useState<'MLP' | 'HGB'>('MLP')
  // One step = one window: each step advances the frontier by a whole w_t.
  const [vitStep, setVitStep] = useState(0)
  const [vitPlaying, setVitPlaying] = useState(() => !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches))
  const goVitWindow = (i: number) => { setVitPlaying(false); setVitStep(Math.max(0, Math.min(REPLAY.windows.length - 1, i))) }
  const [cmp, setCmp] = useState({ indep: true, vit: true, gt: true })
  const [policy, setPolicy] = useState<PolicyKey>('l8')
  const [expandedCand, setExpandedCand] = useState<string | null>(null)
  const [relSel, setRelSel] = useState(2)

  const DUR = rec.windows.length * 30
  useEffect(() => { if (!playing) return; const id = setInterval(() => setT(v => (v + 1 >= DUR ? 0 : v + 1)), 120); return () => clearInterval(id) }, [playing, DUR])
  useEffect(() => { setSelCand(null); setVitStep(0) }, [recId])
  // Stage 4 autoplay: advance one whole window per step, loop at the end.
  useEffect(() => {
    if (!vitPlaying) return
    const id = setInterval(() => setVitStep(s => (s >= REPLAY.windows.length - 1 ? 0 : s + 1)), 1400)
    return () => clearInterval(id)
  }, [vitPlaying])
  const winIdx = Math.min(rec.windows.length - 1, Math.floor(t / 30))
  const win = rec.windows[winIdx]
  // Stages 4–5 run on the 5-window sequential replay (data.ts).
  const vitWin = REPLAY.windows[vitStep]
  const relWin = REPLAY.windows[relSel]

  const decisions = useMemo(() => {
    const out: { d: string; reported: number | null }[] = []; let held: number | null = null
    for (const w of REPLAY.windows) { const r = decide({ reliability: w.reliability, viterbiHR: w.viterbiHR } as never, POLICIES[policy].thresh, (out.at(-1)?.d as never) ?? null, held); if (r.d === 'accept') held = w.viterbiHR; out.push(r) }
    return out
  }, [policy])
  const reportedCount = decisions.filter(d => d.reported !== null).length
  // Real stored DP for the frontier window: top-5 by normalised DP cost.
  const dpRows = [...vitWin.candidates].sort((a, b) => a.dpCost - b.dpCost).slice(0, 5)

  const stageBtn = (n: number, label: string) => (
    <button onClick={() => scrollTo(`stage${n}`)} className="text-left px-3 py-2 rounded-lg border border-stone-200 hover:border-blue-400 hover:bg-blue-50 text-[13px] font-medium text-stone-700 transition"><span className="text-blue-700 font-bold mr-1.5">{n}</span>{label}</button>
  )

  return (
    <section id="demo" className="max-w-6xl mx-auto px-5 py-16 scroll-mt-20">
      <SectionHead title="The Algorithm Playground" lede="Five synchronized stages on one shared timeline. Scrub or press play — every view follows the same playhead." />

      {/* shared controls */}
      <div className="sticky top-14 z-30 bg-white/95 backdrop-blur rounded-lg p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5 flex-wrap">
            {RECORDINGS.map(r => <button key={r.id} onClick={() => { setRecId(r.id); setT(15) }} className={`px-3 py-1.5 rounded-full text-[13px] font-semibold border transition ${recId === r.id ? 'bg-blue-700 text-white border-blue-700' : 'border-stone-300 text-stone-600 hover:border-blue-500'}`}>{r.label}</button>)}
          </div>
          <span className="text-xs text-stone-500">{rec.sub} · {rec.motion}</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setPlaying(!playing)} className="px-4 py-1.5 rounded-full bg-stone-900 text-white text-[13px] font-semibold hover:bg-stone-700">{playing ? '❚❚ Pause' : '▶ Play'}</button>
            <span className="font-mono text-sm text-stone-700 w-20 text-center">{fmtT(t)} / {fmtT(DUR)}</span>
          </div>
        </div>
        <input type="range" min={0} max={DUR - 1} value={t} onChange={e => setT(+e.target.value)} className="w-full mt-3 accent-blue-700" aria-label="Scrub timeline" />
        <p className="text-[11px] text-stone-500 mt-1.5">Window <Tex tex={`${winIdx + 1} \\;/\\; ${rec.windows.length}`} /> · <Tex tex="30\ \mathrm{s}" /> windows · reference HR in window: <b className="text-teal-700"><Tex tex={`${win.trueHR.toFixed(2)}\\ \\mathrm{BPM}`} /></b> (evaluation only)</p>
      </div>

      <div className="grid md:grid-cols-5 gap-2 mb-10">{stageBtn(1, 'PPG Signal Explorer')}{stageBtn(2, 'Candidate Generation')}{stageBtn(3, 'Candidate Scoring')}{stageBtn(4, 'Causal Viterbi Decoding')}{stageBtn(5, 'Reliability Reporting')}</div>

      {/* ── STAGE 1 ── */}
      <article id="stage1" className="scroll-mt-36 border-t border-stone-200 pt-10 mt-10">
        <h3 className="font-serif text-2xl font-medium"><span className="text-blue-700">Stage 1 ·</span> PPG Signal Explorer</h3>
        <p className="text-stone-600 mt-2 max-w-3xl text-[15px] leading-relaxed">Ring PPG (infrared + red, <Tex tex="\approx 100\ \mathrm{Hz}" /> as stored) with accelerometer. At rest the pulse dominates. Under squats or striding, limb motion changes sensor–skin coupling and injects artifacts <em>inside the cardiac band</em> — distorting the waveform until several heart rates become plausible. Compare <b>Rest</b> against <b>Deep squats</b> above.</p>
        <div className="flex flex-wrap gap-4 mt-4 text-[13px]">
          {([['ir', 'Infrared PPG', C.blue], ['red', 'Red PPG', '#7c3aed'], ['acc', 'Accelerometer', C.amber]] as const).map(([k, label, col]) => (
            <label key={k} className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={channels[k]} onChange={() => setChannels({ ...channels, [k]: !channels[k] })} className="accent-blue-700" /><span style={{ color: col }} className="font-semibold">{label}</span></label>))}
          <label className="flex items-center gap-2 ml-auto">Zoom <input type="range" min={5} max={30} step={5} value={span} onChange={e => setSpan(+e.target.value)} className="accent-blue-700" /><span className="text-xs"><Tex tex={`${span}\\ \\mathrm{s}`} /></span></label>
        </div>
        <figure className="figure mt-3"><SignalExplorer rec={rec} t={t} span={span} channels={channels} onScrub={setT} /></figure>
        <div className="grid md:grid-cols-3 gap-3 mt-4 text-[13px]">
          {[['Motion amplitude', <><Tex tex={`\\sigma_{|a|} = ${win.motionAmp.toFixed(2)}`} /> <span className="font-normal text-stone-500">(ACC magnitude std, stored counts)</span></>, win.motionAmp > 20 ? 'Severe — cardiac component may be non-identifiable in this window.' : 'Mild — pulse remains the dominant component.'], ['Motion frequency', win.motionFreqBPM ? <Tex tex={`${win.motionFreqBPM.toFixed(2)}\\ \\mathrm{BPM\\text{-}equiv.}`} /> : <Tex tex="\text{—}" />, win.motionFreqBPM ? <span>Inside the <Tex tex="[35,\,220]\ \mathrm{BPM}" /> candidate band: it will generate its own HR hypotheses.</span> : 'No periodic motion source.'], ['ACC role', 'Segment selection', 'ACC selects motion-quiet segments before spectral estimation (paper §3.1).']].map(([k, v, d]) => (
            <div key={k as string} className="bg-stone-50 rounded-lg p-3"><p className="text-[11px] font-bold tracking-wider text-stone-500 uppercase">{k}</p><p className="font-semibold text-stone-800 mt-0.5">{v}</p><p className="text-stone-500 mt-1">{d}</p></div>))}
        </div>
      </article>

      {/* ── STAGE 2 ── */}
      <article id="stage2" className="scroll-mt-36 border-t border-stone-200 pt-10 mt-12">
        <h3 className="font-serif text-2xl font-medium"><span className="text-blue-700">Stage 2 ·</span> Candidate Generation</h3>
        <p className="text-stone-600 mt-2 max-w-3xl text-[15px] leading-relaxed">Each <Tex tex="30\ \mathrm{s}" /> window yields <b><Tex tex="\approx 140" /> candidates</b> from three estimator families — Welch PSD peaks, autocorrelation peaks, peak-interval estimates — expanded with harmonic variants (<Tex tex="0.5\times,\ 1\times,\ 2\times" />) and filtered to <Tex tex="[35,\,220]\ \mathrm{BPM}" />. Nearby hypotheses are grouped into a single marker below (<Tex tex="\text{×}n" /> = <Tex tex="n" /> candidates).</p>
        <figure className="figure mt-3"><PsdChart rec={rec} win={win} sel={selCand} onSel={setSelCand} /></figure>
        <div className="flex flex-wrap gap-1.5 mt-3" aria-label="Candidate clusters">
          {clusterRepresentatives(win.candidates).map(({ rep: c, count }, i) => (
            <button key={c.id} onClick={() => setSelCand(c)} className={`px-2.5 py-1.5 rounded-full border text-[12px] transition ${selCand?.id === c.id ? 'border-blue-500 bg-blue-50' : 'border-stone-200 hover:border-blue-300'}`}>
              <span className="text-stone-400"><Tex tex={`\\#${i + 1}`} /></span>{' '}<Tex tex={`${c.hr.toFixed(2)}\\ \\mathrm{BPM}`} /> <span className="text-stone-400">· {c.method}{count > 1 ? ` · ×${count}` : ''}</span>
            </button>))}
        </div>
        {selCand ? (
          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm grid md:grid-cols-5 gap-3">
            <div><p className="text-[11px] font-bold text-blue-700 uppercase">Candidate</p><p className="font-serif text-2xl font-medium"><Tex tex={`${selCand.hr.toFixed(2)}\\ \\mathrm{BPM}`} /></p></div>
            <div><p className="text-[11px] font-bold text-blue-700 uppercase">Source</p><p>{selCand.method} · {selCand.channel} channel</p></div>
            <div><p className="text-[11px] font-bold text-blue-700 uppercase">Spectral evidence</p><p>relative power <Tex tex={`${(selCand.power * 100).toFixed(2)}\\%`} /></p></div>
            <div><p className="text-[11px] font-bold text-blue-700 uppercase">Harmonic</p><p><Tex tex={selCand.harmonic === '—' ? '\\text{—}' : selCand.harmonic.replace('×', '\\times')} /> variant{selCand.isMotionPeak ? ' · motion peak' : ''}</p></div>
            <div><p className="text-[11px] font-bold text-blue-700 uppercase">vs. reference</p><p className={Math.abs(selCand.hr - win.trueHR) <= 5 ? 'text-teal-700 font-semibold' : 'text-red-600 font-semibold'}><Tex tex={`${selCand.hr - win.trueHR >= 0 ? '+' : ''}${(selCand.hr - win.trueHR).toFixed(2)}\\ \\mathrm{BPM}`} /> {Math.abs(selCand.hr - win.trueHR) <= 5 ? '(plausible pulse)' : '(likely artifact / harmonic)'}</p></div>
          </div>
        ) : <p className="text-[13px] text-stone-500 mt-2">In <b>Deep squats</b>, the strongest candidate sits at <Tex tex="45.90\ \mathrm{BPM}" />, some <Tex tex="35.00\ \mathrm{BPM}" /> from the <Tex tex="81.00\ \mathrm{BPM}" /> reference, and the ranker's predicted error for its top pick is <Tex tex="\approx 16.70\ \mathrm{BPM}" />. Stage 5 decides whether to report such a window.</p>}
      </article>

      {/* ── STAGE 3 ── */}
      <article id="stage3" className="scroll-mt-36 border-t border-stone-200 pt-10 mt-12">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-[260px]">
            <h3 className="font-serif text-2xl font-medium"><span className="text-blue-700">Stage 3 ·</span> Candidate Scoring</h3>
            <p className="text-stone-600 mt-2 max-w-3xl text-[15px] leading-relaxed">A learned ranker scores every candidate from structured features — spectral power, estimator consensus, harmonic status, source, and distance to the previous decoded HR — trained with soft targets centered on the reference HR. Click a bar to expand its feature breakdown.</p>
          </div>
          <div className="flex rounded-full border border-stone-300 overflow-hidden text-[13px] font-semibold" role="group" aria-label="Candidate scorer">
            {(['MLP', 'HGB'] as const).map(s => <button key={s} aria-pressed={scorer === s} onClick={() => { setScorer(s); setExpandedCand(null) }} className={`px-4 py-2 transition-colors ${scorer === s ? (s === 'MLP' ? 'bg-violet-700 text-white' : 'bg-blue-700 text-white') : 'text-stone-600 hover:bg-stone-50'}`}>{s} scorer</button>)}
          </div>
        </div>
        <div key={scorer} className="scorer-swap">
          <p className={`text-[12px] border rounded-lg px-3 py-2 mt-3 ${scorer === 'MLP' ? 'text-violet-900 bg-violet-50 border-violet-200' : 'text-amber-800 bg-amber-50 border-amber-200'}`}>{scorer === 'MLP' ? 'MLP scorer — the paper\u2019s primary configuration, retrained here on the stored candidates (scripts/build_real_data.py).' : 'HGB scorer — used for the stress test and on-device deployment. Scores below are for the current window.'}</p>
          {scorer === 'HGB' ? (
            <div className="mt-4 space-y-1.5">
              <p className="flex items-center gap-2 text-[12px] font-semibold text-blue-800"><span className="w-2.5 h-2.5 rounded-sm bg-blue-700 inline-block" /> HGB ranking — this window · click a bar for its feature breakdown</p>
              {win.candidates.slice(0, 8).map((c, i) => (
                <div key={c.id}>
                  <button onClick={() => setExpandedCand(expandedCand === c.id ? null : c.id)} aria-expanded={expandedCand === c.id} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition ${expandedCand === c.id ? 'border-blue-400 bg-blue-50' : 'border-stone-200 hover:border-blue-300'}`}>
                    <span className="text-xs text-stone-400 w-5"><Tex tex={`\\#${i + 1}`} /></span>
                    <span className={`font-bold w-20 ${c.isMotionPeak ? 'text-red-600' : 'text-stone-800'}`}><Tex tex={`${c.hr.toFixed(2)}\\ \\mathrm{BPM}`} /></span>
                    <span className="flex-1 h-3 bg-stone-100 rounded-full overflow-hidden"><span className="block h-full rounded-full transition-all duration-500" style={{ width: `${c.score * 100}%`, background: c.isMotionPeak ? C.red : C.blue }} /></span>
                    <span className="text-xs w-14 text-right"><Tex tex={c.score.toFixed(2)} /></span>
                    <span className="text-[11px] text-stone-500 w-36 hidden md:block">{c.method} · {c.channel} · <Tex tex={c.harmonic === '—' ? '\\text{—}' : c.harmonic.replace('×', '\\times')} /></span>
                    <span className="text-[11px] font-semibold w-20 text-right">{Math.abs(c.hr - win.trueHR) <= 5 ? <span className="text-teal-700">near ref</span> : c.isMotionPeak ? <span className="text-red-600">motion peak</span> : ''}</span>
                  </button>
                  {expandedCand === c.id && (
                    <div className="mx-3 mb-2 px-4 py-3 bg-stone-50 rounded-b-lg grid grid-cols-2 md:grid-cols-5 gap-3 text-[12px]">
                      {([['Spectral quality', c.feats.spectral], ['Consensus density @5 BPM', c.feats.consensus], ['Consensus density @10 BPM', c.feats.harmonic], ['Weighted density @10 BPM', c.feats.source], ['Channel quality', c.feats.temporal]] as const).map(([k, v]) => (
                        <div key={k}><p className="text-stone-500">{k.includes('@') ? <>{k.split('@')[0]}@<Tex tex={`${k.split('@')[1].trim().replace(' BPM', '')}\\ \\mathrm{BPM}`} /></> : k}</p><div className="h-2 bg-stone-200 rounded-full mt-1"><div className="h-full bg-blue-600 rounded-full" style={{ width: `${v * 100}%` }} /></div><p className="mt-0.5"><Tex tex={v.toFixed(2)} /></p></div>))}
                      <p className="col-span-full text-stone-500">Candidate cost <Tex tex="E_t(k)" /> <Tex tex={`= ${(c.cost).toFixed(2)}`} /> (−log emission probability from the HGB scorer) — passed to the Viterbi decoder in Stage 4.</p>
                    </div>)}
                </div>))}
            </div>
          ) : (
            <div className="mt-4 space-y-1.5">
              <p className="flex items-center gap-2 text-[12px] font-semibold text-violet-800"><span className="w-2.5 h-2.5 rounded-sm bg-violet-700 inline-block" /> MLP ranking — this window · click a bar for its feature breakdown</p>
              {[...win.candidates].sort((a, b) => b.mlpScore - a.mlpScore).slice(0, 8).map((c, i) => (
                <div key={c.id}>
                  <button onClick={() => setExpandedCand(expandedCand === c.id ? null : c.id)} aria-expanded={expandedCand === c.id} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition ${expandedCand === c.id ? 'border-violet-400 bg-violet-50' : 'border-stone-200 hover:border-violet-300'}`}>
                    <span className="text-xs text-stone-400 w-5"><Tex tex={`\\#${i + 1}`} /></span>
                    <span className={`font-bold w-20 ${c.isMotionPeak ? 'text-red-600' : 'text-stone-800'}`}><Tex tex={`${c.hr.toFixed(2)}\\ \\mathrm{BPM}`} /></span>
                    <span className="flex-1 h-3 bg-stone-100 rounded-full overflow-hidden"><span className="block h-full rounded-full transition-all duration-500" style={{ width: `${c.mlpScore * 100}%`, background: c.isMotionPeak ? C.red : '#7c3aed' }} /></span>
                    <span className="text-xs w-14 text-right"><Tex tex={c.mlpScore.toFixed(2)} /></span>
                    <span className="text-[11px] text-stone-500 w-36 hidden md:block">{c.method} · {c.channel} · <Tex tex={c.harmonic === '—' ? '\\text{—}' : c.harmonic.replace('×', '\\times')} /></span>
                    <span className="text-[11px] font-semibold w-20 text-right">{Math.abs(c.hr - win.trueHR) <= 5 ? <span className="text-teal-700">near ref</span> : c.isMotionPeak ? <span className="text-red-600">motion peak</span> : ''}</span>
                  </button>
                  {expandedCand === c.id && (
                    <div className="mx-3 mb-2 px-4 py-3 bg-stone-50 rounded-b-lg grid grid-cols-2 md:grid-cols-5 gap-3 text-[12px]">
                      {([['Spectral quality', c.feats.spectral], ['Consensus density @5 BPM', c.feats.consensus], ['Consensus density @10 BPM', c.feats.harmonic], ['Weighted density @10 BPM', c.feats.source], ['Channel quality', c.feats.temporal]] as const).map(([k, v]) => (
                        <div key={k}><p className="text-stone-500">{k.includes('@') ? <>{k.split('@')[0]}@<Tex tex={`${k.split('@')[1].trim().replace(' BPM', '')}\\ \\mathrm{BPM}`} /></> : k}</p><div className="h-2 bg-stone-200 rounded-full mt-1"><div className="h-full bg-violet-600 rounded-full" style={{ width: `${v * 100}%` }} /></div><p className="mt-0.5"><Tex tex={v.toFixed(2)} /></p></div>))}
                      <p className="col-span-full text-stone-500">MLP score <Tex tex={`= ${c.mlpScore.toFixed(2)}`} /> — predicted soft target, normalised per window.</p>
                    </div>)}
                </div>))}
              <div className="grid md:grid-cols-3 gap-3 mt-3 text-[13px]">
                {[['MLP scorer', 'Soft-target MLP', 'Retrained on the stored candidates, following the paper\u2019s recipe.'], ['Primary evaluation', 'Headline results', 'The configuration behind the motion results in Evaluation below.'], ['Motion MAE, scoring → + Viterbi', '12.94 → 10.91 BPM', 'Paper result: per-window scoring, then causal decoding.']].map(([k, v, d]) => (
                  <div key={k} className="bg-violet-50 border border-violet-100 rounded-lg p-3"><p className="text-[11px] font-bold tracking-wider text-violet-700 uppercase">{k}</p><p className="font-serif text-lg font-medium text-stone-900 mt-0.5">{v}</p><p className="text-stone-500 mt-1 text-[12px] leading-relaxed">{d}</p></div>
                ))}
              </div>
            </div>
          )}
        </div>
        <p className="text-[13px] text-stone-500 mt-3">Note the lesson: the motion peak often has the <em>highest spectral power</em> (feature <Tex tex="1" />) but loses on consensus, harmonic status, and temporal distance. Raw peak-picking fails; multi-feature ranking does not.</p>
      </article>

      {/* ── STAGE 4 ── */}
      <article id="stage4" className="scroll-mt-36 border-t border-stone-200 pt-10 mt-12">
        <h3 className="font-serif text-2xl font-medium"><span style={{ color: C.teal }}>Stage 4 ·</span> Causal Viterbi Decoding</h3>
        <p className="text-stone-600 mt-2 max-w-3xl text-[15px] leading-relaxed">Per-window winners can still jump implausibly. CITRUS runs an <b>online</b> Viterbi recursion: when window <Tex tex="t" /> arrives, it extends only paths ending at <Tex tex="t-1" /> — no future windows, no backward smoothing — so it deploys in real time. The decoder plays automatically below — <b>one step advances to the next window</b> (<Tex tex={`w_t \\to w_{t+1}`} />, <Tex tex={`${REPLAY.windows.length}`} /> steps in total); pause it to step by hand.</p>
        <p className="text-[13px] text-stone-600 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2 mt-3 max-w-3xl">Sequential replay: five consecutive windows — two static, three in deep squats — decoded causally as they arrive.</p>
        <div className="bg-stone-900 text-stone-100 rounded-lg px-5 py-4 mt-4 text-center overflow-x-auto">
          <p className="text-lg md:text-xl whitespace-nowrap"><Tex tex="D_t(k) = E_t(k) + \min_{j}\bigl[\, D_{t-1}(j) + \Omega_t(j,\,k) \,\bigr], \qquad E_t(k) = -\log p_t(k)" /></p>
          <p className="text-stone-400 text-[13px] mt-2 whitespace-nowrap"><Tex tex="\Omega_t(j,k) = \lambda_{\mathrm{tr}} \min\!\Bigl\{\bigl(\Delta_{jk}/\sigma_{jk}\bigr)^{2},\, 9\Bigr\} + 0.25\Bigl(\max\{0,\, \Delta_{jk}-\tau_{jk}\}/\tau_{jk}\Bigr)^{2}" /> <span className="ml-2">with</span> <Tex tex="\lambda_{\mathrm{tr}} = 2.0" /> <span>and</span> <Tex tex="\Delta_{jk} = |h_t(k) - h_{t-1}(j)|" /></p>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button onClick={() => setVitPlaying(p => !p)} className="px-4 py-1.5 rounded-full bg-teal-700 text-white text-[13px] font-semibold hover:bg-teal-800" aria-label={vitPlaying ? 'Pause decoder autoplay' : 'Play decoder autoplay'}>{vitPlaying ? '❚❚ Pause' : '▶ Play'}</button>
          <button onClick={() => goVitWindow(vitStep - 1)} className="px-3 py-1.5 rounded-full border border-stone-300 text-[13px] font-semibold disabled:opacity-40" disabled={vitStep === 0}>← Prev window</button>
          <button onClick={() => goVitWindow(vitStep + 1)} className="px-3 py-1.5 rounded-full border border-teal-700 text-teal-800 text-[13px] font-semibold disabled:opacity-40" disabled={vitStep === REPLAY.windows.length - 1}>Step window →</button>
          <button onClick={() => { setVitPlaying(false); setVitStep(0) }} className="px-3 py-1.5 rounded-full border border-stone-300 text-[13px] font-semibold">Restart</button>
          {/* segmented step track: one segment per window — a step fills exactly one segment */}
          <div className="flex items-center gap-1.5 flex-1 min-w-[240px]" role="group" aria-label="Decoder step progress">
            {REPLAY.windows.map((w, i) => (
              <button key={w.idx} onClick={() => goVitWindow(i)} title={`Window ${i + 1}`} aria-label={`Go to window ${i + 1}`} aria-current={i === vitStep ? 'step' : undefined} className="relative flex-1 min-w-[36px] h-2.5 p-0 rounded-full bg-stone-200 overflow-hidden">
                <span className="absolute left-0 top-0 block h-full rounded-full bg-teal-600 transition-all duration-300" style={{ width: i <= vitStep ? '100%' : '0%' }} />
              </button>))}
          </div>
          <span className="text-sm whitespace-nowrap">step <Tex tex={`${vitStep + 1} \\;/\\; ${REPLAY.windows.length}`} /> · window <Tex tex={`t = ${vitStep + 1} \\;/\\; ${REPLAY.windows.length}`} /></span>
          <div className="flex gap-3 text-[12px] ml-auto">
            {([['indep', 'Independent', C.red], ['vit', 'Viterbi', C.teal], ['gt', 'Reference', C.ink]] as const).map(([k, l, col]) => <label key={k} className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={cmp[k]} onChange={() => setCmp({ ...cmp, [k]: !cmp[k] })} className="accent-teal-700" /><span style={{ color: col }} className="font-semibold">{l}</span></label>)}
          </div>
        </div>
        <figure className="figure mt-3"><ReplayViterbiGraph windows={REPLAY.windows} upto={vitStep} showIndep={cmp.indep} showVit={cmp.vit} showGT={cmp.gt} /></figure>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 text-[13px]">
          {([['Window', <Tex tex={`w_{${vitStep + 1}}\\ \\text{(${vitWin.isMotion ? 'deep-squat, motion' : 'spo2, static'})}`} />], ['Candidates', <Tex tex={`n_t = ${vitWin.candidates.length}`} />], ['Independent argmax', <Tex tex={`${vitWin.independentHR.toFixed(2)}\\ \\mathrm{BPM}`} />], ['Causal decoded', <Tex tex={`\\hat{h}_t = ${vitWin.viterbiHR.toFixed(2)}\\ \\mathrm{BPM}`} />], ['Reference', <Tex tex={`${vitWin.trueHR.toFixed(2)}\\ \\mathrm{BPM}`} />]] as [string, React.ReactNode][]).map(([k, v]) => (
            <div key={k} className="bg-stone-50 rounded-lg p-3"><p className="text-[11px] font-bold tracking-wider text-stone-500 uppercase">{k}</p><p className="font-semibold text-stone-800 mt-0.5">{v}</p></div>))}
        </div>
        <p className="text-[13px] text-stone-600 mt-3">At the frontier, the independent argmax is off by <Tex tex={`|e_t^{\\mathrm{ind}}| = ${vitWin.errIndep.toFixed(2)}\\ \\mathrm{BPM}`} /> while causal decoding is off by <Tex tex={`|e_t^{\\mathrm{vit}}| = ${vitWin.errVit.toFixed(2)}\\ \\mathrm{BPM}`} /> — the transition term pulls drifting per-window winners back to a plausible path.</p>
        <div className="grid lg:grid-cols-2 gap-4 mt-4">
          <div className="bg-stone-50 rounded-lg overflow-x-auto">
            <p className="px-4 py-2.5 font-semibold text-sm">Dynamic-programming table — window <Tex tex={`w_{${vitStep + 1}}`} /> {vitStep === 0 ? <>(<Tex tex="D_1(k) = E_1(k)" />, no predecessor)</> : <>(best predecessor from window <Tex tex={`w_{${vitStep}}`} />)</>}</p>
            <table className="w-full text-[13px]"><thead><tr className="text-left text-stone-500 border-b border-stone-200"><th className="px-4 py-2">Candidate <Tex tex="k" /></th><th><Tex tex="E_t(k)" /></th><th>Best predecessor <Tex tex="j" /> · <Tex tex="\Omega_t(j,k)" /></th><th><Tex tex="\tilde{D}_t(k)" /></th></tr></thead>
              <tbody>{dpRows.map((c, i) => <tr key={c.id} className={`border-b border-stone-100 ${c.causal ? 'bg-teal-50 font-semibold' : ''}`}><td className="px-4 py-2"><Tex tex={`${c.hr.toFixed(2)}\\ \\mathrm{BPM}`} /> {c.causal && <span className="text-teal-700 text-[11px]">← decoded <Tex tex="\hat{h}_t" /></span>}{c.independent && !c.causal && <span className="text-red-600 text-[11px]"> · indep. argmax</span>}</td><td><Tex tex={c.emissionCost.toFixed(2)} /></td><td>{vitStep === 0 || c.predBpm === null ? <Tex tex="\text{—}" /> : <Tex tex={`${c.predBpm.toFixed(2)}\\ \\mathrm{BPM} \\;\\to\\; ${c.transCost.toFixed(2)}`} />}</td><td><Tex tex={c.dpCost.toFixed(2)} /></td></tr>)}</tbody></table>
            <p className="px-4 py-2 text-[11px] text-stone-500"><Tex tex="\tilde{D}_t(k)" /> is the per-window normalised DP cost (best path <Tex tex="= 0" />). Predicted error for the decoded pick: <Tex tex={`${(dpRows.find(c => c.causal)?.predErr ?? 0).toFixed(2)}\\ \\mathrm{BPM}`} />.</p>
          </div>
          <div>
            <figure className="figure"><ReplayTimeline windows={REPLAY.windows} upto={vitStep} /></figure>
            <div className="grid grid-cols-3 gap-3 mt-3 text-center">
              {[['Independent argmax', `${(REPLAY.windows.slice(0, vitStep + 1).reduce((s, w) => s + w.errIndep, 0) / (vitStep + 1)).toFixed(2)} BPM`, C.red], ['+ Causal Viterbi', `${(REPLAY.windows.slice(0, vitStep + 1).reduce((s, w) => s + w.errVit, 0) / (vitStep + 1)).toFixed(2)} BPM`, C.teal], ['Windows decoded', `${vitStep + 1} / ${REPLAY.windows.length}`, C.ink]].map(([k, v, col]) => (
                <div key={k} className="bg-stone-50 rounded-lg py-3"><p className="font-serif text-xl font-medium" style={{ color: col as string }}><Tex tex={toTexExpr(v)} /></p><p className="text-[11px] text-stone-500 mt-0.5">{k} MAE so far</p></div>))}
            </div>
            <p className="text-[12px] text-stone-500 mt-3">Paper (primary, <Tex tex="5" /> seeds): scoring alone <Tex tex="12.94 \to" /> <b className="text-teal-700"><Tex tex="10.91\ \mathrm{BPM}" /></b> motion MAE after causal decoding. Fixed-run ablation: causal <Tex tex="10.66" /> vs. full-sequence <Tex tex="10.88\ \mathrm{BPM}" />.</p>
          </div>
        </div>
      </article>

      {/* ── STAGE 5 ── */}
      <article id="stage5" className="scroll-mt-36 border-t border-stone-200 pt-10 mt-12">
        <h3 className="font-serif text-2xl font-medium"><span style={{ color: C.amber }}>Stage 5 ·</span> Reliability-Aware Reporting</h3>
        <p className="text-stone-600 mt-2 max-w-3xl text-[15px] leading-relaxed">The estimation layer always produces a value — but under heavy motion, every candidate may be wrong. An HGB reliability model (<MathNumbers text="44–57" /> PPG-quality / disagreement / dispersion features; <Tex tex="\mathrm{AUC}" /> <Tex tex="0.898" /> for detecting error <Tex tex="> 10\ \mathrm{BPM}" />) feeds a <b>learned finite-state policy</b>, solved by value iteration, over (discretized reliability <Tex tex="\times" /> consecutive holds). Switch policies and watch coverage and decisions change.</p>
        <div className="flex flex-wrap gap-2 mt-4">
          {(Object.keys(POLICIES) as PolicyKey[]).map(k => <button key={k} onClick={() => setPolicy(k)} className={`px-4 py-2 rounded-full text-[13px] font-semibold border transition ${policy === k ? 'bg-amber-600 text-white border-amber-600' : 'border-stone-300 text-stone-600 hover:border-amber-500'}`}><Tex tex={`\\lambda_{\\mathrm{rej}} = ${POLICIES[k].lambda}`} /> · {POLICIES[k].suffix}</button>)}
        </div>
        <div className="grid md:grid-cols-4 gap-3 mt-4 text-center">
          {([
            ['Reported coverage (paper, motion)', <Tex tex={toTexExpr(POLICIES[policy].coverage)} />],
            ['Reported-window MAE (paper)', <Tex tex={toTexExpr(POLICIES[policy].motionMAE)} />],
            ['Windows reported here (replay)', <Tex tex={`${reportedCount} / ${REPLAY.windows.length}`} />],
            [<span>Reject cost <Tex tex="\lambda_{\mathrm{rej}}" /></span>, <Tex tex={String(POLICIES[policy].lambda)} />],
          ] as [React.ReactNode, React.ReactNode][]).map(([k, v], i) => (
            <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg py-3 px-2"><p className="font-serif text-xl font-medium text-stone-900">{v}</p><p className="text-[11px] text-stone-500 mt-0.5">{k}</p></div>))}
        </div>
        <p className="text-[13px] text-stone-600 mt-2">{POLICIES[policy].note}</p>
        <p className="text-[12px] text-stone-500 mt-1">Below, the selected policy is applied to the Stage 4 replay.</p>
        <figure className="figure mt-4">
          <p className="font-semibold text-sm mb-1">Reliability per window — click a bar to inspect its features</p>
          <ReliabilityChart windows={REPLAY.windows} thresh={POLICIES[policy].thresh} decisions={decisions} selected={relSel} onSelect={setRelSel} />
          <div className="flex flex-wrap gap-4 mt-2 text-[12px] font-semibold"><span className="text-teal-700">■ Accept — report current estimate</span><span className="text-amber-700">■ Hold — retain last trusted HR</span><span className="text-red-600">■ Reject — withhold measurement</span></div>
        </figure>
        <div className="grid lg:grid-cols-2 gap-4 mt-4">
          <div className="figure">
            <p className="font-semibold text-sm">Reliability features — window <Tex tex={`w_{${relSel + 1}}`} /> ({relWin.isMotion ? 'deep-squat' : 'static'}) · decision: <span className={decisions[relSel].d === 'accept' ? 'text-teal-700' : decisions[relSel].d === 'hold' ? 'text-amber-700' : 'text-red-600'}>{decisions[relSel].d}</span></p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3 text-[13px]">
              {([['Reliability', `r_t = ${relWin.reliability.toFixed(2)}`], ['Candidate dispersion', `\\sigma_{\\mathrm{cand}} = ${relWin.relFeats.cand_std.toFixed(2)}\\ \\mathrm{BPM}`], ['Consensus @5 BPM', `\\rho_{5} = ${relWin.relFeats.consensus_5bpm.toFixed(2)}`], ['Consensus @10 BPM', `\\rho_{10} = ${relWin.relFeats.consensus_10bpm.toFixed(2)}`], ['Mean candidate quality', `\\bar{q} = ${relWin.relFeats.quality_mean.toFixed(2)}`], ['Near-prediction spread', `\\sigma_{\\mathrm{near}} = ${relWin.relFeats.near_pred_std.toFixed(2)}\\ \\mathrm{BPM}`], ['Valid candidates', `n_t = ${Math.round(relWin.relFeats.valid_count)}`], ['Decoded HR', `\\hat{h}_t = ${relWin.viterbiHR.toFixed(2)}\\ \\mathrm{BPM}`], ['Abs. error (eval)', `|e_t| = ${relWin.errVit.toFixed(2)}\\ \\mathrm{BPM}`]] as [string, string][]).map(([k, v]) => (
                <div key={k} className="bg-stone-50 rounded-lg p-2.5"><p className="text-[11px] text-stone-500">{k.includes('@') ? <>Consensus @<Tex tex={`${k.split('@')[1].trim().replace(' BPM', '')}\\ \\mathrm{BPM}`} /></> : k}</p><p className="font-semibold text-stone-800 mt-0.5"><Tex tex={v} /></p></div>))}
            </div>
            <p className="text-[12px] text-stone-500 mt-3">Reading: motion windows collapse consensus (<Tex tex="\rho_{5}" /> falls from <Tex tex="0.30" /> to <Tex tex="0.05\text{–}0.07" />) and inflate dispersion — the pattern the reliability model reads to withhold the window.</p>
          </div>
          <div>
            <figure className="figure"><ReplayTimeline windows={REPLAY.windows} upto={REPLAY.windows.length - 1} decisions={decisions} /></figure>
            <div className="flex items-center gap-2 mt-3 text-[12px] text-stone-600 flex-wrap">
              <span className="font-semibold">Policy state machine:</span>
              <span className="px-2.5 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-800 font-semibold">accept</span><span><Tex tex="\to" /></span>
              <span className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 font-semibold">hold <Tex tex="\times\, m_t" /></span><span><Tex tex="\to" /></span>
              <span className="px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 font-semibold">reject</span>
              <span>over (discretised <Tex tex="r_t" /> <Tex tex="\times" /> consecutive holds <Tex tex="m_t" />), solved by value iteration with reject cost <Tex tex="\lambda_{\mathrm{rej}}" />.</span>
            </div>
          </div>
        </div>
      </article>
    </section>
  )
}

// KaTeX typeset label inside SVG (foreignObject), centred on (x, y).
function SvgMath({ x, y, w, tex, color, size = 10, bold = false }: { x: number; y: number; w: number; tex: string; color: string; size?: number; bold?: boolean }) {
  return (
    <foreignObject x={x - w / 2} y={y} width={w} height={18} style={{ overflow: 'visible', pointerEvents: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'center', color, fontSize: size, fontWeight: bold ? 700 : 600, whiteSpace: 'nowrap' }}><Tex tex={tex} /></div>
    </foreignObject>
  )
}

// ══════════════ EVALUATION ══════════════
function Evaluation() {
  const [covIdx, setCovIdx] = useState(3)
  const [showOverall, setShowOverall] = useState(false)
  const CW = 560, CH = 260, CX = (c: number) => 52 + ((100 - c) / 75) * (CW - 80), CY = (m: number) => CH - 36 - (m / 11) * (CH - 60)
  return (
    <section id="evaluation" className="max-w-6xl mx-auto px-5 py-16 scroll-mt-16">
      <SectionHead kicker="Published results" title="Evaluation" lede="Published results from the paper's motion-focused ring evaluation." />

      <div className="rounded-[10px] border border-stone-200 bg-white p-5">
        <h3 className="font-serif text-xl font-medium">Motion-robust HR estimation — Table <Tex tex="1" /> (<Tex tex="\mathrm{MAE,\ BPM}" />)</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[13px]"><thead><tr className="text-left text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200"><th className="px-4 py-2.5">Configuration</th><th className="px-2 py-2.5">Static</th><th className="px-2 py-2.5">Motion</th><th className="px-2 py-2.5">Overall</th></tr></thead>
            <tbody>{PUBLISHED.motionTable.map(r => <tr key={r.method} className={`border-t border-stone-100 ${r.method.includes('CITRUS') ? 'bg-teal-50 font-semibold' : ''}`}><td className="px-4 py-2.5">{r.method}</td><td className="px-2"><Tex tex={toTexExpr(r.static)} /></td><td className="px-2"><Tex tex={r.motion.toFixed(2)} /></td><td className="px-2"><Tex tex={toTexExpr(r.overall)} /></td></tr>)}</tbody></table>
        </div>
        <p className="text-[11px] text-stone-500 mt-3 pt-3 border-t border-stone-100"><Tex tex="\pm" /> = std over <Tex tex="5" /> seeds where reported.</p>
      </div>
      <p className="text-sm bg-teal-50 border border-teal-200 text-teal-900 rounded-[10px] px-4 py-3 mt-4"><b className="font-serif text-2xl"><Tex tex="-24\%" /></b> <span className="ml-1">motion MAE vs. the LSTM baseline (<Tex tex="14.39 \to 10.91\ \mathrm{BPM}" />). Static MAE reaches <Tex tex="2.63\ \mathrm{BPM}" />.</span></p>

      {/* Matched pair: identical shell, header, body and footer rows — only the fill differs (light = interactive figure, dark = headline result). */}
      <div className="grid lg:grid-cols-2 gap-8 mt-12 items-stretch">
        <div className="rounded-[10px] border border-stone-200 bg-white p-5 flex flex-col h-full">
          <div className="min-h-[76px]">
            <h3 className="font-serif text-xl font-medium">Coverage–accuracy trade-off — Figure <Tex tex="2" /> (interactive)</h3>
            <p className="text-sm text-stone-600 mt-1">Click an operating point. Lower coverage = high-confidence spot checks, not full monitoring.</p>
          </div>
          <div className="flex-1 flex items-center">
            <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full h-auto rounded-lg bg-white" role="img" aria-label="Coverage versus MAE operating points">
              {[0, 3, 6, 9].map(m => <g key={m}><line x1={48} x2={CW - 20} y1={CY(m)} y2={CY(m)} stroke={C.grid} /><SvgMath x={38} y={CY(m) - 7} w={28} tex={String(m)} color={C.mute} /></g>)}
              {showOverall && <path d={'M' + PUBLISHED.coverageOverall.map(p => `${CX(p.cov)},${CY(p.mae)}`).join(' L')} fill="none" stroke={C.mute} strokeWidth={1.6} strokeDasharray="4 3" />}
              <path d={'M' + PUBLISHED.coverage.map(p => `${CX(p.cov)},${CY(p.mae)}`).join(' L')} fill="none" stroke={C.amber} strokeWidth={2.4} />
              {PUBLISHED.coverage.map((p, i) => <g key={i} onClick={() => setCovIdx(i)} className="cursor-pointer"><circle cx={CX(p.cov)} cy={CY(p.mae)} r={i === covIdx ? 9 : 6} fill={i === covIdx ? C.amber : '#fff'} stroke={C.amber} strokeWidth={2.4} /><SvgMath x={CX(p.cov)} y={CY(p.mae) - 22} w={76} tex={`${p.cov}\\% \\cdot ${p.mae}`} color={C.amber} bold /></g>)}
            </svg>
          </div>
          <div className="mt-auto pt-3 border-t border-stone-100">
            <p className="text-[13px] text-stone-700">Selected: <b className="text-amber-700"><Tex tex={`${PUBLISHED.coverage[covIdx].cov}\\%`} /> coverage · <Tex tex={`${PUBLISHED.coverage[covIdx].mae.toFixed(2)}\\ \\mathrm{BPM}`} /> MAE</b> <span className="text-stone-400">(motion windows)</span></p>
            <p className="figcap">Reported-window coverage (motion windows) <Tex tex="\to" /> · MAE (<Tex tex="\mathrm{BPM}" />) <Tex tex="\uparrow" /></p>
            <label className="flex items-center gap-2 text-[13px] mt-2 cursor-pointer"><input type="checkbox" checked={showOverall} onChange={() => setShowOverall(!showOverall)} className="accent-amber-600" /> Show overall curve (static + motion)</label>
          </div>
        </div>
        <div className="rounded-[10px] border border-stone-900 bg-stone-900 text-white p-5 flex flex-col h-full">
          <div className="min-h-[76px]">
            <h3 className="font-serif text-xl font-medium text-white">Sustained-motion stress test</h3>
            <p className="text-sm text-stone-400 mt-1">The heavy-tailed regime behind Figure <Tex tex="2" /> — why selective reporting exists.</p>
          </div>
          <div className="flex-1 flex flex-col justify-center">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><p className="font-serif text-[20px] leading-snug font-medium whitespace-nowrap"><Tex tex="17.65 \to 15.30" /></p><p className="text-[11px] text-stone-400 mt-1">MAE (<Tex tex="\mathrm{BPM}" />), HGB baseline <Tex tex="\to" /> + Viterbi</p></div>
              <div><p className="font-serif text-[20px] leading-snug font-medium whitespace-nowrap"><Tex tex="0.631 \to 0.724" /></p><p className="text-[11px] text-stone-400 mt-1">Pearson <Tex tex="r" /></p></div>
              <div><p className="font-serif text-[20px] leading-snug font-medium whitespace-nowrap"><Tex tex="40.04" /></p><p className="text-[11px] text-stone-400 mt-1">Baseline <Tex tex="\mathrm{P90}" /> error (<Tex tex="\mathrm{BPM}" />) — heavy-tailed</p></div>
            </div>
          </div>
          <div className="mt-auto pt-3 border-t border-white/10">
            <p className="text-[13px] text-stone-300">Improvement: <b className="text-white"><Tex tex="-2.35\ \mathrm{BPM}" /> MAE</b> <span className="text-stone-400">from causal decoding alone, before any window is withheld.</span></p>
            <p className="text-[12px] text-stone-400 mt-2">Heavy-tailed errors motivate temporal decoding and selective reporting.</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-8 mt-12 items-start">
        <div className="rounded-[10px] border border-stone-200 bg-white p-5">
          <h3 className="font-serif text-xl font-medium">Ablations — Table <Tex tex="2" /></h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-[13px]"><thead><tr className="text-left text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200"><th className="px-4 py-2.5">Ablation</th><th className="px-2 py-2.5 text-right">Effect</th></tr></thead>
              <tbody>{PUBLISHED.ablations.map(a => <tr key={a.ablation} className="border-t border-stone-100 align-top"><td className="px-4 py-2.5"><b className="text-stone-800">{a.module}:</b> <span className="text-stone-600"><MathNumbers text={a.ablation} /></span><p className="text-[12px] text-stone-500 mt-1 leading-relaxed"><MathNumbers text={a.detail} /></p></td><td className="px-2 py-2.5 text-right text-teal-800 font-semibold min-w-[130px]"><MathNumbers text={a.result.replace('Δ', 'Δ ')} /></td></tr>)}</tbody></table>
          </div>
        </div>
        <div className="rounded-[10px] border border-stone-200 bg-white p-5">
          <h3 className="font-serif text-xl font-medium">Deployment — ESP32-S3 inference core</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-[13px]"><thead><tr className="text-left text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200"><th className="px-4 py-2.5">Metric</th><th className="px-2 py-2.5 text-right">Value</th></tr></thead>
              <tbody>{[[ 'Mean latency / window', PUBLISHED.deploy.latency], ['Median latency / window', PUBLISHED.deploy.median], ['p95 latency', PUBLISHED.deploy.p95], ['Model storage', PUBLISHED.deploy.storage], ['Estimated energy / window', PUBLISHED.deploy.energy]].map(([k, v]) => <tr key={k} className="border-t border-stone-100"><td className="px-4 py-2.5 text-stone-600"><MathNumbers text={k} /></td><td className="px-2 py-2.5 text-right font-semibold text-stone-900 whitespace-nowrap"><MathNumbers text={v} /></td></tr>)}</tbody></table>
          </div>
          <p className="text-[12px] text-stone-500 mt-3 pt-3 border-t border-stone-100">On-device selections match desktop; a live-sensing prototype streams waveforms and beat events to a browser UI.</p>
        </div>
      </div>
    </section>
  )
}

// ══════════════ PAPER ══════════════
const BIB = `@inproceedings{wang2026citrus,
  title     = {CITRUS: Candidate Inference, Temporal Decoding, and
               Reliability-Gated Reporting for Wearable Devices},
  author    = {Wang, Yi and Liang, Siyuan and Wang, Yuntao},
  booktitle = {Companion of the 2026 ACM International Joint Conference
               on Pervasive and Ubiquitous Computing (UbiComp Companion '26)},
  year      = {2026},
  publisher = {ACM},
  isbn      = {979-8-4007-2533-3/2026/10}
}`
function Paper() {
  const [copied, setCopied] = useState(false)
  return (
    <section id="paper" className="bg-stone-50 border-t border-stone-200 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-5 py-16 grid lg:grid-cols-[1.2fr_1fr] gap-10">
        <div className="min-w-0">
          <SectionHead kicker="Paper & Resources" title="CITRUS at UbiComp Companion ’26" />
          <p className="text-[15px] text-stone-700 leading-relaxed"><b>Abstract.</b> Wearable photoplethysmography (PPG) enables continuous heart-rate (HR) monitoring on consumer devices, but motion artifacts introduce frequency-domain ambiguity: during exercise, the dominant spectral component may correspond to limb movement rather than the true pulse. This paper presents CITRUS, a two-layer system that decomposes motion-robust HR monitoring into estimation (candidate selection + causal Viterbi decoding) and reporting (reliability scoring + accept/hold/reject policy). The platform benchmark contains <MathNumbers text="54 participants and 49.76 h" /> of recordings against clinical references; the motion-focused ring-PPG evaluation uses <MathNumbers text="31 subjects" />. On this subset, the estimation layer reduces motion-window Mean Absolute Error (MAE) from <Tex tex="14.39" /> to <Tex tex="10.91" /> beats per minute (BPM). We additionally develop an ESP32-S3 real-time prototype for live PPG acquisition, on-device filtering, beat-event extraction, and browser visualization. We deploy the feature-vector CITRUS inference core—candidate scoring, causal decoding, and reliability estimation—on the ESP32-S3, averaging <MathNumbers text="156.429 ms" /> per window with <MathNumbers text="145,280 B" /> model storage.</p>
          <div className="mt-5 space-y-2 text-sm">
            {[['Yi Wang', 'The Hong Kong University of Science and Technology (Guangzhou) — ywang183@connect.hkust-gz.edu.cn'], ['Siyuan Liang', 'Cornell University, Ithaca, NY — sl3595@cornell.edu'], ['Yuntao Wang', 'Tsinghua University, Beijing — yuntaowang@tsinghua.edu.cn (corresponding author)']].map(([n, a]) => (
              <p key={n}><b className="text-stone-800">{n}</b> <span className="text-stone-500">· {a}</span></p>))}
          </div>
          <p className="text-sm text-stone-500 mt-4">Companion of the 2026 ACM International Joint Conference on Pervasive and Ubiquitous Computing · October 11–15, 2026 · Shanghai, China · 5 pages · CC BY 4.0</p>
          <div className="flex flex-wrap gap-2.5 mt-5">
            <a href="/citrus.pdf" className="px-5 py-2.5 rounded-full bg-blue-700 text-white text-sm font-semibold hover:bg-blue-800">Read the paper (PDF)</a>
            <span className="px-5 py-2.5 rounded-full border border-dashed border-stone-300 text-sm text-stone-400">Code / data: see reference/</span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="font-serif font-medium text-lg mb-2">Cite this work</p>
          <div className="relative">
            <pre className="bg-stone-900 text-stone-200 text-[12px] leading-relaxed rounded-lg p-4 overflow-x-auto">{BIB}</pre>
            <button onClick={() => { navigator.clipboard?.writeText(BIB); setCopied(true); setTimeout(() => setCopied(false), 1600) }} className="absolute top-3 right-3 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-[12px] font-semibold">{copied ? 'Copied ✓' : 'Copy BibTeX'}</button>
          </div>
        </div>
      </div>
    </section>
  )
}

// ══════════════ APP ══════════════
export default function App() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => { const f = () => setScrolled(window.scrollY > 10); window.addEventListener('scroll', f); return () => window.removeEventListener('scroll', f) }, [])
  return (
    <div className="min-h-screen bg-white text-stone-800 antialiased" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <nav className={`fixed top-0 inset-x-0 z-50 transition ${scrolled ? 'bg-white/92 backdrop-blur shadow-sm border-b border-stone-200' : 'bg-white/70 backdrop-blur'}`}>
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center gap-6">
          <button onClick={() => scrollTo('top')} className="font-serif font-medium text-xl tracking-tight text-stone-900">CITRUS<span className="text-blue-700">.</span></button>
          <div className="hidden md:flex gap-5 text-sm font-medium text-stone-600 ml-2">
            {[['Overview', 'top'], ['Interactive Demo', 'demo'], ['Evaluation', 'evaluation'], ['Paper', 'paper']].map(([l, id]) => <button key={id} onClick={() => scrollTo(id)} className="hover:text-blue-700 transition">{l}</button>)}
          </div>
          <div className="ml-auto flex gap-2">
            <a href="/citrus.pdf" className="px-4 py-1.5 rounded-full bg-stone-900 text-white text-[13px] font-semibold hover:bg-stone-700">Paper PDF</a>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header id="top" className="max-w-6xl mx-auto px-5 pt-28 pb-10 scroll-mt-20">
        <h1 className="font-serif text-[29px] sm:text-4xl md:text-[56px] leading-[1.12] font-medium text-stone-900 mt-4 max-w-4xl">CITRUS: Candidate Inference, Temporal Decoding, and Reliability-Gated Reporting for Wearable Devices</h1>
        <p className="font-serif text-xl md:text-2xl text-stone-500 mt-5">From noisy PPG signals to reliable heart-rate estimates.</p>
        <p className="text-sm text-stone-500">UbiComp Companion ’26 · Shanghai, China · Oct 11–15, 2026</p>
        <p className="mt-4 text-[15px]"><b>Yi Wang</b> <span className="text-stone-500">(HKUST Guangzhou)</span> · <b>Siyuan Liang</b> <span className="text-stone-500">(Cornell)</span> · <b>Yuntao Wang</b> <span className="text-stone-500">(Tsinghua, corresponding)</span></p>
        <div className="flex flex-wrap gap-2.5 mt-6">
          <button onClick={() => scrollTo('demo')} className="px-6 py-3 rounded-full bg-blue-700 text-white font-semibold text-sm hover:bg-blue-800 shadow-sm">Explore Interactive Demo ↓</button>
          <a href="/citrus.pdf" className="px-6 py-3 rounded-full border border-stone-300 font-semibold text-sm hover:border-blue-500">Paper PDF</a>
        </div>
        <figure className="figure mt-9"><img src="/citrus-hero.gif" width={1200} height={240} className="w-full h-auto block" alt="Animated CITRUS pipeline: noisy PPG and accelerometer scroll in, become about 140 candidate heart rates per window (motion cluster at 84 BPM, pulse cluster at 114 BPM), then a decoded heart-rate trace that is accepted, held, or rejected" /></figure>
        <div className="grid md:grid-cols-4 gap-6 mt-8">
          {[['−24%', 'motion MAE vs LSTM: 14.39 → 10.91 BPM', C.teal], ['≈140', 'candidate hypotheses per 30 s window', C.blue], ['2.90 BPM', 'reported MAE at 31% motion coverage', C.amber], ['156.4 ms', 'ESP32-S3 inference-core latency / window', C.ink]].map(([v, k, col]) => (
            <div key={k} className="border-t border-stone-200 pt-4"><p className="font-serif text-[26px] font-medium" style={{ color: col as string }}><Tex tex={toTexExpr(v)} /></p><p className="text-[12px] text-stone-500 mt-1 leading-snug"><MathNumbers text={k} /></p></div>))}
        </div>
      </header>

      <Playground />
      <Evaluation />
      <Paper />
      <footer className="max-w-6xl mx-auto px-5 py-8 border-t border-stone-200 flex flex-wrap gap-3 justify-between text-[12px] text-stone-400">
        <span>CITRUS · UbiComp Companion ’26 · CC BY 4.0</span>
        <span>Playground: recorded data · Evaluation: published results</span>
      </footer>
    </div>
  )
}
