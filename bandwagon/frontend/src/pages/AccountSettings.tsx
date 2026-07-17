import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Music2, Check, X } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Avatar } from '../components/ui/Avatar';
import type { User } from '../api/types';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export function AccountSettings() {
  const { user, updateUser } = useAuth();
  const initialUsername = user?.username ?? '';
  const initialEmail = user?.email ?? '';

  const [username, setUsername] = useState(initialUsername);
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [email, setEmail] = useState(initialEmail);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatarUrl ?? null);
  const [fileError, setFileError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!username || username === initialUsername) { setUsernameStatus('idle'); return; }
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
  }, [username, initialUsername]);

  useEffect(() => {
    return () => {
      if (avatarPreview && avatarPreview.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

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
    if (avatarPreview && avatarPreview.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  const usernameChanged = username !== initialUsername;
  const emailChanged = email !== initialEmail;
  const usernameBlocksSave = usernameChanged && usernameStatus !== 'available';
  const hasChanges = usernameChanged || emailChanged || !!avatarFile;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (usernameBlocksSave || !hasChanges) return;
    setError('');
    setSaving(true);
    try {
      const formData = new FormData();
      if (usernameChanged) formData.append('username', username);
      if (emailChanged) formData.append('email', email);
      if (avatarFile) formData.append('avatar', avatarFile);

      const { user: updated } = await api.put<{ user: User }>('/auth/me', formData);
      updateUser(updated);
      setAvatarFile(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const usernameError =
    usernameStatus === 'invalid' ? '3-20 characters: letters, numbers, underscores only' :
    usernameStatus === 'taken' ? 'Username already taken' :
    undefined;

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="relative border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/home" className="text-gray-400 hover:text-white transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Music2 className="w-5 h-5 text-indigo-400" />
            <span className="font-bold text-white">Account Settings</span>
          </div>
        </div>
      </header>

      <main className="relative max-w-2xl mx-auto px-4 py-8">
        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex flex-col items-center gap-3">
              <Avatar src={avatarPreview} name={username || '?'} size="xl" />
              <label className="text-sm text-indigo-400 hover:text-indigo-300 cursor-pointer transition-colors">
                Change picture
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
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                error={usernameError}
                required
              />
              {usernameChanged && usernameStatus !== 'idle' && usernameStatus !== 'invalid' && (
                <div className="absolute right-3 top-9">
                  {usernameStatus === 'checking' && <span className="text-xs text-gray-500">Checking…</span>}
                  {usernameStatus === 'available' && <Check className="w-4 h-4 text-green-400" />}
                  {usernameStatus === 'taken' && <X className="w-4 h-4 text-red-400" />}
                </div>
              )}
            </div>

            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button type="submit" disabled={saving || usernameBlocksSave || !hasChanges} className="w-full">
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}
