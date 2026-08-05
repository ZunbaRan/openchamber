# Interop Local CRM distribution

Within the acceptance lab, use `../scripts/prepare-local.mjs` before validation
or packing. It stages this complete source under `.runtime/build` and rewrites
the connector from explicit loopback development to the current
`PUBLIC_BASE_URL` (including the random quick-tunnel path). Do not distribute a
server package whose connector still points at the server's loopback address.

Run all commands from the OpenChamber repository root.

## Local development

```bash
node scripts/interactive-ui-extension.mjs validate /absolute/path/to/this-extension
export OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR=/absolute/path/to/this-extension
```

The environment root is a development trust bypass. Do not distribute a production extension as a copied directory.

## Signed package

Create publisher keys once in an offline directory outside this extension and repository:

```bash
node scripts/interactive-ui-extension.mjs keygen /absolute/offline-publisher-keys
```

Create and independently verify the package:

```bash
node scripts/interactive-ui-extension.mjs pack /absolute/path/to/this-extension \
  --out /absolute/dist/com.openchamber.interop.crm-1.0.0.ocix \
  --private-key /absolute/offline-publisher-keys/publisher.private.pem \
  --publisher-id com.example.publisher \
  --publisher-name "Example Publisher" \
  --key-id release-2026

node scripts/interactive-ui-extension.mjs verify /absolute/dist/com.openchamber.interop.crm-1.0.0.ocix

# Optional: independently pin the separately obtained public key.
node scripts/interactive-ui-extension.mjs verify /absolute/dist/com.openchamber.interop.crm-1.0.0.ocix \
  --public-key /absolute/offline-publisher-keys/publisher.public.pem \
  --publisher-id com.example.publisher --key-id release-2026
```

In OpenChamber, open **Settings → Interactive UI Extensions** and choose the `.ocix` file. OpenChamber verifies the embedded publisher key and signed contents, then shows the publisher fingerprint, packaged Agent Tools/Skills, Interactive UI/HTML Artifact counts, Agent routing domain/intents/data authority, network permissions, sandboxed-HTML status, and Native-code status. Compare the fingerprint through an independent channel and confirm **Trust and install**.

After installation, configure **Business connections** on the same page. The starter uses managed `api-key` authentication: create a least-privilege key in the third-party system and save it there. OpenChamber stores the key only on its server, injects it into declared Gateway requests, and never returns it to extension UI or Agent output. A provider that supports one-time setup-code exchange can instead declare `issued-key`; see `docs/OCIX_CONNECTOR_AUTHENTICATION_V1.md`.

Keep `publisher.private.pem` offline. Never copy it, `.env`, API tokens, or business credentials into this extension.

## Agent runtime

Installing `.ocix` on the machine running OpenChamber installs both halves:

- Interactive UI, sandboxed HTML Artifact, manifest, and Business Gateway declarations remain in the OpenChamber managed version store.
- Tool files are managed in `~/.config/opencode/tools`; Skills are managed in `~/.config/opencode/skills`.
- Enable, disable, update, rollback, and uninstall synchronize those files and refresh managed OpenCode.
- The enabled manifest contributes its bounded Agent routing metadata to OpenChamber's per-prompt capability context. Keep the business Tool descriptions, `agentRouting`, `views[].routing`, and `artifacts[].routing` aligned; never use generic `interactive_ui` or `html_artifact` as a fake-data fallback for this connected module.

Do not set a per-extension `OPENCODE_CONFIG_DIR`, and do not manually copy Agent files after a managed install. Tool and Skill names must be globally unique; OpenChamber refuses to overwrite user-owned or another extension's files. If OpenChamber connects to an external OpenCode server on another machine, its Agent Runtime still must be deployed through that server's administration channel.
