# syntax=docker/dockerfile:1
#
# Images of the Rust services. Build one with `--target backend` or `--target akasha`;
# docker-compose.yml does that for you.

FROM rust:1.99-trixie AS build

# cmake/clang build the bundled Tesseract, protoc compiles common/proto,
# libheif-dev is linked for HEIC images.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        clang cmake libclang-dev libheif-dev pkg-config protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .

# The cache mounts keep crates and build artifacts between image builds.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p backend -p akasha \
    && cp target/release/backend target/release/akasha /usr/local/bin/


FROM debian:trixie-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 libheif1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /app --create-home app \
    && mkdir -p /app/.cache \
    && chown app:app /app/.cache

USER app
WORKDIR /app
ENV HOME=/app


FROM runtime AS akasha
COPY --from=build /usr/local/bin/akasha /usr/local/bin/akasha
EXPOSE 50051
CMD ["akasha"]


FROM runtime AS backend
COPY --from=build /usr/local/bin/backend /usr/local/bin/backend
# OCR models are downloaded on first use; docker-compose.yml keeps them in a volume.
ENV XBERG_CACHE_DIR=/app/.cache/xberg
EXPOSE 8081
CMD ["backend"]
