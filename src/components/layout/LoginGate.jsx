import { useEffect, useState } from "react";
import { loginIsRequired, signInToLrs, watchLoginRequired } from "../../features/mapping/services/lrsService";

export default function LoginGate() {
  const [required, setRequired] = useState(loginIsRequired);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => watchLoginRequired(setRequired), []);

  useEffect(() => {
    if (!required) return undefined;
    let cancel = false;
    setBusy(true);
    setNotice("");
    signInToLrs()
      .catch((error) => {
        if (!cancel) setNotice(error.message || "Sign in to continue.");
      })
      .finally(() => {
        if (!cancel) setBusy(false);
      });
    return () => {
      cancel = true;
    };
  }, [required]);

  if (!required) return null;

  return (
    <div className="login-gate" role="dialog" aria-modal="true" aria-labelledby="login-gate-title">
      <div className="login-gate-card">
        <h2 id="login-gate-title">Sign in</h2>
        <p>Sign in with your portal account to continue.</p>
        {notice && <p className="login-gate-note">{notice}</p>}
        <button
          type="button"
          className="profile-logout"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setNotice("");
            signInToLrs()
              .catch((error) => setNotice(error.message || "Sign in to continue."))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}
