import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { Support } from '../../pages/Support';
import { CONTACT_EMAIL } from '../../lib/legal';

// /support is the URL handed to Apple as the App Store "Support URL", and
// review fetches it logged out. The two things that must never quietly break
// are that it renders at all and that a reachable contact address is on it.
function renderSupport() {
  return render(
    <MemoryRouter>
      <Support />
    </MemoryRouter>
  );
}

describe('Support page', () => {
  it('renders without auth or data fetching', () => {
    renderSupport();
    expect(screen.getByRole('heading', { name: 'Support', level: 1 })).toBeInTheDocument();
  });

  it('publishes a mailto link to the contact address', () => {
    renderSupport();
    const links = screen.getAllByRole('link', { name: CONTACT_EMAIL });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', `mailto:${CONTACT_EMAIL}`);
  });
});
