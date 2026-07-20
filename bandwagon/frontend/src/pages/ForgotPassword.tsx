import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { api } from '../api/client';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { WagonMark } from '../components/Logo';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex mb-4"><WagonMark size={56} /></div>
          <h1 className="text-3xl font-bold text-white">Reset your password</h1>
          <p className="text-gray-400 mt-1">We'll email you a link to set a new one</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30">
                <MailCheck className="w-6 h-6 text-emerald-400" />
              </div>
              <p className="text-white font-medium">Check your inbox</p>
              <p className="text-sm text-gray-400">
                We sent a reset link to <span className="text-white">{email}</span>. It expires in 1 hour.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              <Button type="submit" disabled={loading} className="w-full mt-2" size="lg">
                {loading ? 'Sending…' : 'Send Reset Link'}
              </Button>
            </form>
          )}

          <div className="mt-6 text-center">
            <Link to="/auth" className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
              Back to log in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
