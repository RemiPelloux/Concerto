# Concerto for CI and remote runners: the standalone executable on Debian, with git.
#   docker run --rm -v "$PWD:/work" -w /work ghcr.io/remipelloux/concerto --plan "…"
# Built by the release workflow from the Linux executables (amd64 and arm64).
FROM debian:bookworm-slim
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY bin/${TARGETARCH}/concerto /usr/local/bin/concerto
RUN git config --system --add safe.directory '*'
ENTRYPOINT ["concerto"]
CMD ["--help"]
