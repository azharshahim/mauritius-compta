import { afterEach, beforeEach } from 'vitest';

// jsdom provides localStorage; every test starts from a clean demonstration.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = '#/';
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
