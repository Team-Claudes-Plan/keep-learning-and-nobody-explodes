# Dev environment for the ingestion service.
#
# Outputs:
#   packages.default   -> the Rust backend binary (built with crane)
#   packages.dev       -> `nix run .#dev` starts a process-compose dashboard:
#                         postgres (job queue), rustfs (S3), setup, backend
#   devShells.default  -> toolchain + psql/s5cmd/rustfs CLI access
#
# Run `nix run .#dev` from this directory (paths are relative to it).
{
  description = "Course-material ingestion service: Rust backend, RustFS (S3) and Postgres for OCR worker jobs";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    flake-parts.url = "github:hercules-ci/flake-parts";

    # Dev service orchestration (postgres, rustfs, setup, backend).
    process-compose-flake.url = "github:Platonic-Systems/process-compose-flake";

    # Pinned Rust toolchain + crane for cached Rust builds.
    rust-overlay.url = "github:oxalica/rust-overlay";
    crane.url = "github:ipetkov/crane";
  };

  outputs = inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      imports = [ inputs.process-compose-flake.flakeModule ];

      perSystem = { self', system, lib, ... }:
        let
          # nixpkgs with the rust-overlay for the pinned toolchain.
          pkgs = import inputs.nixpkgs {
            inherit system;
            overlays = [ inputs.rust-overlay.overlays.default ];
          };

          # --- dev service constants (single source of truth) ---
          pgPort = 5432;
          s3Port = 9000;
          s3ConsolePort = 9001;
          dbUser = "postgres";
          dbName = "ingestion";
          s3AccessKey = "devadmin";
          s3SecretKey = "devadmin-secret";
          s3Bucket = "course-materials";

          # Environment consumed by the backend; also exported in the dev shell.
          devEnv = {
            DATABASE_URL = "postgres://${dbUser}@localhost:${toString pgPort}/${dbName}";
            S3_ENDPOINT = "http://localhost:${toString s3Port}";
            S3_ACCESS_KEY = s3AccessKey;
            S3_SECRET_KEY = s3SecretKey;
            S3_BUCKET = s3Bucket;
          };

          # --- pinned Rust toolchain, read from rust-toolchain.toml in the repo root ---
          # rust-analyzer + rust-src are added on top for the dev shell/editor.
          toolchain = (pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml).override {
            extensions = [ "rust-src" "rust-analyzer" ];
          };
          craneLib = (inputs.crane.mkLib pkgs).overrideToolchain (_: toolchain);

          src = craneLib.cleanCargoSource ./.;
          commonArgs = { inherit src; strict-deps = true; };
          cargoArtifacts = craneLib.buildDepsOnly commonArgs;
          ingestion = craneLib.buildPackage (commonArgs // { inherit cargoArtifacts; });

          postgresql = pkgs.postgresql_18;

          # --- process scripts ---
          # Paths are relative to the repo root: run from this directory.
          # Data lives in .data/ (gitignored); delete it to reset.

          pg-up = pkgs.writeShellApplication {
            name = "pg-up";
            runtimeInputs = [ postgresql ];
            text = ''
              data="$PWD/.data/postgres"
              if [ ! -f "$data/PG_VERSION" ]; then
                initdb -D "$data" --username=${dbUser} --auth=trust --encoding=UTF8 --locale=C
              fi
              exec postgres -D "$data" -p ${toString pgPort} -k "$data"
            '';
          };

          rustfs-up = pkgs.writeShellApplication {
            name = "rustfs-up";
            runtimeInputs = [ pkgs.rustfs ];
            text = ''
              data="$PWD/.data/s3"
              mkdir -p "$data"
              exec rustfs server \
                --address 127.0.0.1:${toString s3Port} \
                --console-enable \
                --console-address 127.0.0.1:${toString s3ConsolePort} \
                --access-key ${s3AccessKey} \
                --secret-key ${s3SecretKey} \
                "$data"
            '';
          };

          # One-shot: create the job-queue database and the material bucket.
          # Fails loudly on real errors so it shows up in the dashboard.
          dev-setup = pkgs.writeShellApplication {
            name = "dev-setup";
            runtimeInputs = [ postgresql pkgs.s5cmd ];
            text = ''
              export AWS_ACCESS_KEY_ID=${s3AccessKey}
              export AWS_SECRET_ACCESS_KEY=${s3SecretKey}

              # Job-queue database (idempotent)
              if [ -z "$(psql -h localhost -p ${toString pgPort} -U ${dbUser} -d postgres -Atc \
                "SELECT 1 FROM pg_database WHERE datname = '${dbName}'")" ]; then
                createdb -h localhost -p ${toString pgPort} -U ${dbUser} ${dbName}
              fi

              # Material bucket (idempotent)
              if ! s5cmd --endpoint-url http://localhost:${toString s3Port} \
                ls "s3://${s3Bucket}" > /dev/null 2>&1; then
                s5cmd --endpoint-url http://localhost:${toString s3Port} mb "s3://${s3Bucket}"
              fi
            '';
          };

          backend-run = pkgs.writeShellApplication {
            name = "backend-run";
            # stdenv.cc provides the `cc` linker cargo needs outside the crane build.
            runtimeInputs = [ toolchain pkgs.cargo-watch pkgs.stdenv.cc ];
            text = ''
              exec cargo watch -x run
            '';
          };
        in
        {
          packages.default = ingestion;

          formatter = pkgs.nixfmt-rfc-style;

          devShells.default = pkgs.mkShell {
            packages = [
              toolchain
              pkgs.cargo-watch
              pkgs.stdenv.cc   # linker for `cargo build` in the shell
              postgresql
              pkgs.rustfs
              pkgs.s5cmd
              pkgs.curl
              self'.packages.dev
              pkgs.protobuf
            ];
            env = devEnv;
            shellHook = ''
              export AWS_ACCESS_KEY_ID="''${S3_ACCESS_KEY}"
              export AWS_SECRET_ACCESS_KEY="''${S3_SECRET_KEY}"
              echo "ingestion dev shell: psql \$DATABASE_URL | s5cmd --endpoint-url \$S3_ENDPOINT ls | dev"
            '';
          };

          process-compose.dev = {
            cli.preHook = "mkdir -p .data/logs";

            defaults.processSettings = { name, ... }: {
              availability.restart = lib.mkDefault "on_failure";
              availability.max_restarts = lib.mkDefault 5;
              log_location = lib.mkDefault ".data/logs/${name}.log";
            };

            settings.environment = devEnv;
            settings.processes = {
              postgres = {
                description = "Postgres 18 for OCR worker jobs";
                command = pg-up;
                readiness_probe = {
                  exec.command = "${postgresql}/bin/pg_isready -h localhost -p ${toString pgPort} -U ${dbUser}";
                  initial_delay_seconds = 2;
                  period_seconds = 2;
                  timeout_seconds = 3;
                };
              };

              rustfs = {
                description = "RustFS (S3-compatible) object storage";
                command = rustfs-up;
                readiness_probe = {
                  exec.command = "${pkgs.curl}/bin/curl -fsS -o /dev/null http://localhost:${toString s3Port}/minio/health/ready";
                  initial_delay_seconds = 2;
                  period_seconds = 2;
                  timeout_seconds = 3;
                };
              };

              setup = {
                description = "Create database and bucket (idempotent)";
                command = dev-setup;
                depends_on = {
                  postgres.condition = "process_healthy";
                  rustfs.condition = "process_healthy";
                };
              };

              backend = {
                description = "Rust ingestion backend (cargo watch)";
                command = backend-run;
                depends_on.setup.condition = "process_completed_successfully";
              };
            };
          };
        };
    };
}
