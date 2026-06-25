import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export default async function globalSetup() {
  const envFile = path.join(__dirname, '../.env.test');
  if (!fs.existsSync(envFile)) {
    console.log('\n⚠️  .env.test not found — skipping E2E database setup.\n');
    return;
  }

  const testDbUrl = process.env.TEST_DATABASE_URL;
  if (!testDbUrl) {
    throw new Error('TEST_DATABASE_URL must be set in .env.test');
  }

  const backendDir = path.join(__dirname, '../backend');
  const env = { ...process.env, DATABASE_URL: testDbUrl };

  console.log('📦 Running migrations on test DB...');
  execSync('./node_modules/.bin/prisma migrate deploy', { cwd: backendDir, env, stdio: 'inherit' });

  console.log('🌱 Seeding test DB...');
  execSync('./node_modules/.bin/tsx prisma/e2eSeed.ts', { cwd: backendDir, env, stdio: 'inherit' });

  console.log('✅ Test DB ready.\n');
}
