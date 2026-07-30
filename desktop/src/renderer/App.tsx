import { useEffect, useState, type JSX } from "react";

export function App(): JSX.Element {
  const [pong, setPong] = useState<string>("…");

  useEffect(() => {
    let off: (() => void) | undefined;
    void window.mystatus
      .ping()
      .then(() => setPong("ok"))
      .catch(() => setPong("error"));
    off = window.mystatus.onViewModel(() => {
      /* placeholder: view-model push arrives in todo 3 */
    });
    return () => off?.();
  }, []);

  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">mystatus desktop</h1>
      <p className="text-sm text-zinc-400">
        Shell scaffolded. Bridge ping: <span className="font-mono">{pong}</span>
      </p>
      <p className="text-xs text-zinc-500">
        Dashboard, credentials, and settings arrive in later waves.
      </p>
    </main>
  );
}