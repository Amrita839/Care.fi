import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  not_staff: "Your session ended or your account has no portal access.",
};

export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-8 sm:px-6 sm:py-12">
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8 items-stretch">
        {/* Left hero panel (desktop md+) */}
        <div
          className="hidden md:flex flex-col justify-between rounded-[24px] bg-[#111111] p-10 text-white relative overflow-hidden min-h-[480px]"
          style={{
            backgroundImage:
              "linear-gradient(#ffffff10 1px, transparent 1px), linear-gradient(90deg, #ffffff10 1px, transparent 1px)",
            backgroundSize: "42px 42px",
          }}
        >
          <div className="flex items-center gap-2.5">
            <svg className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 5 L12 12 L12 20" stroke="#7E57C2" />
              <path d="M18 5 L12 12" stroke="#B5A6DE" />
            </svg>
            <span className="text-base font-semibold text-white">Patient Locker</span>
          </div>
          <div className="my-auto py-8">
            <h1 className="font-serif text-4xl lg:text-5xl tracking-tight leading-tight font-normal">
              <span className="text-brand-lavender">Realize</span>{" "}
              <span className="text-white">faster claims</span>
            </h1>
            <p className="mt-4 text-sm text-white/70 max-w-sm">
              Insurer queries read, matched and sent to patients — automatically.
            </p>
          </div>
          <p className="text-xs text-white/40">Claims query automation portal</p>
        </div>

        {/* Right side: Login card (and mobile heading) */}
        <div className="flex flex-col justify-center w-full max-w-sm mx-auto">
          {/* Mobile heading */}
          <div className="mb-6 text-center md:hidden">
            <div className="inline-flex items-center gap-2 mb-3">
              <svg className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 5 L12 12 L12 20" stroke="#7E57C2" />
                <path d="M18 5 L12 12" stroke="#B5A6DE" />
              </svg>
              <span className="text-base font-semibold text-ink">Patient Locker</span>
            </div>
            <h1 className="font-serif text-3xl font-normal tracking-tight">
              <span className="text-brand-purple">Realize</span>{" "}
              <span className="text-ink">faster claims</span>
            </h1>
            <p className="mt-2 text-xs text-ink-muted">
              Insurer queries read, matched and sent to patients — automatically.
            </p>
          </div>

          <div className="card p-6 sm:p-8">
            <h2 className="mb-1 text-base font-semibold text-ink">Sign in to your account</h2>
            <p className="mb-6 text-sm text-ink-muted">Staff access only.</p>
            <LoginForm next={searchParams.next} notice={searchParams.error ? NOTICES[searchParams.error] : undefined} />
          </div>
        </div>
      </div>
    </main>
  );
}
