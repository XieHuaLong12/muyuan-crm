import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import './setup-env.mjs';
process.loadEnvFile('.env');
const url=process.env.DATABASE_URL;
if(url==='file:./dev.db'&&!fs.existsSync('prisma/dev.db'))fs.closeSync(fs.openSync('prisma/dev.db','a'));
for(const args of [['node_modules/prisma/build/index.js','migrate','deploy'],['node_modules/prisma/build/index.js','generate'],['--env-file=.env','node_modules/tsx/dist/cli.mjs','prisma/seed.ts']]){const result=spawnSync(process.execPath,args,{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}
