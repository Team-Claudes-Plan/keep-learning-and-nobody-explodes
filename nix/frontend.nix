# Static production build of the frontend (frontend/), ready to be served by nginx.
#
# The dependencies come from frontend/bun.nix, which bun2nix generates from
# frontend/bun.lock: one fetchurl per package, hashed with the lockfile's own
# integrity hashes. `bun install` regenerates it (postinstall script), so commit
# bun.nix together with bun.lock. No hashes need to be maintained by hand.
{
  lib,
  stdenvNoCC,
  bun2nix,
  # Base URL of the backend as seen from the browser. The NixOS module proxies
  # /backend/* to the backend, like the Vite dev proxy does.
  apiUrl ? "/backend",
}:

stdenvNoCC.mkDerivation {
  pname = "keep-learning-and-nobody-explodes-frontend";
  version = "0.1.0";

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

  nativeBuildInputs = [ bun2nix.hook ];

  bunDeps = bun2nix.fetchBunDeps { bunNix = ../frontend/bun.nix; };

  # No dependency needs an install script, and the project's own postinstall
  # (regenerating bun.nix) has no business in the build.
  dontRunLifecycleScripts = true;

  env.VITE_API_URL = apiUrl;

  buildPhase = ''
    runHook preBuild
    bun run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cp -R dist $out
    runHook postInstall
  '';
}
