import { z } from 'zod';

export const ViewportSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const AuthSchema = z.object({
  enabled: z.boolean().default(false),
  loginUrl: z.string().url().optional(),
  usernameEnv: z.string().optional(),
  passwordEnv: z.string().optional(),
  usernameSelector: z.string().optional(),
  passwordSelector: z.string().optional(),
  submitSelector: z.string().optional(),
  successSelector: z.string().optional(),
  headfulFallbackTimeoutMs: z.number().int().positive().default(300_000),
});

export const ConfigSchema = z.object({
  originUrl: z.string().url(),
  targetUrl: z.string().url(),
  viewports: z.array(ViewportSchema).min(1).default([
    { name: 'mobile',  width: 375,  height: 812 },
    { name: 'tablet',  width: 768,  height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ]),
  extraRoutes: z.array(z.string()).default([]),
  maskSelectors: z.array(z.string()).default([]),
  concurrency: z.number().int().min(1).max(8).default(4),
  auth: AuthSchema.default({ enabled: false }),
  artifactsDir: z.string().default('./page-to-page-artifacts'),
  stateFile: z.string().default('./page-to-page.state.json'),
});

export type Config = z.infer<typeof ConfigSchema>;
