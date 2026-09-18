# CpIPOS Desktop Offline License Issuer

This IT Admin module issues offline licenses for `cp-ipos-desktop` v0.3.x.

## Security boundary

- The desktop application contains only the ECDSA P-256 public key.
- The matching private key belongs to CUTTING POINT TECH IT only.
- Never commit the private key, upload it as a public file, ship it with the installer, or expose it with a `NEXT_PUBLIC_` environment variable.
- Production can use the protected Supabase Vault slot `cpipos_license_signing_seed_v030`; server environment variables `CPIPOS_LICENSE_PRIVATE_KEY_PEM` / `CPIPOS_LICENSE_PRIVATE_KEY_BASE64` remain supported as an override.
- The browser sends license metadata to the authenticated IT-only API. Signing happens on the server.

## Backoffice flow

1. Open IT Control Plane.
2. Choose `ออก License POS Desktop` / `Issue POS Desktop License`.
3. Ask the customer to open the License screen in CpIPOS Desktop and send the exact Device Code.
4. Enter customer/store name and choose the commercial plan.
5. Select one or two devices and enter the Device Codes.
6. Choose activation date and either perpetual, 30-day, 365-day, or a custom expiry.
7. Select allowed feature metadata.
8. Click `สร้าง License` / `Issue license`.
9. Copy the generated `CP1...` token or download the `.txt` file.
10. Paste that token into CpIPOS Desktop on an approved device.

## Signed payload contract

The issuer signs this payload shape using ECDSA P-256 + SHA-256 with IEEE-P1363 signature encoding:

```json
{
  "v": 1,
  "product": "CPIPOS-DESKTOP",
  "issuer": "CUTTING-POINT-TECH-IT",
  "licenseId": "CP-YYYYMMDD-XXXXXXXX",
  "customer": "Example Store",
  "plan": "Offline Standard",
  "issuedAt": "ISO-8601",
  "notBefore": "ISO-8601",
  "expiresAt": null,
  "maxDevices": 1,
  "devices": ["CP-AAAAA-BBBBB-CCCCC-DDDDD"],
  "features": ["offline-pos", "inventory", "reports"]
}
```

The final token is:

```text
CP1.<base64url-json-payload>.<base64url-ecdsa-signature>
```

CpIPOS Desktop verifies the signature locally and rejects a modified payload, wrong issuer/product, an unlisted Device Code, a license used before `notBefore`, or an expired license.

## One-device and two-device rules

The actual number of Device Codes entered becomes the signed `maxDevices` value. A token with one Device Code works only on that machine. A token with two Device Codes works only on those two machines. Copying the token to a third machine fails local device validation.

## Rotation and emergency response

If the private key is suspected to be exposed, stop issuing licenses, remove the environment secret, generate a new keypair, ship a new desktop build with the new public key, and reissue licenses. Fully offline licenses cannot be remotely revoked after they have been issued; expiry dates and future optional online check-ins are the available control points.

## Release checklist for Desktop v0.3.0

- IT issuer builds and authenticates correctly.
- Real server signing key is configured outside GitHub.
- Generate a test one-device license and verify activation on Windows.
- Confirm the same token is rejected on a different Device Code.
- Generate an expired license and verify the desktop locks.
- Generate a two-device license and verify only those two Device Codes pass.
- Run Desktop frontend build, SQLite smoke test, Rust check, and Windows installer build.
- Only then tag/release `v0.3.0`.
