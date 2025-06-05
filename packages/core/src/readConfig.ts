import fs from 'fs';
import path from 'path';
import { z } from 'zod'; // Add zod for validation

// Config schema validation
const ConfigSchema = z.object({
  project: z.string(),
  documents: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      path: z.string()
    })
  )
});

export async function readConfig(rootDir: string) {
  const configPath = path.join(rootDir, 'authord.config.json');
  
  if (!fs.existsSync(configPath)) {
    throw new Error('Configuration file not found');
  }

  try {
    const rawData = await fs.promises.readFile(configPath, 'utf-8');
    const config = JSON.parse(rawData);
    return ConfigSchema.parse(config); // Validates structure
  } catch (error:any) {
    throw new Error(`Invalid configuration: ${error.message}`);
  }
}