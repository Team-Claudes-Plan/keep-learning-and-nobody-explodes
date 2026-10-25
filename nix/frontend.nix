# Static production build of the frontend (frontend/), ready to be served by nginx.
#
# Bun cannot fetch inside the sandbox, so the dependencies are a fixed-output
# derivation. After changing frontend/bun.lock, set `hash = lib.fakeHash;`,
# build once and paste the hash from the error message.
{
  lib,
  stdenvNoCC,
  bun,
  nodejs,
  # Base URL of the backend as seen from the browser. The NixOS module proxies
  # /backend/* to the backend, like the Vite dev proxy does.
  apiUrl ? "/backend",
}:

let
  src = lib.fileset.toSource {
    root = ../frontend;
    fileset = lib.fileset.difference ../frontend (
      lib.fileset.unions (
        map lib.fileset.maybeMissing [
          ../frontend/node_modules
          ../frontend/dist
          ../frontend/test-results
          ../frontend/playwright-report
        ]
      )
    );
  };

  # Bun's platform names for the native bindings (rolldown, oxlint).
  bunPlatform =
    {
      x86_64-linux = { os = "linux"; cpu = "x64"; };
      aarch64-linux = { os = "linux"; cpu = "arm64"; };
      x86_64-darwin = { os = "darwin"; cpu = "x64"; };
      aarch64-darwin = { os = "darwin"; cpu = "arm64"; };
    }
    .${stdenvNoCC.hostPlatform.system};

  nodeModules = stdenvNoCC.mkDerivation {
    pname = "keep-learning-and-nobody-explodes-frontend-deps";
    version = "0.1.0";
    src = lib.fileset.toSource {
      root = ../frontend;
      fileset = lib.fileset.unions [
        ../frontend/package.json
        ../frontend/bun.lock
      ];
    };

    nativeBuildInputs = [ bun ];

    dontConfigure = true;
    dontFixup = true;

    buildPhase = ''
      runHook preBuild
      export HOME=$TMPDIR
      bun install --frozen-lockfile --ignore-scripts --no-progress \
        --os=${bunPlatform.os} --cpu=${bunPlatform.cpu}
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -R node_modules $out/
      runHook postInstall
    '';

    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash =
      {
        x86_64-linux = "sha256-XOX5dV91YqPZBdbr7nkxQkKrgZ/kSj72U3fBpOH0KbI=";
        aarch64-linux = "sha256-q3A5KmHZLQp3sds7bJ38b6VGgI9HzmBElpUVZmRmXBk=";
      }
      .${stdenvNoCC.hostPlatform.system} or lib.fakeHash;
  };
in
stdenvNoCC.mkDerivation {
  pname = "keep-learning-and-nobody-explodes-frontend";
  version = "0.1.0";
  inherit src;

  nativeBuildInputs = [
    bun
    nodejs
  ];

  env.VITE_API_URL = apiUrl;

  configurePhase = ''
    runHook preConfigure
    cp -R ${nodeModules}/node_modules .
    chmod -R u+w node_modules
    patchShebangs node_modules
    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild
    export HOME=$TMPDIR
    bun run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cp -R dist $out
    runHook postInstall
  '';

  passthru = { inherit nodeModules; };
}
