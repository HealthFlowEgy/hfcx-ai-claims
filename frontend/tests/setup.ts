import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Reset DOM between tests.
afterEach(() => {
  cleanup();
});

// next-intl needs a stub message bag; individual tests wrap components in
// <NextIntlClientProvider> with the locale they want. Default to Arabic.
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: 'font-inter' }),
  Noto_Kufi_Arabic: () => ({ variable: 'font-noto' }),
}));
