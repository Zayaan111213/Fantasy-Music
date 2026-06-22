import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../../../components/ui/Badge';

describe('Badge', () => {
  it('renders children text', () => {
    render(<Badge>Pop</Badge>);
    expect(screen.getByText('Pop')).toBeInTheDocument();
  });

  it('applies default indigo color when no genre is provided', () => {
    render(<Badge>Label</Badge>);
    expect(screen.getByText('Label').className).toContain('bg-indigo-500/20');
  });

  it('applies genre-specific color for R&B/Hip-Hop', () => {
    render(<Badge genre="R&B/Hip-Hop">R&amp;B</Badge>);
    expect(screen.getByText('R&B').className).toContain('bg-purple-500/20');
  });

  it('applies genre-specific color for Pop', () => {
    render(<Badge genre="Pop">Pop</Badge>);
    expect(screen.getByText('Pop').className).toContain('bg-pink-500/20');
  });

  it('applies genre-specific color for Country', () => {
    render(<Badge genre="Country">Country</Badge>);
    expect(screen.getByText('Country').className).toContain('bg-amber-500/20');
  });

  it('falls back to gray for unknown genre', () => {
    render(<Badge genre="Unknown Genre">Unknown</Badge>);
    expect(screen.getByText('Unknown').className).toContain('bg-gray-500/20');
  });

  it('passes through additional className', () => {
    render(<Badge className="my-badge">Tag</Badge>);
    expect(screen.getByText('Tag').className).toContain('my-badge');
  });
});
