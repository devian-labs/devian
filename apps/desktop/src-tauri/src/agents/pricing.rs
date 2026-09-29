//! API-equivalent prices, used to put a dollar figure on token usage.
//!
//! Claude rates are Anthropic's first-party list prices per million tokens
//! (platform.claude.com/docs/en/about-claude/pricing, checked 2026-09-29).
//! Subscription plans don't bill per token, so for them this is "what the
//! same usage would cost on the API", and Bedrock / Vertex bill separately.

use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Price {
    pub input: f64,
    pub cache_write_5m: f64,
    pub cache_write_1h: f64,
    pub cache_read: f64,
    pub output: f64,
}

const fn p(input: f64, w5: f64, w1: f64, read: f64, output: f64) -> Price {
    Price { input, cache_write_5m: w5, cache_write_1h: w1, cache_read: read, output }
}

/// Most specific names first: "opus-5-5" must match before "opus-5".
const CLAUDE: &[(&str, Price)] = &[
    ("fable-5-1", p(10.0, 12.5, 20.0, 0.25, 50.0)),
    ("mythos-5-1", p(10.0, 12.5, 20.0, 0.25, 50.0)),
    ("fable-5", p(10.0, 12.5, 20.0, 1.0, 50.0)),
    ("mythos-5", p(10.0, 12.5, 20.0, 1.0, 50.0)),
    ("opus-5-5", p(4.0, 5.0, 8.0, 0.20, 20.0)),
    ("opus-5", p(5.0, 6.25, 10.0, 0.50, 25.0)),
    ("opus-4-8", p(5.0, 6.25, 10.0, 0.50, 25.0)),
    ("opus-4-7", p(5.0, 6.25, 10.0, 0.50, 25.0)),
    ("opus-4-6", p(5.0, 6.25, 10.0, 0.50, 25.0)),
    ("opus-4-5", p(5.0, 6.25, 10.0, 0.50, 25.0)),
    ("opus-4-1", p(15.0, 18.75, 30.0, 1.50, 75.0)),
    ("opus-4", p(15.0, 18.75, 30.0, 1.50, 75.0)),
    ("sonnet-5-5", p(2.0, 2.5, 4.0, 0.20, 10.0)),
    ("sonnet-5", p(2.0, 2.5, 4.0, 0.20, 10.0)),
    ("sonnet-4-6", p(3.0, 3.75, 6.0, 0.30, 15.0)),
    ("sonnet-4-5", p(3.0, 3.75, 6.0, 0.30, 15.0)),
    ("sonnet-4", p(3.0, 3.75, 6.0, 0.30, 15.0)),
    ("haiku-4-5", p(1.0, 1.25, 2.0, 0.10, 5.0)),
    ("haiku-3-5", p(0.80, 1.0, 1.60, 0.08, 4.0)),
];

/// Fast mode doubles every rate on the models that offer it.
const FAST_MODELS: &[&str] = &["opus-5-5", "opus-5", "opus-4-8"];

/// Price for a Claude model id, including Bedrock/Vertex spellings like
/// `us.anthropic.claude-opus-4-8-v1:0` or `claude-opus-4-5@20251101`.
pub fn claude_price(model: &str, fast: bool) -> Option<Price> {
    let m = model.to_lowercase();
    let (key, price) = CLAUDE.iter().find(|(k, _)| version_match(&m, k))?;
    let mut price = *price;
    if fast && FAST_MODELS.contains(key) {
        price = Price {
            input: price.input * 2.0,
            cache_write_5m: price.cache_write_5m * 2.0,
            cache_write_1h: price.cache_write_1h * 2.0,
            cache_read: price.cache_read * 2.0,
            output: price.output * 2.0,
        };
    }
    Some(price)
}

/// True when `key` appears in `model` as a complete version: what follows is
/// the end, a date, or a suffix like `-v1:0` / `@2025…`, but not another
/// short version number ("opus-5" must not match "opus-5-5").
fn version_match(model: &str, key: &str) -> bool {
    model.match_indices(key).any(|(i, _)| {
        let rest = &model[i + key.len()..];
        let Some(tail) = rest.strip_prefix('-') else { return true };
        let seg = tail.split(['-', '@', ':', '.']).next().unwrap_or("");
        !(seg.len() <= 2 && !seg.is_empty() && seg.chars().all(|c| c.is_ascii_digit()))
    })
}

/// Dollar cost of one Claude API response, from its `usage` object.
pub fn claude_message_cost(model: &str, usage: &Value) -> Option<f64> {
    let n = |v: &Value| v.as_u64().unwrap_or(0) as f64;
    let fast = usage["speed"].as_str() == Some("fast");
    let price = claude_price(model, fast)?;
    let created = n(&usage["cache_creation_input_tokens"]);
    let split = &usage["cache_creation"];
    let (w5, w1) = if split.is_object() {
        (n(&split["ephemeral_5m_input_tokens"]), n(&split["ephemeral_1h_input_tokens"]))
    } else {
        (created, 0.0)
    };
    Some(
        (n(&usage["input_tokens"]) * price.input
            + n(&usage["output_tokens"]) * price.output
            + n(&usage["cache_read_input_tokens"]) * price.cache_read
            + w5 * price.cache_write_5m
            + w1 * price.cache_write_1h)
            / 1_000_000.0,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn picks_the_most_specific_model() {
        assert_eq!(claude_price("claude-opus-5-5", false).unwrap().input, 4.0);
        assert_eq!(claude_price("claude-opus-5", false).unwrap().input, 5.0);
        assert_eq!(claude_price("claude-sonnet-5-5", false).unwrap().output, 10.0);
        assert_eq!(claude_price("claude-sonnet-4-6", false).unwrap().input, 3.0);
        assert_eq!(claude_price("us.anthropic.claude-opus-4-8-v1:0", false).unwrap().input, 5.0);
        assert_eq!(claude_price("claude-opus-4-5@20251101", false).unwrap().input, 5.0);
        assert_eq!(claude_price("claude-opus-4-20250514", false).unwrap().input, 15.0);
        assert!(claude_price("gpt-5.6", false).is_none());
    }

    #[test]
    fn costs_a_message_with_split_cache_writes() {
        // 1M of each kind on Opus 5.5: 4 + 20 + 0.20 + 5 (5m) + 8 (1h)
        let u = json!({"input_tokens": 1_000_000, "output_tokens": 1_000_000, "cache_read_input_tokens": 1_000_000,
            "cache_creation_input_tokens": 2_000_000, "cache_creation": {"ephemeral_5m_input_tokens": 1_000_000, "ephemeral_1h_input_tokens": 1_000_000}});
        assert!((claude_message_cost("claude-opus-5-5", &u).unwrap() - 37.2).abs() < 1e-9);
        let fast = json!({"input_tokens": 1_000_000, "speed": "fast"});
        assert!((claude_message_cost("claude-opus-5-5", &fast).unwrap() - 8.0).abs() < 1e-9);
    }
}
