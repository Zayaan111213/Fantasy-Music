import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import type { User } from '../api/types';
import { passwordPolicyError } from '../utils/passwordPolicy';
import { posthog } from '../lib/posthog';
import { WagonMark, Wordmark } from '../components/Logo';
import { HowItWorksModal } from '../components/HowItWorksModal';

// Matches the redirect RequireAuth sends someone to when they followed a
// league invite link while logged out, so we can greet them with context.
const INVITE_REDIRECT_RE = /^\/leagues\/join\/([A-Za-z0-9-]+)/;

export function Auth() {
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/home';
  const inviteCode = redirect.match(INVITE_REDIRECT_RE)?.[1] ?? null;
  const [mode, setMode] = useState<'login' | 'signup'>(
    params.get('mode') === 'login' ? 'login' : (params.get('mode') === 'signup' || inviteCode) ? 'signup' : 'login'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [inviteLeagueName, setInviteLeagueName] = useState<string | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!inviteCode) return;
    api.get<{ name: string }>(`/leagues/invite/${inviteCode}`)
      .then((league) => setInviteLeagueName(league.name))
      .catch(() => {});
  }, [inviteCode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (mode === 'signup') {
      const policyError = passwordPolicyError(password);
      if (policyError) { setError(policyError); return; }
    }
    setLoading(true);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/signup';
      const { token, user } = await api.post<{ token: string; user: User }>(path, { email, password });
      login(token, user);
      if (mode === 'signup') {
        // New accounts see the "How Bandwagoner Works" modal on their first Home visit
        localStorage.setItem('bw_show_how_it_works', '1');
        posthog.capture('user_signed_up');
      }
      // New accounts still need to onboard first — carry the redirect (e.g. an
      // invite link) through so onboarding can forward them there afterward.
      navigate(
        mode === 'signup' ? `/onboarding?redirect=${encodeURIComponent(redirect)}` : redirect,
        { replace: true },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex mb-4"><WagonMark size={56} /></div>
          <h1><Wordmark className="text-3xl" /></h1>
          <p className="text-gray-400 mt-1">Fantasy sports for music fans</p>
        </div>

        {inviteCode && (
          <div className="mb-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-3 text-center">
            <p className="text-sm text-gray-200">
              You've been invited to join{' '}
              {inviteLeagueName ? <span className="font-semibold text-white">{inviteLeagueName}</span> : 'a league'} on
              Bandwagoner. Sign up or log in below to join.
            </p>
            <button
              onClick={() => setShowHowItWorks(true)}
              className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors underline underline-offset-2"
            >
              Learn how Bandwagoner works
            </button>
          </div>
        )}

        {/* Card */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm">
          {/* Toggle */}
          <div className="flex bg-white/5 rounded-lg p-1 mb-6">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === 'login' ? 'bg-indigo-500 text-gray-950' : 'text-gray-400 hover:text-white'}`}
            >
              Log In
            </button>
            <button
              onClick={() => setMode('signup')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === 'signup' ? 'bg-indigo-500 text-gray-950' : 'text-gray-400 hover:text-white'}`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {mode === 'login' && (
              <div className="text-right -mt-1">
                <Link to="/forgot-password" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                  Forgot password?
                </Link>
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full mt-2" size="lg">
              {loading ? 'Loading…' : mode === 'login' ? 'Log In' : 'Create Account'}
            </Button>
          </form>
        </div>
      </div>

      {showHowItWorks && <HowItWorksModal onClose={() => setShowHowItWorks(false)} />}
    </div>
  );
}
