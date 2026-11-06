# CITRUS — Interactive Research Website

CITRUS: Candidate Inference, Temporal Decoding, and Reliability-Gated Reporting
for Wearable Devices (UbiComp Companion '26).

React + TypeScript + Vite + Tailwind CSS. All charts are hand-rolled SVG/canvas.

## Run
```bash
pnpm install
pnpm dev         # develop
pnpm build       # production build -> dist/
```

## Data honesty
The authors' real data package lives in `reference/` (see
`reference/README_先读.txt`); the playground no longer uses synthetic data.
`scripts/build_real_data.py` builds `src/real-data.json` from it: the three
stored windows (subject 00020) with their frozen candidates, scored by
running the supplied current-HGB weights (self-checked against the verified
05 replay — decoded HR exact, reliability within 1e-5; subject 00020 is not
the held-out subject, so this is model output, not a held-out evaluation).
Coverage curves in Evaluation are the exact `ring_p13_coverage-summary.csv`
points; other Evaluation numbers are the paper's published values.
`public/citrus.pdf` serves the paper itself.
