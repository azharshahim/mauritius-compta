/** Mission 30 — proof that fictional data cannot silently back the real app. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appMode, demoEnabled } from '../src/demo/mode';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('mission 30 — demo / real separation', () => {
  it('enables the demo only for the exact compile-time string "true"', () => {
    expect(typeof demoEnabled).toBe('boolean');
    expect(appMode).toBe(demoEnabled ? 'demo' : 'production');
    expect(read('src/demo/mode.ts')).toContain("import.meta.env.VITE_DEMO_MODE === 'true'");
  });

  it('loads the fictional backend only behind an explicit demo switch', () => {
    const api = read('src/api.ts');
    expect(api).toContain("import { demoEnabled } from './demo/mode'");
    expect(api).toContain("await import('./demo/runtime')");
    expect(api).not.toMatch(/import\s*\{[^}]*demoRequest[^}]*\}\s*from\s*'\.\/demo/);
    expect(api).not.toMatch(/import\s*\{[^}]*demoCsv[^}]*\}\s*from\s*'\.\/demo/);

    const banner = read('src/components/DemoBanner.tsx');
    expect(banner).toContain("import { demoEnabled } from '../demo/mode'");
    expect(banner).toContain("await import('../demo/runtime')");
    expect(banner).not.toMatch(/import\s*\{[^}]*resetDemo[^}]*\}\s*from\s*'\.\.\/demo/);
  });

  it('keeps the switch module free of demo data', () => {
    const mode = read('src/demo/mode.ts');
    expect(mode).not.toMatch(/from ['"]\.\/runtime/);
    expect(mode).not.toContain('localStorage');
    expect(mode).not.toContain('DemoPassw0rd');
    expect(read('src/main.tsx')).toContain("from './demo/mode'");
    expect(read('src/pages/Login.tsx')).toContain("from '../demo/mode'");
    expect(read('vite.config.ts')).toContain('demoMode ? \'demo@mauritius-compta.test\' : \'\'');
  });
});
