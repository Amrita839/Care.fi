"use client";

import { useFormState, useFormStatus } from "react-dom";
import { signIn, type LoginState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action] = useFormState<LoginState, FormData>(signIn, {});
  const error = state.error ?? notice;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-ink-soft">
          Work email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" placeholder="you@company.com" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-ink-soft">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} className="input" />
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <Submit />
    </form>
  );
}
