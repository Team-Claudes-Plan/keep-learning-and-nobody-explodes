# VM test of the NixOS module: `nix build .#checks.x86_64-linux.nixos-module`.
#
# Boots the whole stack without TLS, then checks the frontend, the proxied API
# and the upload path through RustFS and its webhook into the database. No LLM
# is reachable, so question generation itself is not covered.
{ self, pkgs }:

pkgs.testers.runNixOSTest {
  name = "keep-learning-and-nobody-explodes";

  nodes.machine = {
    imports = [ self.nixosModules.default ];

    virtualisation.memorySize = 4096;
    virtualisation.diskSize = 4096;

    services.keep-learning-and-nobody-explodes = {
      enable = true;
      domain = "localhost";
      nginx.enableACME = false;
      llm = {
        baseUrl = "http://127.0.0.1:1/v1";
        model = "test";
      };
    };
  };

  testScript = ''
    import json

    machine.wait_for_unit("keep-learning-and-nobody-explodes-backend.service")
    machine.wait_for_unit("keep-learning-and-nobody-explodes-akasha.service")
    machine.wait_for_unit("keep-learning-and-nobody-explodes-s3-setup.service")
    machine.wait_for_unit("nginx.service")
    machine.wait_for_open_port(80)

    with subtest("services bind to localhost only"):
        listening = machine.succeed("ss -tlnH")
        for port in ["8081", "9000", "50051"]:
            assert f"127.0.0.1:{port}" in listening, listening
            assert f"0.0.0.0:{port}" not in listening, listening

    with subtest("frontend and client-side routes"):
        machine.succeed("curl -fsS http://localhost/ | grep -q '<div id=\"root\"'")
        machine.succeed("curl -fsS http://localhost/islands | grep -q '<div id=\"root\"'")

    with subtest("API through the /backend proxy"):
        machine.wait_until_succeeds("curl -fsS http://localhost/backend/health")
        user = json.loads(machine.succeed(
            "curl -fsS -X PUT -H 'Content-Type: application/json' "
            "-d '{\"name\": \"Ada\"}' http://localhost/backend/api/users/create"
        ))["id"]
        island = json.loads(machine.succeed(
            f"curl -fsS -X PUT -H 'Content-Type: application/json' -H 'X-User-Id: {user}' "
            "-d '{\"name\": \"Physics\"}' http://localhost/backend/api/islands/create"
        ))["id"]

    with subtest("webhook endpoint is not public"):
        machine.succeed(
            "test $(curl -s -o /dev/null -w '%{http_code}' -X POST "
            "http://localhost/backend/events/rustfs) = 404"
        )

    with subtest("upload reaches the database through RustFS and the webhook"):
        machine.succeed("echo 'Newton: F = m * a' > /tmp/notes.txt")
        machine.succeed(
            f"curl -fsS -H 'X-User-Id: {user}' -F 'file=@/tmp/notes.txt' "
            f"'http://localhost/backend/upload?island_id={island}'"
        )
        machine.wait_until_succeeds(
            "sudo -u keep-learning psql -d keep-learning -Atc "
            f"\"SELECT count(*) FROM documents WHERE island_id = '{island}'\" | grep -qx 1",
            timeout=60,
        )
  '';
}
