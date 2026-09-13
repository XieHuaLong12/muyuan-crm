import fs from 'node:fs';
import crypto from 'node:crypto';
if(!fs.existsSync('.env'))fs.writeFileSync('.env',`DATABASE_URL="file:./dev.db"\nWEBHOOK_SECRET="${crypto.randomBytes(24).toString('hex')}"\nAUTH_SECRET="${crypto.randomBytes(32).toString('hex')}"\nNEXT_PUBLIC_APP_NAME="木远 CRM"\nDEFAULT_TIMEZONE="Asia/Shanghai"\nDEFAULT_CURRENCY="CNY"\nSEED_ADMIN_PASSWORD="${crypto.randomBytes(18).toString('base64url')}"\n`);
console.log('Local environment ready (existing values preserved).');
