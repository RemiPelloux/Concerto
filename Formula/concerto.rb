class Concerto < Formula
  desc "Split a coding request into scored user stories and run coding agents on them, each checked and reviewed"
  homepage "https://github.com/RemiPelloux/Concerto"
  version "1.1.1"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.1.1/concerto-macos-arm64.tar.gz"
      sha256 "55a5c80497b66c712812a5496ee83654adbe3291333184256e6dd724d26880e9"
    end
    on_intel do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.1.1/concerto-macos-x64.tar.gz"
      sha256 "4afe9aea63994a3438f7a4595f7d2d9dcdcd3fb51c0d6b49909ec7ae5496b7a1"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.1.1/concerto-linux-arm64.tar.gz"
      sha256 "e0a4ac28ec8dd7c73dcca28433badacf36ec64bf81f716d39264d7aaeced8dca"
    end
    on_intel do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.1.1/concerto-linux-x64.tar.gz"
      sha256 "d9ffe58944a735dad563e0e902878d12e015285200bc01fc761c7f8366b19e4f"
    end
  end

  def install
    bin.install "concerto"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/concerto --version")
  end
end
