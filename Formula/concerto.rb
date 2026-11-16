class Concerto < Formula
  desc "Split a coding request into scored user stories and run coding agents on them, each checked and reviewed"
  homepage "https://github.com/RemiPelloux/Concerto"
  version "0.19.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v0.19.0/concerto-macos-arm64.tar.gz"
      sha256 "585af8053de165add09a1a623273cdf737f98ae927d9fca3a72409d8013e829b"
    end
    on_intel do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v0.19.0/concerto-macos-x64.tar.gz"
      sha256 "6a4a0f4bfdb0ebde0ccb0c7f7bbc7305428706a6d196395b4ca759bc45b30540"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v0.19.0/concerto-linux-arm64.tar.gz"
      sha256 "2e97d18007bf3df30e8e9eea2f93cb1f8b3ea68d5df297a77509867ba4f444f9"
    end
    on_intel do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v0.19.0/concerto-linux-x64.tar.gz"
      sha256 "64d799197e068a152082b9fc21592fe0af2415c3f3c4b2d90fe48adc138d889e"
    end
  end

  def install
    bin.install "concerto"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/concerto --version")
  end
end
