import { useState } from "react";
import type { AuthStatus } from "../types";
import { Icon } from "./Icons";

type LockScreenProps = {
  auth: AuthStatus;
  onUnlock: (passcode: string) => Promise<{ ok: boolean; error?: string }>;
};

export function LockScreen({ auth, onUnlock }: LockScreenProps) {
  const [passcode, setPasscode] = useState("");
  const [showPasscode, setShowPasscode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    const result = await onUnlock(passcode);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error || "Incorrect passcode.");
    }
  };

  return (
    <div className="lock-screen">
      <div className="lock-backdrop" />
      <div className="lock-card">
        <div className="lock-brand">MYFLIX</div>
        <div className="lock-badge">
          <Icon name="lock" size={16} />
          <span>Private Personal Archive</span>
        </div>
        <h1>Enter your passcode</h1>
        <p className="lock-subtitle">
          This library is completely private. Unlock once to watch and upload across this device.
        </p>

        {!auth.configured ? (
          <div className="lock-alert lock-alert--warn">
            <strong>Setup required:</strong> Add <code>MYFLIX_PASSCODE</code> in your Vercel
            Environment Variables and redeploy before unlocking.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="lock-form">
            <div className={`lock-input-wrap ${error ? "lock-input-wrap--error" : ""}`}>
              <input
                type={showPasscode ? "text" : "password"}
                value={passcode}
                onChange={(e) => {
                  setPasscode(e.target.value);
                  if (error) setError("");
                }}
                placeholder="Passcode"
                autoFocus
                autoComplete="current-password"
                aria-label="Myflix passcode"
              />
              <button
                type="button"
                className="lock-toggle"
                onClick={() => setShowPasscode((prev) => !prev)}
                aria-label={showPasscode ? "Hide passcode" : "Show passcode"}
              >
                <Icon name={showPasscode ? "eyeOff" : "eye"} size={18} />
              </button>
            </div>

            {error && <p className="lock-error">{error}</p>}

            <button className="button button--red lock-submit" type="submit" disabled={submitting}>
              {submitting ? "Unlocking..." : "Unlock Myflix"}
            </button>
          </form>
        )}

        {auth.devHint && <p className="lock-hint">{auth.devHint}</p>}
      </div>
    </div>
  );
}
