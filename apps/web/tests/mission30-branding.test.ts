/** Mission 30 — COMPTAI brand, PWA manifest and icon consistency. */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dictionaries } from '../src/i18n';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** PNG width/height live in the IHDR chunk: 8-byte signature + length + type + 8 bytes. */
function pngSize(path: string) {
  const buffer = readFileSync(join(root, path));
  expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('mission 30 — COMPTAI identity', () => {
  it('uses COMPTAI in both languages without the legacy brand', () => {
    expect(dictionaries.fr['app.name']).toBe('COMPTAI');
    expect(dictionaries.en['app.name']).toBe('COMPTAI');
    expect(dictionaries.fr['suite.name']).toBe('COMPTAI');
    expect(dictionaries.en['suite.name']).toBe('COMPTAI');
    expect(dictionaries.fr['migration.targetField']).toBe('Champ COMPTAI');
    expect(dictionaries.en['migration.targetField']).toBe('COMPTAI field');
    for (const dictionary of [dictionaries.fr, dictionaries.en]) {
      for (const value of Object.values(dictionary)) {
        expect(String(value)).not.toMatch(/Mauritius Business Suite|Mauritius Compta/);
      }
    }
  });

  it('serves a COMPTAI document title, favicon, manifest and browser configuration', () => {
    const html = read('index.html');
    expect(html).toContain('<title>COMPTAI</title>');
    expect(html).toContain('rel="manifest" href="./manifest.webmanifest"');
    expect(html).toContain('comptai-mark.svg');
    expect(html).toContain('apple-mobile-web-app-title" content="COMPTAI');
    expect(html).not.toMatch(/Mauritius Business Suite|Mauritius Compta/);
    expect(existsSync(join(root, 'public/favicon.ico'))).toBe(true);
    expect(existsSync(join(root, 'public/sw.js'))).toBe(true);
    expect(read('src/main.tsx')).toContain('serviceWorker.register');
    expect(read('public/404.html')).toContain('COMPTAI');
    expect(read('public/browserconfig.xml')).toContain('COMPTAI');
  });

  it('declares the expected installable icon set at its exact size', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest'));
    expect(manifest.id).toBe('./');
    expect(manifest.name).toBe('COMPTAI');
    expect(manifest.short_name).toBe('COMPTAI');
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBe('#0b2545');
    expect(manifest.theme_color).toBe('#0b2545');
    expect(manifest.start_url.startsWith('./')).toBe(true);
    expect(manifest.scope).toBe('./');

    const icons = manifest.icons as { src: string; sizes: string; purpose: string }[];
    expect(icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'any')).toBe(true);
    expect(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any')).toBe(true);
    expect(icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'maskable')).toBe(true);
    expect(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable')).toBe(true);

    for (const icon of icons) {
      expect(icon.src.startsWith('/')).toBe(false);
      expect(existsSync(join(root, 'public', icon.src))).toBe(true);
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(pngSize(`public/${icon.src}`)).toEqual({ width, height });
    }
    expect(pngSize('public/icons/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
    expect(pngSize('public/icons/mstile-150.png')).toEqual({ width: 150, height: 150 });

    for (const shortcut of manifest.shortcuts as { url: string; icons: { src: string }[] }[]) {
      expect(shortcut.url.startsWith('./#')).toBe(true);
      for (const icon of shortcut.icons) {
        expect(existsSync(join(root, 'public', icon.src))).toBe(true);
      }
    }
  });
});
