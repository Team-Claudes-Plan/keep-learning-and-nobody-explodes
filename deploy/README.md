# Deploy

Supporting files for running the complete stack with
[`docker-compose.yml`](../docker-compose.yml).

## What happens here

- [`init-storage.sh`](init-storage.sh): run once by the `storage-init` service.
  It creates the upload bucket in RustFS and registers the webhook that tells
  the backend about every new upload, which starts OCR and question generation.
- [`nginx.example.conf`](nginx.example.conf): an example reverse proxy on the
  host in front of the frontend container, with the websocket upgrade the game
  sessions need.

## Why it is needed

The containers come up empty. Without the bucket and its notification
configuration, uploads would be stored but never processed. The compose stack
serves plain HTTP on `127.0.0.1:8080`. For a public host, the example nginx
config puts a real domain (and TLS via certbot) in front of it.

For NixOS hosts, use the module in [`../nix/`](../nix/) instead.
