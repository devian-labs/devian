import { ImageResponse } from "next/og";

export const alt = "Devian: stay in control of your AI coding agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const AGENTS: [string, string][] = [
  ["Claude Code", "#d95926"],
  ["Codex", "#3987e5"],
  ["Cursor", "#c98500"],
  ["OpenCode", "#199e70"],
  ["Antigravity", "#d55181"],
];

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#121212", color: "white", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 36, fontWeight: 700 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "#658cc2", display: "flex" }} />
          Devian
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>Stay in control of your AI coding agents.</div>
          <div style={{ fontSize: 30, color: "rgba(255,255,255,0.6)" }}>Sessions, leftover servers, memory, tokens and plan limits. Free, open source, local.</div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          {AGENTS.map(([name, color]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderRadius: 12, background: "rgba(255,255,255,0.06)", fontSize: 24 }}>
              <div style={{ width: 12, height: 12, borderRadius: 6, background: color }} />
              {name}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
