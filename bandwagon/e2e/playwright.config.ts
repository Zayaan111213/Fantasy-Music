import { defineConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Load .env.test without requiring a dotenv dep
function loadEnvTest() {
  const envFile = path.join(__dirname, '../.env.test');
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}
loadEnvTest();

const backendEnv = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
  NODE_ENV: 'test',
  JWT_SECRET: process.env.JWT_SECRET ?? 'e2e-test-secret',
  PORT: '3001',
  TEST_OVERRIDE_DAY: process.env.TEST_OVERRIDE_DAY ?? '',
  FRONTEND_URL: 'http://localhost:5173',
};

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never', outputFolder: '../e2e-report' }], ['list']],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'fast',
      testMatch: /0[12]-.*\.spec\.ts/,
    },
    {
      name: 'full',
      testMatch: /\d+-.*\.spec\.ts/,
    },
  ],

  globalSetup: './global-setup.ts',

  webServer: [
    {
      command: 'npm run dev --prefix ../backend',
      port: 3001,
      reuseExistingServer: false,
      timeout: 30_000,
      env: backendEnv,
    },
    {
      command: 'npm run dev --prefix ../frontend',
      port: 5173,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
