import { useEffect, useRef, useState } from "react";
import { assetIcons } from "../../assets";
import { readStoredUser, signInToLrs, signOutOfLrs, watchStoredUser } from "../../features/mapping/services/lrsService";

const ROLE_LABELS = {
  org_admin: "Administrator",
  org_publisher: "Publisher",
  org_user: "User",
};

function roleLabel(role) {
  if (!role) return "";
  return ROLE_LABELS[role] || role.replace(/_/g, " ");
}

export default function ProfileMenu() {
  const [user, setUser] = useState(readStoredUser);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const rootRef = useRef(null);

  useEffect(() => watchStoredUser(setUser), []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const signIn = async () => {
    setBusy(true);
    setNotice("");
    try {
      await signInToLrs();
    } catch (error) {
      setNotice(error.message || "Sign-in was cancelled.");
    } finally {
      setBusy(false);
    }
  };

  const logOut = async () => {
    setOpen(false);
    setNotice("");
    await signOutOfLrs();
  };

  const label = user?.fullName || user?.username || "Sign in";

  return (
    <div className="profile-menu-root" ref={rootRef}>
      <button
        type="button"
        className="profile-container"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="profile-icon">
          <assetIcons.RiAccountCircleFill className="profile-icon-icon" />
        </span>
        <span className="profile-details-name">{label}</span>
      </button>
      {open && (
        <div className="profile-menu" role="dialog" aria-label="Signed-in user">
          {user ? (
            <>
              <p className="profile-menu-name">{user.fullName || user.username}</p>
              <dl>
                <div>
                  <dt>Username</dt>
                  <dd>{user.username}</dd>
                </div>
                {user.email && (
                  <div>
                    <dt>Email</dt>
                    <dd>{user.email}</dd>
                  </div>
                )}
                {user.role && (
                  <div>
                    <dt>Role</dt>
                    <dd>{roleLabel(user.role)}</dd>
                  </div>
                )}
              </dl>
              <button type="button" className="profile-logout" onClick={logOut} disabled={busy}>
                {busy ? "Signing out…" : "Log out"}
              </button>
            </>
          ) : (
            <>
              <p className="profile-menu-name">Not signed in</p>
              <p className="profile-menu-note">Sign in with your portal account. Your name and email stay on this browser.</p>
              {notice && <p className="profile-menu-note">{notice}</p>}
              <button type="button" className="profile-logout" onClick={signIn} disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
