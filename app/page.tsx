/**
 * Landing page. Server component shell — the name form arrives as a small client island so
 * this stays static. Must fit one viewport at 100dvh: if it scrolls on a phone, it's wrong.
 */
export default function LandingPage() {
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      {/* TODO: IEEE Student Branch logo, top-center. Present on every screen, never omitted. */}
      <p className="text-xs font-semibold tracking-widest text-ieee-blue uppercase">
        IEEE Ahmedabad University Student Branch
      </p>

      <h1 className="text-4xl font-bold text-balance">Draw it. Beat the AI. Top the board.</h1>

      {/*
        TODO: name entry — a "use client" island under app/_components/ owning the input, the
        participants INSERT and the sessionStorage write. One field and a Start button, nothing
        else. See docs/02-architecture.md § 9 and § 10.
      */}
      <p className="text-ink-muted">Name entry goes here.</p>
    </main>
  );
}
