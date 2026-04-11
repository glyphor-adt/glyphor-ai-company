import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../lib/firebase';
import { useAuth, invalidateAllowedCache, FALLBACK_ADMINS } from '../lib/auth';
import { Card, GradientButton, SectionHeader } from '../components/ui';

interface DashboardUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'viewer';
  created_at: string;
}

export default function Settings() {
  const { user } = useAuth();
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'viewer'>('viewer');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const userEmail = (user?.email ?? '').trim().toLowerCase();
  const isFallbackAdmin = FALLBACK_ADMINS.some(e => e.trim().toLowerCase() === userEmail);
  const isAdmin = !loading && (
    isFallbackAdmin
    || users.some(u => u.email.trim().toLowerCase() === userEmail && u.role === 'admin')
  );

  const fetchUsers = useCallback(async () => {
    try {
      const data = await apiCall<DashboardUser[]>('/api/dashboard-users');
      setUsers(data ?? []);
    } catch (e) {
      console.error('fetchUsers exception:', e);
      const hint = e instanceof Error ? e.message : 'Failed to load users from database';
      setError(hint || 'Failed to load users from database');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const addUser = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) return;
    if (users.some(u => u.email.toLowerCase() === trimmedEmail)) {
      setError('User already exists');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await apiCall('/api/dashboard-users', {
        method: 'POST',
        body: JSON.stringify({ email: trimmedEmail, name: name.trim(), role, created_by: user?.email ?? '' }),
      });
      setEmail('');
      setName('');
      setRole('viewer');
      invalidateAllowedCache();
      await fetchUsers();
    } catch (err) {
      setError((err as Error).message);
    }
    setSaving(false);
  };

  const removeUser = async (targetUser: DashboardUser) => {
    // Don't allow removing yourself
    if (targetUser.email.toLowerCase() === user?.email.toLowerCase()) return;

    try {
      await apiCall(`/api/dashboard-users/${targetUser.id}`, { method: 'DELETE' });
      invalidateAllowedCache();
      await fetchUsers();
    } catch { /* ignore */ }
  };

  const toggleRole = async (targetUser: DashboardUser) => {
    const isSelf = targetUser.email.toLowerCase() === user?.email.toLowerCase();
    // Allow self-promotion (viewer → admin) so bootstrap accounts can fix a wrong DB row.
    // Block self-demotion (admin → viewer) to avoid locking yourself out of user management.
    if (isSelf && targetUser.role === 'admin') return;
    const newRole = targetUser.role === 'admin' ? 'viewer' : 'admin';
    setError('');
    try {
      await apiCall(`/api/dashboard-users/${targetUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole }),
      });
      invalidateAllowedCache();
      await fetchUsers();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!isAdmin && !loading) {
    return (
      <div>
        <SectionHeader title="Settings" subtitle={`You don't have admin access to manage users. Logged in as: ${user?.email ?? 'unknown'}`} />
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="Settings" subtitle="Manage who can access the dashboard" />

      {/* Add User Form */}
      <Card className="mb-6">
        <h3 className="text-sm font-semibold text-txt-primary mb-3">Add User</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-txt-muted mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint focus:border-border-hover focus:outline-none"
              onKeyDown={e => e.key === 'Enter' && addUser()}
            />
          </div>
          <div className="min-w-[150px]">
            <label className="block text-xs text-txt-muted mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Display name"
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint focus:border-border-hover focus:outline-none"
              onKeyDown={e => e.key === 'Enter' && addUser()}
            />
          </div>
          <div className="min-w-[100px]">
            <label className="block text-xs text-txt-muted mb-1">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as 'admin' | 'viewer')}
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-border-hover focus:outline-none"
            >
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <GradientButton
            onClick={addUser}
            disabled={saving || !email.trim()}
          >
            {saving ? 'Adding…' : 'Add'}
          </GradientButton>
        </div>
        {error && <p className="mt-2 text-xs text-prism-critical">{error}</p>}
      </Card>

      {/* Users List */}
      <Card>
        <h3 className="text-sm font-semibold text-txt-primary mb-3">
          Authorized Users ({users.length})
        </h3>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="shimmer-bg h-12 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {users.map(u => {
              const isSelf = u.email.toLowerCase() === user?.email.toLowerCase();
              return (
                <div key={u.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-base text-xs font-bold text-txt-primary">
                      {(u.name || u.email)[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-txt-primary">
                        {u.name || u.email}
                        {isSelf && <span className="ml-2 text-xs text-txt-muted">(you)</span>}
                      </p>
                      <p className="text-xs text-txt-muted">{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      title={
                        isSelf && u.role === 'viewer'
                          ? 'Promote your account to admin (required for Fleet / eval APIs)'
                          : isSelf && u.role === 'admin'
                            ? 'Ask another admin to demote you if needed'
                            : undefined
                      }
                      onClick={() => toggleRole(u)}
                      disabled={isSelf && u.role === 'admin'}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        u.role === 'admin'
                          ? 'bg-cyan/15 text-cyan'
                          : 'bg-base text-txt-muted'
                      } ${
                        isSelf && u.role === 'admin'
                          ? 'cursor-not-allowed opacity-70'
                          : 'hover:opacity-80'
                      }`}
                    >
                      {u.role}
                    </button>
                    {!isSelf && (
                      <button
                        onClick={() => removeUser(u)}
                        className="rounded-md px-2 py-1 text-xs text-prism-critical transition-colors hover:bg-prism-critical/10"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
