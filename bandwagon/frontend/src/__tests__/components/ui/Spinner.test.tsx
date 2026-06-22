import { describe, it, expect } from 'vitest';
import { render, container } from '@testing-library/react';
import { Spinner, FullPageSpinner } from '../../../components/ui/Spinner';

describe('Spinner', () => {
  it('renders without crashing', () => {
    const { container } = render(<Spinner />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('includes animate-spin class', () => {
    const { container } = render(<Spinner />);
    expect((container.firstChild as HTMLElement).className).toContain('animate-spin');
  });

  it('passes through additional className', () => {
    const { container } = render(<Spinner className="w-10 h-10" />);
    expect((container.firstChild as HTMLElement).className).toContain('w-10 h-10');
  });
});

describe('FullPageSpinner', () => {
  it('renders without crashing', () => {
    const { container } = render(<FullPageSpinner />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('contains a Spinner element', () => {
    const { container } = render(<FullPageSpinner />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });
});
