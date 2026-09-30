import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { Dashboard } from "./pages/Dashboard";
import { Despesas } from "./pages/Despesas";
import { Pendencias } from "./pages/Pendencias";
import { Relatorios } from "./pages/Relatorios";
import { Empty } from "./components/common";

const TABS = {
  dashboard: { label: "Resumo", render: () => <Dashboard /> },
  despesas: { label: "Despesas", render: () => <Despesas /> },
  pendencias: { label: "Pendências", render: () => <Pendencias /> },
  relatorios: { label: "Relatórios", render: () => <Relatorios /> },
} as const;

type TabKey = keyof typeof TABS;

function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({ email });
    if (err) setError(err.message);
    else setSent(true);
  }

  return (
    <div className="signin">
      <h1>Monēta ₥</h1>
      {sent
        ? <p>Link enviado para {email}. Abra-o neste navegador para entrar.</p>
        : (
          <>
            <p style={{ color: "var(--text-secondary)" }}>
              Entre com seu e-mail — enviamos um link de acesso.
            </p>
            <form onSubmit={submit}>
              <input
                type="email"
                required
                placeholder="voce@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="E-mail"
              />
              <button className="action" type="submit">Enviar link</button>
            </form>
          </>
        )}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<TabKey>("dashboard");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Signing in is not the same as being allowed in: the allowlist row is what
  // RLS checks, so the app asks for it directly to tell the two apart instead
  // of showing empty screens.
  useEffect(() => {
    if (!session) {
      setAllowed(null);
      return;
    }
    supabase
      .from("app_users")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data }) => setAllowed(Boolean(data)));
  }, [session]);

  if (!ready) return <div className="shell"><Empty>Carregando…</Empty></div>;
  if (!session) return <SignIn />;

  return (
    <div className="shell">
      <header className="top">
        <h1>Monēta ₥</h1>
        <span className="who">
          {session.user.email}{" "}
          <button
            className="action"
            style={{ marginLeft: 8 }}
            onClick={() => supabase.auth.signOut()}
          >
            Sair
          </button>
        </span>
      </header>

      {allowed === false
        ? (
          <Empty>
            Esta conta não tem acesso aos dados. Peça para adicionarem
            <code> {session.user.email} </code> em <code>app_users</code>.
          </Empty>
        )
        : (
          <>
            <nav className="tabs">
              {(Object.keys(TABS) as TabKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  aria-current={tab === key ? "page" : undefined}
                >
                  {TABS[key].label}
                </button>
              ))}
            </nav>
            {TABS[tab].render()}
          </>
        )}
    </div>
  );
}
