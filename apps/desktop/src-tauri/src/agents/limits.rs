//! Live plan limits (5-hour and weekly usage, reset times, extra usage) from
//! each provider's own usage endpoint, the same ones their CLIs use.
//!
//! Credentials: the login each CLI already stored — Claude Code's keychain
//! item for that config folder, Codex's `auth.json`. Tokens are read only
//! when the user has turned limits on for that account, sent only to the
//! provider's own HTTPS endpoint, and never returned to the UI, logged or
//! stored. Tokens are never refreshed here, so Devian can't log a CLI out.

use super::{claude, codex::codex_home, now_ms};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const CACHE_MS: i64 = 5 * 60 * 1000;
const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

#[derive(Serialize, Clone, Debug)]
pub struct LimitWindow {
    pub key: String,
    pub label: String,
    pub used_percent: f64,
    /// Unix ms.
    pub resets_at: Option<i64>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ExtraUsage {
    pub enabled: bool,
    pub used: Option<f64>,
    pub limit: Option<f64>,
    pub used_percent: Option<f64>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ProviderLimits {
    /// "claude:<instance>" or "codex".
    pub id: String,
    pub agent: String,
    pub label: String,
    pub plan: Option<String>,
    /// ok | off | no_login | expired | unsupported | error
    pub status: String,
    pub message: Option<String>,
    pub windows: Vec<LimitWindow>,
    pub extra: Option<ExtraUsage>,
    pub fetched_at: i64,
}

impl ProviderLimits {
    fn new(id: &str, agent: &str, label: &str, plan: Option<String>) -> Self {
        Self { id: id.into(), agent: agent.into(), label: label.into(), plan, status: "ok".into(), message: None, windows: vec![], extra: None, fetched_at: now_ms() }
    }
    fn with(mut self, status: &str, message: impl Into<String>) -> Self {
        self.status = status.into();
        self.message = Some(message.into());
        self
    }
}

/// Every account that could have limits, whether or not they're turned on.
pub fn accounts() -> Vec<ProviderLimits> {
    let mut out: Vec<ProviderLimits> = claude::instances()
        .into_iter()
        .map(|i| {
            let p = ProviderLimits::new(&format!("claude:{}", i.id), "claude", &i.label, i.plan.clone()).with("off", "");
            match i.provider.as_str() {
                "anthropic" => p,
                "bedrock" | "vertex" => p.with("unsupported", "Billed through your cloud provider, so there are no plan limits. Spend is shown from local usage."),
                _ => p.with("unsupported", "Not signed in to a Claude plan (API key or custom endpoint)."),
            }
        })
        .collect();
    if codex_home().join("auth.json").exists() {
        out.push(ProviderLimits::new("codex", "codex", "Codex", None).with("off", ""));
    }
    out
}

fn cache() -> &'static Mutex<HashMap<String, ProviderLimits>> {
    static C: OnceLock<Mutex<HashMap<String, ProviderLimits>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Limits for the accounts in `enabled`; the rest come back as "off" or
/// "unsupported" without touching their credentials.
pub async fn fetch(enabled: &[String], force: bool) -> Vec<ProviderLimits> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15)).build().ok();
    let mut out = Vec::new();
    for acct in accounts() {
        if acct.status == "unsupported" || !enabled.contains(&acct.id) {
            out.push(acct);
            continue;
        }
        if !force {
            if let Some(hit) = cache().lock().ok().and_then(|c| c.get(&acct.id).cloned()) {
                if now_ms() - hit.fetched_at < CACHE_MS {
                    out.push(hit);
                    continue;
                }
            }
        }
        let Some(client) = client.as_ref() else {
            out.push(acct.with("error", "Couldn't start an HTTPS client."));
            continue;
        };
        let fresh = if acct.id == "codex" { codex(client, acct).await } else { claude_limits(client, acct).await };
        if let Ok(mut c) = cache().lock() {
            c.insert(fresh.id.clone(), fresh.clone());
        }
        out.push(fresh);
    }
    out
}

fn parse_time(v: &Value) -> Option<i64> {
    match v {
        Value::String(s) => chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.timestamp_millis()),
        Value::Number(n) => n.as_i64().map(|t| if t < 10_000_000_000 { t * 1000 } else { t }),
        _ => None,
    }
}

// ── Claude ──────────────────────────────────────────────────────────────────

/// The OAuth credential JSON Claude Code stores for one config folder.
fn claude_credentials(inst: &claude::ClaudeInstance) -> Result<Value, String> {
    let file = std::path::Path::new(&inst.path).join(".credentials.json");
    if let Ok(text) = std::fs::read_to_string(&file) {
        return serde_json::from_str(&text).map_err(|_| "Couldn't read Claude Code's saved login.".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        use security_framework::item::{ItemClass, ItemSearchOptions, SearchResult};
        let results = ItemSearchOptions::new()
            .class(ItemClass::generic_password())
            .service(&inst.keychain_service)
            .load_data(true)
            .limit(1)
            .search()
            .map_err(|_| "Not signed in. Run `claude` and `/login` with this config folder.".to_string())?;
        for r in results {
            if let SearchResult::Data(bytes) = r {
                return serde_json::from_slice(&bytes).map_err(|_| "Couldn't read Claude Code's saved login.".to_string());
            }
        }
        Err("Not signed in. Run `claude` and `/login` with this config folder.".into())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Not signed in. Run `claude` and `/login` with this config folder.".into())
    }
}

fn claude_window_label(key: &str) -> String {
    match key {
        "five_hour" => "Session (5h)".into(),
        "seven_day" => "Weekly".into(),
        "seven_day_opus" => "Weekly · Opus".into(),
        "seven_day_sonnet" => "Weekly · Sonnet".into(),
        "seven_day_oauth_apps" => "Weekly · apps".into(),
        "seven_day_routines" => "Daily routines".into(),
        other => {
            let s = other.replace('_', " ");
            let mut c = s.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        }
    }
}

/// Parses `/api/oauth/usage`: every top-level object with a `utilization`
/// becomes a window, so new windows show up without a code change.
pub fn parse_claude_usage(v: &Value) -> (Vec<LimitWindow>, Option<ExtraUsage>) {
    let mut windows: Vec<LimitWindow> = v
        .as_object()
        .into_iter()
        .flatten()
        // Extra usage has a utilization too, but it's a spend cap, not a window.
        .filter(|(k, _)| k.as_str() != "extra_usage")
        .filter_map(|(k, w)| {
            let used = w.get("utilization")?.as_f64()?;
            Some(LimitWindow { key: k.clone(), label: claude_window_label(k), used_percent: used, resets_at: w.get("resets_at").and_then(parse_time) })
        })
        .collect();
    // Session first, then weekly, then the rest.
    let rank = |k: &str| match k { "five_hour" => 0, "seven_day" => 1, _ => 2 };
    windows.sort_by(|a, b| rank(&a.key).cmp(&rank(&b.key)).then(a.key.cmp(&b.key)));
    let extra = v.get("extra_usage").filter(|e| e.is_object()).map(|e| ExtraUsage {
        enabled: e["is_enabled"].as_bool().unwrap_or(false),
        used: e["used_credits"].as_f64(),
        limit: e["monthly_limit"].as_f64(),
        used_percent: e["utilization"].as_f64(),
    });
    (windows, extra)
}

async fn claude_limits(client: &reqwest::Client, acct: ProviderLimits) -> ProviderLimits {
    let inst_id = acct.id.trim_start_matches("claude:").to_string();
    let Some(inst) = claude::instances().into_iter().find(|i| i.id == inst_id) else {
        return acct.with("error", "This config folder no longer exists.");
    };
    let creds = match tokio::task::spawn_blocking(move || claude_credentials(&inst)).await {
        Ok(Ok(c)) => c,
        Ok(Err(e)) => return acct.with("no_login", e),
        Err(e) => return acct.with("error", e.to_string()),
    };
    let oauth = &creds["claudeAiOauth"];
    let Some(token) = oauth["accessToken"].as_str() else {
        return acct.with("no_login", "Not signed in to a Claude plan.");
    };
    if oauth["expiresAt"].as_i64().is_some_and(|t| t < now_ms()) {
        return acct.with("expired", "Login expired. Use Claude Code with this config folder once to refresh it.");
    }
    let res = client
        .get(CLAUDE_USAGE_URL)
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("Accept", "application/json")
        .send()
        .await;
    let res = match res {
        Ok(r) => r,
        Err(e) => return acct.with("error", format!("Couldn't reach Anthropic: {}", e.without_url())),
    };
    let status = res.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return acct.with("expired", "Anthropic didn't accept the saved login. Use Claude Code once to refresh it.");
    }
    if !status.is_success() {
        return acct.with("error", format!("Anthropic returned {status}."));
    }
    let Ok(body) = res.json::<Value>().await else {
        return acct.with("error", "Unexpected response from Anthropic.");
    };
    let (windows, extra) = parse_claude_usage(&body);
    ProviderLimits { windows, extra, fetched_at: now_ms(), ..acct }
}

// ── Codex ───────────────────────────────────────────────────────────────────

fn codex_window(key: &str, w: &Value) -> Option<LimitWindow> {
    let used = w.get("used_percent")?.as_f64()?;
    let secs = w["limit_window_seconds"].as_i64().unwrap_or(0);
    let label = match secs {
        s if s > 0 && s <= 6 * 3600 => format!("Session ({}h)", (s + 1799) / 3600),
        s if s >= 6 * 86_400 => "Weekly".to_string(),
        s if s > 0 => format!("{}h window", s / 3600),
        _ if key == "primary_window" => "Session".into(),
        _ => "Weekly".into(),
    };
    let resets_at = w.get("reset_at").and_then(parse_time).or_else(|| w["reset_after_seconds"].as_i64().map(|s| now_ms() + s * 1000));
    Some(LimitWindow { key: key.into(), label, used_percent: used, resets_at })
}

/// Parses `wham/usage`: `rate_limit.{primary,secondary}_window`.
pub fn parse_codex_usage(v: &Value) -> (Vec<LimitWindow>, Option<String>) {
    let rl = &v["rate_limit"];
    let windows = ["primary_window", "secondary_window"].iter().filter_map(|k| codex_window(k, &rl[*k])).collect();
    let plan = v["plan_type"].as_str().map(|p| {
        let mut c = p.chars();
        c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
    });
    (windows, plan)
}

async fn codex(client: &reqwest::Client, acct: ProviderLimits) -> ProviderLimits {
    let auth: Value = match std::fs::read_to_string(codex_home().join("auth.json")).ok().and_then(|t| serde_json::from_str(&t).ok()) {
        Some(v) => v,
        None => return acct.with("no_login", "Not signed in. Run `codex login`."),
    };
    let tokens = &auth["tokens"];
    let Some(token) = tokens["access_token"].as_str() else {
        return acct.with("unsupported", "Signed in with an API key, which has no plan limits.");
    };
    let mut req = client.get(CODEX_USAGE_URL).bearer_auth(token).header("Accept", "application/json");
    if let Some(account) = tokens["account_id"].as_str() {
        req = req.header("ChatGPT-Account-Id", account);
    }
    let res = match req.send().await {
        Ok(r) => r,
        Err(e) => return acct.with("error", format!("Couldn't reach OpenAI: {}", e.without_url())),
    };
    let status = res.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return acct.with("expired", "OpenAI didn't accept the saved login. Use Codex once to refresh it.");
    }
    if !status.is_success() {
        return acct.with("error", format!("OpenAI returned {status}."));
    }
    let Ok(body) = res.json::<Value>().await else {
        return acct.with("error", "Unexpected response from OpenAI.");
    };
    let (windows, plan) = parse_codex_usage(&body);
    ProviderLimits { windows, plan: plan.or(acct.plan.clone()), fetched_at: now_ms(), ..acct }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_claude_windows_and_extra_usage() {
        let v = json!({
            "five_hour": {"utilization": 42.0, "resets_at": "2026-09-29T15:00:00Z"},
            "seven_day": {"utilization": 61.5, "resets_at": "2026-10-02T09:00:00+00:00"},
            "seven_day_opus": {"utilization": 12.0, "resets_at": null},
            "seven_day_oauth_apps": null,
            "extra_usage": {"is_enabled": true, "monthly_limit": 5000, "used_credits": 1234, "utilization": 24.68}
        });
        let (w, extra) = parse_claude_usage(&v);
        assert_eq!(w.iter().map(|x| x.label.as_str()).collect::<Vec<_>>(), vec!["Session (5h)", "Weekly", "Weekly · Opus"]);
        assert_eq!(w[0].used_percent, 42.0);
        assert!(w[0].resets_at.is_some() && w[2].resets_at.is_none());
        let e = extra.unwrap();
        assert!(e.enabled && e.limit == Some(5000.0));
    }

    #[test]
    fn parses_codex_windows() {
        let v = json!({"plan_type": "plus", "rate_limit": {
            "primary_window": {"used_percent": 18, "limit_window_seconds": 18000, "reset_after_seconds": 3600},
            "secondary_window": {"used_percent": 55, "limit_window_seconds": 604800, "reset_at": 1790000000}
        }});
        let (w, plan) = parse_codex_usage(&v);
        assert_eq!(plan.as_deref(), Some("Plus"));
        assert_eq!(w[0].label, "Session (5h)");
        assert_eq!(w[1].label, "Weekly");
        assert_eq!(w[1].resets_at, Some(1_790_000_000_000));
    }
}
