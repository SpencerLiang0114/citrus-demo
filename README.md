# CITRUS — Interactive Research Website

CITRUS: Candidate Inference, Temporal Decoding, and Reliability-Gated
Reporting for Wearable Devices (UbiComp Companion '26).

Interactive companion site for the paper: a stage-by-stage playground over
recorded PPG windows, published evaluation results, and the paper PDF.
Built with React + TypeScript + Vite + Tailwind CSS. All charts are
hand-rolled SVG/canvas.

## Quick start

Requires Node.js >= 20 and pnpm.

```bash
pnpm install
pnpm dev       # develop
pnpm build     # production build -> dist/
pnpm preview   # serve the production build locally
```

## Deploy

The site is a static build (`dist/`). Any static host works:

- **Vercel / Netlify:** import the repo, build command `pnpm build`,
  output directory `dist`. No other configuration needed.
- **GitHub Pages:** enable Pages with source "GitHub Actions". The
  workflow in `.github/workflows/deploy.yml` builds and deploys on push
  to `main`, setting the base path from the repository name automatically.
- **Subpath hosting in general:** build with `VITE_BASE=/your-path/ pnpm build`.

## Project structure

```
index.html          entry page
public/             paper PDF and hero animation, served as-is
src/App.tsx         page sections and playground
src/components/     math typesetting and chart components
src/data.ts         data layer over the prebuilt snapshot
src/real-data.json  prebuilt playground data (recorded windows + replay)
```

## Data

`src/real-data.json` is a prebuilt snapshot derived from recorded windows
and the paper's published evaluation values. The raw recordings, model
weights, and internal working files are not redistributed in this
repository; the snapshot is sufficient to run and deploy the site as-is.

## Citation

See the "Cite this work" section on the site (BibTeX included), or read
the paper: `public/citrus.pdf`.

## License

Website code: MIT (see `LICENSE`). Paper PDF: CC BY 4.0.
