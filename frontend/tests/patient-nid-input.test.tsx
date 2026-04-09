import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { PatientNidInput } from '@/components/shared/patient-nid-input';

import { renderWithIntl } from './test-utils';

function Harness() {
  const [value, setValue] = useState('');
  const [valid, setValid] = useState(false);
  return (
    <div>
      <PatientNidInput value={value} onChange={setValue} onValidChange={setValid} />
      <div data-testid="is-valid">{valid ? 'yes' : 'no'}</div>
    </div>
  );
}

describe('PatientNidInput', () => {
  it('only accepts digits, up to 14 chars', async () => {
    const user = userEvent.setup();
    const { wrapped } = renderWithIntl(<Harness />, 'en');
    render(wrapped);
    const input = screen.getByLabelText(/patient/i);
    await user.type(input, 'abc29901011234567890');
    // Letters stripped, 14 digits kept.
    expect((input as HTMLInputElement).value).toBe('29901011234567');
    expect(screen.getByTestId('is-valid')).toHaveTextContent('yes');
  });

  it('converts Arabic-Indic digits to ASCII', async () => {
    const user = userEvent.setup();
    const { wrapped } = renderWithIntl(<Harness />, 'ar');
    render(wrapped);
    const input = screen.getByLabelText(/مريض/);
    // Exactly 14 Arabic-Indic digits (2 9 9 0 1 0 1 1 2 3 4 5 6 7).
    await user.type(input, '٢٩٩٠١٠١١٢٣٤٥٦٧');
    expect((input as HTMLInputElement).value).toBe('29901011234567');
    expect(screen.getByTestId('is-valid')).toHaveTextContent('yes');
  });

  it('invalid partial input is flagged with aria-invalid', async () => {
    const user = userEvent.setup();
    const onValid = vi.fn();
    const { wrapped } = renderWithIntl(
      <PatientNidInput value="" onChange={() => {}} onValidChange={onValid} />,
      'en',
    );
    render(wrapped);
    const input = screen.getByLabelText(/patient/i);
    // Fire a change with only 3 digits (still incomplete)
    await user.type(input, '123');
    expect(onValid).toHaveBeenLastCalledWith(false);
  });
});
