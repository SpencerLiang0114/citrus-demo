import { useEffect, useMemo, useState } from 'react'
import { RECORDINGS, REPLAY, POLICIES, PUBLISHED, decide, fmtT, type Candidate, type PolicyKey } from './data'
import { SignalExplorer, PsdChart, ReplayViterbiGraph, ReplayTimeline, ReliabilityChart, clusterRepresentatives, C } from './components/Viz'
import { Tex, MathNumbers, toTexExpr } from './components/Math'

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/* Shared building blocks — one heading, stat, and caption pattern everywhere. */
const SectionHead = ({ kicker, title, lede }: { kicker?: string; title: string; lede?: React.ReactNode }) => (
  <div className="section-head">
    {kicker && <p className="kicker">{kicker}</p>}
    <h2>{title}</h2>
    {lede && <p className="lede">{lede}</p>}
  </div>
)
const StageHead = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <div className="stage-head">
    <span className="stage-num" aria-hidden="true">{n}</span>
    <div><h3><span className="stage-name">Stage {n} · </span>{title}</h3><p>{children}</p></div>
  </div>
)
const Stat = ({ label, children, tone }: { label: React.ReactNode; children: React.ReactNode; tone?: string }) => (
  <div className="stat"><p className="stat-label">{label}</p><p className="stat-value" style={tone ? { color: tone } : undefined}>{children}</p></div>
)
const FigCap = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <figcaption className="figcap"><strong>{label}</strong> {children}</figcaption>
)

// ══════════════ INTERACTIVE PLAYGROUND (shared state) ══════════════
function Playground() {
  const [recId, setRecId] = useState('squats')
  const rec = RECORDINGS.find(r => r.id === recId)!
  const [t, setT] = useState(15)
  const [playing, setPlaying] = useState(false)
  const [span, setSpan] = useState(30)
  const channels = { ir: true, red: true, acc: true, ref: true }
  const [selCand, setSelCand] = useState<Candidate | null>(null)
  const [scorer, setScorer] = useState<'MLP' | 'HGB'>('MLP')
  const [vitStep, setVitStep] = useState(0)
  const [vitPlaying, setVitPlaying] = useState(() => !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches))
  const goVitWindow = (i: number) => { setVitPlaying(false); setVitStep(Math.max(0, Math.min(REPLAY.windows.length - 1, i))) }
  const [cmp, setCmp] = useState({ indep: true, vit: true, gt: true })
  const [policy, setPolicy] = useState<PolicyKey>('l8')
  const [expandedCand, setExpandedCand] = useState<string | null>(null)
  const [relSel, setRelSel] = useState(2)

  const DUR = rec.windows.length * 30
  // Continuous playback: advance by real elapsed time each animation frame
  // (half the old 1 s-per-120 ms step rate, and no per-second jumps).
  useEffect(() => {
    if (!playing) return
    let raf = 0, last: number | null = null
    const RATE = 1000 / 240 // data-seconds per real second (half the previous rate)
    const frame = (now: number) => {
      if (last === null) last = now
      const dt = Math.min(now - last, 100); last = now // cap jumps after tab switches
      setT(v => { const n = v + (dt / 1000) * RATE; return n >= DUR ? n - DUR : n })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing, DUR])
  useEffect(() => { setSelCand(null); setVitStep(0) }, [recId])
  useEffect(() => {
    if (!vitPlaying) return
    const id = setInterval(() => setVitStep(s => (s >= REPLAY.windows.length - 1 ? 0 : s + 1)), 1400)
    return () => clearInterval(id)
  }, [vitPlaying])
  const winIdx = Math.min(rec.windows.length - 1, Math.floor(t / 30))
  const win = rec.windows[winIdx]
  const vitWin = REPLAY.windows[vitStep]
  const relWin = REPLAY.windows[relSel]

  const decisions = useMemo(() => {
    const out: { d: string; reported: number | null }[] = []; let held: number | null = null
    for (const w of REPLAY.windows) { const r = decide({ reliability: w.reliability, viterbiHR: w.viterbiHR } as never, POLICIES[policy].thresh, (out.at(-1)?.d as never) ?? null, held); if (r.d === 'accept') held = w.viterbiHR; out.push(r) }
    return out
  }, [policy])
  const reportedCount = decisions.filter(d => d.reported !== null).length
  const dpRows = [...vitWin.candidates].sort((a, b) => a.dpCost - b.dpCost).slice(0, 5)

  return (
    <section id="demo" className="section scroll-mt-16">
      <SectionHead kicker="Interactive demo" title="The algorithm playground" lede="Five stages, one shared timeline. Scrub or play the recording and every stage below updates from the same window — then replay five windows in sequence through the decoder and the reporting policy." />

      {/* Shared controls: recording, transport, scrubber */}
      <div className="control-bar">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Recording">
            {RECORDINGS.map(r => <button key={r.id} aria-pressed={recId === r.id} onClick={() => { setRecId(r.id); setT(15) }} className="pill">{r.label}</button>)}
          </div>
          <span className="text-xs text-stone-500">{rec.sub} · {rec.motion}</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setPlaying(!playing)} className="btn btn-primary btn-sm">{playing ? '❚❚ Pause' : '▶ Play'}</button>
            <span className="font-mono text-[13px] text-stone-700 w-20 text-center">{fmtT(t)} / {fmtT(DUR)}</span>
          </div>
        </div>
        <input type="range" min={0} max={DUR - 1} step={0.05} value={t} onChange={e => setT(+e.target.value)} className="range mt-1" aria-label="Scrub timeline" />
        <p className="text-[11px] text-stone-500">Window <Tex tex={`${winIdx + 1} \\;/\\; ${rec.windows.length}`} /> · <Tex tex="30\ \mathrm{s}" /> windows · reference HR in window: <b className="text-teal-700"><Tex tex={`${win.trueHR.toFixed(2)}\\ \\mathrm{BPM}`} /></b> (evaluation only)</p>
      </div>

      <nav className="stepper mb-2" aria-label="Playground stages">
        {['PPG signal explorer', 'Candidate generation', 'Candidate scoring', 'Causal Viterbi decoding', 'Reliability reporting'].map((label, i) => (
          <button key={label} onClick={() => scrollTo(`stage${i + 1}`)}><span className="n">{i + 1}</span>{label}</button>
        ))}
      </nav>

      {/* ── STAGE 1 ── */}
      <article id="stage1" className="stage">
        <StageHead n={1} title="PPG signal explorer">Ring PPG (infrared + red, <Tex tex="\approx 100\ \mathrm{Hz}" />) and accelerometer, on the same clock — shown after preprocessing: every channel band-passed <Tex tex="0.55\text{–}4\ \mathrm{Hz}" /> (3rd-order Butterworth, zero-phase, the filter candidate generation uses), with the three accelerometer axes <Tex tex="a_x, a_y, a_z" /> drawn separately. At rest the pulse is clear; during movement, artifacts overlap the cardiac band and the heart rate becomes ambiguous.</StageHead>
        <figure className="figure">
          <div className="fig-title"><span>Preprocessed signals</span><label className="fig-sub flex items-center gap-2">Zoom <input type="range" min={5} max={30} step={5} value={span} onChange={e => setSpan(+e.target.value)} className="range" style={{ width: 110 }} aria-label="Zoom, window length in seconds" /><span><Tex tex={`${span}\\ \\mathrm{s}`} /></span></label></div>
          <SignalExplorer rec={rec} t={t} span={span} channels={channels} onScrub={setT} />
          <FigCap label="Stage 1 · Signals.">Hover for the nearest sample; click to move the cursor (dark line). The three accelerometer axes are overlaid on one common scale in a single lane. All five channels are band-passed (applied to the full <Tex tex="30\ \mathrm{s}" /> window for display; the pipeline filters its selected <Tex tex="4\ \mathrm{s}" /> slices) — for the accelerometer axes this removes the gravity/orientation offset. The motion statistics below are computed from raw <Tex tex="|a|" />, as in slice selection.</FigCap>
        </figure>
        <div className="stat-grid sm:grid-cols-3">
          <Stat label="Motion amplitude"><Tex tex={`\\sigma_{|a|} = ${win.motionAmp.toFixed(2)}`} /> <span className="font-normal text-stone-500">(ACC magnitude std, stored counts)</span></Stat>
          <Stat label="Motion frequency">{win.motionFreqBPM ? <Tex tex={`${win.motionFreqBPM.toFixed(2)}\\ \\mathrm{BPM\\text{-}equiv.}`} /> : <Tex tex="\text{—}" />}</Stat>
          <Stat label="Accelerometer role">Segment selection</Stat>
        </div>
      </article>

      {/* ── STAGE 2 ── */}
      <article id="stage2" className="stage">
        <StageHead n={2} title="Candidate generation">Each <Tex tex="30\ \mathrm{s}" /> window yields <b>≈140 candidates</b> from three estimator families — Welch PSD peaks, autocorrelation peaks, peak-interval estimates — expanded with harmonic variants (<Tex tex="0.5\times,\ 1\times,\ 2\times" />) and filtered to <Tex tex="[35,\,220]\ \mathrm{BPM}" />. Nearby hypotheses are grouped into one marker (<Tex tex="\text{×}n" /> = <Tex tex="n" /> candidates).</StageHead>
        <figure className="figure">
          <div className="fig-title"><span>Spectrum and candidates, current window</span><span className="fig-sub">Click a marker or chip to inspect it</span></div>
          <PsdChart rec={rec} win={win} sel={selCand} onSel={setSelCand} />
          <div className="flex flex-wrap gap-1.5 mt-3" aria-label="Candidate clusters">
            {clusterRepresentatives(win.candidates).map(({ rep: c, count }, i) => (
              <button key={c.id} aria-pressed={selCand?.id === c.id} onClick={() => setSelCand(c)} className="chip">
                <span className="text-stone-400"><Tex tex={`\\#${i + 1}`} /></span> <Tex tex={`${c.hr.toFixed(2)}\\ \\mathrm{BPM}`} /> <span className="text-stone-400">· {c.method}{count > 1 ? ` · ×${count}` : ''}</span>
              </button>))}
          </div>
          {selCand && (
            <div className="callout callout-blue mt-3 grid md:grid-cols-5 gap-3 text-sm" role="status">
              <div><p className="text-[11px] font-semibold text-blue-800">Candidate</p><p className="font-serif text-2xl font-medium"><Tex tex={`${selCand.hr.toFixed(2)}\\ \\mathrm{BPM}`} /></p></div>
              <div><p className="text-[11px] font-semibold text-blue-800">Source</p><p>{selCand.method} · {selCand.channel} channel</p></div>
              <div><p className="text-[11px] font-semibold text-blue-800">Spectral evidence</p><p>relative power <Tex tex={`${(selCand.power * 100).toFixed(2)}\\%`} /></p></div>
              <div><p className="text-[11px] font-semibold text-blue-800">Harmonic</p><p><Tex tex={selCand.harmonic === '—' ? '\\text{—}' : selCand.harmonic.replace('×', '\\times')} /> variant{selCand.isMotionPeak ? ' · motion peak' : ''}</p></div>
              <div><p className="text-[11px] font-semibold text-blue-800">vs. reference</p><p className={Math.abs(selCand.hr - win.trueHR) <= 5 ? 'text-teal-700 font-semibold' : 'text-red-600 font-semibold'}><Tex tex={`${selCand.hr - win.trueHR >= 0 ? '+' : ''}${(selCand.hr - win.trueHR).toFixed(2)}\\ \\mathrm{BPM}`} /> {Math.abs(selCand.hr - win.trueHR) <= 5 ? '(plausible pulse)' : '(likely artifact / harmonic)'}</p></div>
            </div>
          )}
          <FigCap label="Stage 2 · Candidates.">Solid fill is the Welch PSD (IR / red); dashed amber is autocorrelation. Under motion the <span className="text-red-600 font-semibold">tallest peak is limb-motion frequency</span>, not the pulse — the ambiguity CITRUS resolves by scoring every hypothesis instead of picking the maximum. One marker per <Tex tex="2.5\ \mathrm{BPM}" /> cluster, up to six.</FigCap>
        </figure>
      </article>

      {/* ── STAGE 3 ── */}
      <article id="stage3" className="stage">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-[260px]">
            <StageHead n={3} title="Candidate scoring">A learned ranker scores every candidate from structured features — spectral power, estimator consensus, harmonic status, source, and distance to the previous decoded HR — trained with soft targets centred on the reference HR. Click a bar to expand its feature breakdown.</StageHead>
          </div>
          <div className="seg" role="group" aria-label="Candidate scorer">
            {(['MLP', 'HGB'] as const).map(s => <button key={s} aria-pressed={scorer === s} onClick={() => { setScorer(s); setExpandedCand(null) }}>{s} scorer</button>)}
          </div>
        </div>
        <div key={scorer} className="scorer-swap">
          <p className={`callout mt-1 ${scorer === 'MLP' ? 'callout-violet' : 'callout-amber'}`}>{scorer === 'MLP' ? 'MLP scorer — the paper’s primary configuration, retrained on the recorded candidates.' : 'HGB scorer — used for the stress test and on-device deployment. Scores below are for the current window.'}</p>
          <figure className="figure mt-6">
            <div className="fig-title"><span style={{ color: scorer === 'MLP' ? '#6d28d9' : C.blue }}>{scorer} ranking — this window</span><span className="fig-sub">Click a bar for its feature breakdown</span></div>
            <div className="space-y-1.5">
              {(scorer === 'HGB' ? win.candidates.slice(0, 8) : [...win.candidates].sort((a, b) => b.mlpScore - a.mlpScore).slice(0, 8)).map((c, i) => {
                const score = scorer === 'HGB' ? c.score : c.mlpScore
                const bar = c.isMotionPeak ? C.red : scorer === 'MLP' ? '#7c3aed' : C.blue
                return (
                  <div key={c.id}>
                    <button onClick={() => setExpandedCand(expandedCand === c.id ? null : c.id)} aria-expanded={expandedCand === c.id} className="row-btn">
                      <span className="text-xs text-stone-400 w-5"><Tex tex={`\\#${i + 1}`} /></span>
                      <span className={`font-bold w-20 ${c.isMotionPeak ? 'text-red-600' : 'text-stone-800'}`}><Tex tex={`${c.hr.toFixed(2)}\\ \\mathrm{BPM}`} /></span>
                      <span className="meter"><span style={{ width: `${score * 100}%`, background: bar }} /></span>
                      <span className="text-xs w-14 text-right"><Tex tex={score.toFixed(2)} /></span>
                      <span className="text-[11px] text-stone-500 w-36 hidden md:block">{c.method} · {c.channel} · <Tex tex={c.harmonic === '—' ? '\\text{—}' : c.harmonic.replace('×', '\\times')} /></span>
                      <span className="text-[11px] font-semibold w-20 text-right hidden sm:block">{Math.abs(c.hr - win.trueHR) <= 5 ? <span className="text-teal-700">near ref</span> : c.isMotionPeak ? <span className="text-red-600">motion peak</span> : ''}</span>
                    </button>
                    {expandedCand === c.id && (
                      <div className="mx-1 px-4 py-3 bg-stone-50 rounded-b-[10px] grid grid-cols-2 md:grid-cols-5 gap-3 text-[12px]">
                        {([['Spectral quality', c.feats.spectral], ['Consensus density @5 BPM', c.feats.consensus], ['Consensus density @10 BPM', c.feats.harmonic], ['Weighted density @10 BPM', c.feats.source], ['Channel quality', c.feats.temporal]] as const).map(([k, v]) => (
                          <div key={k}><p className="text-stone-500">{k.includes('@') ? <>{k.split('@')[0]}@<Tex tex={`${k.split('@')[1].trim().replace(' BPM', '')}\\ \\mathrm{BPM}`} /></> : k}</p><div className="meter-sm"><div style={{ width: `${v * 100}%`, background: bar }} /></div><p className="mt-0.5"><Tex tex={v.toFixed(2)} /></p></div>))}
                        <p className="col-span-full text-stone-500">{scorer === 'HGB' ? <>Candidate cost <Tex tex="E_t(k)" /> <Tex tex={`= ${(c.cost).toFixed(2)}`} /> (−log emission probability from the HGB scorer) — passed to the Viterbi decoder in Stage 4.</> : <>MLP score <Tex tex={`= ${c.mlpScore.toFixed(2)}`} /> — predicted soft target, normalised per window.</>}</p>
                      </div>)}
                  </div>
                )
              })}
            </div>
            <FigCap label={`Stage 3 · ${scorer} scores.`}>{scorer === 'HGB' ? 'Bars are normalised HGB scores for the eight candidates shown; red marks the motion peak. Expanded rows show the five structured features behind each score.' : 'Bars are normalised MLP scores, best first; red marks the motion peak. The ranker has no access to the reference — “near ref” is shown for evaluation only.'}</FigCap>
          </figure>
          {scorer === 'MLP' && (
            <div className="stat-grid md:grid-cols-3">
              {[['MLP scorer', 'Soft-target MLP', 'Retrained on the stored candidates, following the paper’s recipe.'], ['Primary evaluation', 'Headline results', 'The configuration behind the motion results in Evaluation below.'], ['Motion MAE, scoring → + Viterbi', '12.94 → 10.91 BPM', 'Paper result: per-window scoring, then causal decoding.']].map(([k, v, d]) => (
                <div key={k} className="stat" style={{ background: '#f5f3ff' }}><p className="stat-label" style={{ color: '#6d28d9' }}>{k}</p><p className="font-serif text-lg font-medium text-stone-900 mt-0.5">{v}</p><p className="text-stone-500 mt-1 text-[12px] leading-relaxed">{d}</p></div>
              ))}
            </div>
          )}
        </div>
      </article>

      {/* ── STAGE 4 ── */}
      <article id="stage4" className="stage">
        <StageHead n={4} title="Causal Viterbi decoding">Per-window winners can still jump implausibly. CITRUS runs an <b>online</b> Viterbi recursion: when window <Tex tex="t" /> arrives, it extends only paths ending at <Tex tex="t-1" /> — no future windows, no backward smoothing — so it deploys in real time. One step below advances to the next window (<Tex tex={`w_t \\to w_{t+1}`} />, <Tex tex={`${REPLAY.windows.length}`} /> steps in total); pause to step by hand.</StageHead>
        <p className="callout callout-teal max-w-3xl">Sequential replay: five consecutive windows — two static, three in deep squats — decoded causally as they arrive.</p>
        <div className="panel-dark mt-6 text-center overflow-x-auto">
          <p className="text-lg md:text-xl whitespace-nowrap"><Tex tex="D_t(k) = E_t(k) + \min_{j}\bigl[\, D_{t-1}(j) + \Omega_t(j,\,k) \,\bigr], \qquad E_t(k) = -\log p_t(k)" /></p>
          <p className="text-stone-400 text-[13px] mt-2 whitespace-nowrap"><Tex tex="\Omega_t(j,k) = \lambda_{\mathrm{tr}} \min\!\Bigl\{\bigl(\Delta_{jk}/\sigma_{jk}\bigr)^{2},\, 9\Bigr\} + 0.25\Bigl(\max\{0,\, \Delta_{jk}-\tau_{jk}\}/\tau_{jk}\Bigr)^{2}" /> <span className="ml-2">with</span> <Tex tex="\lambda_{\mathrm{tr}} = 2.0" /> <span>and</span> <Tex tex="\Delta_{jk} = |h_t(k) - h_{t-1}(j)|" /></p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 mt-4">
          <button onClick={() => setVitPlaying(p => !p)} className="btn btn-primary btn-sm" aria-label={vitPlaying ? 'Pause decoder autoplay' : 'Play decoder autoplay'}>{vitPlaying ? '❚❚ Pause' : '▶ Play'}</button>
          <button onClick={() => goVitWindow(vitStep - 1)} className="btn btn-outline btn-sm" disabled={vitStep === 0}>← Prev window</button>
          <button onClick={() => goVitWindow(vitStep + 1)} className="btn btn-outline btn-sm" disabled={vitStep === REPLAY.windows.length - 1}>Step window →</button>
          <button onClick={() => { setVitPlaying(false); setVitStep(0) }} className="btn btn-outline btn-sm">Restart</button>
          <div className="step-track" role="group" aria-label="Decoder step progress">
            {REPLAY.windows.map((w, i) => (
              <button key={w.idx} onClick={() => goVitWindow(i)} title={`Window ${i + 1}`} aria-label={`Go to window ${i + 1}`} aria-current={i === vitStep ? 'step' : undefined}><span style={{ width: i <= vitStep ? '100%' : '0%' }} /></button>))}
          </div>
          <span className="text-[13px] whitespace-nowrap">step <Tex tex={`${vitStep + 1} \\;/\\; ${REPLAY.windows.length}`} /> · window <Tex tex={`t = ${vitStep + 1}`} /></span>
          <div className="flex gap-3 text-[12px] ml-auto">
            {([['indep', 'Independent', C.red], ['vit', 'Viterbi', C.teal], ['gt', 'Reference', C.ink]] as const).map(([k, l, col]) => <label key={k} className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={cmp[k]} onChange={() => setCmp({ ...cmp, [k]: !cmp[k] })} className="check" /><span style={{ color: col }} className="font-semibold">{l}</span></label>)}
          </div>
        </div>
        <figure className="figure mt-6">
          <div className="fig-title"><span>Candidate paths through the replay</span><span className="fig-sub">Dashed line marks the decoding frontier, window <Tex tex={`w_{${vitStep + 1}}`} /></span></div>
          <ReplayViterbiGraph windows={REPLAY.windows} upto={vitStep} showIndep={cmp.indep} showVit={cmp.vit} showGT={cmp.gt} />
          <div className="legend"><span><span className="sw" style={{ background: C.teal }} />Viterbi (causal)</span><span><span className="sw" style={{ background: C.red }} />Independent argmax</span><span><span className="sw" style={{ background: C.ink }} />Reference</span><span>○ top-5 candidates by <Tex tex="\tilde{D}_t(k)" /></span></div>
          <FigCap label="Stage 4 · Decoding.">Each column is one arriving window; only windows up to the frontier are decoded. The transition term pulls drifting per-window winners back to a physiologically plausible path.</FigCap>
        </figure>
        <div className="stat-grid grid-cols-2 md:grid-cols-5">
          <Stat label="Window"><Tex tex={`w_{${vitStep + 1}}\\ \\text{(${vitWin.isMotion ? 'deep-squat, motion' : 'spo2, static'})}`} /></Stat>
          <Stat label="Candidates"><Tex tex={`n_t = ${vitWin.candidates.length}`} /></Stat>
          <Stat label="Independent argmax"><Tex tex={`${vitWin.independentHR.toFixed(2)}\\ \\mathrm{BPM}`} /></Stat>
          <Stat label="Causal decoded" tone={C.teal}><Tex tex={`\\hat{h}_t = ${vitWin.viterbiHR.toFixed(2)}\\ \\mathrm{BPM}`} /></Stat>
          <Stat label="Reference"><Tex tex={`${vitWin.trueHR.toFixed(2)}\\ \\mathrm{BPM}`} /></Stat>
        </div>
        <p className="text-[13px] text-stone-600 mt-3 max-w-3xl leading-relaxed">At the frontier, the independent argmax is off by <Tex tex={`|e_t^{\\mathrm{ind}}| = ${vitWin.errIndep.toFixed(2)}\\ \\mathrm{BPM}`} /> while causal decoding is off by <Tex tex={`|e_t^{\\mathrm{vit}}| = ${vitWin.errVit.toFixed(2)}\\ \\mathrm{BPM}`} />.</p>
        <div className="grid lg:grid-cols-2 gap-4 mt-4 items-start">
          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <p className="px-4 py-3 font-semibold text-sm border-b border-stone-100">Dynamic-programming table — window <Tex tex={`w_{${vitStep + 1}}`} /> {vitStep === 0 ? <>(<Tex tex="D_1(k) = E_1(k)" />, no predecessor)</> : <>(best predecessor from window <Tex tex={`w_{${vitStep}}`} />)</>}</p>
            <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Candidate <Tex tex="k" /></th><th><Tex tex="E_t(k)" /></th><th>Best predecessor <Tex tex="j" /> · <Tex tex="\Omega_t(j,k)" /></th><th><Tex tex="\tilde{D}_t(k)" /></th></tr></thead>
              <tbody>{dpRows.map(c => <tr key={c.id} className={c.causal ? 'hl' : ''}><td><Tex tex={`${c.hr.toFixed(2)}\\ \\mathrm{BPM}`} /> {c.causal && <span className="text-teal-700 text-[11px]">← decoded <Tex tex="\hat{h}_t" /></span>}{c.independent && !c.causal && <span className="text-red-600 text-[11px]"> · indep. argmax</span>}</td><td><Tex tex={c.emissionCost.toFixed(2)} /></td><td>{vitStep === 0 || c.predBpm === null ? <Tex tex="\text{—}" /> : <Tex tex={`${c.predBpm.toFixed(2)}\\ \\mathrm{BPM} \\;\\to\\; ${c.transCost.toFixed(2)}`} />}</td><td><Tex tex={c.dpCost.toFixed(2)} /></td></tr>)}</tbody></table></div>
            <p className="px-4 py-3 text-[11px] text-stone-500 border-t border-stone-100"><Tex tex="\tilde{D}_t(k)" /> is the per-window normalised DP cost (best path <Tex tex="= 0" />). Predicted error for the decoded pick: <Tex tex={`${(dpRows.find(c => c.causal)?.predErr ?? 0).toFixed(2)}\\ \\mathrm{BPM}`} />.</p>
          </div>
          <figure className="figure">
            <div className="fig-title"><span>Decoded trace so far</span></div>
            <ReplayTimeline windows={REPLAY.windows} upto={vitStep} />
            <div className="stat-grid grid-cols-3 text-center" style={{ marginTop: 12 }}>
              {[['Independent argmax', `${(REPLAY.windows.slice(0, vitStep + 1).reduce((s, w) => s + w.errIndep, 0) / (vitStep + 1)).toFixed(2)} BPM`, C.red], ['+ Causal Viterbi', `${(REPLAY.windows.slice(0, vitStep + 1).reduce((s, w) => s + w.errVit, 0) / (vitStep + 1)).toFixed(2)} BPM`, C.teal], ['Windows decoded', `${vitStep + 1} / ${REPLAY.windows.length}`, C.ink]].map(([k, v, col]) => (
                <div key={k} className="stat"><p className="stat-value-serif" style={{ color: col as string }}><Tex tex={toTexExpr(v)} /></p><p className="stat-label mt-0.5">{k} MAE so far</p></div>))}
            </div>
            <FigCap label="Stage 4 · Trace.">Mean absolute error accumulates only over windows decoded so far, so the comparison stays causal.</FigCap>
          </figure>
        </div>
      </article>

      {/* ── STAGE 5 ── */}
      <article id="stage5" className="stage">
        <StageHead n={5} title="Reliability-aware reporting">The estimation layer always produces a value — but under heavy motion, every candidate may be wrong. An HGB reliability model (<MathNumbers text="44–57" /> PPG-quality / disagreement / dispersion features; <Tex tex="\mathrm{AUC}" /> <Tex tex="0.898" /> for detecting error <Tex tex="> 10\ \mathrm{BPM}" />) feeds a <b>learned finite-state policy</b>, solved by value iteration, over (discretised reliability <Tex tex="\times" /> consecutive holds). Switch policies and watch coverage and decisions change.</StageHead>
        <div className="flex flex-wrap gap-2 mt-1" role="group" aria-label="Reporting policy">
          {(Object.keys(POLICIES) as PolicyKey[]).map(k => <button key={k} aria-pressed={policy === k} onClick={() => setPolicy(k)} className="pill pill-amber"><Tex tex={`\\lambda_{\\mathrm{rej}} = ${POLICIES[k].lambda}`} /> · {POLICIES[k].suffix}</button>)}
        </div>
        <div className="stat-grid grid-cols-2 md:grid-cols-4 text-center">
          {([
            ['Reported coverage (paper, motion)', <Tex tex={toTexExpr(POLICIES[policy].coverage)} />],
            ['Reported-window MAE (paper)', <Tex tex={toTexExpr(POLICIES[policy].motionMAE)} />],
            ['Windows reported here (replay)', <Tex tex={`${reportedCount} / ${REPLAY.windows.length}`} />],
            [<span>Reject cost <Tex tex="\lambda_{\mathrm{rej}}" /></span>, <Tex tex={String(POLICIES[policy].lambda)} />],
          ] as [React.ReactNode, React.ReactNode][]).map(([k, v], i) => (
            <div key={i} className="stat" style={{ background: '#fffbeb' }}><p className="stat-value-serif">{v}</p><p className="stat-label mt-0.5">{k}</p></div>))}
        </div>
        <figure className="figure mt-6">
          <div className="fig-title"><span>Reliability per window</span><span className="fig-sub">Click a bar to inspect its features below</span></div>
          <ReliabilityChart windows={REPLAY.windows} thresh={POLICIES[policy].thresh} decisions={decisions} selected={relSel} onSelect={setRelSel} />
          <div className="legend"><span><span className="sw" style={{ background: C.teal }} />Accept — report current estimate</span><span><span className="sw" style={{ background: C.amber }} />Hold — retain last trusted HR</span><span><span className="sw" style={{ background: C.red }} />Reject — withhold measurement</span></div>
          <FigCap label="Stage 5 · Reliability.">Bar height is the reliability score <Tex tex="r_t" /> for each replay window; the dashed line is the active policy threshold. Colour is the resulting decision, not the score.</FigCap>
        </figure>
        <figure className="figure mt-6">
          <div className="fig-title"><span>Reliability features — window <Tex tex={`w_{${relSel + 1}}`} /> ({relWin.isMotion ? 'deep-squat' : 'static'})</span><span className="fig-sub">decision: <b className={decisions[relSel].d === 'accept' ? 'text-teal-700' : decisions[relSel].d === 'hold' ? 'text-amber-700' : 'text-red-600'}>{decisions[relSel].d}</b></span></div>
          <div className="stat-grid grid-cols-2 sm:grid-cols-3" style={{ marginTop: 0 }}>
            {([['Reliability', `r_t = ${relWin.reliability.toFixed(2)}`], ['Candidate dispersion', `\\sigma_{\\mathrm{cand}} = ${relWin.relFeats.cand_std.toFixed(2)}\\ \\mathrm{BPM}`], ['Consensus @5 BPM', `\\rho_{5} = ${relWin.relFeats.consensus_5bpm.toFixed(2)}`], ['Consensus @10 BPM', `\\rho_{10} = ${relWin.relFeats.consensus_10bpm.toFixed(2)}`], ['Mean candidate quality', `\\bar{q} = ${relWin.relFeats.quality_mean.toFixed(2)}`], ['Near-prediction spread', `\\sigma_{\\mathrm{near}} = ${relWin.relFeats.near_pred_std.toFixed(2)}\\ \\mathrm{BPM}`], ['Valid candidates', `n_t = ${Math.round(relWin.relFeats.valid_count)}`], ['Decoded HR', `\\hat{h}_t = ${relWin.viterbiHR.toFixed(2)}\\ \\mathrm{BPM}`], ['Abs. error (eval)', `|e_t| = ${relWin.errVit.toFixed(2)}\\ \\mathrm{BPM}`]] as [string, string][]).map(([k, v]) => (
              <Stat key={k} label={k.includes('@') ? <>Consensus @<Tex tex={`${k.split('@')[1].trim().replace(' BPM', '')}\\ \\mathrm{BPM}`} /></> : k}><Tex tex={v} /></Stat>))}
          </div>
          <FigCap label="Stage 5 · Features.">The features behind the selected window’s reliability score. Absolute error is evaluation-only and never enters the policy.</FigCap>
        </figure>
      </article>
    </section>
  )
}

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
    <section id="evaluation" className="section scroll-mt-16" style={{ paddingTop: 0 }}>
      <SectionHead kicker="Published results" title="Evaluation" lede="Published results from the paper’s motion-focused ring evaluation. These numbers are fixed results, not playground output." />

      <div className="panel">
        <h3>Motion-robust HR estimation — Table <Tex tex="1" /> (<Tex tex="\mathrm{MAE,\ BPM}" />)</h3>
        <div className="mt-3 overflow-x-auto" style={{ marginInline: -20 }}>
          <table className="data-table"><thead><tr><th>Configuration</th><th>Static</th><th>Motion</th><th>Overall</th></tr></thead>
            <tbody>{PUBLISHED.motionTable.map(r => <tr key={r.method} className={r.method.includes('CITRUS') ? 'hl' : ''}><td>{r.method}</td><td><Tex tex={toTexExpr(r.static)} /></td><td><Tex tex={r.motion.toFixed(2)} /></td><td><Tex tex={toTexExpr(r.overall)} /></td></tr>)}</tbody></table>
        </div>
        <p className="text-[11px] text-stone-500 mt-3 pt-3 border-t border-stone-100"><Tex tex="\pm" /> = std over <Tex tex="5" /> seeds where reported. Highlighted row is the full CITRUS estimation layer.</p>
      </div>
      <p className="callout callout-teal flex flex-wrap items-baseline gap-x-2 mt-4"><b className="font-serif text-2xl font-medium">−24%</b><span>motion MAE vs. the LSTM baseline (<Tex tex="14.39 \to 10.91\ \mathrm{BPM}" />). Static MAE reaches <Tex tex="2.63\ \mathrm{BPM}" />.</span></p>

      <div className="grid lg:grid-cols-2 gap-5 mt-10 items-stretch">
        <figure className="figure flex flex-col h-full" style={{ padding: 20 }}>
          <div className="fig-title" style={{ display: 'block' }}><span style={{ fontFamily: '"Source Serif 4", Georgia, serif', fontSize: 20, fontWeight: 500 }}>Coverage–accuracy trade-off</span><p className="fig-sub mt-1" style={{ fontSize: 13 }}>Click an operating point. Lower coverage means high-confidence spot checks, not full monitoring.</p></div>
          <div className="flex-1 flex items-center">
            <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full h-auto" role="img" aria-label="Coverage versus MAE operating points">
              {[0, 3, 6, 9].map(m => <g key={m}><line x1={48} x2={CW - 20} y1={CY(m)} y2={CY(m)} stroke={C.grid} /><SvgMath x={38} y={CY(m) - 7} w={28} tex={String(m)} color={C.mute} /></g>)}
              {showOverall && <path d={'M' + PUBLISHED.coverageOverall.map(p => `${CX(p.cov)},${CY(p.mae)}`).join(' L')} fill="none" stroke={C.mute} strokeWidth={1.6} strokeDasharray="4 3" />}
              <path d={'M' + PUBLISHED.coverage.map(p => `${CX(p.cov)},${CY(p.mae)}`).join(' L')} fill="none" stroke={C.amber} strokeWidth={2.4} />
              {PUBLISHED.coverage.map((p, i) => <g key={i} onClick={() => setCovIdx(i)} className="cursor-pointer"><circle cx={CX(p.cov)} cy={CY(p.mae)} r={i === covIdx ? 9 : 6} fill={i === covIdx ? C.amber : '#fff'} stroke={C.amber} strokeWidth={2.4} /><SvgMath x={CX(p.cov)} y={CY(p.mae) - 22} w={76} tex={`${p.cov}\\% \\cdot ${p.mae}`} color={C.amber} bold /></g>)}
            </svg>
          </div>
          <figcaption className="figcap" style={{ marginTop: 'auto' }}><strong>Figure 2 · Coverage vs. accuracy (interactive).</strong> Selected: <b className="text-amber-700"><Tex tex={`${PUBLISHED.coverage[covIdx].cov}\\%`} /> coverage · <Tex tex={`${PUBLISHED.coverage[covIdx].mae.toFixed(2)}\\ \\mathrm{BPM}`} /> MAE</b> <span className="text-stone-400">(motion windows)</span>
            <label className="flex items-center gap-2 mt-2 cursor-pointer text-[13px] text-stone-700"><input type="checkbox" checked={showOverall} onChange={() => setShowOverall(!showOverall)} className="check" /> Show overall curve (static + motion)</label>
          </figcaption>
        </figure>
        <div className="panel flex flex-col h-full">
          <h3>Sustained-motion stress test</h3>
          <p className="text-sm text-stone-500 mt-1">The heavy-tailed regime behind Figure <Tex tex="2" /> — why selective reporting exists.</p>
          <div className="flex-1 flex flex-col justify-center py-8">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><p className="font-serif text-[20px] leading-snug font-medium whitespace-nowrap text-stone-900"><Tex tex="17.65 \to 15.30" /></p><p className="text-[11px] text-stone-500 mt-1">MAE (<Tex tex="\mathrm{BPM}" />), HGB baseline <Tex tex="\to" /> + Viterbi</p></div>
              <div><p className="font-serif text-[20px] leading-snug font-medium whitespace-nowrap text-stone-900"><Tex tex="0.631 \to 0.724" /></p><p className="text-[11px] text-stone-500 mt-1">Pearson <Tex tex="r" /></p></div>
              <div><p className="font-serif text-[20px] leading-snug font-medium whitespace-nowrap text-stone-900"><Tex tex="40.04" /></p><p className="text-[11px] text-stone-500 mt-1">Baseline <Tex tex="\mathrm{P90}" /> error (<Tex tex="\mathrm{BPM}" />) — heavy-tailed</p></div>
            </div>
          </div>
          <p className="text-[13px] text-stone-600 pt-3 border-t border-stone-100">Improvement: <b className="text-stone-900"><Tex tex="-2.35\ \mathrm{BPM}" /> MAE</b> <span className="text-stone-500">from causal decoding alone, before any window is withheld.</span></p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mt-5 items-start">
        <div className="panel">
          <h3>Ablations — Table <Tex tex="2" /></h3>
          <div className="mt-3 overflow-x-auto" style={{ marginInline: -20 }}>
            <table className="data-table"><thead><tr><th>Ablation</th><th style={{ textAlign: 'right' }}>Effect</th></tr></thead>
              <tbody>{PUBLISHED.ablations.map(a => <tr key={a.ablation}><td><b className="text-stone-800">{a.module}:</b> <span className="text-stone-600"><MathNumbers text={a.ablation} /></span><p className="text-[12px] text-stone-500 mt-1 leading-relaxed"><MathNumbers text={a.detail} /></p></td><td className="text-right text-teal-800 font-semibold" style={{ minWidth: 130 }}><MathNumbers text={a.result.replace('Δ', 'Δ ')} /></td></tr>)}</tbody></table>
          </div>
        </div>
        <div className="panel">
          <h3>Deployment — ESP32-S3 inference core</h3>
          <div className="mt-3 overflow-x-auto" style={{ marginInline: -20 }}>
            <table className="data-table"><thead><tr><th>Metric</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
              <tbody>{[['Mean latency / window', PUBLISHED.deploy.latency], ['Median latency / window', PUBLISHED.deploy.median], ['p95 latency', PUBLISHED.deploy.p95], ['Model storage', PUBLISHED.deploy.storage], ['Estimated energy / window', PUBLISHED.deploy.energy]].map(([k, v]) => <tr key={k}><td className="text-stone-600"><MathNumbers text={k} /></td><td className="text-right font-semibold text-stone-900 whitespace-nowrap"><MathNumbers text={v} /></td></tr>)}</tbody></table>
          </div>
          <p className="text-[11px] text-stone-500 mt-3 pt-3 border-t border-stone-100">Feature-vector inference core on-device; full pipeline context is in the paper.</p>
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
    <section id="paper" className="scroll-mt-16" style={{ background: 'var(--wash)', borderTop: '1px solid var(--line)' }}>
      <div className="section grid lg:grid-cols-[1.2fr_1fr] gap-10" style={{ paddingTop: '4.5rem', paddingBottom: '4.5rem' }}>
        <div className="min-w-0">
          <SectionHead kicker="Paper and resources" title="CITRUS at UbiComp Companion ’26" />
          <p className="text-[15px] text-stone-700 leading-[1.7]"><b>Abstract.</b> Wearable photoplethysmography (PPG) enables continuous heart-rate (HR) monitoring on consumer devices, but motion artifacts introduce frequency-domain ambiguity: during exercise, the dominant spectral component may correspond to limb movement rather than the true pulse. This paper presents CITRUS, a two-layer system that decomposes motion-robust HR monitoring into estimation (candidate selection + causal Viterbi decoding) and reporting (reliability scoring + accept/hold/reject policy). The platform benchmark contains <MathNumbers text="54 participants and 49.76 h" /> of recordings against clinical references; the motion-focused ring-PPG evaluation uses <MathNumbers text="31 subjects" />. On this subset, the estimation layer reduces motion-window Mean Absolute Error (MAE) from <Tex tex="14.39" /> to <Tex tex="10.91" /> beats per minute (BPM). We additionally develop an ESP32-S3 real-time prototype for live PPG acquisition, on-device filtering, beat-event extraction, and browser visualization. We deploy the feature-vector CITRUS inference core—candidate scoring, causal decoding, and reliability estimation—on the ESP32-S3, averaging <MathNumbers text="156.429 ms" /> per window with <MathNumbers text="145,280 B" /> model storage.</p>
          <div className="mt-5 space-y-2 text-sm">
            {[['Yi Wang', 'The Hong Kong University of Science and Technology (Guangzhou) — ywang183@connect.hkust-gz.edu.cn'], ['Siyuan Liang', 'Cornell University, Ithaca, NY — sl3595@cornell.edu'], ['Yuntao Wang', 'Tsinghua University, Beijing — yuntaowang@tsinghua.edu.cn (corresponding author)']].map(([n, a]) => (
              <p key={n}><b className="text-stone-800">{n}</b> <span className="text-stone-500">· {a}</span></p>))}
          </div>
          <p className="text-sm text-stone-500 mt-4 leading-relaxed">Companion of the 2026 ACM International Joint Conference on Pervasive and Ubiquitous Computing · October 11–15, 2026 · Shanghai, China · 5 pages · CC BY 4.0</p>
          <div className="flex flex-wrap gap-2.5 mt-5">
            <a href={`${import.meta.env.BASE_URL}citrus.pdf`} className="btn btn-primary">Read the paper (PDF)</a>
          </div>
        </div>
        <div className="min-w-0">
          <p className="font-serif font-medium text-lg mb-2">Cite this work</p>
          <div className="relative">
            <pre className="text-[12px] leading-relaxed rounded-[12px] p-4 overflow-x-auto" style={{ background: 'var(--ink)', color: '#e7e5e4' }}>{BIB}</pre>
            <button onClick={() => { navigator.clipboard?.writeText(BIB); setCopied(true); setTimeout(() => setCopied(false), 1600) }} className="btn btn-sm absolute top-3 right-3" style={{ background: 'rgba(255,255,255,.12)', color: '#fff', minHeight: 30 }}>{copied ? 'Copied ✓' : 'Copy BibTeX'}</button>
          </div>
          <p className="text-[12px] text-stone-500 mt-3 leading-relaxed">Copy the BibTeX entry above, or download the PDF for the full method, evaluation protocol, and deployment details.</p>
        </div>
      </div>
    </section>
  )
}

// ══════════════ APP ══════════════
export default function App() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => { const f = () => setScrolled(window.scrollY > 10); f(); window.addEventListener('scroll', f); return () => window.removeEventListener('scroll', f) }, [])
  return (
    <div className="min-h-screen bg-white text-stone-800 antialiased" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <a href="#demo" className="sr-only focus:not-sr-only focus:absolute focus:z-[60] focus:bg-white focus:px-4 focus:py-2 focus:text-sm">Skip to interactive demo</a>
      <nav className={`fixed top-0 inset-x-0 z-50 transition ${scrolled ? 'bg-white/95 backdrop-blur shadow-sm border-b border-stone-200' : 'bg-white/80 backdrop-blur border-b border-transparent'}`} aria-label="Main">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center gap-6">
          <button onClick={() => scrollTo('top')} className="font-serif font-medium text-xl tracking-tight text-stone-900">CITRUS<span className="text-blue-700">.</span></button>
          <div className="hidden md:flex gap-5 text-sm font-medium text-stone-600 ml-2">
            {[['Overview', 'top'], ['Interactive demo', 'demo'], ['Evaluation', 'evaluation'], ['Paper', 'paper']].map(([l, id]) => <button key={id} onClick={() => scrollTo(id)} className="hover:text-blue-800 transition py-2">{l}</button>)}
          </div>
          <div className="ml-auto"><a href={`${import.meta.env.BASE_URL}citrus.pdf`} className="btn btn-dark btn-sm">Paper PDF</a></div>
        </div>
      </nav>

      <header id="top" className="max-w-6xl mx-auto px-5 pt-28 pb-4 scroll-mt-20">
        <p className="text-[13px] text-stone-500 font-medium">UbiComp Companion ’26 · Shanghai, China · Oct 11–15, 2026</p>
        <h1 className="font-serif text-[29px] sm:text-4xl md:text-[52px] leading-[1.12] font-medium text-stone-900 mt-3 max-w-4xl">CITRUS: Candidate Inference, Temporal Decoding, and Reliability-Gated Reporting for Wearable Devices</h1>
        <p className="font-serif text-xl md:text-2xl text-stone-500 mt-4">From noisy PPG signals to reliable heart-rate estimates.</p>
        <p className="mt-5 text-[15px] leading-relaxed"><b>Yi Wang</b> <span className="text-stone-500">(HKUST Guangzhou)</span> · <b>Siyuan Liang</b> <span className="text-stone-500">(Cornell)</span> · <b>Yuntao Wang</b> <span className="text-stone-500">(Tsinghua, corresponding)</span></p>
        <div className="flex flex-wrap gap-2.5 mt-6">
          <button onClick={() => scrollTo('demo')} className="btn btn-primary" style={{ minHeight: 44, paddingInline: 22 }}>Explore interactive demo ↓</button>
          <a href={`${import.meta.env.BASE_URL}citrus.pdf`} className="btn btn-outline" style={{ minHeight: 44, paddingInline: 22 }}>Paper PDF</a>
        </div>
        <figure className="figure mt-8">
          <img src={`${import.meta.env.BASE_URL}citrus-hero.gif`} width={1200} height={240} className="w-full h-auto block rounded-[6px]" alt="Animated CITRUS pipeline: noisy PPG and accelerometer scroll in, become about 140 candidate heart rates per window (motion cluster at 84 BPM, pulse cluster at 114 BPM), then a decoded heart-rate trace that is accepted, held, or rejected" />
          <FigCap label="Overview · The CITRUS pipeline.">Noisy PPG and accelerometer (left) become ≈140 candidate heart rates per window; causal decoding selects a plausible trace, and the reporting policy accepts, holds, or rejects each window. Work through it stage by stage below.</FigCap>
        </figure>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-8">
          {[['−24%', 'motion MAE vs LSTM: 14.39 → 10.91 BPM', C.teal], ['≈140', 'candidate hypotheses per 30 s window', C.blue], ['2.90 BPM', 'reported MAE at 31% motion coverage', C.amber], ['156.4 ms', 'ESP32-S3 inference-core latency / window', C.ink]].map(([v, k, col]) => (
            <div key={k} className="hero-stat"><dd style={{ color: col as string }}><Tex tex={toTexExpr(v)} /></dd><dt><MathNumbers text={k} /></dt></div>))}
        </dl>
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
