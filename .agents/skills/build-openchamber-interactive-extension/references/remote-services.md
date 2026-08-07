# Direct Remote service checklist

Use this reference when the user wants a URL+Access-Key Remote app rather than a Local or Hosted thin `.ocix` package.

The authoritative executable guide is `docs/OCIX_REMOTE_SERVICE_DEVELOPER_GUIDE.md`. Read it before editing a Remote service.

## Non-negotiable contract

- The app entry URL returns one signed `openchamber://hosted-ocix-manifest/v1` document with an embedded Ed25519 publisher envelope. There is no `.ocix` package and no unsigned handshake.
- Sign recursively key-sorted canonical JSON without the `signature` field. `publisher.keyId` equals `signature.keyId`.
- Keep the private key outside the service source, repository, artifact directory, logs, screenshots, and client data directory.
- Direct Remote currently declares exactly one `api-key` HTTP Connector.
- The Manifest and resource transport never receives the business Access Key. The Key is injected only into declared Business Gateway requests.
- Every entry/icon path resolves to exactly one signed resource. Serve exact MIME and bytes; SHA-256 is `sha256-` plus Base64 digest.
- `permissions` must cover every derived resource origin, network origin, action ID, Tool name, and Native-code flag.
- Remote resources may not use `agent-runtime/` or other Host-reserved namespaces. Agent Tool shims are generated from validated surface bindings/routing metadata.
- Declarative uses semantic schema only. Native uses Host React/UI Kit/tokens only. Installed HTML is self-contained, token-driven, sandboxed, and uses only declared Business Bridge actions.
- A changed Manifest needs a new semver and signature. Expansion, Native 0→1, or key rotation requires re-consent; same-key non-expanding updates may auto-apply.
- Acceptance must separately prove inspect-without-resource-fetch, first-use lazy fetch, MIME/hash failure, valid/401/403 Key behavior, confirmation-before-write, update/re-consent, and offline/required behavior.

## Brand styling

Do not satisfy a “brand color” request with fixed page-level hex/rgb values or global CSS. Use a signed brand icon plus semantic `--ocix-*` slots, Host tones, chart sequence tokens, content language, and composition. Verify light/dark and more than one Host preset.
