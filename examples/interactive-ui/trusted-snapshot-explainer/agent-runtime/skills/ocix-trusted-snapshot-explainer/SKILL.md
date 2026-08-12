---
name: ocix-trusted-snapshot-explainer
description: Explain the OCIX trust model, signed package verification, the installed zero-capability inventory, and deterministic snapshot replay using the installed Trusted Snapshot Explainer example. Use only for explicit trust-model or installed-snapshot explanation requests; never for business data.
---

# OCIX Trusted Snapshot Explainer

Use the `ocix_explain_trust_pipeline` Tool when the user explicitly asks to
understand the OCIX trust model, how extension packages are signed and
verified, what the installed snapshot-explainer inventory contains, or why the
example replays deterministically. The Tool returns one installed
`openchamber://interactive-result/v1` envelope with `mode=snapshot` and inline
data only.

- Trigger for Chinese requests such as “解释 OCIX 信任模型”, “讲一下签名和验证”, “这个已安装示例里有什么”, or “为什么快照可以回放”.
- Trigger for English requests such as “explain the OCIX trust model”, “how is the package signed and verified”, “what does the installed example contain”, or “why is this snapshot replayable”.
- The data is a bundled deterministic fixture (`dataAuthority=generated`,
  `source.kind=bundled-fixture`, `live=false`). Never present it as live,
  business, or authoritative enterprise data.
- The lesson is selected with `focus` (`overview`, `signature`,
  `installation`, `replay`) and `depth` (`quick`, `detailed`); omit both to get
  the overview at detailed depth. Do not invent other arguments.
- The result is deterministic: identical arguments produce identical bytes.
  Never edit, truncate, wrap, or re-render the envelope returned by the Tool;
  return it intact so OpenChamber renders the view in the conversation.
- This extension is an installed example, not a business system. It declares
  no Connector, action, network permission, storage, credential, Gateway, or
  dashboard, and it must not be used for CRM, ERP, sales, finance, or any
  other business domain.
- Use at most one primary OpenChamber View per assistant turn. If another
  Tool already returned an `openchamber://interactive-result/v1` envelope in
  the current turn, stop: its View is already rendered.
- Do not route ordinary visualization, dashboard, or business requests to
  this Tool, and do not add it to generic reinforcement-learning routing or
  evaluation corpora. It answers trust-model questions only.
- After the View renders, finish with exactly one short conclusion or
  next-step sentence. Do not restate the View sections in prose.

## When not to use

- Business data, dashboards, or live systems: use an installed
  `connected-business-system` Tool instead.
- Ad-hoc visualization of user-provided data: use `interactive_ui`.
- HTML documents or custom simulation: use `html_artifact`.
- Questions about the product, roadmap, or other extensions: answer normally.
