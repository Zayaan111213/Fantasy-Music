import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from '../../../components/ui/Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Hello Card</Card>);
    expect(screen.getByText('Hello Card')).toBeInTheDocument();
  });

  it('includes the base card style class', () => {
    const { container } = render(<Card>Content</Card>);
    expect((container.firstChild as HTMLElement).className).toContain('bg-white/5');
  });

  it('passes through additional className', () => {
    const { container } = render(<Card className="p-4">Content</Card>);
    expect((container.firstChild as HTMLElement).className).toContain('p-4');
  });
});
