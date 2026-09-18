# CpIPOS Desktop v0.3.0 — Offline License Flow

This document is the operational checklist for CUTTING POINT TECH IT when issuing an offline license for CpIPOS Desktop v0.3.0.

## Security model

- Desktop verifies licenses offline with ECDSA P-256 / SHA-256.
- The desktop application contains only the public key.
- The private signing key must exist only in the IT backoffice server environment.
- Never commit the private key to GitHub and never ship it inside the desktop installer.
- The IT issuer refuses to issue licenses if the configured private key does not match the public key embedded in CpIPOS Desktop v0.3.0.
- Product ID: `CPIPOS-DESKTOP`.
- Issuer ID: `CUTTING-POINT-TECH-IT`.
- Supported device count per license: 1 or 2.

Expected desktop public-key fingerprint:

`4DF3:AB73:4E41:1F54:4E17:A082:851A:597F:BA08:331D:A7AF:7EAD:1D51:7970:635D:5295`

## Configure the IT signing key

The production issuer first checks server environment secrets and then falls back to the protected Supabase Vault signer slot `cpipos_license_signing_seed_v030`.

Optional environment overrides:
- `CPIPOS_LICENSE_PRIVATE_KEY_PEM`
- `CPIPOS_LICENSE_PRIVATE_KEY_BASE64`

Environment overrides must not use a `NEXT_PUBLIC_` prefix.

After configuring the key, open the IT Admin backoffice and navigate to:

`IT Admin -> Packages & Access -> Issue POS Desktop License`

The page must show that the private key is configured. If the private key does not match the v0.3.0 desktop public key, the issuer is treated as unavailable and the API fails closed.

## Issue a license

1. Install or run CpIPOS Desktop v0.3.0 on the customer Windows PC.
2. Open the license screen and copy the `Device Code` exactly.
3. In IT Admin, open `Issue POS Desktop License`.
4. Enter the customer/store name.
5. Select the package.
6. Select 1 or 2 devices.
7. Paste each Device Code exactly. Device Codes must be unique.
8. Choose the activation date.
9. Choose the term: perpetual, 30 days, 365 days, or a custom expiry date.
10. Select the allowed features.
11. Press `Issue license`.
12. Copy the generated `CP1.<payload>.<signature>` token.
13. Paste that token into CpIPOS Desktop and press verify/activate.

## Desktop behavior

CpIPOS Desktop v0.3.0 validates all of the following locally without an internet connection:

- digital signature validity;
- product ID;
- issuer ID;
- device count policy;
- whether the current Device Code is present in the signed device list;
- activation date (`notBefore`);
- expiry date (`expiresAt`);
- basic clock rollback protection.

If no valid license is installed, the program can operate only during the configured trial period. After the trial ends, the license gate locks the application until a valid IT-issued license for that device is entered.

## End-to-end acceptance test before release

Do not publish the v0.3.0 installer until all tests below pass on a real Windows machine.

### One-device license

- Run Desktop on PC A and copy Device Code A.
- Issue a one-device license containing only Device Code A.
- Activate on PC A: must pass.
- Try the same license on PC B: must fail with device-not-allowed.

### Two-device license

- Copy Device Code A and Device Code B.
- Issue one license containing both codes.
- Activate on both machines: both must pass.
- Try the same license on PC C: must fail.

### Expiry

- Issue a short/custom-expiry test license.
- Confirm it works before expiry.
- Confirm Desktop rejects it after expiry.

### Tamper test

- Change one character inside the token.
- Desktop must reject the license signature.

### Wrong signing key test

- Configure a different private key in a test environment.
- The IT license issuer status must report unavailable / key mismatch.
- The POST issuer endpoint must refuse to issue a desktop license.

## Release sequence

1. IT backoffice CI is green.
2. Desktop CI is green.
3. IT private key is configured in the target server environment.
4. One-device and two-device end-to-end tests pass.
5. Trial lock, expiry, wrong-device, and tamper tests pass.
6. Run the Desktop UI locally on Windows and complete manual POS QA.
7. Only then create the v0.3.0 Windows installer/release and publish the download link.
