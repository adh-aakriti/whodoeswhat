"use client";

import { createClient } from "@/lib/supabase-browser";

export default function LogoutButton() {
  async function logout() {
    await createClient().auth.signOut();
    window.location.assign("/");
  }

  return (
    <button type="button" className="text-button" data-testid="logout" onClick={logout}>
      Log out
    </button>
  );
}
