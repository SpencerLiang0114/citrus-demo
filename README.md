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

## Data
Playground data is built from the authors' package in `reference/` by
`scripts/build_real_data.py`. The paper's MLP weights are not in the package,
so Stage 3 MLP scores are retrained there on the stored candidates.
Evaluation numbers are the paper's published values. `public/citrus.pdf`
serves the paper itself.
