import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Music2, Check, X } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Avatar } from '../components/ui/Avatar';
import type { User } from '../api/types';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export function Onboarding() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!username) { setUsernameStatus('idle'); return; }
    if (!USERNAME_REGEX.test(username)) { setUsernameStatus('invalid'); return; }

    setUsernameStatus('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const { available } = await api.get<{ available: boolean }>(`/auth/check-username?username=${encodeURIComponent(username)}`);
        setUsernameStatus(available ? 'available' : 'taken');
      } catch {
        setUsernameStatus('idle');
      }
    }, 400);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [username]);

  useEffect(() => {
    return () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); };
  }, [avatarPreview]);

  if (user && user.username !== null) {
    return <Navigate to="/home" replace />;
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError('Only JPEG, PNG, or WebP images are allowed');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError('Image must be smaller than 5MB');
      return;
    }

    setFileError('');
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (usernameStatus !== 'available') return;
    setError('');
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('username', username);
      if (avatarFile) formData.append('avatar', avatarFile);

      const { user: updated } = await api.post<{ user: User }>('/auth/complete-onboarding', formData);
      updateUser(updated);
      navigate('/home', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const usernameError =
    usernameStatus === 'invalid' ? '3-20 characters: letters, numbers, underscores only' :
    usernameStatus === 'taken' ? 'Username already taken' :
    undefined;

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 mb-4">
            <Music2 className="w-7 h-7 text-indigo-400" />
          </div>
          <h1 className="text-3xl font-bold text-white">Set up your profile</h1>
          <p className="text-gray-400 mt-1">Pick a username so friends can find you</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex flex-col items-center gap-3">
              <Avatar src={avatarPreview} name={username || '?'} size="xl" />
              <label className="text-sm text-indigo-400 hover:text-indigo-300 cursor-pointer transition-colors">
                {avatarFile ? 'Change picture' : 'Upload a profile picture (optional)'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              {fileError && <p className="text-xs text-red-400">{fileError}</p>}
            </div>

            <div className="relative">
              <Input
                label="Username"
                placeholder="e.g. chart_topper"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                error={usernameError}
                required
              />
              {username && usernameStatus !== 'idle' && usernameStatus !== 'invalid' && (
                <div className="absolute right-3 top-9">
                  {usernameStatus === 'checking' && <span className="text-xs text-gray-500">Checking…</span>}
                  {usernameStatus === 'available' && <Check className="w-4 h-4 text-green-400" />}
                  {usernameStatus === 'taken' && <X className="w-4 h-4 text-red-400" />}
                </div>
              )}
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading || usernameStatus !== 'available'} className="w-full mt-2" size="lg">
              {loading ? 'Saving…' : 'Continue'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
