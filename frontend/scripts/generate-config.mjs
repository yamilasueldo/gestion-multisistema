import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const apiBaseUrl = (process.env.API_BASE_URL || 'http://localhost:3100/api').replace(/\/+$/, '');
writeFileSync(
  resolve('src/generated-api.ts'),
  `// Archivo generado por scripts/generate-config.mjs\nexport const API_BASE_URL = ${JSON.stringify(apiBaseUrl)};\n`,
  'utf8',
);
