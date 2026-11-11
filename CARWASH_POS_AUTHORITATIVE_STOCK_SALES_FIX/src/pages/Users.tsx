import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import type { TabId, UserProfile } from '../types';
import QwertyKeyboard from '../components/QwertyKeyboard';
import NumericPad from '../components/NumericPad';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { hashPinForStorage } from '../lib/auth';
import {
  fetchProfiles,
  updateProfilePermissions,
  updateProfileFields,
} from '../lib/api';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

const TAB_OPTIONS: { id: TabId; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'sell', label: 'Sell' },
  { id: 'receive', label: 'Receive Stock' },
  { id: 'products', label: 'Products' },
  { id: 'inventory', label: 'Inventory Audit' },
  { id: 'credit', label: 'Credit' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'reports', label: 'Reports' },
  { id: 'activity', label: 'Activity Log' },
];

const DEFAULT_CASHIER_PERMS: TabId[] = [
  'dashboard', 'sell', 'inventory', 'credit', 'expenses', 'receive',
];

const PERM_PRESETS: { label: string; perms: TabId[] }[] = [
  { label: 'Full cashier', perms: [...DEFAULT_CASHIER_PERMS] },
  { label: 'Sell only', perms: ['dashboard', 'sell'] },
  { label: 'Stock only', perms: ['dashboard', 'receive', 'inventory', 'products'] },
];

export default function Users() {
  const currentUser = useStore((s) => s.currentUser);
  const staffUsers = useStore((s) => s.staffUsers);
  const setStaffUsers = useStore((s) => s.setStaffUsers);
  const updateStaffUser = useStore((s) => s.updateStaffUser);
  const addStaffUser = useStore((s) => s.addStaffUser);
  const removeStaffUser = useStore((s) => s.removeStaffUser);
  const logActivity = useStore((s) => s.logActivity);

  const [loading, setLoading] = useState(false);
  const [editNameId, setEditNameId] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPin, setNewPin] = useState('');
  const [addStep, setAddStep] = useState<'name' | 'email' | 'pin'>('name');
  const [editPinId, setEditPinId] = useState<string | null>(null);
  const [pinValue, setPinValue] = useState('');

  const loadFromServer = async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    try {
      const list = await fetchProfiles();
      if (list.length) setStaffUsers(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFromServer();
  }, []);

  if (currentUser?.role !== 'admin') {
    return <div className="p-8 text-center text-gray-500">—</div>;
  }

  const allStaff = staffUsers.length ? staffUsers : [];

  const saveName = async () => {
    if (!editNameId || !nameValue.trim()) return;
    updateStaffUser(editNameId, { full_name: nameValue.trim() });
    if (isSupabaseConfigured) {
      await updateProfileFields(editNameId, { full_name: nameValue.trim() });
    }
    logActivity(currentUser.id, currentUser.full_name, 'User renamed', nameValue.trim());
    setEditNameId(null);
    setNameValue('');
  };

  const togglePerm = async (u: UserProfile, tabId: string) => {
    const checked = u.permissions.includes(tabId);
    const perms = checked
      ? u.permissions.filter((p) => p !== tabId)
      : [...u.permissions, tabId];
    updateStaffUser(u.id, { permissions: perms });
    if (isSupabaseConfigured) {
      await updateProfilePermissions(u.id, perms);
    }
  };

  const finishAdd = async () => {
    if (!newName.trim() || newPin.length !== 6 || !/^\d{6}$/.test(newPin)) return;
    const pin_hash = await hashPinForStorage(newPin);
    const email = newEmail.trim() || `${newName.replace(/\s+/g, '').toLowerCase()}@pub.local`;

    if (isSupabaseConfigured) {
      // Create the cloud profile first, then replace the temporary client hash
      // with a server-generated bcrypt hash through set_profile_pin.
      const { data: inserted, error: insErr } = await supabase
        .from('profiles')
        .insert({
          email,
          full_name: newName.trim(),
          pin_hash: pin_hash, // temporary; admin should set PIN via SQL or we use set_profile_pin after
          role: 'cashier',
          permissions: DEFAULT_CASHIER_PERMS,
          is_active: true,
        })
        .select('id')
        .single();

      if (insErr) {
        console.error('Cloud cashier creation failed:', insErr);
        alert(`Could not create cashier in Supabase: ${insErr.message}. No local-only account was created.`);
        return;
      } else if (inserted?.id) {
        // Update PIN using server-side bcrypt. Never leave a SHA-256 placeholder
        // in the cloud because login_with_pin verifies pgcrypto bcrypt hashes.
        const pinResult = await supabase.rpc('set_profile_pin', { p_id: inserted.id, p_pin: newPin });
        if (pinResult.error || !(pinResult.data as any)?.ok) {
          await supabase.from('profiles').delete().eq('id', inserted.id);
          alert(`Could not securely save the new user's PIN: ${pinResult.error?.message || (pinResult.data as any)?.error || 'PIN update failed'}`);
          return;
        }
        await loadFromServer();
        logActivity(currentUser.id, currentUser.full_name, 'User added', newName.trim());
        setShowAdd(false);
        setNewName('');
        setNewEmail('');
        setNewPin('');
        setAddStep('name');
        return;
      } else {
        alert('Supabase did not return the new cashier profile. Please refresh and try again.');
        return;
      }
    }

    const r = addStaffUser({
      id: crypto.randomUUID(),
      email,
      pin: '',
      pin_hash,
      role: 'cashier',
      full_name: newName.trim(),
      permissions: [...DEFAULT_CASHIER_PERMS],
      is_active: true,
    });
    if (!r.ok) {
      alert(r.error || 'Failed');
      return;
    }
    logActivity(currentUser.id, currentUser.full_name, 'User added', newName.trim());
    setShowAdd(false);
    setNewName('');
    setNewEmail('');
    setNewPin('');
    setAddStep('name');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Users</h1>
        <div className="flex gap-2">
          {isSupabaseConfigured && (
            <button
              onClick={loadFromServer}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 rounded-xl font-semibold"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          )}
          <button
            onClick={() => { setShowAdd(true); setAddStep('name'); setNewName(''); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl font-semibold"
          >
            <Plus size={18} /> Add cashier
          </button>
        </div>
      </div>

      {allStaff.length === 0 && (
        <p className="text-gray-500 text-center py-8">
          No users loaded. {isSupabaseConfigured ? 'Click Refresh or run schema.sql seed.' : 'Demo mode — add a cashier.'}
        </p>
      )}

      {allStaff.map((u) => (
        <div key={u.id} className="bg-white dark:bg-gray-800 rounded-xl shadow p-5">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <div>
              <div className="font-semibold text-lg">{u.full_name}</div>
              <div className="text-sm text-gray-500">
                {u.email} · {u.role} · PIN ••••••
                {u.is_active === false && (
                  <span className="ml-2 text-red-500 font-medium">Inactive</span>
                )}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => { setEditNameId(u.id); setNameValue(u.full_name); }}
                className="px-4 py-2 bg-primary-100 text-primary-700 rounded-xl text-sm font-semibold"
              >
                Edit name
              </button>
              <button
                onClick={() => { setEditPinId(u.id); setPinValue(''); }}
                className="px-4 py-2 bg-amber-100 text-amber-800 rounded-xl text-sm font-semibold"
              >
                Change PIN
              </button>
              {u.role === 'cashier' && (
                <button
                  onClick={async () => {
                    if (!confirm(`Remove ${u.full_name}?`)) return;
                    removeStaffUser(u.id);
                    if (isSupabaseConfigured) {
                      await updateProfileFields(u.id, { is_active: false });
                    }
                    logActivity(currentUser.id, currentUser.full_name, 'User removed', u.full_name);
                  }}
                  className="px-3 py-2 bg-red-50 text-red-600 rounded-xl"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          </div>

          {u.role === 'cashier' && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {PERM_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      updateStaffUser(u.id, { permissions: p.perms });
                      if (isSupabaseConfigured) {
                        void updateProfilePermissions(u.id, p.perms);
                      }
                    }}
                    className="px-2.5 py-1 text-xs rounded-full bg-gray-100 border hover:bg-primary-50"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {TAB_OPTIONS.map((t) => {
                  const checked = u.permissions.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer ${
                        checked ? 'bg-primary-50 border-primary-300' : 'bg-gray-50 dark:bg-gray-900'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePerm(u, t.id)}
                        className="w-5 h-5"
                      />
                      <span className="text-sm">{t.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ))}

      {editNameId && (
        <QwertyKeyboard
          value={nameValue}
          onChange={setNameValue}
          onConfirm={saveName}
          onCancel={() => setEditNameId(null)}
          title="Edit name"
        />
      )}

      {editPinId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm">
            <h2 className="font-bold mb-2">New 6-digit PIN</h2>
            <div className="bg-gray-900 rounded-xl overflow-hidden">
              <NumericPad
                value={pinValue}
                onChange={setPinValue}
                maxLength={6}
                onConfirm={async () => {
                  if (pinValue.length !== 6) return;
                  if (isSupabaseConfigured) {
                    const pinResult = await supabase.rpc('set_profile_pin', { p_id: editPinId, p_pin: pinValue });
                    if (pinResult.error || !(pinResult.data as any)?.ok) {
                      alert(`Could not update PIN: ${pinResult.error?.message || (pinResult.data as any)?.error || 'PIN update failed'}`);
                      return;
                    }
                  }
                  const hash = await hashPinForStorage(pinValue);
                  updateStaffUser(editPinId, { pin_hash: hash, pin: '' });
                  logActivity(currentUser.id, currentUser.full_name, 'PIN changed', editPinId);
                  setEditPinId(null);
                  setPinValue('');
                }}
                large
              />
            </div>
            <button
              onClick={() => setEditPinId(null)}
              className="w-full mt-2 py-2 bg-gray-200 dark:bg-gray-700 rounded-xl"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm space-y-3">
            <h2 className="font-bold text-lg">Add cashier</h2>
            {addStep === 'name' && (
              <>
                <QwertyKeyboard
                  value={newName}
                  onChange={setNewName}
                  onConfirm={() => newName.trim() && setAddStep('email')}
                  onCancel={() => setShowAdd(false)}
                  title="Full name"
                />
              </>
            )}
            {addStep === 'email' && (
              <>
                <QwertyKeyboard
                  value={newEmail}
                  onChange={setNewEmail}
                  onConfirm={() => setAddStep('pin')}
                  onCancel={() => setAddStep('name')}
                  title="Email (optional)"
                />
              </>
            )}
            {addStep === 'pin' && (
              <>
                <p className="text-sm text-gray-500">Enter 6-digit PIN</p>
                <div className="bg-gray-900 rounded-xl overflow-hidden">
                  <NumericPad
                    value={newPin}
                    onChange={setNewPin}
                    maxLength={6}
                    onConfirm={finishAdd}
                    large
                  />
                </div>
                <button onClick={() => setAddStep('email')} className="w-full py-2 text-gray-500">
                  Back
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
