import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../../../components/ui/Badge';

// Genre badges share the vintage slot palette (SlotPill.tsx): the four named
// slot genres get their slot color, everything else reads as Other teal.
describe('Badge', () => {
  it('renders children text', () => {
    render(<Badge>Pop</Badge>);
    expect(screen.getByText('Pop')).toBeInTheDocument();
  });

  it('applies brand gold when no genre is provided', () => {
    render(<Badge>Label</Badge>);
    expect(screen.getByText('Label').style.color).toBe('rgb(232, 178, 58)');
  });

  it('applies harvest gold for R&B/Hip-Hop', () => {
    render(<Badge genre="R&B/Hip-Hop">R&amp;B</Badge>);
    expect(screen.getByText('R&B').style.color).toBe('rgb(232, 178, 58)');
  });

  it('applies burnt orange for Pop', () => {
    render(<Badge genre="Pop">Pop</Badge>);
    expect(screen.getByText('Pop').style.color).toBe('rgb(224, 122, 62)');
  });

  it('applies ochre for Country', () => {
    render(<Badge genre="Country">Country</Badge>);
    expect(screen.getByText('Country').style.color).toBe('rgb(183, 138, 60)');
  });

  it('falls back to Other teal for non-slot genres', () => {
    render(<Badge genre="Latin">Latin</Badge>);
    expect(screen.getByText('Latin').style.color).toBe('rgb(111, 165, 149)');
  });

  it('passes through additional className', () => {
    render(<Badge className="my-badge">Tag</Badge>);
    expect(screen.getByText('Tag').className).toContain('my-badge');
  });
});
