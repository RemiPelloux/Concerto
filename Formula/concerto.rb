class Concerto < Formula
  desc "Split a coding request into scored user stories and run coding agents on them, each checked and reviewed"
  homepage "https://github.com/RemiPelloux/Concerto"
  version "1.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.1.0/concerto-macos-arm64.tar.gz"
      sha256 "a5a014718759f3ca27a4d37d1ba02d5e5aad75fd3a802c669cb81bf11a099e4b"
    end
    on_intel do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.1.0/concerto-macos-x64.tar.gz"
      sha256 "877998cc18a5deaba09e6cf5c9e0c29d948ded4867d5c7f92844c3fb374d6cba"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.1.0/concerto-linux-arm64.tar.gz"
      sha256 "b0903a92b714321a3171e47a8d173b619fe0617f1fde775466d4a6d254541efe"
    end
    on_intel do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.1.0/concerto-linux-x64.tar.gz"
      sha256 "3610d3ecc4a6d610d3cebaab4c6b6e357699c8a722995296553dfcdfcae4cabe"
    end
  end

  def install
    bin.install "concerto"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/concerto --version")
  end
end
