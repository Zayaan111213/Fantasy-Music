import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Avatar, initialsOf } from '../../../components/ui/Avatar';

describe('initialsOf', () => {
  it('takes the first letter of each of the first two words', () => {
    expect(initialsOf('Nipsey Hussle')).toBe('NH');
    expect(initialsOf('KAROL G')).toBe('KG');
    expect(initialsOf('Olivia Dean')).toBe('OD');
  });

  it('keeps two letters for single-word names so the circle is not near-empty', () => {
    expect(initialsOf('Drake')).toBe('DR');
    expect(initialsOf('SZA')).toBe('SZ');
  });

  it('ignores words past the second', () => {
    expect(initialsOf('Earth, Wind & Fire')).toBe('EW');
  });

  it('skips leading punctuation rather than rendering it', () => {
    expect(initialsOf("'til Dawn")).toBe('TD');
  });

  it('handles surrounding and repeated whitespace', () => {
    expect(initialsOf('  Bino   Rideaux  ')).toBe('BR');
  });

  it('falls back to ? for an empty name', () => {
    expect(initialsOf('   ')).toBe('?');
  });
});

describe('Avatar', () => {
  it('renders initials when there is no image', () => {
    render(<Avatar src={null} name="Pooh Shiesty" />);
    expect(screen.getByText('PS')).toBeInTheDocument();
  });

  it('renders the image when a src is given', () => {
    render(<Avatar src="https://example.test/a.jpg" name="Pooh Shiesty" />);
    expect(screen.getByAltText('Pooh Shiesty')).toBeInTheDocument();
    expect(screen.queryByText('PS')).not.toBeInTheDocument();
  });

  it('falls back to initials when the image fails to load', () => {
    render(<Avatar src="https://example.test/broken.jpg" name="Pooh Shiesty" />);
    fireEvent.error(screen.getByAltText('Pooh Shiesty'));
    expect(screen.getByText('PS')).toBeInTheDocument();
  });
});
