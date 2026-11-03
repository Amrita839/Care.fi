import Link from "next/link";
import { LogOut } from "lucide-react";
import { NavLinks } from "@/components/nav-links";
import { requireStaff } from "@/lib/auth";
import { isDemo } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const links = [
    { href: "/patients", label: "Patients" },
    ...(staff.role === "admin" ? [{ href: "/settings", label: "Settings" }] : []),
  ];
  return (
    <div className="min-h-screen">
      {isDemo && (
        <div className="bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-800">
          Demo mode — showing seed data, changes are disabled.
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/patients" className="flex items-center gap-2.5 font-semibold text-ink">
              <svg className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 5 L12 12 L12 20" stroke="#7E57C2" />
                <path d="M18 5 L12 12" stroke="#B5A6DE" />
              </svg>
              <span>Patient Locker</span>
            </Link>
            <NavLinks links={links} />
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium">{staff.full_name}</p>
              <p className="text-xs capitalize text-ink-muted">{staff.role}</p>
            </div>
            <form action="/auth/signout" method="post">
              <button className="btn-ghost" type="submit" aria-label="Sign out" title="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
