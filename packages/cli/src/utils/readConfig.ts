import fs from 'fs';
import path from 'path';
import { z } from 'zod';

// 1. Recursive TOC element: { topic: string; children: TocElement[] }
const TocElementSchema: z.ZodType<{
  topic: string;
  children: Array<{ topic: string; children: any[] }>;
}> = z.lazy(() =>
  z.object({
    topic: z.string(),
    children: z.array(TocElementSchema),
  })
);

// 2. InstanceProfile‐like objects: { id, name, start-page?, toc-elements }
const InstanceSchema = z.object({
  id: z.string(),
  name: z.string(),
  "start-page": z.string().optional(),
  "toc-elements": z.array(TocElementSchema),
});

// 3. Top‐level config exactly as your JSON
export const ConfigSchema = z.object({
  schema: z.string().url(),
  title: z.string(),
  type: z.string(),
  topics: z
    .object({
      dir: z.string(),
    })
    .optional(),
  images: z
    .object({
      dir: z.string(),
      version: z.string(),
      "web-path": z.string(),
    }),
  instances: z.array(InstanceSchema).optional(),
});

export type LiteConfig = z.infer<typeof ConfigSchema>;

export async function readConfig(rootDir: string): Promise<LiteConfig> {
  const configPath = path.join(rootDir, 'authord.config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  try {
    const rawData = await fs.promises.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(rawData);
    return ConfigSchema.parse(parsed);
  } catch (error: any) {
    throw new Error(`Invalid configuration: ${error.message}`);
  }
}
