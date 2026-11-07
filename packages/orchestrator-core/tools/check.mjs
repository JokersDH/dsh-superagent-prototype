import { execFileSync } from 'node:child_process';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
for (const script of ['check:provenance', 'typecheck', 'test', 'build', 'smoke:built']) execFileSync(pnpm, ['run', script], { stdio: 'inherit' });
