class Concerto < Formula
  desc "Split a coding request into scored user stories and run coding agents on them, each checked and reviewed"
  homepage "https://github.com/RemiPelloux/Concerto"
  version "1.0.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.0/concerto-macos-arm64.tar.gz"
      sha256 "f63583d25667cc7b3c62af66c267c11d5ed76bd1e509a068fa3165c66456c46e"
    end
    on_intel do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.0/concerto-macos-x64.tar.gz"
      sha256 "c67ff45c625eb9d88a2b72241f42ecf7d01426ce127e287e2c63d2eb870948cf"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.0/concerto-linux-arm64.tar.gz"
      sha256 "cf48fe54f4a82a9e947457ea439b4392f902fa6320ae33c606db67784c0680d8"
    end
    on_intel do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.0/concerto-linux-x64.tar.gz"
      sha256 "5a27e4425751121d75d0e1e14bd96b686152748ecb4a6763c08a2574156937c2"
    end
  end

  def install
    bin.install "concerto"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/concerto --version")
  end
end
