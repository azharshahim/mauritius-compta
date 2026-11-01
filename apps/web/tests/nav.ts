import { fireEvent, screen, within } from '@testing-library/react';

/**
 * Mission 26 navigation helper for jsdom tests.
 *
 * Groups start collapsed except the active one, so a test that wants to click a
 * destination in another group first expands every group exactly like a user
 * tapping the group headers.
 */
export function expandAllNavGroups(): void {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  for (const button of Array.from(nav.querySelectorAll<HTMLButtonElement>('.nav-group-toggle'))) {
    if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button);
  }
}

export function navLink(name: RegExp | string, container?: HTMLElement): HTMLElement {
  expandAllNavGroups();
  const nav = container ?? (document.querySelector('.nav') as HTMLElement);
  return within(nav).getByRole('link', { name });
}

export function navGroup(name: RegExp | string): HTMLElement {
  const nav = document.querySelector('.nav') as HTMLElement;
  return within(nav).getByRole('button', { name });
}

export function clickNavLink(name: RegExp | string): void {
  fireEvent.click(navLink(name));
}

export function navLinkByText(name: RegExp): HTMLAnchorElement {
  expandAllNavGroups();
  const nav = document.querySelector('.nav') as HTMLElement;
  const link = Array.from(nav.querySelectorAll('a')).find((a) => name.test(a.textContent ?? ''));
  if (!link) throw new Error('Navigation link not found');
  return link as HTMLAnchorElement;
}

/** Unused in some files but re-exported to keep test imports explicit. */
export { screen };
