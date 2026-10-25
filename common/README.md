# Common

Code and definitions shared by the Rust services ([backend](../backend/) and
[Akasha](../akasha/)).

## What happens here

- [`proto/`](proto/) — protobuf sources of the service interfaces, currently
  `akasha.proto` (backend → Akasha: `ManifestTrials` with the document id,
  island id/name, language and extracted text).
- [`grpc/`](grpc/) — the `grpc` crate. Its `build.rs` compiles the `.proto`
  files into Rust client and server code (tonic/prost) at build time. Edit the
  `.proto` files, never the generated code; `protoc` is needed outside the Nix
  shell.
- [`config/`](config/) — the `config` crate with the `define_config!` macro,
  which reads a typed configuration with defaults from environment variables
  and reports missing or malformed values clearly.

## Why it is needed

Both services must agree on the same interface and should handle
configuration the same way. Keeping it in one place avoids drift between the
client and the server of the gRPC call and duplicated boilerplate.
