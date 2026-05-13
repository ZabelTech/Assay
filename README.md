# Assay

**The open protocol for AI-native job applications. Share an endpoint, not a PDF.**

-----

Resumes were made for printers.

Every modern hiring system — ATSes, AI screeners, recruiter copilots — now spends its first step reverse-engineering structured data out of a document that was never structured to begin with. We're using language models to recover the structure we asked candidates to throw away.

Assay replaces the resume with a live, permissioned, machine-readable endpoint that an agent can query directly.

It is **not** a LinkedIn replacement. LinkedIn is for humans browsing each other; Assay is for the agents acting on humans' behalf. The two coexist — a candidate publishes both, links them through their Assay `identity` handles, and lets each consumer reach for whichever surface fits.

## What this is

Assay is two things in one repository:

1. **The Cairn Protocol** — a specification for exposing professional history as queryable, candidate-controlled context. Built on top of the [Model Context Protocol](https://modelcontextprotocol.io). A career is the cairn you build over time; the protocol defines how others read it.
1. **A reference server** — an open-source MCP server that implements the protocol, runnable in a Docker container on a five-dollar VPS.

The hosted version lives at [assay.bot](https://assay.bot). Everything in this repository is open source and self-hostable. Same protocol, same data model, same export-anytime guarantee.

## How it works

A candidate runs an Assay server (self-hosted or hosted), verifies their email with the server, and structures their professional history as claims: work history, projects, skills, endorsements solicited from former colleagues, availability, and preferences. The server exposes the result as MCP tools and resources behind a single permissioned URL.

A recruiter's agent queries that URL the way a developer's editor queries a language server.

```
recruiter agent  ──MCP──>  candidate endpoint
                              │
                              ├─ work history
                              ├─ shipped projects (with evidence)
                              ├─ skills (with citations)
                              ├─ endorsements (email-verified)
                              └─ availability & preferences
```

A query and response, illustrative:

```json
// Tool: query_career
// Input:
{
  "information_needed": "Has this person shipped React Native to production?",
  "client": {
    "role_context": "Senior mobile engineer, B2B SaaS"
  }
}

// Response:
{
  "claims": [
    {
      "claim_id": "clm_8f2a...",
      "type": "project",
      "value": {
        "name": "Field Notes",
        "summary": "Cross-platform note-taking app, React Native + Expo",
        "role": "Sole engineer",
        "started_at": "2022-04-01",
        "platforms": ["iOS", "Android"]
      },
      "evidence": [
        { "type": "url", "url": "https://github.com/alice/field-notes", "label": "Source" },
        { "type": "url", "url": "https://apps.apple.com/...", "label": "iOS App" }
      ],
      "attestation": { "level": "self_attested" }
    },
    {
      "claim_id": "clm_derived_a3f9...",
      "type": "narrative",
      "value": {
        "text": "Alice has shipped two React Native apps to production between 2022 and 2024.",
        "scope": "synthesis"
      },
      "attestation": {
        "level": "derived",
        "derived_by": "https://alice.career",
        "derived_at": "2026-05-10T...",
        "method": "llm_selection_and_summary",
        "derived_from": ["clm_8f2a...", "clm_b7e2..."]
      }
    }
  ]
}
```

The candidate controls what's exposed, to whom, and for how long. A recruiter's access can be scoped to a single role, expire after a window, and leave an audit trail of what was requested and when — owned by the candidate, viewable through their hosting interface. (v0 records requests against tokens but does not yet identify distinct accessors within a forwarded chain; OAuth-based accessor identity is on the v0.1 path.)

## The trust spectrum

Assay does not enforce a single source of truth. Every claim carries an `attestation` field that tells the querying agent how the claim is backed.

**v0 ships with three levels:**

|Level           |Meaning                                                              |Example                                             |
|----------------|---------------------------------------------------------------------|----------------------------------------------------|
|`self_attested` |The candidate said so                                                |"I led a team of six."                              |
|`email_attested`|Endorser proved control of an email address by responding to a challenge|Endorsement from `bob@acme.com`                     |
|`derived`       |Server-synthesized at query time from one or more stored claims      |Summary of multiple projects with `derived_from` IDs|

**v0.1 adds cryptographic levels** (currently in RFC; see [`spec/cairn-v0.md` §15](spec/cairn-v0.md)):

- `source_verified` — pulled live from a system of record via OAuth (GitHub commits, App Store Connect ships, etc.)
- `issuer_attested` — signed credential from an identifiable third party using [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model-2.0/) and [OpenID4VC](https://openid.net/sg/openid4vc/), aligned with the EU digital identity wallet ecosystem
- DID-signed peer attestations, embedded document signatures (PAdES/CAdES/C2PA), and signed JWT tokens with audience binding

v0 is intentionally small so it can ship with a minimal implementation surface and inform the v0.1 cryptographic design with real usage patterns. v0 does not provide cryptographic protection against a malicious host; agents that need stronger guarantees should wait for v0.1 or adopt RFC items ahead of normative adoption.

## Quick start

The published image lands once the reference server PR is merged to `main`. Until then, build locally from the repo:

```bash
# Build the reference server image
docker build -t cairn-server .

# Run with a candidate email and a persistent data volume.
# SUBJECT is the canonical identity (§4); OPERATOR_URL is the URL this server
# advertises in tokenized share links and `derived_by` attribution.
docker run -d --name cairn -p 3000:3000 \
  -v $(pwd)/data:/data \
  -e SUBJECT=you@example.com \
  -e OPERATOR_URL=http://localhost:3000 \
  cairn-server

# Bootstrap: subject email verification, claim authoring, and token issuance
# all live behind a CLI in v0 (the candidate admin UI is on the v0.1 roadmap).
docker exec cairn npm run cli -- subject verify you@example.com
docker exec cairn npm run cli -- claim add /path/to/some-claim.json
docker exec cairn npm run cli -- token issue --days 90 \
  --audience "Acme Talent" --purpose "Senior Backend Engineer role"
```

The last command prints a tokenized URL. Share it with a recruiter; their MCP client connects to it like any other authenticated MCP endpoint. The public URL (`http://localhost:3000/mcp` with no token) serves only `public` claims.

The `docker run` image will become `docker run … ghcr.io/zabeltech/assay` once the published image lands.

### Using your ChatGPT subscription for imports

LinkedIn / GitHub / PDF / paste imports run through an LLM structurer. By default the server uses a fixture-driven `MockStructurer` that returns canned narrative drafts. If you have a ChatGPT Plus, Pro, Business, Edu, or Enterprise subscription you can route import-time LLM calls through your subscription quota instead of paying for the OpenAI API.

1. Install the [Codex CLI](https://developers.openai.com/codex/cli) on the host where the Assay server runs.
2. Run `codex login` (browser OAuth) or `codex login --device-auth` (headless device-code flow). Tokens persist in `~/.codex/` and auto-refresh.
3. Start Assay with `CODEX_CLI=1` set in the environment. The structurer pins `--model gpt-5.5` by default (the currently-recommended Codex model as of mid-2026). Override with `CODEX_MODEL=gpt-5.4` (or `gpt-5.5-codex`, etc.) if your subscription tier doesn't include the default or you want a Codex-specific variant.

Caveat: OpenAI's docs recommend API-key auth for unattended automation; ChatGPT-account auth works in practice but isn't officially blessed for service use. If imports start failing with auth errors, re-run `codex login`. Subscription quotas are metered in 5-hour windows plus a weekly cap — the structurer surfaces quota-exceeded responses as a typed error the admin layer translates to a clean 503-class response.

## Repository layout

```
assay/
├── spec/              # The Cairn Protocol specification (spec/cairn-v0.md)
├── server/            # Reference MCP server (TypeScript, Hono, SQLite)
└── schemas/           # JSON-LD context for career data
```

Additional surfaces — example clients (issue #9), recruiter-side query agent (issue #10), candidate admin API (issue #7), and the hero page (issue #8) — live in follow-up tracking issues.

## Roadmap

**Early — the protocol and the reference implementation are still being designed in the open.** Nothing here is stable yet, and there is no tagged release. This README describes the shape of the system we are building, not a system that exists.

The build path, in rough order of dependency:

1. **Cairn Protocol v0 draft.** The core career object, the three-level attestation model (self / email / derived), the MCP tool surface a candidate's endpoint exposes, and opaque-token permissioning. Published openly for review before any implementation hardens around it.
1. **Reference server.** TypeScript MCP server, runnable in a single Docker container, that implements the v0 spec end-to-end.
1. **Hosted onboarding at assay.bot.** A one-click setup for candidates who don't want to run a server, on the same protocol as the self-hosted path.
1. **Cairn Protocol v0.1.** The cryptographic mechanisms outlined in v0 §15 — Decentralized Identifiers, subject signatures, source-verified attestation via OAuth, issuer-attested via Verifiable Credentials, embedded document signature validation, signed JWT tokens. Each item is a separate RFC inside §15 and will land as it stabilizes.
1. **Source connectors.** OAuth integrations with the most common sources of professional truth (GitHub, GitLab, App Store Connect, AWS, Google Scholar). These ride on top of v0.1's `source_verified` attestation level.
1. **Recruiter-side query agent.** The other end of the protocol — an agent that takes a job description and queries opted-in endpoints with structured results.

Deliberately not on this roadmap, yet: candidate marketplaces, employer billing, ATS integrations, anything that depends on the network already existing. Those come later, on top of a protocol that has been used in the wild long enough to be worth integrating with.

If you want to influence the protocol while it is still soft, now is the time. See [Contributing](#contributing).

## Why open

A career is a thing you carry between jobs for forty years. The infrastructure that holds it should not be optional to own.

The protocol is open because the alternative is another walled garden, and walled gardens are how the resume era ended up where it is. The hosted version at assay.bot funds the work and serves the 95% of candidates who will never run a Docker container. Self-hosters get the same protocol, the same data model, and the same exit. If we ever get worse, you `docker run` your way out in an afternoon.

## Contributing

Issues and PRs welcome. Before working on anything substantial, please open a discussion — the protocol design is moving fast and we want to make sure your work doesn't collide with in-flight changes.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, style, and review process.

## License

The Cairn Protocol specification, schemas, and reference server are released under the [WTFPL](http://www.wtfpl.net/). See [`LICENSE`](LICENSE).

The hosted product at assay.bot is a separate commercial offering, built on top of the same open protocol.

-----

*The future job application is not "upload your CV." It is "share your endpoint."*
