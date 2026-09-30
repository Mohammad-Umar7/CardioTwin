# CardioTwin — web app

Explainable coronary-risk digital twin: overall CAD and LAD · LCX · RCA stenosis probabilities, SHAP
explanations and an interactive 3D heart (BodyParts3D) in the browser. Decision support and education only —
not a diagnosis.

## Prerequisites

* Node.js ≥ 20.19 (developed on 22) and npm 10
* Optional, for live estimates: the FastAPI service in `../backend` (Python 3.11, trained artifacts in `../ml/artifacts`)

## Run

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173 — proxies /api to http://localhost:8000
```

In another terminal, from the repository root, start the API so the app can compute estimates:

```bash
./.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --port 8000   # Windows
.venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000         # macOS / Linux
```

Without a reachable API the app still loads the cohort, schema, metrics and anatomy, and clearly reports
"Estimate unavailable" (the in-browser engine is the next development phase).

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with HMR and the `/api` proxy |
| `npm run build` | Type-check and build to `dist/` (relative base: deployable under any sub-path) |
| `npm run preview` | Serve `dist/` locally (also proxies `/api`) |
| `npm run typecheck` | `tsc -b` in strict mode |
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm test` | Vitest unit and component tests, including the colour-vision gate for the risk ramp |

## Configuration

Copy `.env.example` to `.env.local` to override:

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_API_URL` | *(empty)* | API base URL; empty = same origin (`/api/*`) |
| `VITE_API_PROXY` | `http://localhost:8000` | Dev / preview proxy target for `/api` |
| `VITE_API_HEALTH_TIMEOUT_MS` | `1500` | Health-check timeout before falling back to the in-browser engine |

## Data

* `public/model/*.json` — model artifacts mirrored by the ML pipeline. If a file is missing there but present in
  `../ml/artifacts/`, the Vite plugin in `build/modelArtifacts.ts` serves it in dev and emits it into the build.
* `public/anatomy/` — `cardiotwin_anatomy.glb` (meshopt), `manifest.json`, `vessels.json` from the anatomy pipeline.
  Without the GLB the 3D view shows a procedural schematic heart with the same risk colouring.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the module map and extension points, and
[`../docs/design/DESIGN_SYSTEM.md`](../docs/design/DESIGN_SYSTEM.md) for the binding design specification.

## Licences

Code: MIT. Anatomy: BodyParts3D © The Database Center for Life Science, CC BY-SA 2.1 Japan. Data: UCI Machine
Learning Repository #411 (Extension of Z-Alizadeh Sani), CC BY 4.0.
