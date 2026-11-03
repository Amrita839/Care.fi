import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="mt-1 text-xl font-semibold">Not found</h1>
      <p className="mt-1 text-sm text-ink-muted">This page doesn&apos;t exist, or it isn&apos;t assigned to you.</p>
      <Link href="/patients" className="btn-primary mt-5">Back to patients</Link>
    </main>
  );
}
