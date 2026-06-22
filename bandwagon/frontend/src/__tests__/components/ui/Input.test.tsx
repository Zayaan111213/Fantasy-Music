import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../../../components/ui/Input';

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders a label when provided', () => {
    render(<Input label="Email" />);
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('does not render a label when not provided', () => {
    render(<Input />);
    expect(screen.queryByRole('label')).not.toBeInTheDocument();
  });

  it('renders an error message when provided', () => {
    render(<Input error="This field is required" />);
    expect(screen.getByText('This field is required')).toBeInTheDocument();
  });

  it('applies error border class when error is present', () => {
    render(<Input error="Error" />);
    expect(screen.getByRole('textbox').className).toContain('border-red-500');
  });

  it('forwards placeholder prop', () => {
    render(<Input placeholder="Enter email" />);
    expect(screen.getByPlaceholderText('Enter email')).toBeInTheDocument();
  });

  it('forwards type prop', () => {
    render(<Input type="password" />);
    const input = document.querySelector('input[type="password"]');
    expect(input).toBeInTheDocument();
  });

  it('calls onChange when user types', async () => {
    const handler = vi.fn();
    render(<Input onChange={handler} />);
    await userEvent.type(screen.getByRole('textbox'), 'hello');
    expect(handler).toHaveBeenCalled();
  });
});
