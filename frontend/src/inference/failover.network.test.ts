/**
 * Engine fallback over REAL sockets (no mocked fetch): the API client is pointed at a dead port, and at a
 * stub FastAPI on an ephemeral port that is stopped, restarted, made to fail and made to hang mid-session.
 * The stub answers `/api/predict` with the portable model's own numbers (`engine: "server"`), so every
 * switch between engines must be invisible except for the `engine` field.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApiClient } from '@/services/api';
import { EdgeEngine, ServerEngine, resolveEngine } from '@/services/engine';
import type { HealthResponse, PredictResponse } from '@/types/contracts';
import { InferenceClient } from './client';
import { EdgeModel } from './model';
import { compareResponses } from './parity';
import { loadCohort, loadModelSpec } from './testing/artifacts';

type Mode = 'ok' | 'error500' | 'hang';

/** Minimal stand-in for the FastAPI app on 127.0.0.1:<ephemeral>. */
class StubApi {
  mode: Mode = 'ok';
  predictions = 0;
  port = 0;
  private server: http.Server | null = null;

  constructor(private readonly model: EdgeModel) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  start(port = this.port): Promise<void> {
    const server = http.createServer((req, res) => this.handle(req, res));
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        this.port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  /** Close the listener AND every kept-alive connection, like a crashed process. */
  stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  health(): HealthResponse {
    return {
      status: 'ok',
      model_version: this.model.modelVersion,
      engine: 'server',
      predictor: 'real',
      targets: [...this.model.targets],
    } as unknown as HealthResponse;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/api/health') return send(200, this.health());
    if (req.method === 'POST' && req.url === '/api/predict') {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
      req.on('end', () => {
        this.predictions += 1;
        if (this.mode === 'hang') return; // never answers
        if (this.mode === 'error500') return send(500, { error: 'internal_error', message: 'boom' });
        const { features } = JSON.parse(raw) as { features: Record<string, number | string> };
        try {
          send(200, { ...this.model.predict(features), engine: 'server' });
        } catch (error) {
          send(422, { error: 'validation_error', message: (error as Error).message });
        }
      });
      return;
    }
    send(404, { error: 'not_found', message: req.url ?? '' });
  }
}

/** A port nothing listens on (bound once, then released). */
async function deadPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

let model: EdgeModel;
let stub: StubApi;
const clients: InferenceClient[] = [];
const features = () => loadCohort().patients[3]!.features;

function edge(): EdgeEngine {
  const client = new InferenceClient({ source: { spec: loadModelSpec() } });
  clients.push(client);
  return new EdgeEngine({ client });
}

beforeAll(async () => {
  model = new EdgeModel(loadModelSpec());
  stub = new StubApi(model);
  await stub.start();
});

afterEach(() => {
  stub.mode = 'ok';
  for (const c of clients.splice(0)) c.dispose();
});

afterAll(async () => {
  await stub.stop();
});

describe('engine fallback over real sockets', () => {
  it('API base on a dead port → resolveEngine serves from the edge, same numbers', async () => {
    const api = createApiClient(`http://127.0.0.1:${await deadPort()}`);
    const resolution = await resolveEngine({ client: api, createEdge: edge, override: null, timeoutMs: 3000 });
    expect(resolution.engine.kind).toBe('edge');
    expect(resolution.health).toBeNull();
    expect(resolution.reason).toMatch(/unreachable/i);
    const response = await resolution.engine.predict(features());
    expect(response.engine).toBe('edge');
    expect(compareResponses(response, model.predict(features())).agree).toBe(true);
  });

  it('server → crash → edge → restart → server, with identical numbers throughout', async () => {
    const api = createApiClient(stub.url);
    const resolution = await resolveEngine({ client: api, createEdge: edge, override: null });
    expect(resolution.engine.kind).toBe('server');
    const engine = new ServerEngine(api, resolution.health, { fallback: edge, retryAfterMs: 150 });

    const fromServer = await engine.predict(features());
    expect(fromServer.engine).toBe('server');

    await stub.stop();
    const duringOutage = await engine.predict(features());
    expect(duringOutage.engine).toBe('edge');
    expect(engine.failedOver).toBe(true);
    const report = compareResponses(duringOutage, fromServer);
    expect(report.mismatches).toEqual([]);
    expect(report.maxDeltaProbability).toBe(0);

    await stub.start(); // same port
    await new Promise((r) => setTimeout(r, 200));
    const afterRestart = await engine.predict(features());
    expect(afterRestart.engine).toBe('server');
    expect(engine.failedOver).toBe(false);
  });

  it('fails over on HTTP 500 but surfaces validation errors (422) from a live server', async () => {
    const api = createApiClient(stub.url);
    const engine = new ServerEngine(api, stub.health(), { fallback: edge, retryAfterMs: 0 });
    stub.mode = 'error500';
    await expect(engine.predict(features())).resolves.toMatchObject({ engine: 'edge' });
    stub.mode = 'ok';
    const before = stub.predictions;
    const bad = { ...features(), Nope: 1 } as Record<string, number>;
    await expect(engine.predict(bad)).rejects.toMatchObject({ status: 422, code: 'validation_error' });
    expect(stub.predictions).toBe(before + 1); // answered by the server, not silently by the edge
  });

  it('fails over from a server that accepts the connection but never answers', async () => {
    const api = createApiClient(stub.url);
    const engine = new ServerEngine(api, stub.health(), { fallback: edge, timeoutMs: 400 });
    stub.mode = 'hang';
    const t0 = performance.now();
    const response = await engine.predict(features());
    expect(response.engine).toBe('edge');
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it('builds a fresh fallback after one failed to load (no permanent outage)', async () => {
    const api = createApiClient(`http://127.0.0.1:${await deadPort()}`);
    let attempt = 0;
    const flaky = (): EdgeEngine => {
      attempt += 1;
      if (attempt === 1) {
        const client = new InferenceClient({ source: { spec: { format: 'nope' } as never } });
        clients.push(client);
        return new EdgeEngine({ client });
      }
      return edge();
    };
    const engine = new ServerEngine(api, stub.health(), { fallback: flaky, timeoutMs: 3000 });
    await expect(engine.predict(features())).rejects.toMatchObject({ name: expect.stringMatching(/NetworkError|TimeoutError/) });
    const second: PredictResponse = await engine.predict(features());
    expect(second.engine).toBe('edge');
    expect(attempt).toBe(2);
  });
});
