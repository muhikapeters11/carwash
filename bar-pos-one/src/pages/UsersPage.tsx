import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { ALL_TABS, TAB_LABELS, type AppTab, type User, type UserRole } from "@/types";
import { uid } from "@/lib/utils";
import { Trash2, Pencil } from "lucide-react";
import { useVirtualKeyboard } from "@/components/ui/VirtualKeyboard";
import { enqueueSync } from "@/stores/syncStore";

export function UsersPage() {
  const users = useAppStore((s) => s.users);
  const session = useAppStore((s) => s.session)!;
  const deleteUser = useAppStore((s) => s.deleteUser);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<UserRole>("cashier");
  const [tabs, setTabs] = useState<AppTab[]>(["dashboard", "sell"]);
  const kb = useVirtualKeyboard();

  if (session.role !== "admin") {
    return <div className="p-6 text-[var(--text-muted)]">Only admin can manage users.</div>;
  }

  const openAdd = () => {
    setEditing(null);
    setFullName("");
    setUsername("");
    setPin("");
    setRole("cashier");
    setTabs(["dashboard", "sell"]);
    setShow(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    setFullName(u.full_name);
    setUsername(u.username);
    setPin(u.pin);
    setRole(u.role);
    setTabs([...u.allowed_tabs]);
    setShow(true);
  };

  const toggleTab = (t: AppTab) => {
    setTabs((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const pinTaken = users.some((u) => u.pin === pin && u.id !== editing?.id);
    if (pinTaken) {
      alert("This PIN is already used by another user.");
      return;
    }
    if (editing) {
      const updated: User = {
        ...editing,
        full_name: fullName,
        username: username || fullName.toLowerCase().replace(/\s+/g, ""),
        pin,
        role,
        allowed_tabs: role === "admin" ? [...ALL_TABS] : tabs,
        updated_at: new Date().toISOString(),
      } as User;
      useAppStore.setState({
        users: users.map((u) => (u.id === editing.id ? updated : u)),
      });
      enqueueSync("user_upsert", updated);
      if (session.id === editing.id) {
        useAppStore.setState({
          session: {
            ...session,
            full_name: fullName,
            role,
            allowed_tabs: role === "admin" ? [...ALL_TABS] : tabs,
          },
        });
      }
    } else {
      const created: User = {
        id: uid(),
        full_name: fullName,
        username: username || fullName.toLowerCase().replace(/\s+/g, ""),
        pin,
        role,
        allowed_tabs: role === "admin" ? [...ALL_TABS] : tabs,
        is_active: true,
        created_at: new Date().toISOString(),
      };
      useAppStore.setState({ users: [...users, created] });
      enqueueSync("user_upsert", created);
    }
    setShow(false);
    kb.close();
  };

  return (
    <div className="h-full overflow-y-auto p-6 bg-[var(--bg)]">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold text-[var(--text)]">Users</h1>
        <button
          onClick={openAdd}
          className="px-4 py-2 rounded-xl bg-amber-500 text-white font-bold text-sm"
        >
          Add User
        </button>
      </div>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)]">
        {users.map((u) => (
          <div key={u.id} className="px-5 py-3 flex justify-between items-center gap-3">
            <div className="min-w-0">
              <div className="font-medium text-[var(--text)]">{u.full_name}</div>
              <div className="text-xs text-[var(--text-muted)]">
                Role: {u.role} · PIN set
              </div>
              <div className="text-[10px] text-[var(--text-muted)] mt-1 truncate">
                {u.allowed_tabs.map((t) => TAB_LABELS[t]).join(", ")}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => openEdit(u)}
                className="p-2 rounded-lg text-amber-600 hover:bg-[var(--bg-muted)]"
                title="Edit"
              >
                <Pencil size={18} />
              </button>
              {u.id !== session.id && (
                <button
                  onClick={() => {
                    if (confirm(`Remove ${u.full_name}?`)) deleteUser(u.id);
                  }}
                  className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={submit}
            className="bg-[var(--bg-card)] rounded-2xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto border border-[var(--border)]"
          >
            <h3 className="font-bold text-lg text-[var(--text)]">
              {editing ? "Edit user" : "Add user"}
            </h3>
            <div>
              <label className="text-sm text-[var(--text)]">Full name</label>
              <input
                readOnly
                value={fullName}
                onClick={() => kb.openFor(fullName, setFullName, "alpha")}
                className="mt-1 w-full px-3 py-2.5 rounded-xl cursor-pointer"
                required
              />
            </div>
            <div>
              <label className="text-sm text-[var(--text)]">Username</label>
              <input
                readOnly
                value={username}
                onClick={() => kb.openFor(username, setUsername, "alpha")}
                className="mt-1 w-full px-3 py-2.5 rounded-xl cursor-pointer"
              />
            </div>
            <div>
              <label className="text-sm text-[var(--text)]">PIN (unique)</label>
              <input
                readOnly
                value={pin}
                onClick={() => kb.openFor(pin, setPin, "numeric")}
                className="mt-1 w-full px-3 py-2.5 rounded-xl cursor-pointer"
                required
              />
            </div>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="w-full px-3 py-2.5 rounded-xl"
            >
              <option value="cashier">Cashier</option>
              <option value="manager">Manager</option>
              <option value="accountant">Accountant</option>
              <option value="admin">Admin</option>
            </select>
            {role !== "admin" && (
              <div>
                <div className="text-sm font-medium mb-2 text-[var(--text)]">Allowed tabs</div>
                <div className="grid grid-cols-2 gap-1">
                  {ALL_TABS.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm text-[var(--text)]">
                      <input
                        type="checkbox"
                        checked={tabs.includes(t)}
                        onChange={() => toggleTab(t)}
                      />
                      {TAB_LABELS[t]}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShow(false);
                  kb.close();
                }}
                className="flex-1 py-3 rounded-xl border border-[var(--border)] font-semibold text-[var(--text)]"
              >
                Cancel
              </button>
              <button type="submit" className="flex-1 py-3 rounded-xl bg-amber-500 text-white font-bold">
                Save
              </button>
            </div>
          </form>
        </div>
      )}
      {kb.Keyboard}
    </div>
  );
}
