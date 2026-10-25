# Dev environment for the upload service.
#
# Outputs:
#   packages.default   -> the Rust backend binary (built with crane)
#   packages.dev       -> `nix run .#dev` starts a process-compose dashboard:
#                         postgres (job queue), rustfs (S3), setup, backend, akasha
#   devShells.default  -> toolchain + psql/s5cmd/rustfs CLI access
#
# Run `nix run .#dev` from this directory (paths are relative to it).
{
  description = "Course-material Upload service: Rust backend, RustFS (S3) and Postgres for OCR worker jobs";

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

      # NixOS module hosting the whole app behind the host's nginx, see nix/module.nix.
      flake.nixosModules = rec {
        keep-learning-and-nobody-explodes = import ./nix/module.nix { inherit (inputs) self; };
        default = keep-learning-and-nobody-explodes;
      };

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
          dbName = "upload";
          s3AccessKey = "devadmin";
          s3SecretKey = "devadmin-secret";
          s3Bucket = "course-materials";
          webhookToken = "dev-webhook-token";
          webhookOrigin = "http://127.0.0.1:8081";

          # Environment consumed by the backend; also exported in the dev shell.
          devEnv = {
            DATABASE_URL = "postgres://${dbUser}@localhost:${toString pgPort}/${dbName}";
            S3_ENDPOINT = "http://localhost:${toString s3Port}";
            S3_ACCESS_KEY = s3AccessKey;
            S3_SECRET_KEY = s3SecretKey;
            S3_BUCKET = s3Bucket;
            WEBHOOK_TOKEN = webhookToken;
            SQLX_OFFLINE = "true";
          };

          # --- pinned Rust toolchain, read from rust-toolchain.toml in the repo root ---
          # rust-analyzer + rust-src are added on top for the dev shell/editor.
          toolchain = (pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml).override {
            extensions = [ "rust-src" "rust-analyzer" ];
          };
          craneLib = (inputs.crane.mkLib pkgs).overrideToolchain (_: toolchain);

          # Cargo sources plus the non-Rust files the crates read at build time.
          src = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [
              (craneLib.fileset.commonCargoSources ./.)
              ./common/proto
              ./backend/migrations
              ./akasha/src/pipeline/prompt
              ./frontend/src/game/glyphs.ts
            ];
          };
          # ONNX Runtime for ort-sys (pulled in by kreuzberg-paddle-ocr); linked dynamically.
          onnxruntime = pkgs.onnxruntime;
          ortEnv = {
            ORT_LIB_PATH = "${lib.getLib onnxruntime}/lib";
            ORT_PREFER_DYNAMIC_LINK = "1";
          };

          # Native (build-time) and linked system libraries needed by xberg "full".
          nativeLibs = [ pkgs.pkg-config pkgs.cmake pkgs.protobuf pkgs.rustPlatform.bindgenHook ];
          linkLibs = [ onnxruntime pkgs.libheif ];
          # xberg-tesseract's build script downloads the Tesseract/Leptonica sources,
          # which the sandbox forbids. It accepts verified copies in its cache
          # (<cache>/source-artifacts/<key>/<sha256>/<name>), so Nix fetches them.
          # Revisions and hashes come from xberg-tesseract's build.rs; update them with it.
          tesseractArtifacts = [
            {
              key = "leptonica-source";
              name = "leptonica.zip";
              sha256 = "0febcd4fc5cdc9c52d59509b45483d107f9f40922899e3f134ea615094ecbc77";
              url = "https://codeload.github.com/DanBloomberg/leptonica/zip/13275a278eb55b5746e33f95fbf5a2c8f604b3ab";
            }
            {
              key = "tesseract-source";
              name = "tesseract.zip";
              sha256 = "d2470cc33ee34deeae6fc47809d0b33a3623a4343d92ff317ac3b9903c507bad";
              url = "https://codeload.github.com/tesseract-ocr/tesseract/zip/db0ec62f81b0737fbbe184d8fea40af5738f8eef";
            }
            {
              key = "tessdata-fast-eng";
              name = "eng.traineddata";
              sha256 = "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2";
              url = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd/eng.traineddata";
            }
          ];
          seedTesseractCache = ''
            export TESSERACT_RS_CACHE_DIR="$TMPDIR/xberg-tesseract-cache"
          '' + lib.concatMapStrings (a: ''
            mkdir -p "$TESSERACT_RS_CACHE_DIR/source-artifacts/${a.key}/${a.sha256}"
            cp ${pkgs.fetchurl { inherit (a) url sha256; }} \
              "$TESSERACT_RS_CACHE_DIR/source-artifacts/${a.key}/${a.sha256}/${a.name}"
          '') tesseractArtifacts;

          commonArgs = {
            inherit src;
            pname = "keep-learning-and-nobody-explodes";
            version = "0.1.0";
            strict-deps = true;
            SQLX_OFFLINE = true;
            nativeBuildInputs = nativeLibs;
            buildInputs = linkLibs;
            preBuild = seedTesseractCache;
          } // ortEnv;
          cargoArtifacts = craneLib.buildDepsOnly commonArgs;
          backend = craneLib.buildPackage (commonArgs // { inherit cargoArtifacts; });

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
              notify_queue="$PWD/.data/notify-primary"
              mkdir -p "$data" "$notify_queue"
              export RUSTFS_NOTIFY_ENABLE="true"
              export RUSTFS_NOTIFY_WEBHOOK_ENABLE_PRIMARY="on"
              export RUSTFS_NOTIFY_WEBHOOK_ENDPOINT_PRIMARY="${webhookOrigin}/events/rustfs"
              export RUSTFS_NOTIFY_WEBHOOK_AUTH_TOKEN_PRIMARY="${webhookToken}"
              export RUSTFS_NOTIFY_WEBHOOK_QUEUE_DIR_PRIMARY="$notify_queue"
              export RUSTFS_OUTBOUND_ALLOW_ORIGINS="${webhookOrigin}"
              exec rustfs server \
                --address 127.0.0.1:${toString s3Port} \
                --console-enable \
                --console-address 127.0.0.1:${toString s3ConsolePort} \
                --access-key ${s3AccessKey} \
                --secret-key ${s3SecretKey} \
                "$data"
            '';
          };

          # One-shot setup steps. The backend starts before RustFS so its root
          # endpoint answers the webhook target's documented HEAD health check.
          dev-setup = pkgs.writeShellApplication {
            name = "dev-setup";
            runtimeInputs = [ postgresql ];
            text = ''
              if [ -z "$(psql -h localhost -p ${toString pgPort} -U ${dbUser} -d postgres -Atc \
                "SELECT 1 FROM pg_database WHERE datname = '${dbName}'")" ]; then
                createdb -h localhost -p ${toString pgPort} -U ${dbUser} ${dbName}
              fi
            '';
          };

          bucket-setup = pkgs.writeShellApplication {
            name = "bucket-setup";
            runtimeInputs = [ pkgs.s5cmd ];
            text = ''
              export AWS_ACCESS_KEY_ID=${s3AccessKey}
              export AWS_SECRET_ACCESS_KEY=${s3SecretKey}
              if ! s5cmd --endpoint-url http://localhost:${toString s3Port} \
                ls "s3://${s3Bucket}" > /dev/null 2>&1; then
                s5cmd --endpoint-url http://localhost:${toString s3Port} mb "s3://${s3Bucket}"
              fi
            '';
          };

          backend-run = pkgs.writeShellApplication {
            name = "backend-run";
            # stdenv.cc provides the `cc` linker cargo needs outside the crane build.
            runtimeInputs = [ toolchain pkgs.cargo-watch pkgs.stdenv.cc pkgs.cmake pkgs.pkg-config pkgs.protobuf ];
            text = ''
              export CARGO_BUILD_JOBS="1"
              export NUM_JOBS="1"
              exec cargo watch --watch-when-idle \
                -w backend/src -w backend/migrations -w backend/Cargo.toml \
                -w common/grpc -w Cargo.toml -w Cargo.lock \
                -x 'run -p backend'
            '';
          };

          akasha-run = pkgs.writeShellApplication {
            name = "akasha-run";
            runtimeInputs = [ toolchain pkgs.cargo-watch pkgs.stdenv.cc pkgs.cmake pkgs.pkg-config pkgs.protobuf ];
            text = ''
              # Load the local LLM configuration.
              if [ -f .env ]; then
                set -a
                # shellcheck disable=SC1091
                . ./.env
                set +a
              fi

              # Akasha must use the same database as the backend. Set it after
              # sourcing `.env` so a local override cannot point Akasha at a
              # different database.
              export DATABASE_URL="${devEnv.DATABASE_URL}"

              export CARGO_BUILD_JOBS="1"
              export NUM_JOBS="1"

              exec cargo watch --watch-when-idle \
                -w akasha/src -w akasha/Cargo.toml \
                -w common/grpc -w common/config \
                -w Cargo.toml -w Cargo.lock \
                -x 'run -p akasha'
            '';
          };

          notification-setup = pkgs.writeShellApplication {
            name = "notification-setup";
            runtimeInputs = [ pkgs.awscli2 ];
            text = ''
              export AWS_ACCESS_KEY_ID=${s3AccessKey}
              export AWS_SECRET_ACCESS_KEY=${s3SecretKey}
              aws --endpoint-url http://localhost:${toString s3Port} --region us-east-1 \
                s3api put-bucket-notification-configuration \
                --bucket ${s3Bucket} \
                --notification-configuration '{"QueueConfigurations":[{"Id":"ocr-uploads","QueueArn":"arn:rustfs:sqs:us-east-1:primary:webhook","Events":["s3:ObjectCreated:*"],"Filter":{"Key":{"FilterRules":[{"Name":"prefix","Value":"uploads/"}]}}}]}'
            '';
          };
        in
        {
          # The workspace build contains both service binaries: backend and akasha.
          packages.default = backend;
          packages.server = backend;
          packages.frontend = pkgs.callPackage ./nix/frontend.nix { };
          # Re-exported so the NixOS module does not depend on the host's nixpkgs having it.
          packages.rustfs = pkgs.rustfs;

          checks = lib.optionalAttrs (lib.hasSuffix "-linux" system) {
            nixos-module = import ./nix/test.nix { inherit (inputs) self; inherit pkgs; };
          };

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
              pkgs.awscli2
              pkgs.cmake
              pkgs.pkg-config
              pkgs.rustPlatform.bindgenHook
              pkgs.bun
            ] ++ linkLibs;
            env = devEnv // ortEnv // {
              LD_LIBRARY_PATH = lib.makeLibraryPath linkLibs;
            };
            shellHook = ''
              export AWS_ACCESS_KEY_ID="''${S3_ACCESS_KEY}"
              export AWS_SECRET_ACCESS_KEY="''${S3_SECRET_KEY}"
              echo "upload dev shell: psql \$DATABASE_URL | s5cmd --endpoint-url \$S3_ENDPOINT ls | dev" >&2
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
                depends_on.backend.condition = "process_healthy";
                readiness_probe = {
                  exec.command = "${pkgs.curl}/bin/curl -fsS -o /dev/null http://localhost:${toString s3Port}/minio/health/ready";
                  initial_delay_seconds = 2;
                  period_seconds = 2;
                  timeout_seconds = 3;
                };
              };

              setup = {
                description = "Create database (idempotent)";
                command = dev-setup;
                depends_on.postgres.condition = "process_healthy";
              };

              bucket = {
                description = "Create material bucket (idempotent)";
                command = bucket-setup;
                depends_on.rustfs.condition = "process_healthy";
              };

              backend = {
                description = "Rust upload backend (cargo watch)";
                command = backend-run;
                depends_on.setup.condition = "process_completed_successfully";
                readiness_probe = {
                  exec.command = "${pkgs.curl}/bin/curl -fsS -o /dev/null http://localhost:8081/health";
                  initial_delay_seconds = 2;
                  period_seconds = 2;
                  timeout_seconds = 2;
                };
              };

              akasha = {
                description = "Akasha question extraction gRPC service (cargo watch)";
                command = akasha-run;
                environment = {
                  DATABASE_URL = devEnv.DATABASE_URL;
                };
                depends_on.backend.condition = "process_healthy";
              };

              notifications = {
                description = "Configure RustFS OCR webhook (idempotent)";
                command = notification-setup;
                depends_on = {
                  backend.condition = "process_healthy";
                  bucket.condition = "process_completed_successfully";
                };
              };
            };
          };
        };
    };
}
