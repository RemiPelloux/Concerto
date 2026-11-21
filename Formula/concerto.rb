class Concerto < Formula
  desc "Split a coding request into scored user stories and run coding agents on them, each checked and reviewed"
  homepage "https://github.com/RemiPelloux/Concerto"
  version "1.2.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.2.0/concerto-macos-arm64.tar.gz"
      sha256 "269d7b225d7da8da9cb578da81a6bac63aec65b65839ab3d0956ba50a08c61e6"
    end
    on_intel do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.2.0/concerto-macos-x64.tar.gz"
      sha256 "8549ca46792575e8b4608fe811ac53e7f465bd774492c6286b897a215e8536df"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.2.0/concerto-linux-arm64.tar.gz"
      sha256 "673c329907ece04c11f718d7d1523c400ee043657723b8e6ed9d3de34a42151f"
    end
    on_intel do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.2.0/concerto-linux-x64.tar.gz"
      sha256 "c0c9c56a84734c4e3228ea5333bb4185d56ec0e62cbcc29b74dc18b4f2b472df"
    end
  end

  def install
    bin.install "concerto"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/concerto --version")
  end
end
