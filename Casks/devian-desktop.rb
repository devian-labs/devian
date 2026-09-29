cask "devian-desktop" do
  version "1.2.1"
  sha256 :no_check

  url "https://github.com/devian-labs/devian/releases/download/v#{version}/Devian.Desktop_#{version}_aarch64.dmg"
  name "Devian"
  desc "See and control what AI coding agents do on your machine"
  homepage "https://devian.app"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64

  app "Devian Desktop.app", target: "Devian.app"

  zap trash: [
    "~/.devian",
    "~/.devian_credentials.json",
    "~/.devian_project_meta.json",
    "~/.devian_settings.json",
    "~/Library/Application Support/dev.devian.desktop",
    "~/Library/Caches/dev.devian.desktop",
    "~/Library/Preferences/dev.devian.desktop.plist",
    "~/Library/Saved Application State/dev.devian.desktop.savedState",
    "~/Library/WebKit/dev.devian.desktop",
  ]
end
