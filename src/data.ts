// ── CITRUS synthetic-but-structured replay data ─────────────────────────────
// No raw dataset ships with the paper PDF, so every waveform / candidate below
// is a *deterministic synthetic illustration* generated from the paper's
// described protocol (30 s windows, 25 Hz ring PPG, IR+red, ACC, candidates
// in [35,220] BPM from Welch / autocorrelation / peak-interval + harmonics).
// Published numbers live ONLY in PUBLISHED and are never mixed into replay.

export type Method = 'Welch PSD' | 'Autocorrelation' | 'Peak-interval'
export interface Candidate {
  id: string; hr: number; method: Method; channel: 'IR' | 'Red'
  power: number; harmonic: '0.5×' | '1×' | '2×' | '—'; isMotionPeak: boolean
  score: number; cost: number
  feats: { spectral: number; consensus: number; harmonic: number; source: number; temporal: number }
}
export interface Win {
  idx: number; t0: number; trueHR: number; motionFreqBPM: number; motionAmp: number
  candidates: Candidate[]; independentHR: number; viterbiHR: number
  reliability: number; errIndep: number; errVit: number
}
export interface Recording {
  id: string; label: string; sub: string; motion: string; nWindows: number
  trueBase: number; windows: Win[]
  series: { t: number; ir: number; red: number; acc: number; refHR: number }[]
  psd: { bpm: number; ir: number; red: number }[]
  autocorr: { lagBPM: number; v: number }[]
}

// deterministic PRNG
function mulberry(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const gauss = (x: number, mu: number, sig: number, amp = 1) => amp * Math.exp(-((x - mu) ** 2) / (2 * sig * sig))

function buildRecording(cfg: { id: string; label: string; sub: string; motion: string; seed: number; base: (t: number) => number; motionBPM: number; motionAmp: number; noise: number }): Recording {
  const rnd = mulberry(cfg.seed)
  const NW = 12, DUR = NW * 30
  const series: Recording['series'] = []
  // 2 Hz display series (720 pts) — waveform shape synthesized at display rate via phase
  let phase = 0
  for (let i = 0; i < DUR * 4; i++) {
    const t = i / 4
    const hr = cfg.base(t) / 60, mf = cfg.motionBPM / 60
    phase += (Math.PI * 2 * hr) / 4
    const pulse = Math.pow(Math.max(0, Math.sin(phase)), 3) * 0.9 + 0.18 * Math.sin(phase * 2 + 1)
    const mot = cfg.motionAmp * Math.sin(2 * Math.PI * mf * t) + cfg.motionAmp * 0.4 * Math.sin(2 * Math.PI * mf * 2 * t + 0.7)
    const n = (rnd() - 0.5) * cfg.noise
    series.push({ t, ir: pulse + mot + n, red: 0.82 * pulse + 0.9 * mot + (rnd() - 0.5) * cfg.noise, acc: Math.abs(mot) * 1.6 + (rnd() - 0.5) * 0.15, refHR: cfg.base(t) + (rnd() - 0.5) * 2 })
  }
  const windows: Win[] = []
  let prevVit = cfg.base(0)
  for (let w = 0; w < NW; w++) {
    const trueHR = Math.round(cfg.base(w * 30 + 15))
    const strongMotion = cfg.motionAmp > 0.35
    const cands: Candidate[] = []
    const push = (hr: number, method: Method, ch: 'IR' | 'Red', power: number, harm: Candidate['harmonic'], isMotion = false) => {
      hr = Math.round(clamp(hr, 35, 220))
      if (cands.some(c => Math.abs(c.hr - hr) < 3 && c.method === method)) return
      const distTrue = Math.abs(hr - trueHR)
      const consensus = clamp(1 - distTrue / 60 + (rnd() - 0.5) * 0.2, 0.05, 1)
      const spectral = clamp(power + (rnd() - 0.5) * 0.15, 0.03, 1)
      const harmonicF = harm === '1×' ? 0.9 : harm === '—' ? 0.6 : 0.35
      const temporal = clamp(1 - Math.abs(hr - prevVit) / 55, 0.05, 1)
      const source = method === 'Welch PSD' ? 0.8 : method === 'Autocorrelation' ? 0.7 : 0.6
      // learned-ranker-like logit: truth wins on features, NOT on raw power alone
      const logit = 1.5 * consensus + 0.9 * spectral + 0.7 * harmonicF + 0.5 * source + 1.1 * temporal - (isMotion ? 0.55 : 0) + (rnd() - 0.5) * 0.5
      const score = 1 / (1 + Math.exp(-(logit - 1.6)))
      cands.push({ id: `${w}-${cands.length}`, hr, method, channel: ch, power: spectral, harmonic: harm, isMotionPeak: isMotion, score, cost: Math.round((1 - score) * 100) / 10, feats: { spectral: Math.round(spectral * 100) / 100, consensus: Math.round(consensus * 100) / 100, harmonic: Math.round(harmonicF * 100) / 100, source, temporal: Math.round(temporal * 100) / 100 } })
    }
    // true-HR hypotheses from all three families
    push(trueHR + (rnd() - 0.5) * 4, 'Welch PSD', 'IR', strongMotion ? 0.55 : 0.95, '1×')
    push(trueHR + (rnd() - 0.5) * 5, 'Autocorrelation', 'IR', 0.7, '1×')
    push(trueHR + (rnd() - 0.5) * 6, 'Peak-interval', 'Red', 0.62, '1×')
    push(trueHR + (rnd() - 0.5) * 8, 'Welch PSD', 'Red', strongMotion ? 0.5 : 0.8, '1×')
    // motion peak — the strongest spectral peak under motion (the trap)
    if (cfg.motionAmp > 0.12) {
      push(cfg.motionBPM + (rnd() - 0.5) * 4, 'Welch PSD', 'IR', 0.99, '1×', true)
      push(cfg.motionBPM * 2 > 220 ? cfg.motionBPM : cfg.motionBPM * 2, 'Welch PSD', 'Red', 0.6, '2×', true)
      push(cfg.motionBPM / 2, 'Autocorrelation', 'IR', 0.45, '0.5×', true)
    }
    // harmonics of truth + scattered hypotheses
    push(trueHR * 2, 'Welch PSD', 'IR', 0.5, '2×'); push(trueHR / 2, 'Autocorrelation', 'Red', 0.42, '0.5×')
    for (let k = 0; k < 4; k++) push(45 + rnd() * 150, (['Welch PSD', 'Autocorrelation', 'Peak-interval'] as Method[])[k % 3], k % 2 ? 'Red' : 'IR', 0.2 + rnd() * 0.3, '—')
    cands.sort((a, b) => b.score - a.score)
    let independentHR = cands[0].hr
    // Scorer-only failures the decoder must fix: in some motion windows the
    // per-window argmax jumps to the motion peak / a harmonic.
    if (cfg.motionAmp > 0.35 && w % 4 === 1) {
      const trap = cands.find(c => c.isMotionPeak) ?? cands[1]
      if (trap && Math.abs(trap.hr - trueHR) > 12) independentHR = trap.hr
    }
    // causal Viterbi (illustrated): penalize jumps from previous decoded value
    let best = cands[0], bestCost = Infinity
    for (const c of cands) { const tot = c.cost + 0.012 * (c.hr - prevVit) ** 2; if (tot < bestCost) { bestCost = tot; best = c } }
    let viterbiHR = best.hr
    // Severe-motion windows where every hypothesis is weak: even the decoded
    // path is pulled toward the motion peak — these motivate Stage 5 reporting.
    if (cfg.motionAmp > 0.35 && w === 6) {
      const trap = cands.reduce((a, b) => Math.abs(b.hr - cfg.motionBPM) < Math.abs(a.hr - cfg.motionBPM) ? b : a, cands[0])
      if (Math.abs(trap.hr - trueHR) > 12) viterbiHR = trap.hr
    }
    // The full DP retains a cost per candidate state, so the path can recover
    // next window even when one decoded window is pulled off — no lock-in.
    prevVit = best.hr
    const errVit = Math.abs(viterbiHR - trueHR)
    let reliability = Math.round(clamp(Math.exp(-errVit / 22) - cfg.motionAmp * 0.18 + (rnd() - 0.5) * 0.12, 0.04, 0.99) * 100) / 100
    // Moderate-reliability windows: estimate is usable but estimator
    // disagreement is high — these become Hold under stricter policies.
    if (cfg.motionAmp > 0.35 && w % 4 === 3) reliability = Math.round(clamp(reliability * 0.48, 0.22, 0.42) * 100) / 100
    windows.push({ idx: w, t0: w * 30, trueHR, motionFreqBPM: cfg.motionBPM, motionAmp: cfg.motionAmp, candidates: cands, independentHR, viterbiHR, reliability, errIndep: Math.abs(independentHR - trueHR), errVit })
  }
  // PSD + autocorr for window display are regenerated per-window in the UI from window data;
  // recording-level curves use the mid recording window's characteristics
  const mid = windows[6]
  const psd: Recording['psd'] = [], autocorr: Recording['autocorr'] = []
  for (let bpm = 35; bpm <= 220; bpm += 1.5) {
    psd.push({ bpm, ir: gauss(bpm, mid.trueHR, 4, 0.6) + gauss(bpm, cfg.motionBPM, 3.5, cfg.motionAmp > 0.35 ? 1 : cfg.motionAmp) + gauss(bpm, mid.trueHR * 2, 5, 0.22) + 0.03 + rnd() * 0.02, red: gauss(bpm, mid.trueHR, 5, 0.5) + gauss(bpm, cfg.motionBPM, 4, cfg.motionAmp > 0.35 ? 0.8 : cfg.motionAmp * 0.8) + 0.025 + rnd() * 0.02 })
    autocorr.push({ lagBPM: bpm, v: gauss(bpm, mid.trueHR, 6, 0.85) + gauss(bpm, cfg.motionBPM, 7, cfg.motionAmp * 0.7) + gauss(bpm, mid.trueHR / 2, 8, 0.3) + 0.04 })
  }
  return { id: cfg.id, label: cfg.label, sub: cfg.sub, motion: cfg.motion, nWindows: NW, trueBase: cfg.base(0), windows, series, psd, autocorr }
}

export const RECORDINGS: Recording[] = [
  buildRecording({ id: 'rest', label: 'Rest', sub: 'Seated, minimal motion', motion: 'Static', seed: 11, base: t => 64 + 3 * Math.sin(t / 90), motionBPM: 0, motionAmp: 0.03, noise: 0.06 }),
  buildRecording({ id: 'squats', label: 'Deep squats', sub: 'Squat cadence ≈ motion peak', motion: 'Deep-squat protocol', seed: 42, base: t => 98 + 22 * Math.sin(t / 120) + t / 18, motionBPM: 84, motionAmp: 0.62, noise: 0.16 }),
  buildRecording({ id: 'striding', label: 'Striding', sub: 'Step frequency inside cardiac band', motion: 'Striding protocol', seed: 77, base: t => 104 + 16 * Math.sin(t / 100 + 1), motionBPM: 112, motionAmp: 0.5, noise: 0.14 }),
]

export type PolicyKey = 'l30' | 'l8' | 'l4'
export const POLICIES: Record<PolicyKey, { label: string; suffix: string; lambda: number; coverage: string; motionMAE: string; note: string; thresh: number }> = {
  l30: { label: 'λrej = 30 · full coverage', suffix: 'full coverage', lambda: 30, coverage: '100%', motionMAE: '9.99 BPM', note: 'Policy emits every window — accepts or holds through unreliable stretches.', thresh: 0.18 },
  l8: { label: 'λrej = 8 · balanced', suffix: 'balanced', lambda: 8, coverage: '~50–70%', motionMAE: '6.2 BPM @ 50%', note: 'Rejects the least reliable windows; holds briefly before rejecting.', thresh: 0.45 },
  l4: { label: 'λrej = 4 · spot-check', suffix: 'spot-check', lambda: 4, coverage: '31%', motionMAE: '2.90 BPM', note: 'High-confidence spot measurements only — comparable to static-window accuracy.', thresh: 0.68 },
}
export type Decision = 'accept' | 'hold' | 'reject'
export function decide(w: Win, thresh: number, prevDecision: Decision | null, heldHR: number | null): { d: Decision; reported: number | null } {
  if (w.reliability >= thresh) return { d: 'accept', reported: w.viterbiHR }
  if (w.reliability >= thresh * 0.55 && heldHR !== null && prevDecision !== 'reject') return { d: 'hold', reported: heldHR }
  return { d: 'reject', reported: null }
}

// ── Published results (paper text, verbatim values) ─────────────────────────
export const PUBLISHED = {
  motionTable: [
    { method: 'LSTM baseline', static: '5.52 ± 0.33', motion: 14.39, overall: '6.70 ± 0.27' },
    { method: 'LSTM + smoothing + ACC priors', static: '5.33 ± 0.29', motion: 13.00, overall: '6.35 ± 0.30' },
    { method: 'HGB direct-regression probe', static: '3.85', motion: 13.08, overall: '5.08' },
    { method: 'Candidate scorer + causal Viterbi (CITRUS)', static: '2.63 ± 0.06', motion: 10.91, overall: '3.73 ± 0.13' },
  ],
  stress: { baseMAE: 17.65, vitMAE: 15.30, r0: 0.631, r1: 0.724, windows: '4,491 windows · 37.43 h · 54 subject groups' },
  coverage: [ // motion windows, Fig.2 / §4.3 anchor points; intermediate points interpolated for the curve shape
    { cov: 100, mae: 9.99 }, { cov: 85, mae: 8.6 }, { cov: 70, mae: 7.4 }, { cov: 50, mae: 6.2 }, { cov: 40, mae: 4.6 }, { cov: 31, mae: 2.90 },
  ],
  coverageOverall: [{ cov: 100, mae: 3.9 }, { cov: 85, mae: 3.3 }, { cov: 70, mae: 2.8 }, { cov: 50, mae: 2.2 }, { cov: 31, mae: 1.6 }],
  ablations: [
    { module: 'Candidate scoring', ablation: 'Remove raw-waveform CNN encoder', result: 'Δ overall MAE −0.01 BPM; 85k → 28k params', detail: 'Structured candidate features suffice — the MLP scorer (28k params) needs no waveform encoder, a 3× parameter reduction.' },
    { module: 'Candidate generation', ablation: 'Remove ACC segment selection', result: '+1.0 BPM motion MAE', detail: 'ACC is used before candidate extraction to select motion-quiet segments for spectral estimation. It is not a candidate source.' },
    { module: 'Temporal decoder', ablation: 'Causal (online) vs. full-sequence', result: '10.66 vs. 10.88 BPM (fixed run)', detail: 'Causal decoding matches full-sequence decoding while using no future windows — suitable for real-time, on-device inference.' },
    { module: 'Reliability model', ablation: 'Feature ablation (AUC, err > 10 BPM)', result: 'PPG-only 0.898 · PPG+ACC 0.888 · ACC-only 0.710', detail: 'Accelerometer features do not improve reliability estimation; PPG quality + inter-estimator disagreement carry the signal.' },
    { module: 'Before decoding', ablation: 'Scorer output before Viterbi (5-seed primary)', result: '12.94 → 10.91 BPM motion MAE', detail: 'Primary evaluation (mean of 5 seeds): causal Viterbi removes physiologically implausible jumps left by per-window scoring.' },
  ],
  deploy: { latency: '156.429 ms', median: '188.470 ms', p95: '197.943 ms', storage: '145,280 B', heap: '392,324 B min free heap', energy: '20.60–28.19 mJ / window (mean, datasheet est.)', hw: 'ESP32-S3 rev 0.2 @ 160 MHz · feature-vector inference core only — excludes raw filtering & candidate generation' },
}
export const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
