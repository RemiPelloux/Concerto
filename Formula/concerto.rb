class Concerto < Formula
  desc "Split a coding request into scored user stories and run coding agents on them, each checked and reviewed"
  homepage "https://github.com/RemiPelloux/Concerto"
  version "1.0.4"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.4/concerto-macos-arm64.tar.gz"
      sha256 "672f4b3fcb91139b10fae4f5d9432301637d00a530d5adf1f46d3e3259033fae"
    end
    on_intel do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.4/concerto-macos-x64.tar.gz"
      sha256 "fc03d6269bf8676553ea01480fce3cfb5f3ecbc6d27acbc795edbbf0a566751f"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.4/concerto-linux-arm64.tar.gz"
      sha256 "8fd9fdd597df9541aee5dc2c688c703228e1d08df2fbd8eb622dd9d8d21cdf2d"
    end
    on_intel do
      url "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.4/concerto-linux-x64.tar.gz"
      sha256 "fe0adf9400cfe28fdcf3eed63ee89faef6039f71ac189e7364f8cf5f4ec3af32"
    end
  end

  def install
    bin.install "concerto"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/concerto --version")
  end
end
