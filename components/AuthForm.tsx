"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import Tagline from "@/components/Tagline";

type Mode = "signup" | "login";

export default function AuthForm({ mode }: { mode: Mode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isSignup = mode === "signup";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { data, error } = isSignup
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    if (!data.session) {
      setError("Account created, but no session was returned. Email confirmation must be turned off in Supabase.");
      setLoading(false);
      return;
    }
    // Full navigation so the server sees the new auth cookies.
    window.location.assign("/app");
  }

  return (
    <main className="container narrow">
      <Tagline small />
      <h1>{isSignup ? "Create your account" : "Log in"}</h1>
      <p className="muted intro">
        {isSignup ? "An email and a password is all it takes." : "Welcome back. Your task sheet is where you left it."}
      </p>
      <form className="form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor={`${mode}-email`}>Email</label>
          <input
            id={`${mode}-email`}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid={`${mode}-email`}
          />
        </div>
        <div className="field">
          <label htmlFor={`${mode}-password`}>Password</label>
          <input
            id={`${mode}-password`}
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={`${mode}-password-hint`}
            data-testid={`${mode}-password`}
          />
          <p id={`${mode}-password-hint`} className="hint">At least 6 characters.</p>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={loading} data-testid={`${mode}-submit`}>
          {loading ? "Please wait…" : isSignup ? "Sign up" : "Log in"}
        </button>
      </form>
      <p className="muted switch">
        {isSignup ? (
          <>Already have an account? <Link href="/login" className="text-link">Log in</Link></>
        ) : (
          <>New here? <Link href="/signup" className="text-link">Sign up</Link></>
        )}
      </p>
    </main>
  );
}
