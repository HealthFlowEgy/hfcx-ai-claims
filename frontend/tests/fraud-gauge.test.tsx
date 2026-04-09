import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { FraudGauge } from '@/components/shared/fraud-gauge';

import { renderWithIntl } from './test-utils';

describe('FraudGauge', () => {
  it('labels low-risk score in English', () => {
    const { wrapped } = renderWithIntl(<FraudGauge score={0.1} />, 'en');
    render(wrapped);
    expect(screen.getByRole('img', { name: /10%/ })).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it('labels high-risk score in Arabic', () => {
    const { wrapped } = renderWithIntl(<FraudGauge score={0.75} />, 'ar');
    render(wrapped);
    // Arabic-Indic 75
    expect(screen.getByText(/٧٥/)).toBeInTheDocument();
    expect(screen.getByText(/مرتفع/)).toBeInTheDocument();
  });

  it('renders factor list when showFactors=true', () => {
    const factors = ['high amount', 'late submission', 'excessive codes'];
    const { wrapped } = renderWithIntl(
      <FraudGauge score={0.65} showFactors factors={factors} />,
      'en',
    );
    render(wrapped);
    for (const f of factors) {
      expect(screen.getByText(f)).toBeInTheDocument();
    }
  });
});
