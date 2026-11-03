# CITRUS — Interactive Research Website

CITRUS: Candidate Inference, Temporal Decoding, and Reliability-Gated Reporting
for Wearable Devices (UbiComp Companion '26, DOI 10.1145/3798063.3839136).

React + TypeScript + Vite + Tailwind CSS. All charts are hand-rolled SVG/canvas.

## Run
```bash
npm install
npm run dev      # develop
npm run build    # production build -> dist/
```

## Data honesty
No dataset or code accompanied `citrus.pdf`, so the Algorithm Playground uses
deterministic synthetic data generated from the paper's described protocol
(30 s windows, IR/red PPG + ACC, ~140 candidates in [35,220] BPM, harmonics),
clearly labeled as illustrative. Every number in Evaluation / Paper is a
published value reproduced verbatim and kept separate from replay data.
`public/citrus.pdf` serves the paper itself.
