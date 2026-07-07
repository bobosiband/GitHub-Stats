import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openapiDocument } from '../src/docs/openapi.js';

const out = fileURLToPath(new URL('../openapi.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(openapiDocument, null, 2)}\n`);
console.log(`Wrote OpenAPI spec → ${out}`);
