import { useState } from 'react';
import { Button } from './ui/Button';
import { initPostHog, isPostHogConfigured, getConsentStatus, setConsentStatus } from '../lib/posthog';

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(() => isPostHogConfigured() && getConsentStatus() === null);

  function handleAccept() {
    setConsentStatus('accepted');
    initPostHog();
    setVisible(false);
  }

  function handleDecline() {
    setConsentStatus('declined');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 border-t border-white/10 bg-gray-950/95 backdrop-blur-sm">
      <div className="max-w-3xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center gap-3">
        <p className="text-sm text-gray-300 flex-1">
          We use cookies to understand how people use Bandwagoner (which features get used, where people get stuck). You can decline and we won't track you.
        </p>
        <div className="flex gap-2 shrink-0">
          <Button variant="secondary" size="sm" onClick={handleDecline}>Decline</Button>
          <Button variant="primary" size="sm" onClick={handleAccept}>Accept</Button>
        </div>
      </div>
    </div>
  );
}
