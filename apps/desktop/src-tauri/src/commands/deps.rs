use std::path::Path;
use std::process::Command;
use std::collections::HashSet;
use serde::{Deserialize, Serialize};
use regex::Regex;

// ─── Shell helper ─────────────────────────────────────────────────────────────

fn run_shell_cmd(path: &str, cmd_base: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(cmd_base);
        for arg in args { cmd.arg(arg); }
        cmd.current_dir(path).output()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let full_cmd = format!("{} {}", cmd_base, args.join(" "));
        Command::new(&shell).arg("-l").arg("-c").arg(&full_cmd).current_dir(path).output()
    }
}

/// Run a command; return stdout string or error string.
fn try_cmd(path: &str, cmd: &str, args: &[&str]) -> Result<String, String> {
    match run_shell_cmd(path, cmd, args) {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            if out.status.success() || !stdout.trim().is_empty() {
                Ok(stdout)
            } else {
                Err(stderr)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

fn is_missing_tool(err: &str) -> bool {
    let e = err.to_lowercase();
    e.contains("command not found") || e.contains("not found") ||
    e.contains("no such file") || e.contains("is not recognized") ||
    e.contains("cannot find") || e.contains("not installed")
}

// ─── Core types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum UpdateType {
    #[serde(rename = "Patch")] Patch,
    #[serde(rename = "Minor")] Minor,
    #[serde(rename = "Major")] Major,
    #[serde(rename = "Unknown")] Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutdatedPackage {
    pub name: String,
    pub current: String,
    pub latest: String,
    pub ecosystem: String,
    pub update_type: UpdateType,
    pub changelog_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vulnerability {
    pub name: String,
    pub severity: String,
    pub title: String,
    pub advisory_url: String,
    pub via: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateResult {
    pub package: String,
    pub success: bool,
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnusedDependency {
    pub name: String,
    pub dep_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DepStatus {
    pub ecosystem: String,
    pub outdated: Vec<OutdatedPackage>,
    pub vulnerabilities: Vec<Vulnerability>,
    pub unused_dependencies: Vec<UnusedDependency>,
    pub error: Option<String>,
    pub tool_hints: Vec<String>,
}

// ─── Semver helpers ───────────────────────────────────────────────────────────

fn parse_semver(v: &str) -> Option<(u64, u64, u64)> {
    let v = v.trim_start_matches(|c: char| c == '^' || c == '~' || c == 'v' || c == '=');
    let v = v.split('-').next().unwrap_or(v);
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() < 3 { return None; }
    Some((parts[0].parse().ok()?, parts[1].parse().ok()?, parts[2].parse().ok()?))
}

fn classify_update(current: &str, latest: &str) -> UpdateType {
    let Some((cur_maj, cur_min, _)) = parse_semver(current) else { return UpdateType::Unknown };
    let Some((lat_maj, lat_min, _)) = parse_semver(latest)  else { return UpdateType::Unknown };
    if lat_maj > cur_maj      { UpdateType::Major }
    else if lat_min > cur_min { UpdateType::Minor }
    else                      { UpdateType::Patch }
}

fn sort_outdated(v: &mut Vec<OutdatedPackage>) {
    v.sort_by(|a, b| {
        let ord = |u: &UpdateType| match u { UpdateType::Patch => 0, UpdateType::Minor => 1, UpdateType::Major => 2, _ => 3 };
        ord(&a.update_type).cmp(&ord(&b.update_type)).then(a.name.cmp(&b.name))
    });
}

fn sort_vulns(v: &mut Vec<Vulnerability>) {
    v.sort_by(|a, b| {
        let ord = |s: &str| match s { "critical" => 0, "high" => 1, "moderate" => 2, _ => 3 };
        ord(&a.severity).cmp(&ord(&b.severity))
    });
}

fn changelog_url(name: &str, latest: &str, eco: &str) -> String {
    match eco {
        "node"     => format!("https://www.npmjs.com/package/{}?activeTab=versions", name),
        "python"   => format!("https://pypi.org/project/{}/{}/", name, latest),
        "rust"     => format!("https://crates.io/crates/{}/{}", name, latest),
        "go"       => format!("https://pkg.go.dev/{}@{}", name, latest),
        "ruby"     => format!("https://rubygems.org/gems/{}/versions/{}", name, latest),
        "php"      => format!("https://packagist.org/packages/{}", name),
        "maven"    => format!("https://mvnrepository.com/artifact/{}", name),
        _          => format!("https://www.google.com/search?q={}+{}+changelog", name, latest),
    }
}

// ─── Ecosystem detection ──────────────────────────────────────────────────────

fn detect_primary_ecosystem(path: &str) -> &'static str {
    let p = Path::new(path);
    if p.join("package.json").exists()       { return "node"; }
    if p.join("Cargo.toml").exists()         { return "rust"; }
    if p.join("go.mod").exists()             { return "go"; }
    if p.join("Gemfile").exists()            { return "ruby"; }
    if p.join("pom.xml").exists()            { return "maven"; }
    if p.join("build.gradle").exists() || p.join("build.gradle.kts").exists() { return "gradle"; }
    if p.join("composer.json").exists()      { return "php"; }
    // Python: several manifest formats
    if p.join("requirements.txt").exists() || p.join("pyproject.toml").exists() ||
       p.join("Pipfile").exists() || p.join("setup.py").exists() { return "python"; }
    "unknown"
}

fn is_poetry_project(path: &str) -> bool {
    let toml = Path::new(path).join("pyproject.toml");
    if let Ok(content) = std::fs::read_to_string(toml) {
        return content.contains("[tool.poetry]");
    }
    false
}

// ─── Node (npm / yarn / pnpm) ─────────────────────────────────────────────────

fn npm_outdated(path: &str) -> Vec<OutdatedPackage> {
    let raw = match try_cmd(path, "npm", &["outdated", "--json"]) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    if raw.trim().is_empty() { return vec![]; }
    let json: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
    let mut result = Vec::new();
    if let Some(map) = json.as_object() {
        for (name, info) in map {
            let current = info.get("current").and_then(|v| v.as_str()).unwrap_or("?").to_string();
            let latest  = info.get("latest").and_then(|v| v.as_str()).unwrap_or("?").to_string();
            if current != latest && current != "?" {
                result.push(OutdatedPackage {
                    name: name.clone(), current: current.clone(), latest: latest.clone(),
                    ecosystem: "node".to_string(),
                    update_type: classify_update(&current, &latest),
                    changelog_url: changelog_url(name, &latest, "node"),
                });
            }
        }
    }
    sort_outdated(&mut result);
    result
}

fn npm_audit(path: &str) -> Vec<Vulnerability> {
    let raw = match try_cmd(path, "npm", &["audit", "--json"]) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    if raw.trim().is_empty() { return vec![]; }
    let json: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
    let mut result = Vec::new();
    if let Some(vulns) = json.get("vulnerabilities").and_then(|v| v.as_object()) {
        for (name, info) in vulns {
            let severity = info.get("severity").and_then(|v| v.as_str()).unwrap_or("low").to_string();
            if severity == "low" { continue; }
            let via_arr = info.get("via").and_then(|v| v.as_array());
            let mut title = String::new();
            let mut via_names = vec![];
            if let Some(arr) = via_arr {
                for item in arr {
                    if let Some(t) = item.get("title").and_then(|v| v.as_str()) {
                        if title.is_empty() { title = t.to_string(); }
                    } else if let Some(s) = item.as_str() {
                        via_names.push(s.to_string());
                    }
                }
            }
            result.push(Vulnerability {
                name: name.clone(), severity, title,
                advisory_url: format!("https://www.npmjs.com/advisories/search?q={}", name),
                via: via_names,
            });
        }
    }
    sort_vulns(&mut result);
    result.dedup_by(|a, b| a.name == b.name);
    result
}

fn npm_unused_deps(path: &str) -> Vec<UnusedDependency> {
    let package_json_path = Path::new(path).join("package.json");
    let content = match std::fs::read_to_string(&package_json_path) { Ok(c) => c, Err(_) => return vec![] };
    let package_json: serde_json::Value = match serde_json::from_str(&content) { Ok(j) => j, Err(_) => return vec![] };
    let dependencies = package_json.get("dependencies").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    let dev_dependencies = package_json.get("devDependencies").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    let mut dep_names: HashSet<String> = dependencies.keys().cloned().collect();
    dep_names.extend(dev_dependencies.keys().cloned());
    if dep_names.is_empty() { return vec![]; }
    let mut used: HashSet<String> = HashSet::new();
    if let Some(scripts) = package_json.get("scripts").and_then(|v| v.as_object()) {
        for script in scripts.values().filter_map(|v| v.as_str()) {
            for dep in &dep_names { if script.contains(dep.as_str()) { used.insert(dep.clone()); } }
        }
    }
    let string_literal_re = Regex::new(r#"['"`]([^'"`\n]+)['"`]"#).unwrap();
    let walker = walkdir::WalkDir::new(path).max_depth(10).follow_links(false).into_iter();
    for entry in walker.filter_entry(|e| {
        let name = e.file_name().to_string_lossy();
        !(e.file_type().is_dir() && matches!(name.as_ref(), ".git" | "node_modules" | "dist" | "build" | ".next" | "coverage" | "target"))
    }) {
        let entry = match entry { Ok(e) => e, Err(_) => continue };
        if !entry.file_type().is_file() { continue; }
        let ext = entry.path().extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs" | "vue" | "svelte") { continue; }
        let file_content = match std::fs::read_to_string(entry.path()) { Ok(c) => c, Err(_) => continue };
        for cap in string_literal_re.captures_iter(&file_content) {
            let Some(raw) = cap.get(1).map(|m| m.as_str()) else { continue };
            if raw.is_empty() || raw.starts_with('.') || raw.starts_with('/') { continue; }
            let normalized = if raw.starts_with('@') {
                let mut parts = raw.split('/');
                match (parts.next(), parts.next()) {
                    (Some(scope), Some(name)) => format!("{}/{}", scope, name),
                    _ => continue,
                }
            } else {
                raw.split('/').next().unwrap_or(raw).to_string()
            };
            if dep_names.contains(&normalized) { used.insert(normalized); }
        }
    }
    let mut unused = Vec::new();
    for name in dependencies.keys() { if !used.contains(name) { unused.push(UnusedDependency { name: name.clone(), dep_type: "dependency".to_string() }); } }
    for name in dev_dependencies.keys() { if !used.contains(name) { unused.push(UnusedDependency { name: name.clone(), dep_type: "devDependency".to_string() }); } }
    unused.sort_by(|a, b| a.name.cmp(&b.name));
    unused
}

// ─── Python (pip / poetry) ────────────────────────────────────────────────────

fn pip_outdated(path: &str) -> Vec<OutdatedPackage> {
    // Try pip3 first, then pip
    let raw = try_cmd(path, "pip3", &["list", "--outdated", "--format=json"])
        .or_else(|_| try_cmd(path, "pip", &["list", "--outdated", "--format=json"]))
        .unwrap_or_default();
    if raw.trim().is_empty() { return vec![]; }
    let json: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap_or_default();
    let mut result: Vec<OutdatedPackage> = json.iter().filter_map(|pkg| {
        let name    = pkg.get("name").and_then(|v| v.as_str())?;
        let current = pkg.get("version").and_then(|v| v.as_str()).unwrap_or("?");
        let latest  = pkg.get("latest_version").and_then(|v| v.as_str()).unwrap_or("?");
        Some(OutdatedPackage {
            name: name.to_string(), current: current.to_string(), latest: latest.to_string(),
            ecosystem: "python".to_string(),
            update_type: classify_update(current, latest),
            changelog_url: changelog_url(name, latest, "python"),
        })
    }).collect();
    sort_outdated(&mut result);
    result
}

fn poetry_outdated(path: &str) -> Vec<OutdatedPackage> {
    let raw = match try_cmd(path, "poetry", &["show", "--outdated"]) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    // poetry show --outdated outputs: name  current  latest  description
    let mut result = Vec::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            let name = parts[0].to_string();
            let current = parts[1].to_string();
            let latest = parts[2].to_string();
            if current != latest {
                result.push(OutdatedPackage {
                    name: name.clone(), current: current.clone(), latest: latest.clone(),
                    ecosystem: "python".to_string(),
                    update_type: classify_update(&current, &latest),
                    changelog_url: changelog_url(&name, &latest, "python"),
                });
            }
        }
    }
    sort_outdated(&mut result);
    result
}

fn pip_audit(path: &str) -> (Vec<Vulnerability>, Option<String>) {
    let raw = match try_cmd(path, "pip-audit", &["--format", "json", "--skip-editable"]) {
        Ok(s) => s,
        Err(e) => {
            if is_missing_tool(&e) {
                return (vec![], Some("pip-audit not found. Install: pip install pip-audit".to_string()));
            }
            return (vec![], None);
        }
    };
    if raw.trim().is_empty() { return (vec![], None); }
    let json: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap_or_default();
    let mut result = Vec::new();
    for pkg in &json {
        let name = pkg.get("name").and_then(|v| v.as_str()).unwrap_or("?");
        if let Some(vulns) = pkg.get("vulns").and_then(|v| v.as_array()) {
            for v in vulns {
                let id = v.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let desc = v.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let fix = v.get("fix_versions").and_then(|v| v.as_array())
                    .and_then(|arr| arr.first()).and_then(|v| v.as_str()).unwrap_or("");
                result.push(Vulnerability {
                    name: name.to_string(),
                    severity: "high".to_string(),
                    title: if desc.is_empty() { id.clone() } else { desc.chars().take(120).collect() },
                    advisory_url: format!("https://osv.dev/vulnerability/{}", id),
                    via: if fix.is_empty() { vec![] } else { vec![format!("fix: {}", fix)] },
                });
            }
        }
    }
    sort_vulns(&mut result);
    (result, None)
}

// ─── Rust (cargo) ─────────────────────────────────────────────────────────────

fn cargo_outdated(path: &str) -> (Vec<OutdatedPackage>, Option<String>) {
    let raw = match try_cmd(path, "cargo", &["outdated", "--format", "json"]) {
        Ok(s) => s,
        Err(e) => {
            if is_missing_tool(&e) || e.contains("no such subcommand") {
                return (vec![], Some("cargo-outdated not installed. Run: cargo install cargo-outdated".to_string()));
            }
            return (vec![], None);
        }
    };
    if raw.trim().is_empty() { return (vec![], None); }
    let json: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
    let mut result = Vec::new();
    if let Some(deps) = json.get("dependencies").and_then(|v| v.as_array()) {
        for dep in deps {
            let name    = dep.get("name").and_then(|v| v.as_str()).unwrap_or("?");
            let current = dep.get("project").and_then(|v| v.as_str()).unwrap_or("?");
            let latest  = dep.get("latest").and_then(|v| v.as_str()).unwrap_or("?");
            if current == latest || latest == "---" || current == "?" { continue; }
            result.push(OutdatedPackage {
                name: name.to_string(), current: current.to_string(), latest: latest.to_string(),
                ecosystem: "rust".to_string(),
                update_type: classify_update(current, latest),
                changelog_url: changelog_url(name, latest, "rust"),
            });
        }
    }
    sort_outdated(&mut result);
    (result, None)
}

fn cargo_audit(path: &str) -> (Vec<Vulnerability>, Option<String>) {
    let raw = match try_cmd(path, "cargo", &["audit", "--json"]) {
        Ok(s) => s,
        Err(e) => {
            if is_missing_tool(&e) || e.contains("no such subcommand") {
                return (vec![], Some("cargo-audit not installed. Run: cargo install cargo-audit".to_string()));
            }
            return (vec![], None);
        }
    };
    if raw.trim().is_empty() { return (vec![], None); }
    let json: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
    let mut result = Vec::new();
    if let Some(list) = json.pointer("/vulnerabilities/list").and_then(|v| v.as_array()) {
        for entry in list {
            let name     = entry.pointer("/package/name").and_then(|v| v.as_str()).unwrap_or("?");
            let title    = entry.pointer("/advisory/title").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let url      = entry.pointer("/advisory/url").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let severity = entry.pointer("/advisory/cvss").and_then(|v| v.as_str())
                .map(|_| "high".to_string())
                .unwrap_or_else(|| "moderate".to_string());
            result.push(Vulnerability {
                name: name.to_string(), severity, title,
                advisory_url: url,
                via: vec![],
            });
        }
    }
    sort_vulns(&mut result);
    (result, None)
}

// ─── Go ───────────────────────────────────────────────────────────────────────

fn go_outdated(path: &str) -> Vec<OutdatedPackage> {
    // go list -m -u -json all emits newline-delimited JSON objects
    let raw = match try_cmd(path, "go", &["list", "-m", "-u", "-json", "all"]) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let mut result = Vec::new();
    // Split on }\n{ boundaries
    let chunks: Vec<&str> = raw.split("}\n{")
        .enumerate()
        .map(|(i, chunk)| {
            let _ = i; // suppress unused warning
            chunk
        })
        .collect();
    for (i, chunk) in chunks.iter().enumerate() {
        let mut s = chunk.to_string();
        if i > 0 { s = "{".to_string() + &s; }
        if i < chunks.len() - 1 { s.push('}'); }
        let json: serde_json::Value = match serde_json::from_str(&s) { Ok(v) => v, Err(_) => continue };
        let path_str = json.get("Path").and_then(|v| v.as_str()).unwrap_or("?");
        let current  = json.get("Version").and_then(|v| v.as_str()).unwrap_or("?");
        if let Some(update) = json.get("Update").and_then(|v| v.as_object()) {
            let latest = update.get("Version").and_then(|v| v.as_str()).unwrap_or("?");
            if current != latest {
                result.push(OutdatedPackage {
                    name: path_str.to_string(), current: current.to_string(), latest: latest.to_string(),
                    ecosystem: "go".to_string(),
                    update_type: classify_update(current, latest),
                    changelog_url: changelog_url(path_str, latest, "go"),
                });
            }
        }
    }
    sort_outdated(&mut result);
    result
}

fn govulncheck_scan(path: &str) -> (Vec<Vulnerability>, Option<String>) {
    let raw = match try_cmd(path, "govulncheck", &["-json", "./..."]) {
        Ok(s) => s,
        Err(e) => {
            if is_missing_tool(&e) {
                return (vec![], Some("govulncheck not installed. Run: go install golang.org/x/vuln/cmd/govulncheck@latest".to_string()));
            }
            return (vec![], None);
        }
    };
    let mut result = Vec::new();
    // govulncheck emits newline-delimited JSON messages
    let mut seen: HashSet<String> = HashSet::new();
    for line in raw.lines() {
        let json: serde_json::Value = match serde_json::from_str(line) { Ok(v) => v, Err(_) => continue };
        if let Some(finding) = json.get("message").and_then(|v| v.get("finding")) {
            let osv = finding.get("osv").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if osv.is_empty() || seen.contains(&osv) { continue; }
            seen.insert(osv.clone());
            // Extract the vulnerable module from the trace
            let module_name = finding.get("trace").and_then(|v| v.as_array())
                .and_then(|arr| arr.last())
                .and_then(|v| v.get("module")).and_then(|v| v.as_str())
                .unwrap_or("unknown").to_string();
            result.push(Vulnerability {
                name: module_name,
                severity: "high".to_string(),
                title: osv.clone(),
                advisory_url: format!("https://pkg.go.dev/vuln/{}", osv),
                via: vec![],
            });
        }
    }
    sort_vulns(&mut result);
    (result, None)
}

// ─── Ruby (Bundler) ───────────────────────────────────────────────────────────

fn bundler_outdated(path: &str) -> Vec<OutdatedPackage> {
    // bundle outdated --parseable outputs: "* gem_name (newest X.Y.Z, installed A.B.C)"
    let raw = match try_cmd(path, "bundle", &["outdated", "--parseable"]) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let re = Regex::new(r"\*\s+(\S+)\s+\(newest\s+([\d.]+),\s+installed\s+([\d.]+)").unwrap();
    let mut result = Vec::new();
    for line in raw.lines() {
        if let Some(caps) = re.captures(line) {
            let name    = caps.get(1).map(|m| m.as_str()).unwrap_or("?");
            let latest  = caps.get(2).map(|m| m.as_str()).unwrap_or("?");
            let current = caps.get(3).map(|m| m.as_str()).unwrap_or("?");
            result.push(OutdatedPackage {
                name: name.to_string(), current: current.to_string(), latest: latest.to_string(),
                ecosystem: "ruby".to_string(),
                update_type: classify_update(current, latest),
                changelog_url: changelog_url(name, latest, "ruby"),
            });
        }
    }
    sort_outdated(&mut result);
    result
}

fn bundle_audit(path: &str) -> (Vec<Vulnerability>, Option<String>) {
    // First update the advisory database, then audit
    let _ = try_cmd(path, "bundle-audit", &["update"]);
    let raw = match try_cmd(path, "bundle-audit", &["check"]) {
        Ok(s) => s,
        Err(e) => {
            if is_missing_tool(&e) {
                return (vec![], Some("bundler-audit not installed. Run: gem install bundler-audit".to_string()));
            }
            return (vec![], None);
        }
    };
    let mut result = Vec::new();
    // Parse text output: lines like "Name: gem_name\nVersion: X.Y.Z\nAdvisory: CVE-...\nTitle: ...\nSeverity: ..."
    let mut current_gem = String::new();
    let mut current_title = String::new();
    let mut current_severity = String::new();
    let mut current_advisory = String::new();
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("Name: ") { current_gem = rest.trim().to_string(); }
        else if let Some(rest) = line.strip_prefix("Advisory: ") { current_advisory = rest.trim().to_string(); }
        else if let Some(rest) = line.strip_prefix("Title: ") { current_title = rest.trim().to_string(); }
        else if let Some(rest) = line.strip_prefix("Criticality: ") {
            current_severity = match rest.trim().to_lowercase().as_str() {
                "critical" | "high" => "high".to_string(),
                "medium" => "moderate".to_string(),
                _ => "low".to_string(),
            };
        } else if line.is_empty() && !current_gem.is_empty() {
            result.push(Vulnerability {
                name: current_gem.clone(),
                severity: if current_severity.is_empty() { "moderate".to_string() } else { current_severity.clone() },
                title: current_title.clone(),
                advisory_url: format!("https://rubysec.com/advisories/{}", current_advisory),
                via: vec![],
            });
            current_gem.clear(); current_title.clear(); current_severity.clear(); current_advisory.clear();
        }
    }
    sort_vulns(&mut result);
    (result, None)
}

// ─── PHP (Composer) ───────────────────────────────────────────────────────────

fn composer_outdated(path: &str) -> Vec<OutdatedPackage> {
    let raw = match try_cmd(path, "composer", &["outdated", "--format=json", "--no-dev"]) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    if raw.trim().is_empty() { return vec![]; }
    let json: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
    let mut result = Vec::new();
    if let Some(installed) = json.get("installed").and_then(|v| v.as_array()) {
        for pkg in installed {
            let name    = pkg.get("name").and_then(|v| v.as_str()).unwrap_or("?");
            let current = pkg.get("version").and_then(|v| v.as_str()).unwrap_or("?");
            let latest  = pkg.get("latest").and_then(|v| v.as_str()).unwrap_or("?");
            let status  = pkg.get("latest-status").and_then(|v| v.as_str()).unwrap_or("");
            if status == "up-to-date" || current == latest { continue; }
            result.push(OutdatedPackage {
                name: name.to_string(), current: current.to_string(), latest: latest.to_string(),
                ecosystem: "php".to_string(),
                update_type: classify_update(current, latest),
                changelog_url: changelog_url(name, latest, "php"),
            });
        }
    }
    sort_outdated(&mut result);
    result
}

// ─── Maven ────────────────────────────────────────────────────────────────────

fn maven_outdated(path: &str) -> (Vec<OutdatedPackage>, Option<String>) {
    let raw = match try_cmd(path, "mvn", &["-q", "versions:display-dependency-updates", "-DprocessDependencies=true"]) {
        Ok(s) => s,
        Err(e) => {
            if is_missing_tool(&e) {
                return (vec![], Some("mvn not found. Install Apache Maven and ensure it is in PATH.".to_string()));
            }
            return (vec![], None);
        }
    };
    // Parse lines like: [INFO]   package:name ... X.Y.Z -> A.B.C
    let re = Regex::new(r"([\w.\-]+:[\w.\-]+)\s+[\w.]+ -> ([\d.]+)").unwrap();
    let mut result = Vec::new();
    for line in raw.lines() {
        if let Some(caps) = re.captures(line) {
            let name   = caps.get(1).map(|m| m.as_str()).unwrap_or("?");
            let latest = caps.get(2).map(|m| m.as_str()).unwrap_or("?");
            result.push(OutdatedPackage {
                name: name.to_string(), current: "?".to_string(), latest: latest.to_string(),
                ecosystem: "maven".to_string(), update_type: UpdateType::Unknown,
                changelog_url: changelog_url(name, latest, "maven"),
            });
        }
    }
    (result, None)
}

// ─── Main dispatch ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn check_dep_status(path: String) -> DepStatus {
    let ecosystem = detect_primary_ecosystem(&path);
    let mut hints: Vec<String> = vec![];

    match ecosystem {
        "node" => DepStatus {
            ecosystem: "node".to_string(),
            outdated: npm_outdated(&path),
            vulnerabilities: npm_audit(&path),
            unused_dependencies: npm_unused_deps(&path),
            error: None,
            tool_hints: hints,
        },

        "python" => {
            let outdated = if is_poetry_project(&path) { poetry_outdated(&path) } else { pip_outdated(&path) };
            let (vulns, hint) = pip_audit(&path);
            if let Some(h) = hint { hints.push(h); }
            DepStatus { ecosystem: "python".to_string(), outdated, vulnerabilities: vulns, unused_dependencies: vec![], error: None, tool_hints: hints }
        }

        "rust" => {
            let (outdated, o_hint) = cargo_outdated(&path);
            let (vulns, v_hint) = cargo_audit(&path);
            if let Some(h) = o_hint { hints.push(h); }
            if let Some(h) = v_hint { hints.push(h); }
            DepStatus { ecosystem: "rust".to_string(), outdated, vulnerabilities: vulns, unused_dependencies: vec![], error: None, tool_hints: hints }
        }

        "go" => {
            let outdated = go_outdated(&path);
            let (vulns, v_hint) = govulncheck_scan(&path);
            if let Some(h) = v_hint { hints.push(h); }
            DepStatus { ecosystem: "go".to_string(), outdated, vulnerabilities: vulns, unused_dependencies: vec![], error: None, tool_hints: hints }
        }

        "ruby" => {
            let outdated = bundler_outdated(&path);
            let (vulns, v_hint) = bundle_audit(&path);
            if let Some(h) = v_hint { hints.push(h); }
            DepStatus { ecosystem: "ruby".to_string(), outdated, vulnerabilities: vulns, unused_dependencies: vec![], error: None, tool_hints: hints }
        }

        "maven" => {
            let (outdated, hint) = maven_outdated(&path);
            if let Some(h) = hint { hints.push(h); }
            DepStatus { ecosystem: "maven".to_string(), outdated, vulnerabilities: vec![], unused_dependencies: vec![], error: None, tool_hints: hints }
        }

        "gradle" => DepStatus {
            ecosystem: "gradle".to_string(), outdated: vec![], vulnerabilities: vec![],
            unused_dependencies: vec![], error: None,
            tool_hints: vec!["Gradle dependency updates require the 'com.github.ben-manes.versions' plugin in your build file.".to_string()],
        },

        "php" => DepStatus {
            ecosystem: "php".to_string(),
            outdated: composer_outdated(&path),
            vulnerabilities: vec![], unused_dependencies: vec![], error: None, tool_hints: hints,
        },

        _ => DepStatus {
            ecosystem: "unknown".to_string(), outdated: vec![], vulnerabilities: vec![],
            unused_dependencies: vec![], error: Some("No supported manifest file found.".to_string()),
            tool_hints: vec![],
        },
    }
}

// ─── Update commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn update_npm_package(path: String, package_name: String, version: String) -> UpdateResult {
    let install_spec = format!("{}@{}", package_name, version);
    match run_shell_cmd(&path, "npm", &["install", &install_spec]) {
        Ok(out) => {
            let success = out.status.success();
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            UpdateResult { package: package_name, success, output: if success { stdout } else { format!("{}\n{}", stdout, stderr) }.trim().to_string() }
        }
        Err(e) => UpdateResult { package: package_name, success: false, output: e.to_string() }
    }
}

/// Ecosystem-aware package fix (for vulnerability patching)
#[tauri::command]
pub async fn update_package_to_latest(path: String, package_name: String, ecosystem: String) -> UpdateResult {
    let (cmd, args) = match ecosystem.as_str() {
        "node"   => ("npm".to_string(),    vec!["install".to_string(), format!("{}@latest", package_name)]),
        "python" => ("pip".to_string(),    vec!["install".to_string(), "--upgrade".to_string(), package_name.clone()]),
        "rust"   => ("cargo".to_string(),  vec!["update".to_string(), "--precise".to_string(), "latest".to_string()]),
        "ruby"   => ("bundle".to_string(), vec!["update".to_string(), package_name.clone()]),
        "php"    => ("composer".to_string(), vec!["require".to_string(), format!("{}:@latest", package_name)]),
        _        => return UpdateResult { package: package_name, success: false, output: "Auto-fix not supported for this ecosystem.".to_string() },
    };
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    match run_shell_cmd(&path, &cmd, &args_refs) {
        Ok(out) => {
            let success = out.status.success();
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            UpdateResult { package: package_name, success, output: stdout.trim().to_string() }
        }
        Err(e) => UpdateResult { package: package_name, success: false, output: e.to_string() }
    }
}

#[tauri::command]
pub async fn update_all_patch_packages(path: String) -> Vec<UpdateResult> {
    let status = check_dep_status(path.clone()).await;
    let eco = status.ecosystem.as_str();

    // For ecosystems with a native "update patch" command, run it directly
    let (cmd, args): (&str, Vec<&str>) = match eco {
        "node"   => ("npm",    vec!["update"]),
        "rust"   => ("cargo",  vec!["update"]),
        "go"     => ("go",     vec!["get", "-u=patch", "./..."]),
        "ruby"   => ("bundle", vec!["update", "--patch"]),
        "python" => {
            // pip has no native patch-only update; upgrade only patch-classified packages
            let patches: Vec<String> = status.outdated.iter()
                .filter(|p| p.update_type == UpdateType::Patch)
                .map(|p| p.name.clone())
                .collect();
            if patches.is_empty() {
                return vec![UpdateResult { package: "all".to_string(), success: true, output: "No patch updates available.".to_string() }];
            }
            let mut pip_args = vec!["install".to_string(), "--upgrade".to_string()];
            pip_args.extend(patches.iter().cloned());
            let args_refs: Vec<&str> = pip_args.iter().map(|s| s.as_str()).collect();
            return match run_shell_cmd(&path, "pip3", &args_refs).or_else(|_| run_shell_cmd(&path, "pip", &args_refs)) {
                Ok(out) => vec![UpdateResult {
                    package: "python-patches".to_string(),
                    success: out.status.success(),
                    output: String::from_utf8_lossy(&out.stdout).trim().to_string(),
                }],
                Err(e) => vec![UpdateResult { package: "python-patches".to_string(), success: false, output: e.to_string() }],
            };
        }
        "php"    => ("composer", vec!["update", "--no-dev"]),
        _ => return vec![UpdateResult { package: "all".to_string(), success: false, output: format!("Auto-update not supported for {} ecosystem.", eco) }],
    };

    match run_shell_cmd(&path, cmd, &args) {
        Ok(out) => vec![UpdateResult {
            package: "all".to_string(),
            success: out.status.success(),
            output: String::from_utf8_lossy(&out.stdout).trim().to_string(),
        }],
        Err(e) => vec![UpdateResult { package: "all".to_string(), success: false, output: e.to_string() }],
    }
}

#[tauri::command]
pub async fn remove_unused_npm_packages(path: String, package_names: Vec<String>) -> Vec<UpdateResult> {
    if package_names.is_empty() { return vec![]; }
    let mut args: Vec<String> = vec!["uninstall".to_string()];
    args.extend(package_names.iter().cloned());
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    match run_shell_cmd(&path, "npm", &args_refs) {
        Ok(out) => {
            let success = out.status.success();
            let combined = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
            package_names.into_iter().map(|p| UpdateResult { package: p, success, output: combined.trim().to_string() }).collect()
        }
        Err(e) => package_names.into_iter().map(|p| UpdateResult { package: p, success: false, output: e.to_string() }).collect(),
    }
}
