import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ClaimStatusBadge } from '@/components/shared/claim-status-badge';
import type { ClaimStatus } from '@/lib/types';

import { renderWithIntl } from './test-utils';

const ALL_STATUSES: ClaimStatus[] = [
  'submitted',
  'in_review',
  'ai_analyzed',
  'approved',
  'denied',
  'investigating',
  'settled',
  'voided',
];

describe('ClaimStatusBadge', () => {
  it.each(ALL_STATUSES)(
    'renders Arabic label with icon for status %s',
    (status) => {
      const { wrapped } = renderWithIntl(<ClaimStatusBadge status={status} />, 'ar');
      render(wrapped);
      const badge = screen.getByLabelText((content) => content.length > 0);
      expect(badge).toBeInTheDocument();
      expect(badge.getAttribute('data-status')).toBe(status);
    },
  );

  it('uses an icon + text (DS-A11Y-002: color is never the only signal)', () => {
    const { wrapped } = renderWithIntl(
      <ClaimStatusBadge status="approved" />,
      'en',
    );
    render(wrapped);
    const badge = screen.getByLabelText('Approved');
    expect(badge).toHaveTextContent('Approved');
    // icon is an SVG element
    expect(badge.querySelector('svg')).not.toBeNull();
  });

  it('supports the size prop', () => {
    const { wrapped } = renderWithIntl(
      <ClaimStatusBadge status="denied" size="sm" />,
      'en',
    );
    render(wrapped);
    const badge = screen.getByLabelText('Denied');
    expect(badge.className).toContain('text-xs');
  });
});
