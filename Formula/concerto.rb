class Concerto < Formula
  desc "Split a coding request into scored user stories and run coding agents on them, each checked and reviewed"
  homepage "https://github.com/RemiPelloux/Concerto"
  version "1.0.5"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.5/concerto-macos-arm64.tar.gz"
      sha256 "35c4d76606752b38e23882a92bab15618fd8d117406a1cddc89dc0f275185c65"
    end
    on_intel do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.5/concerto-macos-x64.tar.gz"
      sha256 "63238e57f80c83898936753270230a420e7a4fd5ad41970a0966a7702576f6db"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.5/concerto-linux-arm64.tar.gz"
      sha256 "81ab80372da797244867d5e33057b6cf074ddac3c76233a87620420877dc36c8"
    end
    on_intel do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.5/concerto-linux-x64.tar.gz"
      sha256 "da65e322efdb3c8fccb56bcda2fb77bb522f2a3bb131461f214aee2e91419bf4"
    end
  end

  def install
    bin.install "concerto"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/concerto --version")
  end
end
