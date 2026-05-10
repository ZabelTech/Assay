# Assay

**The open protocol for AI-native job applications. Share an endpoint, not a PDF.**

-----

Resumes were made for printers.

Every modern hiring system — ATSes, AI screeners, recruiter copilots — now spends its first step reverse-engineering structured data out of a document that was never structured to begin with. We’re using language models to recover the structure we asked candidates to throw away.

Assay replaces the resume with a live, permissioned, machine-readable endpoint that an agent can query directly.

## What this is

Assay is two things in one repository:

1. **The Cairn Protocol** — a specification for exposing professional history as queryable, attestable, candidate-controlled context. Built on top of the [Model Context Protocol](https://modelcontextprotocol.io). A career is the cairn you build over time; the protocol defines how others read it.
1. **A reference server** — an open-source MCP server that implements the protocol, runnable in a Docker container on a five-dollar VPS.

The hosted version lives at [assay.bot](https://assay.bot). Everything in this repository is open source and self-hostable. Same protocol, same data model, same export-anytime guarantee.

## How it works

A candidate runs an Assay server (self-hosted or hosted) and connects sources of professional truth: GitHub, App Store Connect, employer-issued credentials, certifications, references. The server exposes those as MCP tools and resources behind a single permissioned URL.

A recruiter’s agent queries that URL the way a developer’s editor queries a language server.

```
recruiter agent  ──MCP──>  candidate endpoint
                              │
                              ├─ work history (with provenance)
                              ├─ shipped projects (with evidence)
                              ├─ skills (with citations)
                              ├─ endorsements (signed)
                              └─ availability & preferences
```

A query and response, illustrative:

```json
// Tool: query_career
// Input:
{
  "question": "Has this person shipped React Native to production?"
}

// Response:
{
  "answer": "Yes — three production deployments between 2022 and 2024.",
  "evidence": [
    {
      "type": "shipped_project",
      "title": "Field Notes (iOS, Android)",
      "url": "https://apps.apple.com/...",
      "attestation": {
        "level": "source_verified",
        "source": "App Store Connect",
        "verified_at": "2026-04-12T..."
      }
    },
    { ... }
  ]
}
```

The candidate controls what’s exposed, to whom, and for how long. A recruiter’s access can be scoped to a single role, expire after a window, and leave an audit log the candidate owns.

## The trust spectrum

Assay does not enforce a single source of truth. Every claim carries an `attestation` field that tells the querying agent how the claim is backed:

|Level            |Meaning                                           |Example                            |
|-----------------|--------------------------------------------------|-----------------------------------|
|`self_attested`  |The candidate said so                             |“I led a team of six.”             |
|`source_verified`|Pulled live from a system of record via OAuth     |847 merged PRs in a GitHub org     |
|`issuer_attested`|Signed credential from an identifiable third party|Employer-signed tenure & title     |
|`peer_attested`  |Vouch from a known person, on the record          |Endorsement from a verifiable human|

A recruiter screening for senior roles will weight issuer-attested employment heavily. A recruiter for a junior creative role might care more about source-verified shipped work. Assay makes the trust level legible; the agent decides how to weight it.

Issuer-attested claims use [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model-2.0/) and [OpenID4VC](https://openid.net/sg/openid4vc/) — the same standards landing in the EU digital identity wallet. We are not inventing crypto; we are integrating the standards that the broader credential ecosystem is converging on.

## Quick start

```bash
# Run the reference server locally
docker run -p 3000:3000 ghcr.io/zabeltech/assay

# Configure with your sources
assay connect github
assay connect linkedin  # read-only, for migration
assay connect domain    # for DNS-based identity
```

Your endpoint is now live at `http://localhost:3000/mcp`. Point any MCP-compatible client at it.

For production self-hosting (TLS, a real domain, persistent storage), see [`docs/self-hosting.md`](docs/self-hosting.md).

## Repository layout

```
assay/
├── spec/              # The Cairn Protocol specification
├── server/            # Reference MCP server (TypeScript)
├── schemas/           # JSON Schema and JSON-LD context for career data
├── connectors/        # OAuth integrations with sources of truth
├── verifiers/         # Verifiable Credential issuance and verification
├── examples/          # Example endpoints, queries, and integrations
└── docs/              # Protocol docs, self-hosting guide, contributor guide
```

## Roadmap

**Early — the protocol and the reference implementation are still being designed in the open.** Nothing here is stable yet, and there is no v0.1 release. This README describes the shape of the system we are building, not a system that exists.

The build path, in rough order of dependency:

1. **Cairn Protocol v0 draft.** The core career object, the attestation model, the MCP tool surface a candidate’s endpoint exposes, and the permissioning semantics. Published openly for review before any implementation hardens around it.
1. **Reference server.** TypeScript MCP server, runnable in a single Docker container, that implements the v0 spec end-to-end.
1. **Source connectors.** OAuth integrations with the most common sources of professional truth: GitHub, GitLab, App Store Connect, AWS, Google Scholar, personal domain via DNS, and a few more.
1. **Verifiable Credentials.** Issuance and verification flow built on W3C VCs and OpenID4VC, so issuer-attested claims are interoperable with the broader credential ecosystem rather than locked to Assay.
1. **Hosted onboarding at assay.bot.** A one-click setup for candidates who don’t want to run a server, on the same protocol as the self-hosted path.
1. **Recruiter-side query agent.** The other end of the protocol — an agent that takes a job description and queries opted-in endpoints with evidence-backed results.

Deliberately not on this roadmap, yet: candidate marketplaces, employer billing, ATS integrations, anything that depends on the network already existing. Those come later, on top of a protocol that has been used in the wild long enough to be worth integrating with.

If you want to influence the protocol while it is still soft, now is the time. See [Contributing](#contributing).

## Why open

A career is a thing you carry between jobs for forty years. The infrastructure that holds it should not be optional to own.

The protocol is open because the alternative is another walled garden, and walled gardens are how the resume era ended up where it is. The hosted version at assay.bot funds the work and serves the 95% of candidates who will never run a Docker container. Self-hosters get the same protocol, the same data model, and the same exit. If we ever get worse, you `docker run` your way out in an afternoon.

## Contributing

Issues and PRs welcome. Before working on anything substantial, please open a discussion — the protocol design is moving fast and we want to make sure your work doesn’t collide with in-flight changes.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, style, and review process.

## License

The Cairn Protocol specification, schemas, and reference server are released under the [WTFPL](http://www.wtfpl.net/). See [`LICENSE`](LICENSE).

The hosted product at assay.bot is a separate commercial offering, built on top of the same open protocol.

-----

*The future job application is not “upload your CV.” It is “share your endpoint.”*
