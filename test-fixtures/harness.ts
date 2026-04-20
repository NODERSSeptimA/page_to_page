import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createOriginApp } from './origin/server.js';
import { createTargetApp } from './target/server.js';

export interface FixtureHandles {
  originUrl: string;
  targetUrl: string;
  stop: () => Promise<void>;
}

async function listen(app: ReturnType<typeof createOriginApp>): Promise<{ url: string; server: Server }> {
  return new Promise((done, fail) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const a = server.address() as AddressInfo;
      done({ url: `http://127.0.0.1:${a.port}`, server });
    });
    server.on('error', fail);
  });
}

export async function startFixtures(): Promise<FixtureHandles> {
  const origin = await listen(createOriginApp());
  const target = await listen(createTargetApp());
  return {
    originUrl: origin.url,
    targetUrl: target.url,
    stop: async () => {
      await Promise.all([
        new Promise<void>((r) => origin.server.close(() => r())),
        new Promise<void>((r) => target.server.close(() => r())),
      ]);
    },
  };
}
