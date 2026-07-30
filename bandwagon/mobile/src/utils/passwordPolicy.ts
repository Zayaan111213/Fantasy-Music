// Mirrors the backend passwordPolicyError (api/routes/auth.ts) so users get
// instant, friendly feedback; the server remains the enforcement backstop.
export function passwordPolicyError(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[0-9]/.test(password)) return 'Password must include at least one number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include at least one special character';
  return null;
}
