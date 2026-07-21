import { PENDING_TEAM_INVITES, TEAM } from "../../data";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Team() {
  const owners = TEAM.filter((m) => m.role === "Owner").length;
  const reviewers = TEAM.filter((m) => m.role === "Reviewer").length;
  const viewers = TEAM.filter((m) => m.role === "Viewer").length;

  return (
    <>
      <div className="page-head" style={{ alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontSize: 28 }}>Team</h1>
          <p>
            Acme Wholesale · {TEAM.length} members · reviewers grade submissions and release
            reports.
          </p>
        </div>
        <button className="btn btn-primary">+ Invite teammate</button>
      </div>

      <div className="grid-3" style={{ marginBottom: 24 }}>
        {[
          { label: "Owners", n: owners, sub: "full access & billing" },
          { label: "Reviewers", n: reviewers, sub: "grade & release reports" },
          { label: "Viewers", n: viewers, sub: "read-only access" },
        ].map((t) => (
          <div key={t.label} className="stat-tile" style={{ background: "#fff" }}>
            <p className="stat-label">{t.label}</p>
            <p className="stat-value" style={{ fontSize: 26 }}>
              {t.n}
            </p>
            <p className="stat-sub">{t.sub}</p>
          </div>
        ))}
      </div>

      <div className="table-card" style={{ background: "#fff", marginBottom: 28 }}>
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Last active</th>
              <th className="num">Reviews</th>
            </tr>
          </thead>
          <tbody>
            {TEAM.map((m) => (
              <tr key={m.id}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      className="nav-avatar"
                      style={
                        m.role === "Owner"
                          ? {
                              width: 36,
                              height: 36,
                              background: "linear-gradient(140deg,#16a34a,#0d3b2b)",
                              color: "#fff",
                            }
                          : { width: 36, height: 36 }
                      }
                    >
                      {initials(m.name)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {m.name}{" "}
                        {m.isYou && (
                          <span style={{ font: "500 12px var(--sans)", color: "var(--ink-faint)" }}>
                            · you
                          </span>
                        )}
                      </div>
                      <div style={{ font: "500 11px var(--mono)", color: "var(--ink-faint)", marginTop: 1 }}>
                        {m.email}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`badge${m.role === "Owner" ? " badge-pass" : ""}`} style={{ fontFamily: "var(--sans)", fontSize: 12 }}>
                    {m.role}
                    {m.role !== "Owner" ? " ▾" : ""}
                  </span>
                </td>
                <td style={{ color: "var(--ink-muted)", fontSize: 13 }}>{m.lastActive}</td>
                <td className="num">{m.reviews ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="eyebrow" style={{ margin: "0 0 12px" }}>
        Pending invites
      </div>
      {PENDING_TEAM_INVITES.map((inv) => (
        <div key={inv.email} className="pending-banner">
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "1px dashed #d9a200",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
              color: "#b58600",
            }}
          >
            ✉
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ font: "600 14px var(--sans)" }}>{inv.email}</div>
            <div style={{ font: "500 11px var(--mono)", color: "#b58600", marginTop: 2 }}>
              {inv.role} · invited {inv.invited}
            </div>
          </div>
          <button className="btn" style={{ padding: "7px 14px", fontSize: 12 }}>
            Resend
          </button>
          <button
            className="btn btn-ghost"
            style={{ padding: "7px 8px", fontSize: 12, color: "#c0392b" }}
          >
            Revoke
          </button>
        </div>
      ))}
    </>
  );
}
