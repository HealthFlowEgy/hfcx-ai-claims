import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ConfidenceBar } from '@/components/shared/confidence-bar';

import { renderWithIntl } from './test-utils';

describe('ConfidenceBar', () => {
  it('green for ≥ 0.80', () => {
    const { wrapped } = renderWithIntl(<ConfidenceBar confidence={0.92} />, 'en');
    const { container } = render(wrapped);
    const fill = container.querySelector('.bg-hcx-success');
    expect(fill).not.toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '92');
  });

  it('amber for 0.50–0.79', () => {
    const { wrapped } = renderWithIntl(<ConfidenceBar confidence={0.65} />, 'en');
    const { container } = render(wrapped);
    expect(container.querySelector('.bg-hcx-warning')).not.toBeNull();
  });

  it('red for < 0.50', () => {
    const { wrapped } = renderWithIntl(<ConfidenceBar confidence={0.3} />, 'en');
    const { container } = render(wrapped);
    expect(container.querySelector('.bg-hcx-danger')).not.toBeNull();
  });

  it('displays Arabic-Indic percentage in Arabic mode (SRS DS-RTL-005)', () => {
    const { wrapped } = renderWithIntl(
      <ConfidenceBar confidence={0.85} />,
      'ar',
    );
    render(wrapped);
    // 85 → ٨٥
    expect(screen.getByText(/٨٥/)).toBeInTheDocument();
  });
});
