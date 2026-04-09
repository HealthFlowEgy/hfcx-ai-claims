import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Reset DOM + unstub globals between tests so a leaked fetch mock
// from one suite does not contaminate the next.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
