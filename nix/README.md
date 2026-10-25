# Nix

Nix expressions for building and hosting the project. The dev environment
itself (`nix develop`, `nix run .#dev`) is defined in the root
[`flake.nix`](../flake.nix).

## What happens here

- [`frontend.nix`](frontend.nix): static production build of the frontend
  (`packages.frontend`), with the backend expected under `/backend`.
- [`module.nix`](module.nix): the NixOS module
  `services.keep-learning-and-nobody-explodes` (`nixosModules.default`).
- [`test.nix`](test.nix): a NixOS VM test of the module
  (`checks.x86_64-linux.nixos-module`).

## Why it is needed

The app consists of five parts: frontend, backend, Akasha, RustFS and
PostgreSQL. The module wires all of them together on a single NixOS host, so
hosting the app takes one `enable` instead of hand-written systemd units, nginx
config and secrets.

## Hosting on NixOS

With `services.keep-learning-and-nobody-explodes.enable = true;` the module sets up:

| Part | Runs as | Reachable at |
|---|---|---|
| frontend | static files served by the host's nginx | `https://<domain>/` |
| backend | `keep-learning-and-nobody-explodes-backend.service` | `127.0.0.1:8081`, public as `https://<domain>/backend/` (incl. websockets) |
| Akasha | `keep-learning-and-nobody-explodes-akasha.service` | `127.0.0.1:50051` |
| RustFS (S3) | `keep-learning-and-nobody-explodes-rustfs.service` | `127.0.0.1:9000` |
| PostgreSQL | the host's `services.postgresql` | unix socket, peer authentication |

- Only nginx listens publicly. It gets a Let's Encrypt certificate through the
  host's `security.acme` settings and redirects HTTP to HTTPS.
- The S3 keys and the webhook token are generated on first start and stored in
  `/var/lib/keep-learning-and-nobody-explodes/secrets.env`. Uploads are stored in
  `/var/lib/keep-learning-and-nobody-explodes/s3`.
- The upload webhook (`/backend/events/`) is not reachable from outside.
- The OCR models are downloaded on first use into
  `/var/cache/keep-learning-and-nobody-explodes`, so the host needs outbound
  internet access. So does Akasha, unless the LLM endpoint is local.

### Host flake

```nix
# /etc/nixos/flake.nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    keep-learning-and-nobody-explodes.url = "github:Team-Claudes-Plan/keep-learning-and-nobody-explodes";
  };

  outputs = { nixpkgs, keep-learning-and-nobody-explodes, ... }: {
    nixosConfigurations.my-host = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ./configuration.nix
        keep-learning-and-nobody-explodes.nixosModules.default
        {
          services.keep-learning-and-nobody-explodes = {
            enable = true;
            domain = "learn.example.org";
            nginx.openFirewall = true;
            llm = {
              baseUrl = "https://api.openai.com/v1";
              model = "gpt-4.1-mini";
              apiKeyFile = "/run/secrets/llm-api-key";
            };
          };

          security.acme = {
            acceptTerms = true;
            defaults.email = "admin@example.org";
          };
        }
      ];
    };
  };
}
```

Pin a branch or commit with
`github:Team-Claudes-Plan/keep-learning-and-nobody-explodes/<ref>`. Run
`nix flake update keep-learning-and-nobody-explodes` to pull a newer version.
The packages are built with this repository's pinned nixpkgs, independent of
the host's.

### Plain `configuration.nix`

This works without a host flake, as long as flakes are enabled
(`nix.settings.experimental-features = [ "nix-command" "flakes" ];`):

```nix
# /etc/nixos/configuration.nix
{ ... }:

let
  keep-learning-and-nobody-explodes = builtins.getFlake
    "github:Team-Claudes-Plan/keep-learning-and-nobody-explodes/<commit>";
in
{
  imports = [ keep-learning-and-nobody-explodes.nixosModules.default ];

  services.keep-learning-and-nobody-explodes = {
    enable = true;
    domain = "learn.example.org";
    nginx.openFirewall = true;
    llm = {
      baseUrl = "https://api.openai.com/v1";
      model = "gpt-4.1-mini";
      apiKeyFile = "/run/secrets/llm-api-key";
    };
  };

  security.acme = {
    acceptTerms = true;
    defaults.email = "admin@example.org";
  };
}
```

`builtins.getFlake` needs a locked reference (a commit hash) in pure
evaluation. With a branch name, build with `nixos-rebuild switch --impure`.

### Options

| Option | Default | Description |
|---|---|---|
| `enable` | `false` | enable the whole stack |
| `domain` | — | public domain of the nginx virtual host |
| `llm.baseUrl`, `llm.model` | — | OpenAI-compatible endpoint and model for Akasha |
| `llm.apiKeyFile` | `null` | file with the API key, read as a systemd credential |
| `language` | `"german"` | language of the generated questions (`german`, `english`) |
| `nginx.enableACME` | `true` | TLS via Let's Encrypt and redirect to HTTPS |
| `nginx.openFirewall` | `false` | open ports 80 and 443 |
| `maxUploadBytes` | 256 MiB | upload limit of the backend and nginx |
| `environmentFile` | `null` | extra environment for backend and Akasha (e.g. `RUST_LOG`) |
| `database.createLocally` | `true` | use the host's PostgreSQL; otherwise set `database.url` |
| `akasha.concurrency`, `akasha.maxQuestions` | `8`, `10` | Akasha's parallelism and questions per document |
| `backend.port`, `akasha.port`, `s3.port` | `8081`, `50051`, `9000` | local ports |
| `user`, `group` | `keep-learning` | system user of all services and PostgreSQL role |

All options are under `services.keep-learning-and-nobody-explodes`. To change the
virtual host further, set `services.nginx.virtualHosts."<domain>"` in the host
configuration; NixOS merges it with the module's settings.

### Operating

```bash
systemctl status 'keep-learning-and-nobody-explodes-*'
journalctl -fu keep-learning-and-nobody-explodes-akasha
```

## Development

```bash
nix build .#server     # backend and akasha binaries
nix build .#frontend   # static frontend
nix build .#checks.x86_64-linux.nixos-module   # VM test of the module
```

The frontend's dependencies are a fixed-output derivation. After changing
`frontend/bun.lock`, replace the hash in [`frontend.nix`](frontend.nix) with
`lib.fakeHash`, build, and paste the hash from the error message. Only
`x86_64-linux` has a hash so far.
