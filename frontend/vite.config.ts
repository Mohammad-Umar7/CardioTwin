/// <reference types="vitest/config" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { modelArtifacts } from './build/modelArtifacts';

const root = path.dirname(fileURLToPath(import.meta.url));

const VENDOR_CHUNKS: ReadonlyArray<readonly [string, RegExp]> = [
  ['vendor-three', /[\\/]node_modules[\\/](three|three-stdlib|three-mesh-bvh)[\\/]/],
  [
    'vendor-r3f',
    /[\\/]node_modules[\\/](@react-three|postprocessing|maath|camera-controls|troika-[\w-]+|@react-spring|n8ao|its-fine|suspend-react)[\\/]/,
  ],
  ['vendor-react', /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run)[\\/]/],
  ['vendor-motion', /[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/],
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, 'VITE_');
  const apiProxy = env.VITE_API_PROXY || 'http://localhost:8000';
  const proxy = { '/api': { target: apiProxy, changeOrigin: true } };

  return {
    // Relative base: the build works from any sub-path (GitHub Pages, a CDN folder, FastAPI at /).
    base: './',
    plugins: [
      react(),
      modelArtifacts({
        artifactsDir: path.resolve(root, '../ml/artifacts'),
        publicDir: path.resolve(root, 'public'),
      }),
    ],
    resolve: {
      alias: { '@': path.resolve(root, 'src') },
      dedupe: ['three', 'react', 'react-dom'],
    },
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            return VENDOR_CHUNKS.find(([, pattern]) => pattern.test(id))?.[0];
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      include: ['src/**/*.test.{ts,tsx}'],
      restoreMocks: true,
    },
  };
});
