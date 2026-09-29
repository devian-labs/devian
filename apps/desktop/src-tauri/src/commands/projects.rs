use std::fs;
use std::path::{Component, Path};
use std::process::Command;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct RepoInsightFile {
    pub path: String,
    pub size_bytes: u64,
    pub line_count: u64,
    pub change_count: u64,
    pub hotspot_score: f64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct RepoInsights {
    pub total_lines_of_code: u64,
    pub largest_files: Vec<RepoInsightFile>,
    pub most_modified_files: Vec<RepoInsightFile>,
    pub hotspots: Vec<RepoInsightFile>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct GitBranchInfo {
    pub name: String,
    pub is_current: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct CommitTimelinePoint {
    pub month: String,
    pub count: u32,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct RepositorySearchMatch {
    pub project_name: String,
    pub project_path: String,
    pub file_path: String,
    pub line_number: u32,
    pub snippet: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct RepositoryChatIndex {
    pub project_name: String,
    pub project_path: String,
    pub tracked_file_count: usize,
    pub context: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct RepositoryIndexStatus {
    pub project_name: String,
    pub project_path: String,
    pub indexed_file_count: usize,
    pub chunk_count: usize,
    pub last_indexed_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct RepositoryIndexChunk {
    pub project_name: String,
    pub project_path: String,
    pub rel_path: String,
    pub title: String,
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub score: f64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ProjectMeta {
    pub tags: Vec<String>,
    pub is_favorite: bool,
}

fn devian_home() -> std::path::PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
}

fn get_project_meta_path() -> String {
    devian_home()
        .join(".devian_project_meta.json")
        .to_string_lossy()
        .to_string()
}

fn fetch_project_meta() -> HashMap<String, ProjectMeta> {
    let path = get_project_meta_path();
    if Path::new(&path).exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(meta) = serde_json::from_str::<HashMap<String, ProjectMeta>>(&content) {
                return meta;
            }
        }
    }
    HashMap::new()
}

#[tauri::command]
pub async fn update_project_metadata(path: String, tags: Vec<String>, is_favorite: bool) -> Result<(), String> {
    let mut meta = fetch_project_meta();
    meta.insert(path, ProjectMeta { tags, is_favorite });
    
    let json_str = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("Serialization error: {}", e))?;
    
    fs::write(get_project_meta_path(), json_str)
        .map_err(|e| format!("Failed to save project metadata: {}", e))
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CleanupEntry {
    pub timestamp: u64,
    pub resource: String,
    pub size_bytes: f64,
}

fn get_history_path() -> String {
    devian_home()
        .join(".devian_cleanup_history.json")
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
pub async fn fetch_cleanup_history() -> Result<Vec<CleanupEntry>, String> {
    let path = get_history_path();
    if Path::new(&path).exists() {
        match fs::read_to_string(&path) {
            Ok(content) => {
                match serde_json::from_str(&content) {
                    Ok(val) => Ok(val),
                    Err(_) => Ok(Vec::new())
                }
            },
            Err(_) => Ok(Vec::new())
        }
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn add_cleanup_entry(resource: String, size_bytes: f64) -> Result<(), String> {
    let mut history = fetch_cleanup_history().await.unwrap_or_default();
    
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
        
    history.push(CleanupEntry {
        timestamp: now,
        resource,
        size_bytes,
    });
    
    // Keep last 50 entries
    if history.len() > 50 {
        history.drain(0..(history.len() - 50));
    }
    
    let json_str = serde_json::to_string_pretty(&history)
        .map_err(|e| format!("Serialization error: {}", e))?;
    
    fs::write(get_history_path(), json_str)
        .map_err(|e| format!("Failed to save history: {}", e))
}

// Helper to calculate folder size recursively
fn get_dir_size(path: &Path) -> u64 {
    let mut size = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_dir() {
                    size += get_dir_size(&entry.path());
                } else {
                    size += metadata.len();
                }
            }
        }
    }
    size
}

#[derive(Default)]
struct GitignoreCleanupRules {
    exact_dirs: HashSet<String>,
    dir_names: HashSet<String>,
}

fn normalize_relative_path(path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            Component::CurDir => {}
            _ => return None,
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

fn detect_docker_assets(path: &Path) -> (bool, Vec<String>) {
    let has_dockerfile = path.join("Dockerfile").exists();
    let compose_files = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]
        .iter()
        .map(|name| path.join(name))
        .filter(|candidate| candidate.exists())
        .filter_map(|candidate| candidate.to_str().map(|value| value.to_string()))
        .collect::<Vec<_>>();
    (has_dockerfile, compose_files)
}

fn slugify_project_name(name: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}

fn collect_project_labeled_container_ids(project_path: &str) -> Result<Vec<String>, String> {
    let output = Command::new("docker")
        .args(["ps", "-a", "--filter", &format!("label=devian.project_path={}", project_path), "--format", "{{.ID}}"])
        .output()
        .map_err(|e| format!("Failed to query project containers: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect())
}

fn load_gitignore_cleanup_rules(repo_path: &Path) -> GitignoreCleanupRules {
    let mut rules = GitignoreCleanupRules::default();

    if let Ok(gitignore_content) = fs::read_to_string(repo_path.join(".gitignore")) {
        for raw_line in gitignore_content.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') || line.starts_with('!') {
                continue;
            }

            let is_directory_rule = line.ends_with('/');
            let cleaned = line
                .trim_start_matches('/')
                .trim_end_matches('/')
                .trim();

            if cleaned.is_empty() || cleaned.contains('*') || cleaned.contains('?') || cleaned.contains('[') {
                continue;
            }

            if cleaned == "." || cleaned == ".." || cleaned == ".git" {
                continue;
            }

            if cleaned.contains('/') {
                if let Some(normalized) = normalize_relative_path(Path::new(cleaned)) {
                    rules.exact_dirs.insert(normalized);
                }
            } else if is_directory_rule || cleaned.starts_with('.') || cleaned.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')) {
                rules.dir_names.insert(cleaned.to_string());
            }
        }
    }

    rules
}

fn collect_cleanable_directories(repo_path: &Path) -> Vec<serde_json::Value> {
    let known_safe_names: HashSet<&str> = [
        "node_modules", ".next", "dist", "build", ".cache", "coverage",
        "venv", ".venv", "__pycache__", "target", ".gradle",
    ].iter().cloned().collect();

    let gitignore_rules = load_gitignore_cleanup_rules(repo_path);
    let mut dep_folders: Vec<serde_json::Value> = Vec::new();
    let mut seen_paths: HashSet<String> = HashSet::new();

    let mut walker = walkdir::WalkDir::new(repo_path)
        .max_depth(12)
        .follow_links(false)
        .into_iter();

    while let Some(entry) = walker.next() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        if entry.depth() == 0 || !entry.file_type().is_dir() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name == ".git" {
            walker.skip_current_dir();
            continue;
        }

        let relative_path = match entry.path().strip_prefix(repo_path).ok().and_then(normalize_relative_path) {
            Some(path) => path,
            None => continue,
        };

        let is_known_safe = known_safe_names.contains(file_name.as_str());
        let is_gitignored_name = gitignore_rules.dir_names.contains(&file_name);
        let is_gitignored_path = gitignore_rules.exact_dirs.contains(&relative_path);

        if !(is_known_safe || is_gitignored_name || is_gitignored_path) {
            continue;
        }

        if !seen_paths.insert(relative_path.clone()) {
            walker.skip_current_dir();
            continue;
        }

        let size = get_dir_size(entry.path());
        if size == 0 {
            walker.skip_current_dir();
            continue;
        }

        let last_accessed: i64 = fs::metadata(entry.path())
            .ok()
            .and_then(|m| m.accessed().or_else(|_| m.modified()).ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        dep_folders.push(serde_json::json!({
            "name": file_name,
            "relative_path": relative_path,
            "size_bytes": size,
            "last_accessed": last_accessed
        }));

        walker.skip_current_dir();
    }

    dep_folders
}

// ─── Runtime + Framework detection ───────────────────────────────────────────

fn read_file_first_line(p: &Path) -> String {
    fs::read_to_string(p).unwrap_or_default().lines().next().unwrap_or("").trim().to_string()
}

/// Returns (runtime_name, version, source_file)
fn detect_runtime(path: &Path) -> (String, String, String) {
    // Node.js
    let nvmrc = read_file_first_line(&path.join(".nvmrc"));
    if !nvmrc.is_empty() { return ("Node.js".into(), nvmrc, ".nvmrc".into()); }
    let nv = read_file_first_line(&path.join(".node-version"));
    if !nv.is_empty() { return ("Node.js".into(), nv, ".node-version".into()); }
    if let Ok(pkg) = fs::read_to_string(path.join("package.json")) {
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&pkg) {
            if let Some(v) = j.pointer("/engines/node").and_then(|v| v.as_str()) {
                return ("Node.js".into(), v.to_string(), "package.json engines".into());
            }
        }
    }

    // Ruby
    let rv = read_file_first_line(&path.join(".ruby-version"));
    if !rv.is_empty() { return ("Ruby".into(), rv, ".ruby-version".into()); }
    if let Ok(gemfile) = fs::read_to_string(path.join("Gemfile")) {
        for line in gemfile.lines() {
            let t = line.trim();
            if t.starts_with("ruby ") || t.starts_with("ruby(") {
                let ver = t.trim_start_matches("ruby").trim()
                    .trim_matches(|c: char| c == '\'' || c == '"' || c == '(' || c == ')')
                    .to_string();
                if !ver.is_empty() { return ("Ruby".into(), ver, "Gemfile".into()); }
            }
        }
    }

    // Python
    let pyv = read_file_first_line(&path.join(".python-version"));
    if !pyv.is_empty() { return ("Python".into(), pyv, ".python-version".into()); }
    if let Ok(pipfile) = fs::read_to_string(path.join("Pipfile")) {
        for line in pipfile.lines() {
            let t = line.trim();
            if t.starts_with("python_version") {
                let v = t.splitn(2, '=').nth(1).unwrap_or("")
                    .trim().trim_matches(|c: char| c == '"' || c == '\'').to_string();
                if !v.is_empty() { return ("Python".into(), v, "Pipfile".into()); }
            }
        }
    }
    if let Ok(pyp) = fs::read_to_string(path.join("pyproject.toml")) {
        for line in pyp.lines() {
            let t = line.trim();
            if t.starts_with("requires-python") || t.starts_with("python_requires") {
                let v = t.splitn(2, '=').nth(1).unwrap_or("")
                    .trim().trim_matches(|c: char| c == '"' || c == '\'').to_string();
                if !v.is_empty() { return ("Python".into(), v, "pyproject.toml".into()); }
            }
        }
    }

    // Go
    if let Ok(gomod) = fs::read_to_string(path.join("go.mod")) {
        for line in gomod.lines() {
            let t = line.trim();
            if t.starts_with("go ") {
                let v = t.trim_start_matches("go ").trim().to_string();
                if !v.is_empty() { return ("Go".into(), v, "go.mod".into()); }
            }
        }
    }

    // Rust
    if let Ok(tc) = fs::read_to_string(path.join("rust-toolchain.toml")) {
        for line in tc.lines() {
            let t = line.trim();
            if t.starts_with("channel") {
                let v = t.splitn(2, '=').nth(1).unwrap_or("")
                    .trim().trim_matches(|c: char| c == '"' || c == '\'').to_string();
                if !v.is_empty() { return ("Rust".into(), v, "rust-toolchain.toml".into()); }
            }
        }
    }
    let rt = read_file_first_line(&path.join("rust-toolchain"));
    if !rt.is_empty() && !rt.starts_with('[') {
        return ("Rust".into(), rt, "rust-toolchain".into());
    }

    // Java
    let jv = read_file_first_line(&path.join(".java-version"));
    if !jv.is_empty() { return ("Java".into(), jv, ".java-version".into()); }
    if let Ok(pom) = fs::read_to_string(path.join("pom.xml")) {
        for line in pom.lines() {
            if line.contains("<java.version>") {
                if let (Some(s), Some(e)) = (line.find('>'), line.rfind('<')) {
                    if s < e { return ("Java".into(), line[s+1..e].trim().to_string(), "pom.xml".into()); }
                }
            }
        }
    }

    // PHP
    if let Ok(comp) = fs::read_to_string(path.join("composer.json")) {
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&comp) {
            if let Some(v) = j.pointer("/require/php").and_then(|v| v.as_str()) {
                return ("PHP".into(), v.to_string(), "composer.json".into());
            }
        }
    }

    (String::new(), String::new(), String::new())
}

/// Parse Gemfile.lock specs section → HashMap<gem_name_lowercase, version>
fn parse_gemfile_lock(path: &Path) -> HashMap<String, String> {
    let mut gems = HashMap::new();
    let Ok(content) = fs::read_to_string(path.join("Gemfile.lock")) else { return gems; };
    let mut in_specs = false;
    for line in content.lines() {
        let raw = line;
        let trimmed = raw.trim();
        if trimmed == "specs:" { in_specs = true; continue; }
        if !in_specs { continue; }
        if trimmed.is_empty() || (!raw.starts_with("    ") && !raw.starts_with('\t')) {
            // End of specs section (new top-level group or blank line)
            if !trimmed.is_empty() { in_specs = false; }
            continue;
        }
        // 4-space indent = top-level gem entry:  "    gemname (1.2.3)"
        // 6-space indent = sub-dependency — skip
        let indent = raw.len() - raw.trim_start().len();
        if indent != 4 { continue; }
        if let Some(paren) = trimmed.find(" (") {
            let name = trimmed[..paren].trim().to_lowercase();
            let version = trimmed[paren+2..].trim_end_matches(')').to_string();
            gems.insert(name, version);
        }
    }
    gems
}

const KEY_RUBY_GEMS: &[(&str, &str)] = &[
    ("rails", "Rails"),
    ("sinatra", "Sinatra"), ("hanami", "Hanami"),
    ("devise", "Devise"), ("pundit", "Pundit"), ("cancancan", "CanCan"),
    ("sidekiq", "Sidekiq"), ("delayed_job", "DelayedJob"), ("resque", "Resque"),
    ("pg", "PostgreSQL"), ("mysql2", "MySQL"), ("sqlite3", "SQLite"), ("redis", "Redis"),
    ("elasticsearch", "Elasticsearch"), ("mongoid", "MongoDB"),
    ("carrierwave", "CarrierWave"), ("shrine", "Shrine"), ("paperclip", "Paperclip"),
    ("stripe", "Stripe"), ("aws-sdk-s3", "AWS S3"),
    ("graphql", "GraphQL"), ("grape", "Grape"), ("jwt", "JWT"),
    ("httparty", "HTTParty"), ("faraday", "Faraday"),
    ("turbo-rails", "Turbo"), ("stimulus-rails", "Stimulus"), ("hotwire", "Hotwire"),
    ("rspec-rails", "RSpec"), ("factory_bot_rails", "FactoryBot"),
    ("rubocop", "RuboCop"), ("brakeman", "Brakeman"),
    ("puma", "Puma"), ("unicorn", "Unicorn"), ("passenger", "Passenger"),
    ("capistrano", "Capistrano"),
];

/// Detect framework/library versions from package manifests
fn detect_frameworks(path: &Path) -> Vec<serde_json::Value> {
    let mut result = Vec::new();

    // ── Node.js frameworks from package.json ─────────────────────────────────
    if let Ok(pkg) = fs::read_to_string(path.join("package.json")) {
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&pkg) {
            let mut all_deps: HashMap<String, String> = HashMap::new();
            for section in &["dependencies", "devDependencies", "peerDependencies"] {
                if let Some(obj) = j.get(section).and_then(|v| v.as_object()) {
                    for (k, v) in obj {
                        all_deps.insert(k.clone(), v.as_str().unwrap_or("").to_string());
                    }
                }
            }
            let node_frameworks: &[(&str, &str)] = &[
                ("react", "React"), ("next", "Next.js"), ("vue", "Vue"),
                ("nuxt", "Nuxt"), ("@angular/core", "Angular"),
                ("svelte", "Svelte"), ("@sveltejs/kit", "SvelteKit"),
                ("gatsby", "Gatsby"), ("remix", "@remix-run/react"),
                ("astro", "Astro"), ("solid-js", "SolidJS"),
                ("express", "Express"), ("fastify", "Fastify"),
                ("@nestjs/core", "NestJS"), ("koa", "Koa"),
                ("hapi", "Hapi"), ("elysia", "Elysia"),
                ("prisma", "Prisma"), ("drizzle-orm", "Drizzle"),
                ("typeorm", "TypeORM"), ("sequelize", "Sequelize"),
                ("graphql", "GraphQL"), ("apollo-server", "Apollo"),
                ("socket.io", "Socket.IO"), ("trpc", "@trpc/server"),
                ("tailwindcss", "Tailwind CSS"), ("vite", "Vite"),
            ];
            for (pkg_name, display) in node_frameworks {
                if let Some(ver) = all_deps.get(*pkg_name) {
                    result.push(serde_json::json!({"name": display, "version": ver}));
                }
            }
        }
    }

    // ── Ruby gems (Rails + key libs) ─────────────────────────────────────────
    if path.join("Gemfile").exists() {
        let gems = parse_gemfile_lock(path);
        for (gem_key, display) in KEY_RUBY_GEMS {
            if let Some(ver) = gems.get(*gem_key) {
                result.push(serde_json::json!({"name": display, "version": ver}));
            }
        }
    }

    // ── Python frameworks from requirements.txt / pyproject.toml ─────────────
    let py_frameworks: &[(&str, &str)] = &[
        ("django", "Django"), ("flask", "Flask"), ("fastapi", "FastAPI"),
        ("tornado", "Tornado"), ("sanic", "Sanic"), ("starlette", "Starlette"),
        ("aiohttp", "aiohttp"), ("sqlalchemy", "SQLAlchemy"),
        ("celery", "Celery"), ("pydantic", "Pydantic"),
    ];
    let mut py_added: HashSet<String> = HashSet::new();
    for req_file in &["requirements.txt", "requirements/base.txt", "requirements/common.txt"] {
        if let Ok(content) = fs::read_to_string(path.join(req_file)) {
            for line in content.lines() {
                let lower = line.trim().to_lowercase();
                if lower.is_empty() || lower.starts_with('#') { continue; }
                for (pkg, display) in py_frameworks {
                    if lower.starts_with(pkg) && !py_added.contains(*pkg) {
                        let version = line.split(['=', '>', '<', '~', '^', '!', '['])
                            .filter(|s| s.chars().next().map_or(false, |c| c.is_ascii_digit()))
                            .next().unwrap_or("").trim().to_string();
                        result.push(serde_json::json!({"name": display, "version": version}));
                        py_added.insert(pkg.to_string());
                    }
                }
            }
        }
    }

    // ── PHP / Laravel ─────────────────────────────────────────────────────────
    if let Ok(comp) = fs::read_to_string(path.join("composer.json")) {
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&comp) {
            let php_frameworks: &[(&str, &str)] = &[
                ("laravel/framework", "Laravel"), ("symfony/framework-bundle", "Symfony"),
                ("slim/slim", "Slim"), ("cakephp/cakephp", "CakePHP"),
            ];
            for (pkg, display) in php_frameworks {
                if let Some(ver) = j.pointer(&format!("/require/{}", pkg.replace('/', "~1")))
                    .or_else(|| j.pointer(&format!("/require-dev/{}", pkg.replace('/', "~1"))))
                    .and_then(|v| v.as_str()) {
                    result.push(serde_json::json!({"name": display, "version": ver}));
                }
            }
        }
    }

    result
}

/// Count all gems in Gemfile.lock
fn gem_count_from_lock(path: &Path) -> usize {
    parse_gemfile_lock(path).len()
}

fn process_single_repo(path: &Path, meta_map: &HashMap<String, ProjectMeta>) -> Option<serde_json::Value> {
    if !path.is_dir() {
        return None;
    }
    
    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let path_str = path.to_string_lossy().to_string();
    
    // Determine Tech Stack and Dependency Folder
    let mut stack = Vec::new();
    let mut missing_deps = false;
    let mut packages = Vec::new();
    let mut keywords = Vec::new();
    let mut top_level_files = Vec::new();
    let mut scripts_list: Vec<String> = Vec::new();
    let mut has_env = false;

    // List top-level files for searching
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if !file_name.starts_with('.') && file_name != "node_modules" && file_name != "target" {
                top_level_files.push(file_name);
            }
        }
    }
    
    // .env variants
    let env_files = [".env", ".env.local", ".env.development", ".env.test", ".env.production"];
    for file in &env_files {
        if path.join(file).exists() {
            has_env = true;
            break;
        }
    }
    // Rails-style config files (secrets.yml, credentials, database config, master key)
    if !has_env {
        let rails_config_files = [
            "config/secrets.yml",
            "config/credentials.yml.enc",
            "config/credentials.yml",
            "config/database.yml",
            "config/master.key",
            "config/application.yml",    // Figaro gem
        ];
        for file in &rails_config_files {
            if path.join(file).exists() {
                has_env = true;
                break;
            }
        }
    }
    
    if path.join("package.json").exists() { 
        stack.push("Node.js"); 
        if !path.join("node_modules").exists() {
            missing_deps = true;
        }
        if let Ok(content) = fs::read_to_string(path.join("package.json")) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                // Extract scripts
                if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
                    for key in scripts.keys() {
                        scripts_list.push(key.clone());
                    }
                }
                // Extract dependencies
                if let Some(deps) = json.get("dependencies").and_then(|d| d.as_object()) {
                    for key in deps.keys() {
                        packages.push(key.clone());
                    }
                }
                if let Some(dev_deps) = json.get("devDependencies").and_then(|d| d.as_object()) {
                    for key in dev_deps.keys() {
                        packages.push(key.clone());
                    }
                }
                // Extract keywords
                if let Some(kws) = json.get("keywords").and_then(|k| k.as_array()) {
                    for kw in kws {
                        if let Some(kw_str) = kw.as_str() {
                            keywords.push(kw_str.to_string());
                        }
                    }
                }
            }
        }
    }

    if path.join("Cargo.toml").exists() { 
        stack.push("Rust"); 
        if let Ok(content) = fs::read_to_string(path.join("Cargo.toml")) {
            // Very simple line-based parsing for Cargo.toml dependencies to avoid adding toml crate if not needed
            let mut in_deps = false;
            for line in content.lines() {
                let line = line.trim();
                if line == "[dependencies]" || line == "[dev-dependencies]" {
                    in_deps = true;
                    continue;
                }
                if line.starts_with('[') {
                    in_deps = false;
                    continue;
                }
                if in_deps && !line.is_empty() && !line.starts_with('#') {
                    if let Some(idx) = line.find('=') {
                        packages.push(line[..idx].trim().to_string());
                    }
                }
            }
        }
    }

    if path.join("requirements.txt").exists() || path.join("pyproject.toml").exists() || path.join("setup.py").exists() { 
        stack.push("Python"); 
        if let Ok(content) = fs::read_to_string(path.join("requirements.txt")) {
            for line in content.lines() {
                let line = line.trim();
                if !line.is_empty() && !line.starts_with('#') {
                    // split at ==, >=, etc
                    let pkg = line.split(&['=', '>', '<', '~', '[', ' '][..]).next().unwrap_or("");
                    if !pkg.is_empty() {
                        packages.push(pkg.to_string());
                    }
                }
            }
        }
    }
    if path.join("go.mod").exists() { 
        stack.push("Go"); 
    }
    if path.join("pom.xml").exists() || path.join("build.gradle").exists() || path.join("build.gradle.kts").exists() {
        stack.push("Java");
    }
    if path.join("composer.json").exists() {
        stack.push("PHP");
        if let Ok(content) = fs::read_to_string(path.join("composer.json")) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(require) = json.get("require").and_then(|r| r.as_object()) {
                    for key in require.keys() {
                        packages.push(key.clone());
                    }
                }
                if let Some(require_dev) = json.get("require-dev").and_then(|r| r.as_object()) {
                    for key in require_dev.keys() {
                        packages.push(key.clone());
                    }
                }
            }
        }
    }
    if path.join("Gemfile").exists() {
        stack.push("Ruby");
    }
    let (has_dockerfile, docker_compose_files) = detect_docker_assets(path);
    if has_dockerfile || !docker_compose_files.is_empty() {
        stack.push("Docker");
    }

    if stack.is_empty() {
         stack.push("Unknown");
    }

    let dep_folders = collect_cleanable_directories(path);
    let total_dep_size: u64 = dep_folders.iter()
        .filter_map(|folder| folder.get("size_bytes").and_then(|size| size.as_u64()))
        .sum();

    // Use the same logical-byte calculation as cleanup targets so the breakdown stays consistent.
    let project_size = get_dir_size(path);

    // Get Last Commit
    let mut last_commit = "No commits".to_string();
    let mut last_commit_timestamp: i64 = 0;
    if let Ok(output) = Command::new("git")
        .arg("log")
        .arg("-n")
        .arg("1")
        .arg("--format=%s (%cr)|%ct")
        .current_dir(&path)
        .output() 
    {
        if output.status.success() {
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let parts: Vec<&str> = raw.splitn(2, '|').collect();
            last_commit = parts.first().unwrap_or(&"No commits").to_string();
            if parts.len() > 1 {
                last_commit_timestamp = parts[1].parse::<i64>().unwrap_or(0);
            }
        }
    }

    // Get current branch
    let mut current_branch = String::from("unknown");
    if let Ok(output) = Command::new("git")
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .current_dir(&path)
        .output()
    {
        if output.status.success() {
            let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !branch.is_empty() {
                current_branch = branch;
            }
        }
    }

    // ── Runtime + framework detection ─────────────────────────────────────────
    let (runtime_name, runtime_version, runtime_source) = detect_runtime(path);
    let frameworks = detect_frameworks(path);
    let gem_count = if path.join("Gemfile.lock").exists() { gem_count_from_lock(path) } else { 0 };

    // Get last modified date from filesystem
    let last_modified_timestamp: i64 = fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let stale_threshold = 90 * 24 * 60 * 60; // 90 days
    let inactive_threshold = 30 * 24 * 60 * 60; // 30 days
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    let days_since_commit = if last_commit_timestamp > 0 { (now - last_commit_timestamp) / (24 * 60 * 60) } else { 999 };
    let is_stale = last_commit_timestamp > 0 && (now - last_commit_timestamp) > stale_threshold;
    let is_inactive = last_commit_timestamp > 0 && (now - last_commit_timestamp) > inactive_threshold && !is_stale;

    // Activity status: active (< 30d), inactive (30-90d), abandoned (> 90d)
    let activity_status = if last_commit_timestamp == 0 {
        "unknown"
    } else if is_stale {
        "abandoned"
    } else if is_inactive {
        "inactive"
    } else {
        "active"
    };

    let mut health_score: u32 = 100;
    if is_stale { health_score = health_score.saturating_sub(20); }
    if is_inactive { health_score = health_score.saturating_sub(10); }
    // Note: missing_deps is intentionally NOT penalized — cleanup removes deps and they can be reinstalled
    if project_size > 1_000_000_000 { health_score = health_score.saturating_sub(10); }
    if total_dep_size > 500_000_000 { health_score = health_score.saturating_sub(10); }

    let meta = meta_map.get(&path_str).cloned().unwrap_or_default();

    Some(serde_json::json!({
        "name": name,
        "path": path_str,
        "stack": stack,
        "status": "idle",
        "dependency_folders": dep_folders,
        "total_dep_size_bytes": total_dep_size,
        "project_size_bytes": project_size,
        "last_commit": last_commit,
        "last_commit_timestamp": last_commit_timestamp,
        "health_score": health_score,
        "is_stale": is_stale,
        "missing_deps": missing_deps,
        "has_env": has_env,
        "scripts": scripts_list,
        "current_branch": current_branch,
        "activity_status": activity_status,
        "days_since_commit": days_since_commit,
        "last_modified_timestamp": last_modified_timestamp,
        "packages": packages,
        "keywords": keywords,
        "top_level_files": top_level_files,
        "has_dockerfile": has_dockerfile,
        "has_docker_compose": !docker_compose_files.is_empty(),
        "docker_compose_files": docker_compose_files,
        "tags": meta.tags,
        "is_favorite": meta.is_favorite,
        "runtime_name": runtime_name,
        "runtime_version": runtime_version,
        "runtime_source": runtime_source,
        "frameworks": frameworks,
        "gem_count": gem_count
    }))
}

#[tauri::command]
pub async fn scan_local_projects() -> Result<Vec<serde_json::Value>, String> {
    #[cfg(debug_assertions)]
    let home = std::env::var("HOME")
        .map(|h| format!("{}/Documents", h))
        .unwrap_or_else(|_| "/".to_string());

    #[cfg(not(debug_assertions))]
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    
    // Directories to skip during traversal — system/media folders and large dependency folders
    let skip_dirs: std::collections::HashSet<&str> = [
        "Library", "Pictures", "Movies", "Music", ".Trash",
        "node_modules", "target", ".venv", "venv", "__pycache__",
        ".cargo", ".rustup", ".npm", ".cache",
    ].iter().cloned().collect();

    let meta_map = fetch_project_meta();

    let mut repos = Vec::new();

    let walker = walkdir::WalkDir::new(&home)
        .max_depth(10)
        .follow_links(false)
        .into_iter();

    for entry in walker.filter_entry(|e| {
        // Only filter directories — allow all files through (though we won't use them)
        if e.file_type().is_dir() {
            let name = e.file_name().to_string_lossy();
            // Skip hidden dirs (except .git which we're looking for)
            if name != ".git" && name.starts_with('.') {
                return false;
            }
            // Skip known large/system directories
            if skip_dirs.contains(name.as_ref()) {
                return false;
            }
            true
        } else {
            true
        }
    }) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue, // Permission denied or other FS error — silently skip
        };

        if entry.file_type().is_dir() && entry.file_name() == ".git" {
            if let Some(project_root) = entry.path().parent() {
                if let Some(repo_data) = process_single_repo(project_root, &meta_map) {
                    repos.push(repo_data);
                }
            }
        }
    }

    Ok(repos)
}

#[tauri::command]
pub async fn delete_dependency_folder(base_path: String, folder_name: String) -> Result<(), String> {
    let base = Path::new(&base_path);
    let relative_path = normalize_relative_path(Path::new(&folder_name))
        .ok_or_else(|| format!("Unsafe folder deletion attempted: {}", folder_name))?;

    if relative_path == ".git" || relative_path == "." || relative_path == ".." {
        return Err(format!("Unsafe folder deletion attempted: {}", folder_name));
    }

    let full_path = base.join(&relative_path);
    if !full_path.starts_with(base) {
        return Err(format!("Unsafe folder deletion attempted: {}", folder_name));
    }

    if !full_path.exists() {
         return Err(format!("Folder does not exist: {:?}", full_path));
    }

    if !full_path.is_dir() {
         return Err(format!("Path is not a directory: {:?}", full_path));
    }

    let safe_folders = [
        "node_modules", ".next", "dist", "build", ".cache", "coverage",
        "venv", ".venv", "__pycache__", "target", ".gradle",
        "vendor/bundle", // Rails bundler cache (safe — gems are re-installable)
        "tmp",           // Rails tmp dir
        "log",           // Rails log dir (optional cleanup)
    ];

    let basename = full_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();

    // Folders that must NEVER be deleted regardless of gitignore rules.
    // This protects Rails config, source code, tests, migrations, etc.
    let never_delete = [
        "config", "app", "lib", "src", "test", "spec", "db",
        "public", "assets", "app", "bin", "script",
    ];
    if never_delete.contains(&basename.as_str()) {
        return Err(format!("Protected folder cannot be deleted: {}", folder_name));
    }

    // Also block deletion of any path that contains known sensitive config files.
    // These files must never be removed: secrets.yml, credentials, master.key, database.yml
    let sensitive_patterns = [
        "secrets.yml", "credentials.yml", "credentials.yml.enc",
        "master.key", "database.yml", "application.yml",
    ];
    let path_str_lower = relative_path.to_lowercase();
    if sensitive_patterns.iter().any(|p| path_str_lower.contains(p)) {
        return Err(format!("Sensitive config file protected from deletion: {}", folder_name));
    }

    let gitignore_rules = load_gitignore_cleanup_rules(base);
    let is_allowed = safe_folders.contains(&basename.as_str())
        || safe_folders.contains(&relative_path.as_str())
        || gitignore_rules.dir_names.contains(&basename)
        || gitignore_rules.exact_dirs.contains(&relative_path);

    if !is_allowed {
        return Err(format!("Unsafe folder deletion attempted: {}", folder_name));
    }

    // Attempt to remove directory
    if let Err(e) = fs::remove_dir_all(&full_path) {
         return Err(format!("Failed to delete folder {:?}: {}", full_path, e));
    }

    Ok(())
}

#[tauri::command]
pub async fn fetch_project_commits(path: String) -> Result<Vec<serde_json::Value>, String> {
    let output = Command::new("git")
        .arg("log")
        .arg("-n")
        .arg("10")
        .arg("--format=%H|%s|%an|%cr|%ct")
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to get commits: {}", e))?;

    if !output.status.success() {
        return Err("Git log failed. Is this a valid git repository?".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut commits = Vec::new();

    for line in stdout.lines() {
        if line.trim().is_empty() { continue; }
        let parts: Vec<&str> = line.splitn(5, '|').collect();
        if parts.len() >= 4 {
            commits.push(serde_json::json!({
                "hash": parts[0],
                "message": parts.get(1).unwrap_or(&""),
                "author": parts.get(2).unwrap_or(&""),
                "relative_time": parts.get(3).unwrap_or(&""),
            }));
        }
    }

    Ok(commits)
}

#[tauri::command]
pub async fn fetch_commit_timeline(path: String) -> Result<Vec<CommitTimelinePoint>, String> {
    let output = Command::new("git")
        .arg("log")
        .arg("--date=format:%Y-%m")
        .arg("--format=%ad")
        .arg("--since=12 months ago")
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to get commit timeline: {}", e))?;

    if !output.status.success() {
        return Err("Git log failed. Is this a valid git repository?".to_string());
    }

    let mut counts: HashMap<String, u32> = HashMap::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let month = line.trim();
        if month.is_empty() {
            continue;
        }
        *counts.entry(month.to_string()).or_insert(0) += 1;
    }

    let now = chrono::Utc::now();
    let mut timeline = Vec::new();
    for offset in (0..12).rev() {
        let date = now - chrono::Months::new(offset);
        let key = date.format("%Y-%m").to_string();
        timeline.push(CommitTimelinePoint {
            month: key.clone(),
            count: *counts.get(&key).unwrap_or(&0),
        });
    }

    Ok(timeline)
}

#[tauri::command]
pub async fn start_project_docker_stack(path: String, name: String) -> Result<String, String> {
    let project_path = Path::new(&path);
    let (has_dockerfile, compose_files) = detect_docker_assets(project_path);

    if !compose_files.is_empty() {
        let mut command = Command::new("docker");
        command.arg("compose");
        for file in &compose_files {
            command.arg("-f").arg(file);
        }
        let output = command
            .args(["up", "-d"])
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to start compose stack: {}", e))?;

        if output.status.success() {
            return Ok("compose".to_string());
        }
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    if has_dockerfile {
        let existing = collect_project_labeled_container_ids(&path)?;
        if !existing.is_empty() {
            let output = Command::new("docker")
                .arg("start")
                .args(&existing)
                .output()
                .map_err(|e| format!("Failed to start project container: {}", e))?;
            if output.status.success() {
                return Ok("container".to_string());
            }
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        let slug = slugify_project_name(&name);
        let image_tag = format!("devian-{}-image", slug);
        let container_name = format!("devian-{}-app", slug);

        let build_output = Command::new("docker")
            .args(["build", "-t", &image_tag, "."])
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to build Docker image: {}", e))?;

        if !build_output.status.success() {
            return Err(String::from_utf8_lossy(&build_output.stderr).to_string());
        }

        let run_output = Command::new("docker")
            .args([
                "run",
                "-d",
                "--name",
                &container_name,
                "--label",
                &format!("devian.project_path={}", path),
                "--label",
                &format!("devian.project_name={}", name),
                "-P",
                &image_tag,
            ])
            .output()
            .map_err(|e| format!("Failed to run Docker container: {}", e))?;

        if run_output.status.success() {
            return Ok(container_name);
        }
        return Err(String::from_utf8_lossy(&run_output.stderr).to_string());
    }

    Err("No Dockerfile or docker compose file found for this project.".to_string())
}

#[tauri::command]
pub async fn stop_project_docker_stack(path: String, _name: String) -> Result<(), String> {
    let project_path = Path::new(&path);
    let (has_dockerfile, compose_files) = detect_docker_assets(project_path);

    if !compose_files.is_empty() {
        let mut command = Command::new("docker");
        command.arg("compose");
        for file in &compose_files {
            command.arg("-f").arg(file);
        }
        let output = command
            .arg("stop")
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to stop compose stack: {}", e))?;

        if output.status.success() {
            return Ok(());
        }
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    if has_dockerfile {
        let existing = collect_project_labeled_container_ids(&path)?;
        if existing.is_empty() {
            return Ok(());
        }
        let output = Command::new("docker")
            .arg("stop")
            .args(&existing)
            .output()
            .map_err(|e| format!("Failed to stop project container: {}", e))?;
        if output.status.success() {
            return Ok(());
        }
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Err("No Dockerfile or docker compose file found for this project.".to_string())
}

fn is_skipped_analysis_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | "coverage"
            | ".cache"
            | ".venv"
            | "venv"
            | "__pycache__"
    )
}

fn is_skipped_analysis_file(path: &Path) -> bool {
    let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
    matches!(
        file_name,
        "package-lock.json"
            | "yarn.lock"
            | "pnpm-lock.yaml"
            | "bun.lockb"
            | "bun.lock"
            | "Cargo.lock"
            | "composer.lock"
            | "Gemfile.lock"
            | "Podfile.lock"
    )
}

fn is_probably_text(bytes: &[u8]) -> bool {
    !bytes.iter().take(4096).any(|b| *b == 0)
}

fn count_lines(content: &str) -> u64 {
    if content.is_empty() {
        0
    } else {
        content.lines().count() as u64
    }
}

fn run_git_command(path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .map_err(|e| format!("Git command failed to start: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let message = if !stderr.is_empty() { stderr } else { stdout };
        Err(if message.is_empty() {
            "Git command failed".to_string()
        } else {
            message
        })
    }
}

#[tauri::command]
pub async fn fetch_git_branches(path: String) -> Result<Vec<GitBranchInfo>, String> {
    let output = Command::new("git")
        .arg("branch")
        .arg("--list")
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to list branches: {}", e))?;

    if !output.status.success() {
        return Err("Unable to list branches for this repository".to_string());
    }

    let mut branches = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let is_current = trimmed.starts_with('*');
        let name = trimmed.trim_start_matches('*').trim().to_string();
        if !name.is_empty() {
            branches.push(GitBranchInfo { name, is_current });
        }
    }

    Ok(branches)
}

#[tauri::command]
pub async fn git_fetch(path: String) -> Result<String, String> {
    run_git_command(&path, &["fetch", "--all", "--prune"])
}

#[tauri::command]
pub async fn git_pull(path: String) -> Result<String, String> {
    run_git_command(&path, &["pull", "--ff-only"])
}

#[tauri::command]
pub async fn git_push(path: String) -> Result<String, String> {
    run_git_command(&path, &["push"])
}

#[tauri::command]
pub async fn git_stash_changes(path: String) -> Result<String, String> {
    run_git_command(&path, &["stash", "push", "-u", "-m", "Devian stash"])
}

#[tauri::command]
pub async fn git_create_branch(path: String, branch_name: String) -> Result<String, String> {
    let trimmed = branch_name.trim();
    if trimmed.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    run_git_command(&path, &["checkout", "-b", trimmed])
}

#[tauri::command]
pub async fn git_switch_branch(path: String, branch_name: String) -> Result<String, String> {
    let trimmed = branch_name.trim();
    if trimmed.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    run_git_command(&path, &["checkout", trimmed])
}

#[tauri::command]
pub async fn analyze_repository_insights(path: String) -> Result<RepoInsights, String> {
    let project_path = Path::new(&path);
    if !project_path.exists() || !project_path.is_dir() {
        return Err("Project path does not exist".to_string());
    }
    if !project_path.join(".git").exists() {
        return Err("Repository analysis requires a git repository".to_string());
    }

    let tracked_output = Command::new("git")
        .arg("ls-files")
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to enumerate tracked files: {}", e))?;

    if !tracked_output.status.success() {
        return Err("Git ls-files failed".to_string());
    }

    let churn_output = Command::new("git")
        .arg("log")
        .arg("--pretty=format:")
        .arg("--name-only")
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to inspect git history: {}", e))?;

    if !churn_output.status.success() {
        return Err("Git log failed".to_string());
    }

    let mut change_counts: HashMap<String, u64> = HashMap::new();
    for line in String::from_utf8_lossy(&churn_output.stdout).lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        *change_counts.entry(trimmed.to_string()).or_insert(0) += 1;
    }

    let mut total_lines_of_code = 0_u64;
    let mut files = Vec::new();

    for rel_path in String::from_utf8_lossy(&tracked_output.stdout).lines() {
        if rel_path.trim().is_empty() {
            continue;
        }

        let rel_path_obj = Path::new(rel_path);
        if rel_path_obj
            .components()
            .any(|component| is_skipped_analysis_dir(component.as_os_str().to_string_lossy().as_ref()))
        {
            continue;
        }
        if is_skipped_analysis_file(rel_path_obj) {
            continue;
        }

        let abs_path = project_path.join(rel_path);
        let metadata = match fs::metadata(&abs_path) {
            Ok(metadata) if metadata.is_file() => metadata,
            _ => continue,
        };

        if metadata.len() > 2_000_000 {
            continue;
        }

        let bytes = match fs::read(&abs_path) {
            Ok(bytes) if is_probably_text(&bytes) => bytes,
            _ => continue,
        };

        let content = match String::from_utf8(bytes) {
            Ok(content) => content,
            Err(_) => continue,
        };

        let line_count = count_lines(&content);
        total_lines_of_code += line_count;

        let change_count = *change_counts.get(rel_path).unwrap_or(&0);
        let hotspot_score = (line_count as f64).sqrt() * change_count as f64;

        files.push(RepoInsightFile {
            path: rel_path.to_string(),
            size_bytes: metadata.len(),
            line_count,
            change_count,
            hotspot_score,
        });
    }

    let mut largest_files = files.clone();
    largest_files.sort_by(|a, b| {
        b.size_bytes
            .cmp(&a.size_bytes)
            .then_with(|| b.line_count.cmp(&a.line_count))
    });
    largest_files.truncate(5);

    let mut most_modified_files: Vec<RepoInsightFile> = files
        .iter()
        .filter(|file| file.change_count > 0)
        .cloned()
        .collect();
    most_modified_files.sort_by(|a, b| {
        b.change_count
            .cmp(&a.change_count)
            .then_with(|| b.line_count.cmp(&a.line_count))
    });
    most_modified_files.truncate(5);

    let mut hotspots: Vec<RepoInsightFile> = files
        .iter()
        .filter(|file| file.change_count > 0 && file.line_count > 0)
        .cloned()
        .collect();
    hotspots.sort_by(|a, b| {
        b.hotspot_score
            .partial_cmp(&a.hotspot_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.change_count.cmp(&a.change_count))
    });
    hotspots.truncate(5);

    Ok(RepoInsights {
        total_lines_of_code,
        largest_files,
        most_modified_files,
        hotspots,
    })
}

#[tauri::command]
pub async fn archive_project(path: String) -> Result<(), String> {
    let project_path = Path::new(&path);
    if !project_path.exists() {
        return Err("Project path does not exist".to_string());
    }

    let parent_dir = project_path.parent().ok_or("Cannot get parent directory")?;
    let project_name = project_path.file_name().ok_or("Cannot get project name")?;
    
    let archive_name = format!("{}.tar.gz", project_name.to_string_lossy());
    
    let output = Command::new("tar")
        .arg("-czf")
        .arg(&archive_name)
        .arg("-C")
        .arg(parent_dir)
        .arg(project_name)
        .current_dir(parent_dir)
        .output()
        .map_err(|e| format!("Failed to create archive: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Tar command failed: {}", stderr));
    }

    if let Err(e) = fs::remove_dir_all(&project_path) {
        return Err(format!("Failed to delete original folder: {}", e));
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_project(path: String) -> Result<u64, String> {
    let project_path = Path::new(&path);
    if !project_path.exists() {
        return Err("Project path does not exist".to_string());
    }
    if !project_path.is_dir() {
        return Err("Path is not a directory".to_string());
    }
    // Safety: only delete directories that contain a .git folder (confirmed repos)
    if !project_path.join(".git").exists() {
        return Err("Safety check failed: not a git repository. Refusing to delete.".to_string());
    }

    // Calculate size before deleting
    let size = get_dir_size(project_path);

    fs::remove_dir_all(&project_path)
        .map_err(|e| format!("Failed to delete project: {}", e))?;

    Ok(size)
}

#[tauri::command]
pub async fn fetch_git_branch(path: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to get branch: {}", e))?;

    if !output.status.success() {
        return Err("Not a git repository or no commits yet".to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub async fn get_project_context(path: String) -> Result<String, String> {
    let project_path = Path::new(&path);
    let mut context = String::new();

    // Read README if exists
    for readme_name in &["README.md", "readme.md", "README", "README.txt"] {
        let readme_path = project_path.join(readme_name);
        if readme_path.exists() {
            if let Ok(content) = fs::read_to_string(&readme_path) {
                let truncated: String = content.chars().take(1500).collect();
                context.push_str(&format!("README:\n{}\n\n", truncated));
            }
            break;
        }
    }

    // Read package.json if exists
    let pkg_path = project_path.join("package.json");
    if pkg_path.exists() {
        if let Ok(content) = fs::read_to_string(&pkg_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                let mut pkg_info = String::new();
                if let Some(desc) = json.get("description").and_then(|v| v.as_str()) {
                    pkg_info.push_str(&format!("Description: {}\n", desc));
                }
                if let Some(deps) = json.get("dependencies").and_then(|v| v.as_object()) {
                    let dep_names: Vec<&String> = deps.keys().collect();
                    pkg_info.push_str(&format!("Dependencies: {}\n", dep_names.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")));
                }
                if let Some(scripts) = json.get("scripts").and_then(|v| v.as_object()) {
                    let script_names: Vec<&String> = scripts.keys().collect();
                    pkg_info.push_str(&format!("Scripts: {}\n", script_names.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")));
                }
                if !pkg_info.is_empty() {
                    context.push_str(&format!("package.json:\n{}\n", pkg_info));
                }
            }
        }
    }

    // Read Cargo.toml if exists
    let cargo_path = project_path.join("Cargo.toml");
    if cargo_path.exists() {
        if let Ok(content) = fs::read_to_string(&cargo_path) {
            let truncated: String = content.chars().take(800).collect();
            context.push_str(&format!("Cargo.toml:\n{}\n\n", truncated));
        }
    }

    // List top-level directory structure
    if let Ok(entries) = fs::read_dir(project_path) {
        let mut items: Vec<String> = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with('.') || name == ".env" {
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                items.push(format!("{}{}", name, if is_dir { "/" } else { "" }));
            }
        }
        items.sort();
        context.push_str(&format!("File structure:\n{}\n", items.join("\n")));
    }

    if context.is_empty() {
        return Err("No project context found".to_string());
    }

    Ok(context)
}

