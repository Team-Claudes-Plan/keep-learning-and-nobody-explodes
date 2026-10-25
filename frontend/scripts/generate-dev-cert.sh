#!/usr/bin/env bash
# Creates a local development CA and an HTTPS certificate for the Vite dev server.
#
# The CA is only for your own devices on your own network. Install the CA on the phone once,
# then Vite can serve https://<lan-ip>:5173 so 8th Wall gets the secure context it needs.
#
# Run from frontend/: npm run cert
set -euo pipefail

cd "$(dirname "$0")/.."

CERT_DIR="${CERT_DIR:-certs}"
CA_DAYS="${CA_DAYS:-3650}"
SERVER_DAYS="${SERVER_DAYS:-825}"

mkdir -p "$CERT_DIR"

# ----- Root CA (created once, reused for later certificates) ------------------------------------

if [[ ! -f "$CERT_DIR/ca.key" || ! -f "$CERT_DIR/ca.crt" ]]; then
  echo "Creating a new local development CA …"
  openssl genrsa -out "$CERT_DIR/ca.key" 4096
  chmod 600 "$CERT_DIR/ca.key"
  openssl req -x509 -new -key "$CERT_DIR/ca.key" -sha256 -days "$CA_DAYS" \
    -subj "/C=DE/O=Keep Learning Local Dev/CN=Keep Learning Local Dev CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -out "$CERT_DIR/ca.crt"
else
  echo "Reusing the existing local development CA."
fi

# ----- Names the certificate is valid for ------------------------------------------------------

LOCAL_HOST="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"
DNS_NAMES=("localhost" "${LOCAL_HOST}.local" "$(hostname)" "*.local" "*.fritz.box")
IPS=("127.0.0.1")

if [[ "$(uname -s)" == "Darwin" ]]; then
  # Every IPv4 address (Wi-Fi, USB-Ethernet, Thunderbolt bridge, …), so the phone can use
  # whichever interface is on the same network.
  while IFS= read -r ip; do
    [[ -n "$ip" ]] && IPS+=("$ip")
  done < <(ifconfig | awk '/inet / && $2 != "127.0.0.1" { print $2 }')
else
  # Linux fallback for people not on macOS.
  for ip in $(hostname -I 2>/dev/null || true); do
    IPS+=("$ip")
  done
fi

SAN_PARTS=()
for name in "${DNS_NAMES[@]}"; do SAN_PARTS+=("DNS:$name"); done
for ip in "${IPS[@]}"; do SAN_PARTS+=("IP:$ip"); done
SAN="$(printf '%s\n' "${SAN_PARTS[@]}" | awk '!seen[$0]++' | paste -sd, -)"

# ----- Server certificate, signed by the local CA ---------------------------------------------

cat > "$CERT_DIR/server.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$SAN
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
EOF

openssl genrsa -out "$CERT_DIR/server.key" 2048
chmod 600 "$CERT_DIR/server.key"
openssl req -new -key "$CERT_DIR/server.key" \
  -subj "/C=DE/O=Keep Learning Local Dev/CN=${LOCAL_HOST}.local" \
  -out "$CERT_DIR/server.csr"
openssl x509 -req -in "$CERT_DIR/server.csr" \
  -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
  -out "$CERT_DIR/server.crt" -days "$SERVER_DAYS" -sha256 \
  -extfile "$CERT_DIR/server.ext"
rm -f "$CERT_DIR/server.csr" "$CERT_DIR/server.ext"

# A friendly file name for AirDrop / the phone's certificate installer.
cp "$CERT_DIR/ca.crt" "$CERT_DIR/keep-learning-local-ca.crt"

# ----- iOS profile with the CA -----------------------------------------------------------------
# The certificate still has to be fully trusted after installing the profile:
# Settings > General > About > Certificate Trust Settings.

CA_BASE64="$(base64 < "$CERT_DIR/ca.crt" | tr -d '\n')"
PROFILE_UUID="$(uuidgen)"
CERT_UUID="$(uuidgen)"

cat > "$CERT_DIR/keep-learning-local-ca.mobileconfig" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>keep-learning-local-ca.crt</string>
      <key>PayloadContent</key>
      <data>$CA_BASE64</data>
      <key>PayloadDescription</key>
      <string>Trusts the local HTTPS certificate used by the Keep Learning dev server.</string>
      <key>PayloadDisplayName</key>
      <string>Keep Learning Local Dev CA</string>
      <key>PayloadIdentifier</key>
      <string>dev.keep-learning.local-ca</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>$CERT_UUID</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Local HTTPS development certificate for the Keep Learning AR demo.</string>
  <key>PayloadDisplayName</key>
  <string>Keep Learning Local Dev CA</string>
  <key>PayloadIdentifier</key>
  <string>dev.keep-learning.profile</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>$PROFILE_UUID</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
EOF

# ----- Summary ---------------------------------------------------------------------------------

{
  echo "Keep Learning – local HTTPS for the AR demo"
  echo
  echo "1. Start the dev server:  npm run dev"
  echo "2. AirDrop ONE of these files to the phone:"
  echo "   iOS:           $(pwd)/$CERT_DIR/keep-learning-local-ca.mobileconfig"
  echo "   iOS / Android: $(pwd)/$CERT_DIR/keep-learning-local-ca.crt"
  echo
  echo "3. Install the profile/certificate, then on iOS enable full trust:"
  echo "   Settings > General > About > Certificate Trust Settings."
  echo
  echo "4. Open one of these URLs on the phone (same Wi-Fi as the Mac):"
  for name in "${DNS_NAMES[@]}"; do
    [[ "$name" == \*.* ]] && continue
    echo "   https://$name:5173/ar-demo"
  done
  for ip in "${IPS[@]}"; do echo "   https://$ip:5173/ar-demo"; done
  echo
  echo "If Vite starts on another port, use the URL it prints."
  echo "After a network change run 'npm run cert' again."
  echo
  echo "NEVER send ca.key or server.key. Only the CA certificate/profile belongs on the phone."
} > "$CERT_DIR/README.txt"

echo
echo "Certificate created."
echo "  Server key:     $CERT_DIR/server.key  (private, never share)"
echo "  Server cert:    $CERT_DIR/server.crt"
echo "  Local CA:       $CERT_DIR/ca.crt      (private key next to it, never share ca.key)"
echo
echo "Send ONE of these to the phone (AirDrop / email):"
echo "  iOS:            $CERT_DIR/keep-learning-local-ca.mobileconfig"
echo "  iOS / Android:  $CERT_DIR/keep-learning-local-ca.crt"
echo
echo "Valid for:"
for name in "${DNS_NAMES[@]}"; do
  [[ "$name" == \*.* ]] && continue
  echo "  https://$name:5173"
done
for ip in "${IPS[@]}"; do echo "  https://$ip:5173"; done
echo
echo "Start the dev server with: npm run dev"
echo "On iOS, enable full trust afterwards: Settings > General > About > Certificate Trust Settings."
