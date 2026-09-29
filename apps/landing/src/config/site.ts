// Single source of truth for where the project lives on GitHub.
export const GITHUB_REPO = "devian-labs/devian";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
export const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
export const LATEST_RELEASE_URL = `${GITHUB_URL}/releases/latest`;
export const HOMEBREW_COMMANDS = [
    `brew tap devian-labs/devian ${GITHUB_URL}`,
    "brew install --cask devian-desktop",
];
