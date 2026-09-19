import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
if (fs.existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.DATABASE_URL?.startsWith('mysql://')) throw new Error('DATABASE_URL must be a MySQL URL');
const cli = 'node_modules/prisma/build/index.js';
// Only register an existing V1 schema after proving it matches the immutable baseline.
const diff = spawnSync(process.execPath, [cli, 'migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma',
  '--to-schema-datamodel', 'prisma/baseline/schema.prisma', '--exit-code'], { stdio: 'inherit' });
if (diff.status !== 0) {
  console.error('Baseline not registered: schema differs from V1. Review the diff before deploying; do not reset the database.');
  process.exit(diff.status || 1);
}
const resolve = spawnSync(process.execPath, [cli, 'migrate', 'resolve', '--applied', '20260918000000_mysql_baseline'], { stdio: 'inherit' });
process.exit(resolve.status || 0);
