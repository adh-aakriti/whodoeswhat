import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { DM_Sans, Fraunces } from "next/font/google";
import { createClient } from "@/lib/supabase-server";
import LogoutButton from "@/components/LogoutButton";
import "./globals.css";

const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif", display: "swap" });
const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "WhoDoesWhat",
  description:
    "WhoDoesWhat helps university project teams split work into tasks with owners and deadlines so everyone knows what's next.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FAF8F4",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href={user ? "/app" : "/"} className="brand">
              WhoDoesWhat
            </Link>
            <nav className="nav" aria-label="Account">
              {user ? (
                <LogoutButton />
              ) : (
                <Link href="/login" className="text-link">Log in</Link>
              )}
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
