import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/posthog', () => ({
  initPostHog: vi.fn(),
  isPostHogConfigured: vi.fn(),
  getConsentStatus: vi.fn(),
  setConsentStatus: vi.fn(),
}));

import { initPostHog, isPostHogConfigured, getConsentStatus, setConsentStatus } from '../../lib/posthog';
import { CookieConsentBanner } from '../../components/CookieConsentBanner';

const initPostHogMock = initPostHog as ReturnType<typeof vi.fn>;
const isPostHogConfiguredMock = isPostHogConfigured as ReturnType<typeof vi.fn>;
const getConsentStatusMock = getConsentStatus as ReturnType<typeof vi.fn>;
const setConsentStatusMock = setConsentStatus as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CookieConsentBanner', () => {
  it('renders nothing when PostHog is not configured, even with no consent decision yet', () => {
    isPostHogConfiguredMock.mockReturnValue(false);
    getConsentStatusMock.mockReturnValue(null);
    render(<CookieConsentBanner />);
    expect(screen.queryByText(/We use cookies/)).not.toBeInTheDocument();
  });

  it('renders nothing when a consent decision was already made', () => {
    isPostHogConfiguredMock.mockReturnValue(true);
    getConsentStatusMock.mockReturnValue('accepted');
    render(<CookieConsentBanner />);
    expect(screen.queryByText(/We use cookies/)).not.toBeInTheDocument();
  });

  it('renders the banner when configured and no decision has been made', () => {
    isPostHogConfiguredMock.mockReturnValue(true);
    getConsentStatusMock.mockReturnValue(null);
    render(<CookieConsentBanner />);
    expect(screen.getByText(/We use cookies/)).toBeInTheDocument();
  });

  it('accepting records consent, initializes PostHog, and hides the banner', async () => {
    isPostHogConfiguredMock.mockReturnValue(true);
    getConsentStatusMock.mockReturnValue(null);
    render(<CookieConsentBanner />);

    await userEvent.click(screen.getByText('Accept'));

    expect(setConsentStatusMock).toHaveBeenCalledWith('accepted');
    expect(initPostHogMock).toHaveBeenCalled();
    expect(screen.queryByText(/We use cookies/)).not.toBeInTheDocument();
  });

  it('declining records consent, never initializes PostHog, and hides the banner', async () => {
    isPostHogConfiguredMock.mockReturnValue(true);
    getConsentStatusMock.mockReturnValue(null);
    render(<CookieConsentBanner />);

    await userEvent.click(screen.getByText('Decline'));

    expect(setConsentStatusMock).toHaveBeenCalledWith('declined');
    expect(initPostHogMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/We use cookies/)).not.toBeInTheDocument();
  });
});
