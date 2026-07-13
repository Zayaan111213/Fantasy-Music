import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Music2 } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import type { User } from '../api/types';

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      const { token: jwt, user } = await api.post<{ token: string; user: User }>('/auth/reset-password', {
        token,
        password,
      });
      login(jwt, user);
      navigate('/home', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/50 via-gray-950 to-purple-950/30 pointer-events-none" />

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 mb-4">
            <Music2 className="w-7 h-7 text-indigo-400" />
          </div>
          <h1 className="text-3xl font-bold text-white">Choose a new password</h1>
          <p className="text-gray-400 mt-1">You'll be logged in right after</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm">
          {!token ? (
            <div className="text-center space-y-4">
              <p className="text-white font-medium">This reset link is invalid.</p>
              <Link to="/forgot-password" className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
                Request a new link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="New Password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Input
                label="Confirm Password"
                type="password"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400">
                  {error}
                  {error === 'Invalid or expired reset link' && (
                    <div className="mt-1">
                      <Link to="/forgot-password" className="text-indigo-400 hover:text-indigo-300 transition-colors">
                        Request a new link
                      </Link>
                    </div>
                  )}
                </div>
              )}

              <Button type="submit" disabled={loading} className="w-full mt-2" size="lg">
                {loading ? 'Saving…' : 'Set New Password'}
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
