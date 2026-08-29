import { Link } from 'react-router-dom';
import { WagonMark, Wordmark } from './Logo';

/**
 * Shared shell for the public legal pages (/privacy, /terms) and /support.
 *
 * These are deliberately reachable while logged out: the App Store review
 * process fetches the privacy policy and support URLs without an account, and
 * a logged-in gate on either is a submission blocker.
 *
 * effectiveDate is optional because /support is not a dated document the way
 * the two legal pages are. It describes how the app behaves today, and putting
 * a date on it would only invite the question of whether it has gone stale.
 */
export function LegalPage({
  title,
  effectiveDate,
  children,
}: {
  title: string;
  effectiveDate?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-950">
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <WagonMark size={32} />
            <Wordmark className="text-lg" />
          </Link>
          <Link
            to="/"
            className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Back to site
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-white mb-1">{title}</h1>
        {effectiveDate ? (
          <p className="text-sm text-gray-500 mb-10">Effective {effectiveDate}</p>
        ) : (
          <div className="mb-10" />
        )}

        <div className="space-y-8 text-gray-300 leading-relaxed">{children}</div>

        <div className="mt-16 pt-8 border-t border-white/10 flex gap-4 text-sm text-gray-500">
          <Link to="/support" className="hover:text-gray-300 transition-colors">
            Support
          </Link>
          <Link to="/privacy" className="hover:text-gray-300 transition-colors">
            Privacy Policy
          </Link>
          <Link to="/terms" className="hover:text-gray-300 transition-colors">
            Terms of Service
          </Link>
        </div>
      </main>
    </div>
  );
}

export function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-white mb-2">{heading}</h2>
      <div className="space-y-3 text-[15px]">{children}</div>
    </section>
  );
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-1.5 pl-5 list-disc marker:text-gray-600">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
