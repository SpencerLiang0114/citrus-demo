import { useEffect, useMemo, useRef, useState } from 'react'
import { RECORDINGS, POLICIES, PUBLISHED, decide, fmtT, type Candidate, type PolicyKey } from './data'
import { SignalExplorer, PsdChart, ViterbiGraph, HrTimeline, C } from './components/Viz'
import { Tex, MathNumbers, toTexExpr } from './components/Math'

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
const SectionHead = ({ title, lede }: { kicker?: string; title: string; lede?: React.ReactNode }) => (
  <div className="mb-8">
    <h2 className="font-serif text-3xl md:text-4xl font-semibold text-stone-900">{title}</h2>
    {lede && <p className="text-stone-600 mt-3 max-w-3xl leading-relaxed">{lede}</p>}
  </div>
)

// ══════════════ INTERACTIVE PLAYGROUND (shared state) ══════════════
function Playground() {
  const [recId, setRecId] = useState('squats')
  const rec = RECORDINGS.find(r => r.id === recId)!
  const [t, setT] = useState(195)
  const [playing, setPlaying] = useState(false)
  const [span, setSpan] = useState(120)
  const [channels, setChannels] = useState({ ir: true, red: true, acc: true, ref: true })
  const [selCand, setSelCand] = useState<Candidate | null>(null)
  const [scorer, setScorer] = useState<'MLP' | 'HGB'>('MLP')
  const [vitStep, setVitStep] = useState(6)
  const [cmp, setCmp] = useState({ indep: true, vit: true, gt: true })
  const [policy, setPolicy] = useState<PolicyKey>('l8')
  const [expandedCand, setExpandedCand] = useState<string | null>(null)

  useEffect(() => { if (!playing) return; const id = setInterval(() => setT(v => (v + 1 >= 360 ? 0 : v + 1)), 120); return () => clearInterval(id) }, [playing])
  useEffect(() => { setSelCand(null); setVitStep(6) }, [recId])
  const winIdx = Math.min(11, Math.floor(t / 30))
  const win = rec.windows[winIdx]
  const vitWin = rec.windows[vitStep]

  const decisions = useMemo(() => {
    const out: { d: string; reported: number | null }[] = []; let held: number | null = null
    for (const w of rec.windows) { const r = decide(w, POLICIES[policy].thresh, (out.at(-1)?.d as never) ?? null, held); if (r.d === 'accept') held = w.viterbiHR; out.push(r) }
    return out
  }, [rec, policy])
  const reportedCount = decisions.filter(d => d.reported !== null).length
  // DP table for frontier window
  const dpRows = vitWin.candidates.slice(0, 5).map(c => {
    let bestJ = rec.windows[Math.max(0, vitStep - 1)].candidates[0], bestVal = Infinity
    if (vitStep > 0) for (const j of rec.windows[vitStep - 1].candidates.slice(0, 5)) { const v = j.cost + 0.012 * (j.hr - c.hr) ** 2; if (v < bestVal) { bestVal = v; bestJ = j } }
    return { c, bestJ, trans: vitStep === 0 ? 0 : Math.round(bestVal * 10) / 10, total: Math.round((c.cost + (vitStep === 0 ? 0 : bestVal)) * 10) / 10 }
  }).sort((a, b) => a.total - b.total)

  const stageBtn = (n: number, label: string) => (
    <button onClick={() => scrollTo(`stage${n}`)} className="text-left px-3 py-2 rounded-lg border border-stone-200 hover:border-blue-400 hover:bg-blue-50 text-[13px] font-medium text-stone-700 transition"><span className="text-blue-700 font-bold mr-1.5">{n}</span>{label}</button>
  )

  return (
    <section id="demo" className="max-w-6xl mx-auto px-5 py-16 scroll-mt-20">
      <SectionHead title="The Algorithm Playground" lede="One recording, one shared timeline, five synchronized stages. Scrub or press play — every view follows the same playhead. Replay data is a synthetic illustration from the paper's protocol; published results are in Evaluation." />

      {/* shared controls */}
      <div className="sticky top-14 z-30 bg-white/95 backdrop-blur border border-stone-200 rounded-xl p-4 shadow-sm mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5 flex-wrap">
            {RECORDINGS.map(r => <button key={r.id} onClick={() => { setRecId(r.id); setT(15) }} className={`px-3 py-1.5 rounded-full text-[13px] font-semibold border transition ${recId === r.id ? 'bg-blue-700 text-white border-blue-700' : 'border-stone-300 text-stone-600 hover:border-blue-500'}`}>{r.label}</button>)}
          </div>
          <span className="text-xs text-stone-500">{rec.sub} · {rec.motion}</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setPlaying(!playing)} className="px-4 py-1.5 rounded-full bg-stone-900 text-white text-[13px] font-semibold hover:bg-stone-700">{playing ? '❚❚ Pause' : '▶ Play'}</button>
            <span className="font-mono text-sm text-stone-700 w-20 text-center">{fmtT(t)} / 6:00</span>
          </div>
        </div>
        <input type="range" min={0} max={359} value={t} onChange={e => setT(+e.target.value)} className="w-full mt-3 accent-blue-700" aria-label="Scrub timeline" />
        <div className="flex gap-1 mt-1">{rec.windows.map(w => <button key={w.idx} onClick={() => setT(w.t0 + 15)} title={`Window ${w.idx + 1}`} className={`flex-1 h-2 rounded-full transition ${w.idx === winIdx ? 'bg-blue-700' : w.idx < winIdx ? 'bg-blue-200' : 'bg-stone-200'}`} />)}</div>
        <p className="text-[11px] text-stone-500 mt-1.5">Window {winIdx + 1} of 12 · 30 s windows · reference HR in window: <b className="text-teal-700">{win.trueHR} BPM</b> (evaluation target only — never an inference input)</p>
      </div>

      <div className="grid md:grid-cols-5 gap-2 mb-10">{stageBtn(1, 'PPG Signal Explorer')}{stageBtn(2, 'Candidate Generation')}{stageBtn(3, 'Candidate Scoring')}{stageBtn(4, 'Causal Viterbi Decoding')}{stageBtn(5, 'Reliability Reporting')}</div>

      {/* ── STAGE 1 ── */}
      <article id="stage1" className="scroll-mt-36 border-t border-stone-200 pt-10 mt-10">
        <h3 className="font-serif text-2xl font-semibold"><span className="text-blue-700">Stage 1 ·</span> PPG Signal Explorer</h3>
        <p className="text-stone-600 mt-2 max-w-3xl text-[15px] leading-relaxed">Ring PPG (25 Hz, infrared + red) with accelerometer. At rest the pulse dominates. Under squats or striding, limb motion changes sensor–skin coupling and injects artifacts <em>inside the cardiac band</em> — distorting the waveform until several heart rates become plausible. Compare <b>Rest</b> against <b>Deep squats</b> above.</p>
        <div className="flex flex-wrap gap-4 mt-4 text-[13px]">
          {([['ir', 'Infrared PPG', C.blue], ['red', 'Red PPG', '#7c3aed'], ['acc', 'Accelerometer', C.amber], ['ref', 'Reference HR (eval only)', C.teal]] as const).map(([k, label, col]) => (
            <label key={k} className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={channels[k]} onChange={() => setChannels({ ...channels, [k]: !channels[k] })} className="accent-blue-700" /><span style={{ color: col }} className="font-semibold">{label}</span></label>))}
          <label className="flex items-center gap-2 ml-auto">Zoom <input type="range" min={30} max={360} step={30} value={span} onChange={e => setSpan(+e.target.value)} className="accent-blue-700" /><span className="font-mono text-xs">{span}s</span></label>
        </div>
        <div className="mt-3 border border-stone-200 rounded-xl p-3"><SignalExplorer rec={rec} t={t} span={span} channels={channels} onScrub={setT} /></div>
        <div className="grid md:grid-cols-3 gap-3 mt-4 text-[13px]">
          {[['Motion amplitude', `${win.motionAmp.toFixed(2)} (norm.)`, win.motionAmp > 0.35 ? 'Severe — cardiac component may be non-identifiable in this window.' : 'Mild — pulse remains the dominant component.'], ['Motion frequency', win.motionFreqBPM ? `${win.motionFreqBPM} BPM-equiv.` : '—', win.motionFreqBPM ? 'Inside the 35–220 BPM candidate band: it will generate its own HR hypotheses.' : 'No periodic motion source.'], ['ACC role', 'Segment selection', 'ACC selects motion-quiet segments before spectral estimation. It is not a candidate source (paper §3.1).']].map(([k, v, d]) => (
            <div key={k} className="bg-stone-50 rounded-lg p-3"><p className="text-[11px] font-bold tracking-wider text-stone-500 uppercase">{k}</p><p className="font-semibold text-stone-800 mt-0.5">{v}</p><p className="text-stone-500 mt-1">{d}</p></div>))}
        </div>
      </article>

      {/* ── STAGE 2 ── */}
      <article id="stage2" className="scroll-mt-36 border-t border-stone-200 pt-10 mt-12">
        <h3 className="font-serif text-2xl font-semibold"><span className="text-blue-700">Stage 2 ·</span> Candidate Generation</h3>
        <p className="text-stone-600 mt-2 max-w-3xl text-[15px] leading-relaxed">Each <Tex tex="30\ \mathrm{s}" /> window yields <b><Tex tex="\approx 140" /> candidates</b> (median <Tex tex="140" />, range <Tex tex="57\text{–}160" />) from three estimator families — Welch PSD peaks, autocorrelation peaks, peak-interval estimates — each expanded with harmonic variants (<Tex tex="0.5\times,\ 1\times,\ 2\times" />) and filtered to <Tex tex="[35,\,220]\ \mathrm{BPM}" />. The top-<Tex tex="12" /> for window <Tex tex={String(winIdx + 1)} /> are marked below.</p>
        <div className="mt-3 border border-stone-200 rounded-xl p-3"><PsdChart rec={rec} win={win} sel={selCand} onSel={setSelCand} /></div>
        {selCand ? (
          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm grid md:grid-cols-5 gap-3">
            <div><p className="text-[11px] font-bold text-blue-700 uppercase">Candidate</p><p className="font-serif text-2xl font-semibold"><Tex tex={`${selCand.hr}\\ \\mathrm{BPM}`} /></p></div>
            <div><p className="text-[11px] font-bold text-blue-700 uppercase">Source</p><p>{selCand.method} · {selCand.channel} channel</p></div>
            <div><p className="text-[11px] font-bold text-blue-700 uppercase">Spectral evidence</p><p>relative power <Tex tex={`${(selCand.power * 100).toFixed(0)}\\%`} /></p></div>
            <div><p className="text-[11px] font-bold text-blue-700 uppercase">Harmonic</p><p><Tex tex={selCand.harmonic === '—' ? '\\text{—}' : selCand.harmonic.replace('×', '\\times')} /> variant{selCand.isMotionPeak ? ' · motion peak' : ''}</p></div>
            <div><p className="text-[11px] font-bold text-blue-700 uppercase">vs. reference</p><p className={Math.abs(selCand.hr - win.trueHR) <= 5 ? 'text-teal-700 font-semibold' : 'text-red-600 font-semibold'}><Tex tex={`${selCand.hr - win.trueHR >= 0 ? '+' : ''}${selCand.hr - win.trueHR}\\ \\mathrm{BPM}`} /> {Math.abs(selCand.hr - win.trueHR) <= 5 ? '(plausible pulse)' : '(likely artifact / harmonic)'}</p></div>
          </div>
        ) : <p className="text-[13px] text-stone-500 mt-2">Tip: in <b>Deep squats</b>, click the red marker near <Tex tex="84\ \mathrm{BPM}" /> — it has the highest spectral power yet sits <Tex tex="\sim 30\ \mathrm{BPM}" /> from the reference.</p>}
      </article>

      {/* ── STAGE 3 ── */}
      <article id="stage3" className="scroll-mt-36 border-t border-stone-200 pt-10 mt-12">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-[260px]">
            <h3 className="font-serif text-2xl font-semibold"><span className="text-blue-700">Stage 3 ·</span> Candidate Scoring</h3>
            <p className="text-stone-600 mt-2 max-w-3xl text-[15px] leading-relaxed">A learned ranker scores every candidate from structured features — spectral power, estimator consensus, harmonic status, source, and distance to the previous decoded HR — trained with soft targets centered on the reference HR. Click a bar to expand its feature breakdown.</p>
          </div>
          <div className="flex rounded-full border border-stone-300 overflow-hidden text-[13px] font-semibold">
            {(['MLP', 'HGB'] as const).map(s => <button key={s} onClick={() => setScorer(s)} className={`px-4 py-2 ${scorer === s ? 'bg-blue-700 text-white' : 'text-stone-600 hover:bg-stone-50'}`}>{s} scorer</button>)}
          </div>
        </div>
        <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3"><MathNumbers text={scorer === 'MLP' ? 'MLP scorer (28k params) — used in the primary 31-subject evaluation. A raw-waveform CNN encoder added nothing (−0.01 BPM when removed, 85k → 28k params).' : 'HGB (histogram gradient-boosting) scorer — used in the sustained-motion stress test and the ESP32-S3 embedded configuration.'} /> Rankings below are illustrative for either scorer.</p>
        <div className="mt-4 space-y-1.5">
          {win.candidates.slice(0, 8).map((c, i) => (
            <div key={c.id}>
              <button onClick={() => setExpandedCand(expandedCand === c.id ? null : c.id)} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition ${expandedCand === c.id ? 'border-blue-400 bg-blue-50' : 'border-stone-200 hover:border-blue-300'}`}>
                <span className="text-xs text-stone-400 w-5"><Tex tex={`\\#${i + 1}`} /></span>
                <span className={`font-bold w-20 ${c.isMotionPeak ? 'text-red-600' : 'text-stone-800'}`}><Tex tex={`${c.hr}\\ \\mathrm{BPM}`} /></span>
                <span className="flex-1 h-3 bg-stone-100 rounded-full overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${c.score * 100}%`, background: c.isMotionPeak ? C.red : C.blue }} /></span>
                <span className="text-xs w-14 text-right"><Tex tex={c.score.toFixed(2)} /></span>
                <span className="text-[11px] text-stone-500 w-36 hidden md:block">{c.method} · {c.channel} · <Tex tex={c.harmonic === '—' ? '\\text{—}' : c.harmonic.replace('×', '\\times')} /></span>
                <span className="text-[11px] font-semibold w-20 text-right">{Math.abs(c.hr - win.trueHR) <= 5 ? <span className="text-teal-700">near ref</span> : c.isMotionPeak ? <span className="text-red-600">motion peak</span> : ''}</span>
              </button>
              {expandedCand === c.id && (
                <div className="mx-3 mb-2 px-4 py-3 bg-stone-50 rounded-b-lg grid grid-cols-2 md:grid-cols-5 gap-3 text-[12px]">
                  {([['Spectral strength', c.feats.spectral], ['Estimator consensus', c.feats.consensus], ['Harmonic status', c.feats.harmonic], ['Source prior', c.feats.source], ['Temporal distance', c.feats.temporal]] as const).map(([k, v]) => (
                    <div key={k}><p className="text-stone-500">{k}</p><div className="h-2 bg-stone-200 rounded-full mt-1"><div className="h-full bg-blue-600 rounded-full" style={{ width: `${v * 100}%` }} /></div><p className="mt-0.5"><Tex tex={v.toFixed(2)} /></p></div>))}
                  <p className="col-span-full text-stone-500">Candidate cost <Tex tex="E_t(k)" /> <Tex tex={`= ${(c.cost).toFixed(1)}`} /> (derived from scorer logit) — passed to the Viterbi decoder in Stage 4.</p>
                </div>)}
            </div>))}
        </div>
        <p className="text-[13px] text-stone-500 mt-3">Note the lesson: the motion peak often has the <em>highest spectral power</em> (feature 1) but loses on consensus, harmonic status, and temporal distance. Raw peak-picking fails; multi-feature ranking does not.</p>
      </article>

      {/* ── STAGE 4 ── */}
      <article id="stage4" className="scroll-mt-36 border-t border-stone-200 pt-10 mt-12">
        <h3 className="font-serif text-2xl font-semibold"><span style={{ color: C.teal }}>Stage 4 ·</span> Causal Viterbi Decoding</h3>
        <p className="text-stone-600 mt-2 max-w-3xl text-[15px] leading-relaxed">Per-window winners can still jump implausibly (<MathNumbers text="72 → 144 → 70 BPM" />). CITRUS runs an <b>online</b> Viterbi recursion: when window <em><Tex tex="t" /></em> arrives, it extends only paths ending at <Tex tex="t-1" /> — no future windows, no backward smoothing — so it deploys in real time. Step the decoder forward and watch red, implausible transitions get priced out.</p>
        <div className="bg-stone-900 text-stone-100 rounded-xl px-5 py-4 mt-4 text-center text-lg md:text-xl overflow-x-auto whitespace-nowrap">
          <Tex tex="D_t(k) = E_t(k) + \min_{j}\bigl[\, D_{t-1}(j) + \Omega_t(j,\,k) \,\bigr]" /> <span className="text-stone-400 text-sm ml-3"><Tex tex="\Omega" /> = quadratic penalty on <Tex tex="|\Delta\mathrm{HR}|" /></span>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button onClick={() => setVitStep(v => Math.max(0, v - 1))} className="px-3 py-1.5 rounded-full border border-stone-300 text-[13px] font-semibold disabled:opacity-40" disabled={vitStep === 0}>← Prev window</button>
          <button onClick={() => setVitStep(v => Math.min(11, v + 1))} className="px-4 py-1.5 rounded-full bg-teal-700 text-white text-[13px] font-semibold disabled:opacity-40" disabled={vitStep === 11}>Step decoder →</button>
          <input type="range" min={0} max={11} value={vitStep} onChange={e => setVitStep(+e.target.value)} className="flex-1 min-w-[140px] accent-teal-700" aria-label="Viterbi frontier" />
          <span className="text-sm">frontier: window <Tex tex={`${vitStep + 1} / 12`} /></span>
          <div className="flex gap-3 text-[12px] ml-auto">
            {([['indep', 'Independent', C.red], ['vit', 'Viterbi', C.teal], ['gt', 'Reference', C.ink]] as const).map(([k, l, col]) => <label key={k} className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={cmp[k]} onChange={() => setCmp({ ...cmp, [k]: !cmp[k] })} className="accent-teal-700" /><span style={{ color: col }} className="font-semibold">{l}</span></label>)}
          </div>
        </div>
        <div className="mt-3 border border-stone-200 rounded-xl p-3"><ViterbiGraph rec={rec} upto={vitStep} showIndep={cmp.indep} showVit={cmp.vit} showGT={cmp.gt} /></div>
        <div className="grid lg:grid-cols-2 gap-4 mt-4">
          <div className="border border-stone-200 rounded-xl overflow-x-auto">
            <p className="px-4 py-2.5 bg-stone-50 font-semibold text-sm">Dynamic-programming table — window <Tex tex={String(vitStep + 1)} /> {vitStep === 0 ? <>(<Tex tex="D_1(k) = E_1(k)" />)</> : <>(best predecessor from window <Tex tex={String(vitStep)} />)</>}</p>
            <table className="w-full text-[13px]"><thead><tr className="text-left text-stone-500 border-b border-stone-200"><th className="px-4 py-2">Candidate <Tex tex="k" /></th><th><Tex tex="E_t(k)" /></th><th>Best <Tex tex="j \to" /> transition <Tex tex="\Omega" /></th><th><Tex tex="D_t(k)" /></th></tr></thead>
              <tbody>{dpRows.map((r, i) => <tr key={r.c.id} className={`border-b border-stone-100 ${i === 0 ? 'bg-teal-50 font-semibold' : ''}`}><td className="px-4 py-2"><Tex tex={`${r.c.hr}\\ \\mathrm{BPM}`} /> {i === 0 && <span className="text-teal-700 text-[11px]">← decoded <Tex tex="\hat{h}_t" /></span>}</td><td><Tex tex={r.c.cost.toFixed(1)} /></td><td>{vitStep === 0 ? '—' : <Tex tex={`${r.bestJ.hr}\\ \\mathrm{BPM} \\to ${r.trans.toFixed(1)}`} />}</td><td><Tex tex={r.total.toFixed(1)} /></td></tr>)}</tbody></table>
          </div>
          <div>
            <div className="border border-stone-200 rounded-xl p-3"><HrTimeline rec={rec} upto={vitStep} /></div>
            <div className="grid grid-cols-3 gap-3 mt-3 text-center">
              {[['Independent argmax', `${(rec.windows.slice(0, vitStep + 1).reduce((s, w) => s + w.errIndep, 0) / (vitStep + 1)).toFixed(1)} BPM`, C.red], ['+ Causal Viterbi', `${(rec.windows.slice(0, vitStep + 1).reduce((s, w) => s + w.errVit, 0) / (vitStep + 1)).toFixed(1)} BPM`, C.teal], ['Windows decoded', `${vitStep + 1} / 12`, C.ink]].map(([k, v, col]) => (
                <div key={k} className="bg-stone-50 rounded-lg py-3"><p className="font-serif text-xl font-semibold" style={{ color: col as string }}><Tex tex={toTexExpr(v)} /></p><p className="text-[11px] text-stone-500 mt-0.5">{k} MAE so far (illustrative)</p></div>))}
            </div>
            <p className="text-[12px] text-stone-500 mt-3">Paper (primary, <Tex tex="5" /> seeds): scoring alone <Tex tex="12.94 \to" /> <b className="text-teal-700"><Tex tex="10.91\ \mathrm{BPM}" /></b> motion MAE after causal decoding. Fixed-run ablation: causal <Tex tex="10.66" /> vs. full-sequence <Tex tex="10.88\ \mathrm{BPM}" /> — causality costs nothing.</p>
          </div>
        </div>
      </article>

      {/* ── STAGE 5 ── */}
      <article id="stage5" className="scroll-mt-36 border-t border-stone-200 pt-10 mt-12">
        <h3 className="font-serif text-2xl font-semibold"><span style={{ color: C.amber }}>Stage 5 ·</span> Reliability-Aware Reporting</h3>
        <p className="text-stone-600 mt-2 max-w-3xl text-[15px] leading-relaxed">The estimation layer always produces a value — but under heavy motion, every candidate may be wrong. An HGB reliability model (<MathNumbers text="44–57" /> PPG-quality / disagreement / dispersion features; <Tex tex="\mathrm{AUC}" /> <Tex tex="0.898" /> for detecting error <Tex tex="> 10\ \mathrm{BPM}" />) feeds a <b>learned finite-state policy</b> — solved by value iteration, not a hand-set threshold — over (discretized reliability <Tex tex="\times" /> consecutive holds). Switch policies and watch coverage and decisions change.</p>
        <div className="flex flex-wrap gap-2 mt-4">
          {(Object.keys(POLICIES) as PolicyKey[]).map(k => <button key={k} onClick={() => setPolicy(k)} className={`px-4 py-2 rounded-full text-[13px] font-semibold border transition ${policy === k ? 'bg-amber-600 text-white border-amber-600' : 'border-stone-300 text-stone-600 hover:border-amber-500'}`}><Tex tex={`\\lambda_{\\mathrm{rej}} = ${POLICIES[k].lambda}`} /> · {POLICIES[k].suffix}</button>)}
        </div>
        <div className="grid md:grid-cols-4 gap-3 mt-4 text-center">
          {([
            ['Reported coverage (paper, motion)', <Tex tex={toTexExpr(POLICIES[policy].coverage)} />],
            ['Reported-window MAE (paper)', <Tex tex={toTexExpr(POLICIES[policy].motionMAE)} />],
            ['Windows reported here', <Tex tex={`${reportedCount} / 12`} />],
            [<span>Reject cost <Tex tex="\lambda_{\mathrm{rej}}" /></span>, <Tex tex={String(POLICIES[policy].lambda)} />],
          ] as [React.ReactNode, React.ReactNode][]).map(([k, v], i) => (
            <div key={i} className="bg-amber-50 border border-amber-100 rounded-xl py-3 px-2"><p className="font-serif text-xl font-semibold text-stone-900">{v}</p><p className="text-[11px] text-stone-500 mt-0.5">{k}</p></div>))}
        </div>
        <p className="text-[13px] text-stone-600 mt-2">{POLICIES[policy].note}</p>
        {/* reliability + decision timeline */}
        <div className="mt-4 border border-stone-200 rounded-xl p-4">
          <div className="flex gap-1">{rec.windows.map((w, i) => {
            const d = decisions[i].d
            return <button key={i} onClick={() => setT(w.t0 + 15)} className="flex-1 group" title={`Window ${i + 1}: ${d}`}>
              <div className="rounded-t-md transition-all" style={{ height: `${18 + w.reliability * 44}px`, background: d === 'accept' ? C.teal : d === 'hold' ? C.amber : '#fecaca', opacity: i === winIdx ? 1 : 0.75, marginTop: `${62 - (18 + w.reliability * 44)}px` }} />
              <p className={`hidden sm:block text-[10px] font-bold mt-1.5 ${d === 'accept' ? 'text-teal-700' : d === 'hold' ? 'text-amber-700' : 'text-red-600'}`}>{d.toUpperCase()}</p>
              <p className="hidden sm:block text-[10px] text-stone-400"><Tex tex={`r = ${w.reliability.toFixed(2)}`} /></p>
            </button>
          })}</div>
          <div className="flex gap-4 mt-3 text-[12px] font-semibold"><span className="text-teal-700">■ Accept — report current estimate</span><span className="text-amber-700">■ Hold — retain last trusted HR</span><span className="text-red-600">■ Reject — withhold measurement</span><span className="text-stone-400 font-normal ml-auto">bar height = reliability <Tex tex="r_t = \exp\!\bigl(-|e_t|/\tau_r\bigr)" /> target</span></div>
        </div>
        <div className="mt-3 border border-stone-200 rounded-xl p-3"><HrTimeline rec={rec} upto={11} decisions={decisions} /></div>
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
      <SectionHead kicker="Evaluation · Published results" title="What the paper reports" lede={<>All numbers in this section are the paper's reported values (primary: <MathNumbers text="31" />-subject motion-focused ring evaluation, <MathNumbers text="2,009" /> windows, <MathNumbers text="5" /> seeds). They are independent of the synthetic replay above.</>} />

      <h3 className="font-serif text-xl font-semibold mt-2">Motion-robust HR estimation — Table <Tex tex="1" /> (<Tex tex="\mathrm{MAE,\ BPM}" />)</h3>
      <div className="border border-stone-200 rounded-xl overflow-hidden mt-4">
          <table className="w-full text-[13px]"><thead><tr className="bg-stone-50 text-left text-stone-500"><th className="px-4 py-2.5">Configuration</th><th className="px-2 py-2.5">Static</th><th className="px-2 py-2.5">Motion</th><th className="px-2 py-2.5">Overall</th></tr></thead>
            <tbody>{PUBLISHED.motionTable.map(r => <tr key={r.method} className={`border-t border-stone-100 ${r.method.includes('CITRUS') ? 'bg-teal-50 font-semibold' : ''}`}><td className="px-4 py-2.5">{r.method}</td><td className="px-2"><Tex tex={toTexExpr(r.static)} /></td><td className="px-2"><Tex tex={r.motion.toFixed(2)} /></td><td className="px-2"><Tex tex={toTexExpr(r.overall)} /></td></tr>)}</tbody></table>
          <p className="text-[11px] text-stone-500 px-4 py-2"><Tex tex="\pm" /> = std over <Tex tex="5" /> seeds where reported. Platform: <MathNumbers text="54 participants, 49.76 h" /> vs. clinical references (<Tex tex="\tau" />-Ring); motion analysis on <MathNumbers text="31 subjects" />, ring-only inputs at runtime.</p>
        </div>
      <p className="text-sm bg-teal-50 border border-teal-200 text-teal-900 rounded-xl px-4 py-3 mt-4"><b className="font-serif text-2xl"><Tex tex="-24\%" /></b> <span className="ml-1">motion MAE vs. the LSTM baseline (<Tex tex="14.39 \to 10.91\ \mathrm{BPM}" />). Static MAE reaches <Tex tex="2.63\ \mathrm{BPM}" />.</span></p>

      <div className="grid lg:grid-cols-2 gap-8 mt-12">
        <div>
          <h3 className="font-serif text-xl font-semibold">Coverage–accuracy trade-off — Figure <Tex tex="2" /> (interactive)</h3>
          <p className="text-sm text-stone-600 mt-1">Click an operating point. Lower coverage = high-confidence spot checks, not full monitoring.</p>
          <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full h-auto mt-2 border border-stone-200 rounded-xl bg-white">
            {[0, 3, 6, 9].map(m => <g key={m}><line x1={48} x2={CW - 20} y1={CY(m)} y2={CY(m)} stroke={C.grid} /><SvgMath x={38} y={CY(m) - 7} w={28} tex={String(m)} color={C.mute} /></g>)}
            {showOverall && <path d={PUBLISHED.coverageOverall.map(p => `${CX(p.cov)},${CY(p.mae)}`).join(' L')} fill="none" stroke={C.mute} strokeWidth={1.6} strokeDasharray="4 3" markerEnd="none" />}
            <path d={'M' + PUBLISHED.coverage.map(p => `${CX(p.cov)},${CY(p.mae)}`).join(' L')} fill="none" stroke={C.amber} strokeWidth={2.4} />
            {PUBLISHED.coverage.map((p, i) => <g key={i} onClick={() => setCovIdx(i)} className="cursor-pointer"><circle cx={CX(p.cov)} cy={CY(p.mae)} r={i === covIdx ? 9 : 6} fill={i === covIdx ? C.amber : '#fff'} stroke={C.amber} strokeWidth={2.4} /><SvgMath x={CX(p.cov)} y={CY(p.mae) - 22} w={76} tex={`${p.cov}\\% \\cdot ${p.mae}`} color={C.amber} bold /></g>)}
          </svg>
          <p className="text-center text-[11px] text-stone-500">Reported-window coverage (motion windows) <Tex tex="\to" /> · MAE (<Tex tex="\mathrm{BPM}" />) <Tex tex="\uparrow" /></p>
          <label className="flex items-center gap-2 text-[13px] mt-2 cursor-pointer"><input type="checkbox" checked={showOverall} onChange={() => setShowOverall(!showOverall)} className="accent-amber-600" /> Show overall (static + motion) curve — dashed, values read from Fig. 2 shape</label>
        </div>
        <div>
          <div className="bg-stone-900 text-white rounded-xl p-5">
            <h3 className="font-serif text-xl font-semibold text-white">Sustained-motion stress test</h3>
            <div className="grid grid-cols-3 gap-3 mt-3 text-center">
              <div><p className="font-serif text-[20px] leading-snug font-semibold whitespace-nowrap"><Tex tex="17.65 \to 15.30" /></p><p className="text-[11px] text-stone-400">MAE (<Tex tex="\mathrm{BPM}" />), HGB baseline <Tex tex="\to" /> + Viterbi</p></div>
              <div><p className="font-serif text-[20px] leading-snug font-semibold whitespace-nowrap"><Tex tex="0.631 \to 0.724" /></p><p className="text-[11px] text-stone-400">Pearson <Tex tex="r" /></p></div>
              <div><p className="font-serif text-[20px] leading-snug font-semibold whitespace-nowrap"><Tex tex="40.04" /></p><p className="text-[11px] text-stone-400">Baseline <Tex tex="\mathrm{P90}" /> error (<Tex tex="\mathrm{BPM}" />) — heavy-tailed</p></div>
            </div>
            <p className="text-[12px] text-stone-400 mt-3"><MathNumbers text={PUBLISHED.stress.windows} />, subject-disjoint splits. Heavy tails are exactly what temporal decoding + selective reporting are for.</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-8 mt-12">
        <div>
          <h3 className="font-serif text-xl font-semibold">Ablations — Table <Tex tex="2" /> (expandable)</h3>
          <div className="mt-3 space-y-2">
            {PUBLISHED.ablations.map(a => (
              <details key={a.ablation} className="border border-stone-200 rounded-xl bg-white group">
                <summary className="px-4 py-3 cursor-pointer text-sm list-none flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-3"><span><b className="text-stone-800">{a.module}:</b> <span className="text-stone-600"><MathNumbers text={a.ablation} /></span></span><span className="text-[12px] text-teal-800 font-semibold sm:text-right break-words"><MathNumbers text={a.result.replace('Δ', 'Δ ')} /></span></summary>
                <p className="px-4 pb-3.5 text-[13px] text-stone-600 border-t border-stone-100 pt-2.5"><MathNumbers text={a.detail} /></p>
              </details>))}
          </div>
        </div>
        <div>
          <h3 className="font-serif text-xl font-semibold">Deployment — ESP32-S3 inference core</h3>
          <div className="grid grid-cols-3 gap-3 mt-3 text-center">
            {[[PUBLISHED.deploy.latency, 'mean latency / window'], [PUBLISHED.deploy.storage, 'model storage'], [PUBLISHED.deploy.p95, 'p95 latency']].map(([v, k]) => (
              <div key={k} className="bg-stone-50 border border-stone-200 rounded-xl py-4 px-2"><p className="font-serif text-xl font-semibold text-stone-900"><Tex tex={toTexExpr(v)} /></p><p className="text-[11px] text-stone-500 mt-1"><MathNumbers text={k} /></p></div>))}
          </div>
          <ul className="text-[13px] text-stone-600 mt-4 space-y-1.5 list-disc pl-5">
            <li>Median <MathNumbers text={PUBLISHED.deploy.median} /> · max <MathNumbers text="197.949 ms" /> over <MathNumbers text="60" /> warm inferences (<MathNumbers text="5" /> passes <Tex tex="\times" /> <MathNumbers text="12" /> windows); <MathNumbers text={PUBLISHED.deploy.heap} />.</li>
            <li>Estimated inference energy <MathNumbers text={PUBLISHED.deploy.energy} /> Candidate/Viterbi selections match desktop on all <MathNumbers text="12" /> golden windows (max reliability <Tex tex="\Delta" /> <Tex tex="=" /> <MathNumbers text="3.815×10⁻⁶" />).</li>
            <li><b>Scope note:</b> <MathNumbers text={PUBLISHED.deploy.hw} />. This is a feature-vector inference-core benchmark, <em>not</em> complete end-to-end hardware deployment; raw-signal candidate generation remains a staged migration step. A separate <MathNumbers text="100 Hz" /> live-sensing prototype streams waveforms + beat events to a browser UI.</li>
          </ul>
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
            <span className="px-5 py-2.5 rounded-full border border-dashed border-stone-300 text-sm text-stone-400">Code / data: not included with the paper PDF</span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="font-serif font-semibold text-lg mb-2">Cite this work</p>
          <div className="relative">
            <pre className="bg-stone-900 text-stone-200 text-[12px] leading-relaxed rounded-xl p-4 overflow-x-auto">{BIB}</pre>
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
          <button onClick={() => scrollTo('top')} className="font-serif font-bold text-xl tracking-tight text-stone-900">CITRUS<span className="text-blue-700">.</span></button>
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
        <h1 className="font-serif text-[29px] sm:text-4xl md:text-[56px] leading-[1.12] font-semibold text-stone-900 mt-4 max-w-4xl">CITRUS: Candidate Inference, Temporal Decoding, and Reliability-Gated Reporting for Wearable Devices</h1>
        <p className="font-serif text-xl md:text-2xl text-stone-500 mt-5">From noisy PPG signals to reliable heart-rate estimates.</p>
        <p className="text-sm text-stone-500">UbiComp Companion ’26 · Shanghai, China · Oct 11–15, 2026</p>
        <p className="mt-4 text-[15px]"><b>Yi Wang</b> <span className="text-stone-500">(HKUST Guangzhou)</span> · <b>Siyuan Liang</b> <span className="text-stone-500">(Cornell)</span> · <b>Yuntao Wang</b> <span className="text-stone-500">(Tsinghua, corresponding)</span></p>
        <div className="flex flex-wrap gap-2.5 mt-6">
          <button onClick={() => scrollTo('demo')} className="px-6 py-3 rounded-full bg-blue-700 text-white font-semibold text-sm hover:bg-blue-800 shadow-sm">Explore Interactive Demo ↓</button>
          <a href="/citrus.pdf" className="px-6 py-3 rounded-full border border-stone-300 font-semibold text-sm hover:border-blue-500">Paper PDF</a>
        </div>
        <div className="border border-stone-200 rounded-2xl mt-9 px-4 pt-2 pb-1 bg-gradient-to-b from-white to-stone-50"><img src="/citrus-hero.gif" width={1200} height={240} className="w-full h-auto block" alt="Animated CITRUS pipeline: noisy PPG and accelerometer scroll in, become about 140 candidate heart rates per window (motion cluster at 84 BPM, pulse cluster at 114 BPM), then a decoded heart-rate trace that is accepted, held, or rejected" /></div>
        <div className="grid md:grid-cols-4 gap-3 mt-6 text-center">
          {[['−24%', 'motion MAE vs LSTM: 14.39 → 10.91 BPM', C.teal], ['≈140', 'candidate hypotheses per 30 s window', C.blue], ['2.90 BPM', 'reported MAE at 31% motion coverage', C.amber], ['156.4 ms', 'ESP32-S3 inference-core latency / window', C.ink]].map(([v, k, col]) => (
            <div key={k} className="border border-stone-200 rounded-xl py-4 px-3"><p className="font-serif text-[26px] font-semibold" style={{ color: col as string }}><Tex tex={toTexExpr(v)} /></p><p className="text-[12px] text-stone-500 mt-1 leading-snug"><MathNumbers text={k} /></p></div>))}
        </div>
      </header>

      <Playground />
      <Evaluation />
      <Paper />
      <footer className="max-w-6xl mx-auto px-5 py-8 border-t border-stone-200 flex flex-wrap gap-3 justify-between text-[12px] text-stone-400">
        <span>CITRUS · UbiComp Companion ’26 · CC BY 4.0</span>
        <span>Playground data: synthetic illustration from the paper protocol · Published results: verbatim from the paper</span>
      </footer>
    </div>
  )
}
