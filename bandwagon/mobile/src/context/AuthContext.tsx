import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import type { User } from '@bandwagon/shared';
import { api, TOKEN_KEY } from '../api/client';
import { queryClient } from '../lib/queryClient';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => Promise<void>;
  updateUser: (user: User) => void;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // SecureStore has no sync read API (Keychain/Keystore-backed), so unlike
  // the web AuthContext's sync useState initializer, the token read and the
  // /auth/me validation are two sequential async steps under one isLoading.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await SecureStore.getItemAsync(TOKEN_KEY);
      if (cancelled) return;
      if (!t) {
        setIsLoading(false);
        return;
      }
      setToken(t);
      try {
        const u = await api.get<User>('/auth/me');
        if (!cancelled) setUser(u);
      } catch {
        if (!cancelled) {
          await SecureStore.deleteItemAsync(TOKEN_KEY);
          setToken(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(t: string, u: User) {
    await SecureStore.setItemAsync(TOKEN_KEY, t);
    setToken(t);
    setUser(u);
  }

  async function logout() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
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
