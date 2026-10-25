# NixOS module hosting the complete app on one machine:
#
#   nginx (host's, TLS via ACME) ──▶ frontend (static files)
#                                └─▶ /backend/* ──▶ backend   127.0.0.1:8081
#   backend ──▶ PostgreSQL (unix socket), RustFS 127.0.0.1:9000, Akasha 127.0.0.1:50051
#   RustFS ──webhook──▶ backend;  Akasha ──▶ PostgreSQL, LLM (OpenAI-compatible API)
#
# Only nginx listens publicly; every service binds to 127.0.0.1. The S3 keys
# and the webhook token are generated on first start and kept in the state
# directory. The flake passes itself as `self` so the packages default to the
# ones built from this repository.
{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.keep-learning-and-nobody-explodes;
  name = "keep-learning-and-nobody-explodes";
  flakePackages = self.packages.${pkgs.stdenv.hostPlatform.system};

  stateDir = "/var/lib/${name}";
  secretsFile = "${stateDir}/secrets.env";

  backendOrigin = "http://127.0.0.1:${toString cfg.backend.port}";
  s3Endpoint = "http://127.0.0.1:${toString cfg.s3.port}";

  databaseUrl =
    if cfg.database.createLocally then
      "postgres:///${cfg.database.name}?host=/run/postgresql&user=${cfg.user}"
    else
      cfg.database.url;

  # Shared by the long-running services.
  hardening = {
    User = cfg.user;
    Group = cfg.group;
    NoNewPrivileges = true;
    PrivateTmp = true;
    PrivateDevices = true;
    ProtectSystem = "strict";
    ProtectHome = true;
    ProtectClock = true;
    ProtectHostname = true;
    ProtectKernelLogs = true;
    ProtectKernelModules = true;
    ProtectKernelTunables = true;
    ProtectControlGroups = true;
    RestrictNamespaces = true;
    RestrictRealtime = true;
    RestrictSUIDSGID = true;
    RestrictAddressFamilies = [
      "AF_UNIX"
      "AF_INET"
      "AF_INET6"
    ];
    LockPersonality = true;
    CapabilityBoundingSet = "";
    UMask = "0077";
  };

  # Newer nixpkgs create roles and databases in postgresql-setup.service, older
  # ones in postgresql.service itself; a missing unit in `after` is ignored.
  databaseUnits = lib.optionals cfg.database.createLocally [
    "postgresql.service"
    "postgresql-setup.service"
  ];
  requiresDatabase = lib.optional cfg.database.createLocally "postgresql.service";
in
{
  options.services.keep-learning-and-nobody-explodes = {
    enable = lib.mkEnableOption "Keep Learning and Nobody Explodes (frontend, backend, Akasha, RustFS, PostgreSQL)";

    domain = lib.mkOption {
      type = lib.types.str;
      example = "learn.example.org";
      description = "Public domain of the app. An nginx virtual host is created for it.";
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = flakePackages.server;
      defaultText = lib.literalExpression "keep-learning-and-nobody-explodes.packages.\${system}.server";
      description = "Package providing the `backend` and `akasha` binaries.";
    };

    frontendPackage = lib.mkOption {
      type = lib.types.package;
      default = flakePackages.frontend;
      defaultText = lib.literalExpression "keep-learning-and-nobody-explodes.packages.\${system}.frontend";
      description = "Static frontend build. It must be built with `VITE_API_URL=/backend`.";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "keep-learning";
      description = "System user running all services; also the PostgreSQL role.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "keep-learning";
      description = "System group running all services.";
    };

    language = lib.mkOption {
      type = lib.types.enum [
        "german"
        "english"
      ];
      default = "german";
      description = "Language Akasha writes the generated questions in.";
    };

    maxUploadBytes = lib.mkOption {
      type = lib.types.ints.positive;
      default = 256 * 1024 * 1024;
      description = "Largest accepted upload in bytes (backend and nginx).";
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/keep-learning.env";
      description = ''
        Optional environment file passed to the backend and Akasha, e.g. for
        `LLM_API_KEY` or `RUST_LOG`. Keep it out of the Nix store.
      '';
    };

    llm = {
      baseUrl = lib.mkOption {
        type = lib.types.str;
        example = "https://api.openai.com/v1";
        description = "Base URL of an OpenAI-compatible chat completions API.";
      };

      model = lib.mkOption {
        type = lib.types.str;
        example = "gpt-4.1-mini";
        description = "Model Akasha generates the questions with.";
      };

      apiKeyFile = lib.mkOption {
        type = lib.types.nullOr lib.types.path;
        default = null;
        example = "/run/secrets/llm-api-key";
        description = ''
          File containing the API key of the LLM endpoint. It is read through
          systemd credentials, so it may be owned by root. Leave it `null` for
          endpoints without a key, or set `LLM_API_KEY` in {option}`environmentFile`.
        '';
      };
    };

    akasha = {
      port = lib.mkOption {
        type = lib.types.port;
        default = 50051;
        description = "Local gRPC port of Akasha.";
      };

      concurrency = lib.mkOption {
        type = lib.types.ints.positive;
        default = 8;
        description = "Documents Akasha processes in parallel.";
      };

      maxQuestions = lib.mkOption {
        type = lib.types.ints.positive;
        default = 10;
        description = "Questions Akasha generates at most per document.";
      };
    };

    backend.port = lib.mkOption {
      type = lib.types.port;
      default = 8081;
      description = "Local HTTP port of the backend.";
    };

    s3 = {
      port = lib.mkOption {
        type = lib.types.port;
        default = 9000;
        description = "Local port of the RustFS S3 API.";
      };

      bucket = lib.mkOption {
        type = lib.types.str;
        default = "course-materials";
        description = "Bucket the uploaded documents are stored in.";
      };

      package = lib.mkOption {
        type = lib.types.package;
        default = flakePackages.rustfs;
        defaultText = lib.literalExpression "keep-learning-and-nobody-explodes.packages.\${system}.rustfs";
        description = "RustFS package.";
      };
    };

    database = {
      createLocally = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Enable PostgreSQL on this host and create the database and a role
          named after {option}`user`, authenticated over the unix socket.
        '';
      };

      name = lib.mkOption {
        type = lib.types.str;
        default = cfg.user;
        defaultText = lib.literalExpression "config.services.keep-learning-and-nobody-explodes.user";
        description = ''
          Database name. With {option}`database.createLocally` it must equal
          {option}`user` (NixOS grants ownership only to the role of the same name).
        '';
      };

      url = lib.mkOption {
        type = lib.types.str;
        default = "";
        example = "postgres://keep-learning@db.internal/keep-learning";
        description = "PostgreSQL URL, only used without {option}`database.createLocally`.";
      };
    };

    nginx = {
      enableACME = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Request a certificate from Let's Encrypt via the host's
          `security.acme` configuration and redirect HTTP to HTTPS.
        '';
      };

      openFirewall = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Open TCP ports 80 and 443.";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.database.createLocally -> cfg.database.name == cfg.user;
        message = "services.${name}.database.name must equal services.${name}.user when database.createLocally is enabled.";
      }
      {
        assertion = cfg.database.createLocally || cfg.database.url != "";
        message = "services.${name}.database.url must be set when database.createLocally is disabled.";
      }
    ];

    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      home = stateDir;
    };
    users.groups.${cfg.group} = { };

    services.postgresql = lib.mkIf cfg.database.createLocally {
      enable = true;
      ensureDatabases = [ cfg.database.name ];
      ensureUsers = [
        {
          name = cfg.user;
          ensureDBOwnership = true;
        }
      ];
    };

    systemd.services = {
      # Generates the S3 keys and the webhook token once. The names cover both
      # the backend (S3_*, WEBHOOK_TOKEN) and RustFS (RUSTFS_*).
      "${name}-secrets" = {
        description = "Generate the internal secrets of Keep Learning and Nobody Explodes";
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          User = cfg.user;
          Group = cfg.group;
          StateDirectory = name;
          StateDirectoryMode = "0750";
          UMask = "0077";
        };
        path = [ pkgs.openssl ];
        script = ''
          if [ ! -s ${secretsFile} ]; then
            access_key=$(openssl rand -hex 16)
            secret_key=$(openssl rand -hex 32)
            webhook_token=$(openssl rand -hex 32)
            cat > ${secretsFile}.tmp <<EOF
          S3_ACCESS_KEY=$access_key
          S3_SECRET_KEY=$secret_key
          RUSTFS_ACCESS_KEY=$access_key
          RUSTFS_SECRET_KEY=$secret_key
          WEBHOOK_TOKEN=$webhook_token
          RUSTFS_NOTIFY_WEBHOOK_AUTH_TOKEN_PRIMARY=$webhook_token
          EOF
            mv ${secretsFile}.tmp ${secretsFile}
          fi
        '';
      };

      "${name}-backend" = {
        description = "Keep Learning and Nobody Explodes backend";
        wantedBy = [ "multi-user.target" ];
        requires = [ "${name}-secrets.service" ] ++ requiresDatabase;
        after = [
          "network.target"
          "${name}-secrets.service"
        ] ++ databaseUnits;
        # RustFS checks its webhook target on start, so it follows the backend.
        wants = [ "${name}-rustfs.service" ];
        environment = {
          LISTEN_ADDR = "127.0.0.1:${toString cfg.backend.port}";
          MAX_UPLOAD_BYTES = toString cfg.maxUploadBytes;
          DATABASE_URL = databaseUrl;
          S3_ENDPOINT = s3Endpoint;
          S3_BUCKET = cfg.s3.bucket;
          AKASHA_GRPC_URL = "http://127.0.0.1:${toString cfg.akasha.port}";
          AKASHA_LANGUAGE = cfg.language;
          # The OCR models are downloaded on first use.
          XBERG_CACHE_DIR = "/var/cache/${name}/xberg";
          HOME = stateDir;
          RUST_LOG = lib.mkDefault "info";
        };
        serviceConfig = hardening // {
          ExecStart = "${cfg.package}/bin/backend";
          EnvironmentFile = [ secretsFile ] ++ lib.optional (cfg.environmentFile != null) cfg.environmentFile;
          StateDirectory = name;
          StateDirectoryMode = "0750";
          CacheDirectory = name;
          Restart = "on-failure";
          RestartSec = "5s";
        };
      };

      "${name}-akasha" = {
        description = "Keep Learning and Nobody Explodes question generation (Akasha)";
        wantedBy = [ "multi-user.target" ];
        # The backend applies the database migrations Akasha relies on.
        requires = requiresDatabase;
        after = [
          "network-online.target"
          "${name}-backend.service"
        ] ++ databaseUnits;
        wants = [ "network-online.target" ];
        environment = {
          ADDRESS = "127.0.0.1:${toString cfg.akasha.port}";
          CONCURRENCY = toString cfg.akasha.concurrency;
          DATABASE_URL = databaseUrl;
          LLM_BASE_URL = cfg.llm.baseUrl;
          LLM_MODEL = cfg.llm.model;
          PIPELINE_MAX_QUESTIONS = toString cfg.akasha.maxQuestions;
          RUST_LOG = lib.mkDefault "info";
        };
        script = ''
          if [ -n "''${CREDENTIALS_DIRECTORY:-}" ] && [ -f "$CREDENTIALS_DIRECTORY/llm-api-key" ]; then
            LLM_API_KEY=$(< "$CREDENTIALS_DIRECTORY/llm-api-key")
          fi
          # async-openai needs a value even for endpoints without a key.
          export LLM_API_KEY=''${LLM_API_KEY:-none}
          exec ${cfg.package}/bin/akasha
        '';
        serviceConfig = hardening // {
          EnvironmentFile = lib.optional (cfg.environmentFile != null) cfg.environmentFile;
          LoadCredential = lib.optional (cfg.llm.apiKeyFile != null) "llm-api-key:${cfg.llm.apiKeyFile}";
          Restart = "on-failure";
          RestartSec = "5s";
        };
      };

      "${name}-rustfs" = {
        description = "Keep Learning and Nobody Explodes object storage (RustFS)";
        wantedBy = [ "multi-user.target" ];
        requires = [ "${name}-secrets.service" ];
        after = [
          "network.target"
          "${name}-secrets.service"
          "${name}-backend.service"
        ];
        environment = {
          RUSTFS_ADDRESS = "127.0.0.1:${toString cfg.s3.port}";
          RUSTFS_CONSOLE_ENABLE = "false";
          RUSTFS_VOLUMES = "${stateDir}/s3";
          # Upload notifications for the OCR pipeline.
          RUSTFS_NOTIFY_ENABLE = "true";
          RUSTFS_NOTIFY_WEBHOOK_ENABLE_PRIMARY = "on";
          RUSTFS_NOTIFY_WEBHOOK_ENDPOINT_PRIMARY = "${backendOrigin}/events/rustfs";
          RUSTFS_NOTIFY_WEBHOOK_QUEUE_DIR_PRIMARY = "${stateDir}/notify-primary";
          RUSTFS_OUTBOUND_ALLOW_ORIGINS = backendOrigin;
        };
        preStart = ''
          mkdir -p ${stateDir}/s3 ${stateDir}/notify-primary
        '';
        serviceConfig = hardening // {
          ExecStart = "${lib.getExe' cfg.s3.package "rustfs"} server";
          EnvironmentFile = secretsFile;
          StateDirectory = name;
          StateDirectoryMode = "0750";
          LimitNOFILE = 1048576;
          Restart = "on-failure";
          RestartSec = "5s";
        };
      };

      # Creates the bucket and points its upload notifications at the backend (idempotent).
      "${name}-s3-setup" = {
        description = "Configure the Keep Learning and Nobody Explodes bucket";
        wantedBy = [ "multi-user.target" ];
        requires = [ "${name}-rustfs.service" ];
        after = [ "${name}-rustfs.service" ];
        partOf = [ "${name}-rustfs.service" ];
        path = [
          pkgs.awscli2
          pkgs.curl
        ];
        environment = {
          AWS_DEFAULT_REGION = "us-east-1";
          HOME = "/tmp";
        };
        script = ''
          export AWS_ACCESS_KEY_ID=$S3_ACCESS_KEY AWS_SECRET_ACCESS_KEY=$S3_SECRET_KEY
          for _ in $(seq 60); do
            curl -fsS -o /dev/null ${s3Endpoint}/health/ready && break
            sleep 1
          done
          aws --endpoint-url ${s3Endpoint} s3api head-bucket --bucket ${cfg.s3.bucket} 2>/dev/null \
            || aws --endpoint-url ${s3Endpoint} s3api create-bucket --bucket ${cfg.s3.bucket}
          aws --endpoint-url ${s3Endpoint} s3api put-bucket-notification-configuration \
            --bucket ${cfg.s3.bucket} \
            --notification-configuration '{"QueueConfigurations":[{"Id":"ocr-uploads","QueueArn":"arn:rustfs:sqs:us-east-1:primary:webhook","Events":["s3:ObjectCreated:*"],"Filter":{"Key":{"FilterRules":[{"Name":"prefix","Value":"uploads/"}]}}}]}'
        '';
        serviceConfig = hardening // {
          Type = "oneshot";
          RemainAfterExit = true;
          EnvironmentFile = secretsFile;
        };
      };
    };

    services.nginx = {
      enable = true;
      recommendedProxySettings = lib.mkDefault true;
      recommendedTlsSettings = lib.mkDefault true;
      recommendedGzipSettings = lib.mkDefault true;
      recommendedOptimisation = lib.mkDefault true;

      virtualHosts.${cfg.domain} = {
        enableACME = cfg.nginx.enableACME;
        forceSSL = cfg.nginx.enableACME;
        root = cfg.frontendPackage;

        locations = {
          # Single-page app: unknown paths are client-side routes.
          "/".tryFiles = "$uri $uri/ /index.html";

          # Hashed build output never changes under the same name.
          "/assets/".extraConfig = ''
            expires 1y;
            add_header Cache-Control "public, immutable";
          '';

          # The frontend talks to the backend under /backend (VITE_API_URL),
          # including the websockets of the game sessions and the user channel.
          "/backend/" = {
            proxyPass = "${backendOrigin}/";
            proxyWebsockets = true;
            extraConfig = ''
              client_max_body_size ${toString cfg.maxUploadBytes};
              proxy_request_buffering off;
              proxy_read_timeout 1h;
              proxy_send_timeout 1h;
            '';
          };

          # Only RustFS (locally) may deliver upload events.
          "/backend/events/".return = "404";
        };
      };
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.nginx.openFirewall [
      80
      443
    ];
  };
}
