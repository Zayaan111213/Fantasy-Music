import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api } from '../api/client';
import { queryClient } from '../lib/queryClient';
import type { User } from '../api/types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  updateUser: (user: User) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('bw_token'));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const t = localStorage.getItem('bw_token');
    if (!t) { setIsLoading(false); return; }
    api.get<User>('/auth/me')
      .then((u) => setUser(u))
      .catch(() => { localStorage.removeItem('bw_token'); setToken(null); })
      .finally(() => setIsLoading(false));
  }, []);

  function login(t: string, u: User) {
    localStorage.setItem('bw_token', t);
    setToken(t);
    setUser(u);
  }

  function logout() {
    localStorage.removeItem('bw_token');
    setToken(null);
    setUser(null);
    queryClient.clear();
  }

  function updateUser(u: User) {
    setUser(u);
  }

  return (
    <AuthContext.Provider value={{ user, token, login, updateUser, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
