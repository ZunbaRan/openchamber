# OCIX signed distribution contract

Load this reference for signing, packaging, installation, lifecycle, or marketplace work.

## Trust model

- Development roots configured with `OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR` are an explicit local-development bypass. Do not present them as production installation.
- Managed extensions must arrive as signed `.ocix` packages. The Ed25519 package signature covers extension identity, publisher identity, timestamp, and every file path, byte length, and SHA-256 hash.
- New packages embed the publisher public key inside the signed index. OpenChamber first verifies that the package is internally consistent, then shows publisher identity, key id, fingerprint, Tool/Skill inventory, Interactive UI/HTML Artifact surface counts, network permissions, sandboxed-HTML status, and Native-code status for explicit confirmation. The embedded key does not prove real-world identity; compare its fingerprint through an independent channel for production.
- Signed marketplace catalogs likewise embed their marketplace public key. Adding a catalog requires only its URL plus an explicit fingerprint confirmation; a trusted catalog can delegate package publisher keys.
- Trusted Native runs in the OpenChamber page. A signature proves origin and integrity; it does not sandbox or certify the code.
- Keep private keys outside extension directories, repositories, `.ocix` files, logs, screenshots, and OpenChamber data directories.

## Commands

```bash
node scripts/interactive-ui-extension.mjs keygen /absolute/offline-key-directory

node scripts/interactive-ui-extension.mjs pack /absolute/extension \
  --out /absolute/dist/extension-1.0.0.ocix \
  --private-key /absolute/offline-key-directory/publisher.private.pem \
  --publisher-id com.acme.publisher \
  --publisher-name "Acme" \
  --key-id release-2026

node scripts/interactive-ui-extension.mjs verify /absolute/dist/extension-1.0.0.ocix

# Optional independent key pin:
node scripts/interactive-ui-extension.mjs verify /absolute/dist/extension-1.0.0.ocix \
  --public-key /absolute/offline-key-directory/publisher.public.pem \
  --publisher-id com.acme.publisher --key-id release-2026
```

`pack` runs the extension validator first. It refuses `.env`, private-key PEM, symlinks, path traversal, excess files, and oversized content. Never bypass a failed validator by hand-building a ZIP.

## Managed lifecycle

Use **Settings → Interactive UI Extensions** to:

1. Choose a `.ocix`; OpenChamber verifies its embedded signing key and signed file index before extraction.
2. Review the publisher fingerprint, Agent Tools/Skills, Interactive UI/HTML Artifact inventory, network origins, sandboxed-HTML capability, and Native-code permission, then confirm trust and installation.
3. Installation validates in staging, moves the signed source to the managed version store, copies Tools to `~/.config/opencode/tools`, deploys Skills to `~/.config/opencode/skills`, commits ownership hashes, and refreshes managed OpenCode.
4. Configure each authenticated Connector under **Business connections**. This secret is separate from the publisher signing key and never belongs in the `.ocix` package.
5. Disable an extension to remove its UI and managed Agent Runtime without deleting installed versions or its connection configuration; enable restores both.
6. Install a higher semantic version to update while retaining the previous active version; rollback repoints both UI and Agent Runtime.
7. Uninstall removes managed global Agent files, moves extension sources to recoverable trash, and deletes the extension's stored Connector credentials.

Global Agent files are owned by the extension manager. Installation must fail without overwriting when a Tool or Skill target is user-owned, modified outside OpenChamber, or already owned by another enabled OCIX. Multiple extensions coexist in the shared directories; no extension-specific `OPENCODE_CONFIG_DIR` is used.

The manager also persists the signed OCIX file index for each installed version and re-hashes the managed source before exposing an enabled extension to the runtime. A missing or mismatched record fails closed; reinstall the version after investigating tampering.

When changing manager persistence, test successful round trips and injected state-write failure cleanup. Never expose public-key PEM, local managed paths, tokens, or private keys in manager API responses.

## Signed static marketplace

An entry array contains extension identity, package HTTPS URL, package `sha256-...`, and publisher `{id,name,keyId,publicKey}`. Generate a signed catalog:

```bash
node scripts/interactive-ui-extension.mjs catalog /absolute/entries.json \
  --out /absolute/public/catalog.json \
  --private-key /absolute/offline-market-keys/publisher.private.pem \
  --marketplace-id com.acme.marketplace \
  --marketplace-name "Acme Marketplace" \
  --key-id catalog-2026
```

Host `catalog.json` and `.ocix` packages on HTTPS static storage. The client first self-verifies the embedded marketplace key and asks the user to confirm its fingerprint. After trust, it verifies, in order: stored marketplace identity/key, catalog signature, package URL policy, downloaded package hash, catalog-delegated publisher key, and package signature/file index.

Extension Manager compares catalog semantic versions with the active managed version. An exact match is disabled as Installed; a greater version is offered as Update; older catalog entries remain installable only as an explicit version choice. The installed-extension diagnostics disclosure shows the managed install source, Tool names, Skill names, signed package hash, and unresolved surface Tool bindings without exposing file contents or credentials.

Do not call a static deployment an officially operated marketplace. Account systems, submissions, payment, review, malware analysis, key revocation, transparency logs, takedowns, CDN operations, and SLA are separate service governance.
