import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../../context/AuthContext';
import type { User } from '../../api/types';

// Mock the api module
vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(),
  },
}));

// Mock react-query client
vi.mock('../../lib/queryClient', () => ({
  queryClient: { clear: vi.fn() },
}));

import { api } from '../../api/client';
import { queryClient } from '../../lib/queryClient';

const apiMock = api as { get: ReturnType<typeof vi.fn> };
const queryClearMock = queryClient.clear as ReturnType<typeof vi.fn>;

const fakeUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  username: 'testuser',
  avatarUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

function TestConsumer() {
  const { user, token, isLoading, login, logout, updateUser } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="user">{user?.username ?? 'null'}</span>
      <span data-testid="token">{token ?? 'null'}</span>
      <button onClick={() => login('tok-123', fakeUser)}>login</button>
      <button onClick={() => logout()}>logout</button>
      <button onClick={() => updateUser({ ...fakeUser, username: 'updated' })}>updateUser</button>
    </div>
  );
}

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow('useAuth must be used inside AuthProvider');
    spy.mockRestore();
  });
});

describe('AuthProvider', () => {
  it('resolves to no user when no token stored', async () => {
    apiMock.get.mockResolvedValue(fakeUser);
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    // React 18 Testing Library flushes effects in act(), so loading completes synchronously
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('user').textContent).toBe('null');
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('fetches /auth/me when a token exists in localStorage', async () => {
    localStorage.setItem('bw_token', 'existing-token');
    apiMock.get.mockResolvedValue(fakeUser);
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(apiMock.get).toHaveBeenCalledWith('/auth/me');
    expect(screen.getByTestId('user').textContent).toBe('testuser');
  });

  it('clears token from localStorage when /auth/me fails', async () => {
    localStorage.setItem('bw_token', 'bad-token');
    apiMock.get.mockRejectedValue(new Error('Unauthorized'));
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(localStorage.getItem('bw_token')).toBeNull();
    expect(screen.getByTestId('user').textContent).toBe('null');
  });

  it('login() sets token in localStorage and updates user state', async () => {
    apiMock.get.mockResolvedValue(fakeUser);
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await userEvent.click(screen.getByText('login'));
    expect(localStorage.getItem('bw_token')).toBe('tok-123');
    expect(screen.getByTestId('user').textContent).toBe('testuser');
    expect(screen.getByTestId('token').textContent).toBe('tok-123');
  });

  it('logout() clears localStorage, nulls user and token, calls queryClient.clear()', async () => {
    localStorage.setItem('bw_token', 'existing-token');
    apiMock.get.mockResolvedValue(fakeUser);
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('testuser'));

    await userEvent.click(screen.getByText('logout'));
    expect(localStorage.getItem('bw_token')).toBeNull();
    expect(screen.getByTestId('user').textContent).toBe('null');
    expect(screen.getByTestId('token').textContent).toBe('null');
    expect(queryClearMock).toHaveBeenCalled();
  });

  it('updateUser() updates the user state', async () => {
    localStorage.setItem('bw_token', 'existing-token');
    apiMock.get.mockResolvedValue(fakeUser);
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('testuser'));

    await userEvent.click(screen.getByText('updateUser'));
    expect(screen.getByTestId('user').textContent).toBe('updated');
  });
});
