import { Link } from "react-router-dom";
import { BILLING } from "../../data";

export function Billing() {
  const b = BILLING;
  const assessPct = Math.round((b.usage.assessments / b.included.assessments) * 100);
  const seatPct = Math.round((b.usage.seats / b.included.seats) * 100);

  return (
    <>
      <div className="crumb">
        <Link to="/dashboard/settings">Settings</Link> / <span className="here">Billing</span>
      </div>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 28 }}>Billing &amp; plan</h1>
          <p>Acme Wholesale · manage your subscription, usage, and invoices.</p>
        </div>
      </div>

      <div
        className="report-grid"
        style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, alignItems: "start" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              background: "linear-gradient(135deg,#082f3c,#0b3140)",
              borderRadius: 16,
              padding: 26,
              color: "#fff",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ font: "700 18px var(--sans)" }}>{b.plan}</span>
                  <span className="badge badge-solid" style={{ fontSize: 10 }}>
                    CURRENT PLAN
                  </span>
                </div>
                <div style={{ font: "800 40px var(--mono)", lineHeight: 1 }}>
                  ${b.priceMonthly}
                  <span style={{ font: "500 15px var(--sans)", color: "var(--navy-muted)" }}>/mo</span>
                </div>
                <div style={{ font: "500 12px var(--sans)", color: "var(--navy-ink-2)", marginTop: 10 }}>
                  Renews {b.renews} · billed monthly
                </div>
              </div>
              <button
                className="btn"
                style={{ background: "#fff", color: "#082f3c", borderColor: "#fff" }}
              >
                Change plan
              </button>
            </div>
            <div
              style={{
                display: "flex",
                gap: 26,
                marginTop: 22,
                paddingTop: 20,
                borderTop: "1px solid var(--navy-border)",
                flexWrap: "wrap",
              }}
            >
              {[
                { k: "Assessments / mo", v: `${b.included.assessments} included` },
                { k: "Reviewer seats", v: `${b.included.seats} included` },
                { k: "Overage", v: b.included.overage },
              ].map((s) => (
                <div key={s.k}>
                  <div style={{ font: "400 11px var(--sans)", color: "var(--navy-muted)" }}>{s.k}</div>
                  <div style={{ font: "700 15px var(--mono)", marginTop: 3 }}>{s.v}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
              <h3 style={{ font: "700 16px var(--sans)", margin: 0 }}>Usage this cycle</h3>
              <span style={{ font: "500 12px var(--mono)", color: "var(--ink-faint)" }}>{b.usage.cycle}</span>
            </div>
            {[
              { label: "Assessments", used: b.usage.assessments, cap: b.included.assessments, pct: assessPct, color: "var(--accent)" },
              { label: "Reviewer seats", used: b.usage.seats, cap: b.included.seats, pct: seatPct, color: "var(--navy)" },
            ].map((u, i) => (
              <div key={u.label} style={{ marginBottom: i === 0 ? 20 : 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                  <span style={{ font: "600 13px var(--sans)", color: "var(--ink-2)" }}>{u.label}</span>
                  <span style={{ font: "600 13px var(--mono)" }}>
                    {u.used} <span style={{ color: "var(--ink-faint)" }}>/ {u.cap}</span>
                  </span>
                </div>
                <div style={{ height: 9, background: "var(--surface-2)", borderRadius: 5, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${u.pct}%`,
                      background: u.color,
                      borderRadius: 5,
                      transformOrigin: "left",
                      animation: `barIn 0.9s ${0.2 + i * 0.12}s cubic-bezier(0.3,0.8,0.3,1) both`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "18px 22px 14px" }}>
              <h3 style={{ font: "700 16px var(--sans)", margin: 0 }}>Invoices</h3>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice</th>
                  <th className="num">Amount</th>
                  <th className="num">Status</th>
                </tr>
              </thead>
              <tbody>
                {b.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td style={{ fontSize: 13 }}>{inv.date}</td>
                    <td className="artifact" style={{ color: "var(--ink-muted)", fontSize: 12 }}>
                      {inv.id}
                    </td>
                    <td className="num">{inv.amount}</td>
                    <td className="num">
                      <span className="badge badge-pass" style={{ fontSize: 10 }}>
                        ✓ {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ font: "700 14px var(--sans)", marginBottom: 14 }}>Payment method</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div
                style={{
                  width: 44,
                  height: 30,
                  borderRadius: 6,
                  background: "linear-gradient(135deg,#082f3c,#16404e)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  font: "700 9px var(--mono)",
                  color: "var(--accent-bright)",
                }}
              >
                {b.card.brand}
              </div>
              <div>
                <div style={{ font: "600 13px var(--mono)" }}>•••• {b.card.last4}</div>
                <div style={{ font: "500 11px var(--sans)", color: "var(--ink-faint)", marginTop: 1 }}>
                  Expires {b.card.expires}
                </div>
              </div>
            </div>
            <button className="btn" style={{ width: "100%", fontSize: 12, padding: 9 }}>
              Update card
            </button>
          </div>

          <div
            style={{
              background: "#f6fdf9",
              border: "1px solid var(--accent-line)",
              borderRadius: 14,
              padding: 20,
            }}
          >
            <div style={{ font: "700 14px var(--sans)", marginBottom: 6 }}>{b.upsell.plan} plan</div>
            <p style={{ font: "400 12.5px/1.5 var(--sans)", color: "var(--ink-2)", margin: "0 0 14px" }}>
              {b.upsell.pitch}
            </p>
            <div style={{ font: "800 24px var(--mono)", marginBottom: 12 }}>
              ${b.upsell.priceMonthly.toLocaleString()}
              <span style={{ font: "500 13px var(--sans)", color: "var(--ink-muted)" }}>/mo</span>
            </div>
            <button className="btn btn-primary" style={{ width: "100%", padding: 11, fontSize: 13 }}>
              Upgrade to {b.upsell.plan}
            </button>
          </div>

          <div style={{ font: "500 11px/1.5 var(--sans)", color: "var(--ink-faint)", textAlign: "center" }}>
            Billing questions?{" "}
            <span style={{ color: "var(--accent-strong)", fontWeight: 600 }}>Contact support</span>
          </div>
        </div>
      </div>
    </>
  );
}
