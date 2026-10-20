import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import LogoutButton from "@/components/LogoutButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "WhoDoesWhat",
  description:
    "WhoDoesWhat helps university project teams split work into tasks with owners and deadlines so everyone knows what's next.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href={user ? "/app" : "/"} className="brand">
            WhoDoesWhat
          </Link>
          <nav className="nav">
            {user ? (
              <LogoutButton />
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost">Log in</Link>
              </>
            )}
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
