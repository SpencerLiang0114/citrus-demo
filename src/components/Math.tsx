import { useMemo } from 'react'
import katex from 'katex'

/**
 * Renders markdown-style math ($...$ / $$...$$ source, without the delimiters)
 * to real typeset symbols via KaTeX at runtime.
 * Usage: <Tex tex="68\ \mathrm{BPM}" />  ·  <Tex tex="\lambda_{\mathrm{rej}} = 8" />
 */
export function Tex({ tex, block = false, className = '', style }: { tex: string; block?: boolean; className?: string; style?: React.CSSProperties }) {
  const html = useMemo(() => katex.renderToString(tex, { displayMode: block, throwOnError: false, strict: false, trust: true }), [tex, block])
  if (block) return <span className={`katex-block ${className}`} style={style} dangerouslySetInnerHTML={{ __html: html }} />
  return <span className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />
}

const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' }

/** Convert a plain numeric expression ("5.52 ± 0.33", "~50–70%", "20.60–28.19 mJ", "3.815×10⁻⁶") to LaTeX source. */
export function toTexExpr(input: string): string {
  let s = input.trim()
  s = s.replace(/×10([⁻-]?)((?:[⁰¹²³⁴⁵⁶⁷⁸⁹]|\d)+)/g, (_, sign, sup) => `\\times 10^{${sign}${[...sup].map(c => SUP[c] ?? c).join('')}}`)
  s = s.replace(/−/g, '-').replace(/–/g, '\\text{–}').replace(/→/g, ' \\to ')
  s = s.replace(/±/g, ' \\pm ').replace(/~/g, '\\sim ').replace(/≈/g, '\\approx ').replace(/%/g, '\\%')
  s = s.replace(/(\d),(\d)/g, '$1{,}$2')
  s = s.replace(/\s*(BPM|MHz|ms|Hz|mJ)(?![A-Za-z])/g, '\\ \\mathrm{$1}')
  s = s.replace(/\s*(B|h)$/, '\\ \\mathrm{$1}')
  s = s.replace(/@/g, '\\text{ @ }')
  return s
}

const CORE = String.raw`\d[\d,]*(?:\.\d+)?`
// A numeric result token: optional sign/≈/~, value, optional ± std, optional range/arrow pair,
// optional ×10⁻ⁿ exponent, optional unit. Lookbehind keeps digits inside identifiers (ESP32-S3) as text.
const NUM_RE = new RegExp(`(?<![A-Za-z0-9])([~≈−+]?${CORE}(?:\\s*±\\s*${CORE})?(?:\\s*[→–]\\s*[−+]?${CORE}(?:\\s*±\\s*${CORE})?)?(?:×10[⁻-]?[⁰¹²³⁴⁵⁶⁷⁸⁹\\d]+)?(?:\\s*(?:BPM|MHz|ms|Hz|mJ|%|B|h))?)`, 'g')
const NUM_FULL = new RegExp(`^${NUM_RE.source}$`)

/**
 * Renders prose with every numeric token typeset as KaTeX math; words stay in the
 * surrounding text font (never math italics). Use for experiment-result strings
 * that mix values with labels, e.g. "Δ overall MAE −0.01 BPM; 85k → 28k params".
 */
const GREEK: Record<string, string> = { 'Δ': '\\Delta', 'λ': '\\lambda', 'τ': '\\tau', 'Ω': '\\Omega' }
export function MathNumbers({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {text.split(/([ΔλτΩ])/).map((seg, i) => GREEK[seg]
        ? <Tex key={i} tex={GREEK[seg]} />
        : seg.split(NUM_RE).map((p, j) => (p && NUM_FULL.test(p) ? <Tex key={`${i}-${j}`} tex={toTexExpr(p)} /> : <span key={`${i}-${j}`}>{p}</span>)))}
    </span>
  )
}
