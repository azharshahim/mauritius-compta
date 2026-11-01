/**
 * Mission 40 — theme palette regression tests.
 *
 * The application keeps one architecture: the semantic variables declared in
 * `styles.css`. These tests read that stylesheet directly, so a future
 * hard-coded colour that only works in one theme fails the suite instead of
 * silently shipping.
 *
 * Contrasts use the WCAG 2.x relative-luminance formula. Thresholds follow
 * WCAG 2.2 AA: 4.5:1 for normal text, 3:1 for large text and for the boundaries
 * and focus indicators of interactive components.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs with `apps/web` as the working directory; import.meta.url is an
// http URL in jsdom, so the workspace path is resolved relatively to it.
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

function blocks(pattern: RegExp): string[] {
  const result: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css))) {
    const start = match.index + match[0].length;
    const end = css.indexOf('}', start);
    result.push(css.slice(start, end));
  }
  return result;
}

function variables(source: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const match of source.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    vars[match[1]!] = match[2]!.trim();
  }
  return vars;
}

const light = Object.assign({}, ...blocks(/:root\s*\{/g).map(variables));
const dark = Object.assign({}, ...blocks(/\[data-theme='dark'\]\s*\{/g).map(variables));

function rgb(hex: string): [number, number, number] {
  let value = hex.replace('#', '');
  if (value.length === 3) value = value.split('').map((char) => char + char).join('');
  if (!/^[0-9a-f]{6}$/i.test(value)) throw new Error(`Not an opaque hex colour: ${hex}`);
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const channels = rgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

/** Tokens that intentionally do not change: typography, geometry and the printed payslip paper. */
const INVARIANT_PREFIXES = ['radius', 'font', 'paper-'];

describe('mission 40 — one centralised palette', () => {
  it('declares every colour token in both themes', () => {
    const colourTokens = Object.keys(light).filter(
      (name) => !INVARIANT_PREFIXES.some((prefix) => name.startsWith(prefix)),
    );
    expect(colourTokens.length).toBeGreaterThan(20);
    expect(colourTokens.filter((name) => !(name in dark))).toEqual([]);
    expect(Object.keys(dark).filter((name) => !(name in light))).toEqual([]);
  });

  it('keeps the printed payslip on its constant paper palette', () => {
    expect(light['paper-bg']).toBe('#ffffff');
    expect(light['paper-text']).toBeDefined();
    expect(dark['paper-bg']).toBeUndefined();
    expect(css).not.toMatch(/#647684/i);
    expect(css).not.toMatch(/#94a3b8/i);
    expect(css).not.toMatch(/#8b9bb0/i);
  });

  it.each(['light', 'dark'] as const)('%s text and secondary text meet AA on every surface', (theme) => {
    const palette = theme === 'light' ? light : dark;
    for (const background of ['bg', 'surface', 'surface-2', 'surface-3', 'row-hover']) {
      expect(contrast(palette.text, palette[background]), `--text on --${background}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.muted, palette[background]), `--muted on --${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(['light', 'dark'] as const)('%s status colours remain readable on their tinted backgrounds', (theme) => {
    const palette = theme === 'light' ? light : dark;
    for (const status of ['danger', 'success', 'warning', 'info']) {
      expect(
        contrast(palette[status], palette[`${status}-bg`]),
        `--${status} on --${status}-bg`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(['light', 'dark'] as const)('%s primary actions and focus indicators meet AA / 3:1', (theme) => {
    const palette = theme === 'light' ? light : dark;
    expect(contrast(palette['text-on-accent'], palette.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette['text-on-accent'], palette['accent-dark'])).toBeGreaterThanOrEqual(4.5);
    for (const background of ['surface', 'surface-2', 'surface-3']) {
      expect(contrast(palette['focus-ring'], palette[background]), `focus ring on --${background}`).toBeGreaterThanOrEqual(3);
      expect(
        contrast(palette['border-control'], palette[background]),
        `--border-control on --${background}`,
      ).toBeGreaterThanOrEqual(3);
    }
    // The sidebar and hero panels stay dark in both themes: the standard light
    // theme ring (#1d4ed8) only reaches 2.47:1 against the navy chrome.
    expect(contrast(palette['focus-ring-on-dark'], palette.navy)).toBeGreaterThanOrEqual(3);
    expect(css).toMatch(/\.sidebar :focus-visible[\s\S]*outline-color: var\(--focus-ring-on-dark\)/);
  });

  it('keeps interactive states distinguishable without relying on colour alone', () => {
    // Active tabs/buttons combine a filled background, a border and bold text;
    // keyboard focus is a 2 px outline with an offset, not a colour-only change.
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\)/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline-offset:\s*2px/);
    for (const selector of ['tabs button.active', 'bank-tab.active', 'purchase-tab.active', 'module-tab.active']) {
      expect(css).toContain(selector);
    }
    expect(css).toMatch(/\[data-theme='dark'\] \.btn-danger\s*\{[^}]*color: var\(--text-on-danger\)/);
    expect(css).toMatch(/\[data-theme='dark'\] \.tabs a\.active/);
  });
});
