/**
 * Vite plugin: make the trained ML artifacts available at `model/*.json` even when
 * `public/model/` has not been populated yet.
 *
 * The ML pipeline mirrors its artifacts into `frontend/public/model/` (the normal path). When that
 * mirror is missing a file but `ml/artifacts/` has it (a fresh checkout after training, or the Docker
 * build stage, which copies `ml/artifacts/` next to the frontend), this plugin:
 *   - dev:   serves `ml/artifacts/<file>` for `GET <base>model/<file>`;
 *   - build: emits the missing files into `dist/model/`.
 * Files already present in `public/model/` always win, so the plugin never shadows the mirror.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const ARTIFACT_PATTERN = /^[\w.-]+\.json$/;

export interface ModelArtifactsOptions {
  /** Directory the ML pipeline writes to, normally `<repo>/ml/artifacts`. */
  artifactsDir: string;
  /** Directory Vite serves statically, normally `<frontend>/public`. */
  publicDir: string;
}

function listArtifacts(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((name) => ARTIFACT_PATTERN.test(name));
  } catch {
    return [];
  }
}

export function modelArtifacts(options: ModelArtifactsOptions): Plugin {
  const { artifactsDir, publicDir } = options;
  const mirrorDir = path.join(publicDir, 'model');
  const missingFromMirror = () =>
    listArtifacts(artifactsDir).filter((name) => !fs.existsSync(path.join(mirrorDir, name)));

  return {
    name: 'cardiotwin:model-artifacts',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        const name = /\/model\/([\w.-]+\.json)$/.exec(url)?.[1];
        if (!name || fs.existsSync(path.join(mirrorDir, name))) return next();
        const source = path.join(artifactsDir, name);
        if (!fs.existsSync(source)) return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(source).pipe(res);
      });
    },
    generateBundle() {
      for (const name of missingFromMirror()) {
        this.emitFile({
          type: 'asset',
          fileName: `model/${name}`,
          source: fs.readFileSync(path.join(artifactsDir, name)),
        });
      }
    },
  };
}
