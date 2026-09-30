"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  setActiveUser as setCookie,
  getActiveUserId as getActiveUserIdFromServer,
  clearActiveUser,
  setDefaultUser as setDefault,
  getDefaultUserId,
} from "@/lib/active-user-client";

/* ── Types ────────────────────────────────────────────────────────────── */

export type UserDTO = {
  id: number;
  name: string;
  color: string;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
};

type UserContextType = {
  activeUser: UserDTO | null;
  users: UserDTO[];
  loading: boolean;
  switchUser: (id: number) => void;
  createUser: (data: {
    name: string;
    color?: string;
    avatar?: string | null;
  }) => Promise<UserDTO>;
  updateUser: (
    id: number,
    data: { name?: string; color?: string; avatar?: string | null },
  ) => Promise<UserDTO>;
  deleteUser: (id: number) => Promise<void>;
  refreshUsers: () => Promise<void>;
  /** True when there are no users at all (triggers onboarding) */
  needsOnboarding: boolean;
};

const UserContext = createContext<UserContextType | null>(null);

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}

/* ── Provider ─────────────────────────────────────────────────────────── */

export function UserProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [activeUser, setActiveUser] = useState<UserDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      if (res.ok) {
        const data: UserDTO[] = await res.json();
        setUsers(data);
        return data;
      }
    } catch {
      /* ignore */
    }
    return [] as UserDTO[];
  }, []);

  // Initialise on mount
  useEffect(() => {
    async function init() {
      setLoading(true);
      const allUsers = await fetchUsers();

      if (allUsers.length === 0) {
        setNeedsOnboarding(true);
        setLoading(false);
        return;
      }

      // 1. Ask the server who the signed cookie says we are
      const sessionUserId = await getActiveUserIdFromServer();
      let userId = sessionUserId;

      // 2. Fallback to localStorage default
      if (!userId) {
        userId = getDefaultUserId();
      }

      // 3. Fallback to first user
      if (!userId) {
        userId = allUsers[0].id;
      }

      // Validate the user exists
      const user = allUsers.find((u) => u.id === userId) ?? allUsers[0];
      await setCookie(user.id);
      setActiveUser(user);
      setLoading(false);

      // The page was server-rendered before this session existed, so anything
      // user-scoped came back empty. Refresh once to pick it up — but only when
      // we actually established a new session, or this loops forever.
      if (sessionUserId !== user.id) {
        router.refresh();
      }
    }

    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchUser = useCallback(
    async (id: number) => {
      const user = users.find((u) => u.id === id);
      if (!user) return;
      // The cookie is set server-side now, so wait for it before navigating —
      // otherwise the next request still carries the previous user.
      const ok = await setCookie(id);
      if (!ok) return;
      setActiveUser(user);
      // Notify FavouritesProvider and other listeners
      window.dispatchEvent(new CustomEvent("user-switched"));
      // Navigate home — staying on a trip/city page would 404
      // because that data belongs to the previous user
      router.push("/");
      router.refresh();
    },
    [users, router],
  );

  const createUser = useCallback(
    async (data: { name: string; color?: string; avatar?: string | null }) => {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create user");
      const user: UserDTO = await res.json();

      setUsers((prev) => [...prev, user]);
      setNeedsOnboarding(false);

      // If this is the first user, auto-activate
      if (!activeUser) {
        await setCookie(user.id);
        setDefault(user.id);
        setActiveUser(user);
        router.refresh();
      }

      return user;
    },
    [activeUser, router],
  );

  const updateUser = useCallback(
    async (
      id: number,
      data: { name?: string; color?: string; avatar?: string | null },
    ) => {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update user");
      const updated: UserDTO = await res.json();

      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
      if (activeUser?.id === id) {
        setActiveUser(updated);
      }

      return updated;
    },
    [activeUser],
  );

  const deleteUser = useCallback(
    async (id: number) => {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to delete user");
      }

      const remaining = users.filter((u) => u.id !== id);
      setUsers(remaining);

      // Setting the cookie is a server round-trip now, so it can't happen
      // inside the state updater.
      if (activeUser?.id === id) {
        if (remaining.length > 0) {
          await setCookie(remaining[0].id);
          setActiveUser(remaining[0]);
        } else {
          await clearActiveUser();
          setActiveUser(null);
          setNeedsOnboarding(true);
        }
        router.refresh();
      }
    },
    [activeUser, users, router],
  );

  const refreshUsers = useCallback(async () => {
    const allUsers = await fetchUsers();
    if (activeUser) {
      const updated = allUsers.find((u) => u.id === activeUser.id);
      if (updated) setActiveUser(updated);
    }
  }, [fetchUsers, activeUser]);

  return (
    <UserContext.Provider
      value={{
        activeUser,
        users,
        loading,
        switchUser,
        createUser,
        updateUser,
        deleteUser,
        refreshUsers,
        needsOnboarding,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}
