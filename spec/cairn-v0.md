# Cairn Protocol v0

**Status:** Draft. This document is a request for comments, not a frozen specification. Breaking changes are expected before v0.1. The goal of publishing it now is to make the design soft and visible while it can still be shaped by the engineers who will use it.

**Last updated:** 2026-05-11

**Editor:** ZabelTech

-----

## 1. Overview

The Cairn Protocol defines how a person's professional history is exposed as a live, structured, permissioned, machine-readable endpoint that AI agents can query.

It replaces the resume — a static document optimized for printers — with a queryable interface that returns structured claims with evidence references and lightweight attestation metadata. It does not specify what a hiring decision should look like. It specifies what the candidate-side data should look like, what claims about that data mean, and how a recruiter's agent fetches them.

Cairn is a profile of the [Model Context Protocol](https://modelcontextprotocol.io). A Cairn endpoint is an MCP server that exposes a specific set of tools and resources defined here. Any MCP-compatible client can speak to it. Any conforming server interoperates with any conforming client.

### 1.1 Scope: cold-query only

Cairn governs the cold-query layer — the moment an agent first encounters a candidate's professional context and decides whether to engage. What happens after that — phone screens, written exchanges, offers, negotiations — happens between humans, off-protocol. Cairn deliberately does not model progressive disclosure across interview stages, conditional grants, or post-offer negotiation. Those are conversation problems, not data-shape problems, and the protocol's job ends once a recruiter and candidate are in contact.

### 1.2 What is and is not in v0

v0 deliberately ships with a minimal trust surface:

- **In v0:** structured claims, email-attested endorsements, derived (server-synthesized) claims, evidence references with content hashes, opaque permissioning tokens, request fingerprinting, audit logging, visibility levels, and the MCP tool surface.
- **Not in v0, outlined for v0.1 (§15):** Decentralized Identifiers, cryptographic signatures over claims or tokens, Verifiable Credentials, source-verified attestation via OAuth, issuer-attested credentials, embedded document/image signature validation, signed JWT tokens with audience binding, and counter-signed client identity.

The v0 trust model is intentionally honest about its strength: email-attested endorsements are the strongest signal the protocol provides, and everything else is the candidate's word with structured supporting evidence for inspection. Stronger trust mechanisms are deferred to v0.1 so v0 can ship with a small implementation surface and so the design of the cryptographic mechanisms can be informed by what real querying agents need from the cold-query layer.

## 2. Conformance

The keywords MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174).

A *conforming server* MUST implement all tools and resources marked REQUIRED in §10. A conforming server MUST accept and serve career objects that validate against the schema in §5–§9. A conforming server SHOULD implement all tools and resources marked RECOMMENDED.

A *conforming client* MUST be able to consume any career object that validates against this specification. A conforming client SHOULD respect the visibility metadata defined in §9 when displaying or forwarding claims.

## 3. Terminology

**Subject** — the person a career object describes. Identified by an email address (§4).

**Career object** — the top-level document served by a Cairn endpoint. Contains a collection of claims about the subject. Defined in §5.

**Claim** — an atomic assertion about the subject, with attached metadata describing how it is attested and what evidence supports it. Defined in §6.

**Attestation** — metadata on a claim describing the trust level. Defined in §7.

**Evidence** — links and references attached to a claim that allow third parties to inspect the underlying material. Defined in §8.

**Endpoint** — the URL at which a Cairn server is reachable. Speaks MCP over HTTP (or other MCP-supported transports).

**Endorser** — an individual whose control of an email address has been verified, used as the basis for `email_attested` claims (§7.2).

**Querying agent** — an MCP client (typically operating on behalf of a recruiter, employer, or hiring system) that connects to a Cairn endpoint to read claims.

## 4. Identity

The subject of a career object is identified by an **email address**. The candidate's email address is their canonical identity within the protocol; the endpoint URL is where the data is hosted but is not the identity.

This separation matters for portability. A candidate who moves between hosts brings their email-as-identity with them. Email-attested endorsements (§7.2) are bound to the subject's email rather than the endpoint URL, so they remain valid across host changes without re-solicitation.

### 4.1 Subject email verification

The subject SHOULD have demonstrated control of their email address to the hosting server before that email appears as the `subject` of a career object. The verification flow follows the same email-challenge pattern used for endorser verification (§7.2): the server sends a challenge to the address, and the candidate responds.

`subject_verified` on the career object (§5) indicates whether this verification has occurred. Servers MUST default `subject_verified` to `false` for unverified subjects and MUST NOT silently mark a subject verified without a completed challenge.

### 4.2 Endorser identity

Endorsers are also identified by email address. The same challenge-response flow used for subject verification is used to verify endorser identity at the time of endorsement creation (§7.2).

### 4.3 Operator identity

Servers identify their operator by a URL (typically the operator's privacy policy or homepage) and an optional contact email. There is no cryptographic binding between the operator and the data they host; agents that need stronger operator identity assurance are dependent on the v0.1 mechanisms outlined in §15.

## 5. The Career Object

A career object is the root document served by a Cairn endpoint. It has the following shape:

```json
{
  "@context": [
    "https://schema.org",
    "https://cairn.dev/schemas/v0"
  ],
  "schema_version": "cairn/0.1",
  "subject": "alice@example.com",
  "subject_verified": true,
  "endpoint": "https://alice.career/mcp",
  "updated_at": "2026-05-10T14:32:00Z",
  "claims": [
    { ... },
    { ... }
  ]
}
```

|Field             |Type              |Required|Description                                                                  |
|------------------|------------------|--------|-----------------------------------------------------------------------------|
|`@context`        |array of strings  |REQUIRED|JSON-LD contexts. MUST include the Cairn v0 context.                         |
|`schema_version`  |string            |REQUIRED|The Cairn schema version this object conforms to.                            |
|`subject`         |string (email)    |REQUIRED|The email address identifying the subject.                                   |
|`subject_verified`|boolean           |REQUIRED|Whether the subject has completed an email challenge with this server (§4.1).|
|`endpoint`        |URL               |REQUIRED|The canonical endpoint URL where this career object is hosted.               |
|`updated_at`      |ISO-8601 timestamp|REQUIRED|Last modification time of the career object.                                 |
|`claims`          |array of Claim    |REQUIRED|The claims that make up the career. May be empty.                            |

The career object MAY contain additional implementation-specific fields. Conforming clients MUST ignore unrecognized top-level fields.

## 6. Claims

A claim is the atomic unit of the protocol. The career object is a collection of claims; everything queryable about a person is expressed as one.

### 6.1 Common claim fields

Every claim, regardless of type, has the following common shape:

```json
{
  "claim_id": "clm_8f2a4c7d...",
  "subject": "alice@example.com",
  "type": "employment",
  "value": { ... },
  "evidence": [ ... ],
  "attestation": { ... },
  "visibility": "public",
  "created_at": "2024-09-02T10:14:00Z",
  "updated_at": "2024-09-02T10:14:00Z"
}
```

|Field        |Type              |Required|Description                                                       |
|-------------|------------------|--------|------------------------------------------------------------------|
|`claim_id`   |string            |REQUIRED|Stable, unique identifier for this claim within the career object.|
|`subject`    |string (email)    |REQUIRED|Always equal to the career object's subject.                      |
|`type`       |string            |REQUIRED|One of the standard types in §6.2 or a custom type per §6.3.      |
|`value`      |object            |REQUIRED|The claim's payload. Shape depends on `type`.                     |
|`evidence`   |array             |OPTIONAL|Links to underlying material. See §8.                             |
|`attestation`|object            |REQUIRED|Trust metadata. See §7.                                           |
|`visibility` |enum              |REQUIRED|`public`, `permissioned`, or `private`. See §9.                   |
|`created_at` |ISO-8601 timestamp|REQUIRED|When the claim was first added to the career object.              |
|`updated_at` |ISO-8601 timestamp|REQUIRED|When the claim was last modified.                                 |

### 6.2 Standard claim types

The v0 standard types are:

#### `identity`

Basic information about the subject. A career object SHOULD contain exactly one `identity` claim.

```json
{
  "type": "identity",
  "value": {
    "name": "Alice Chen",
    "pronouns": "she/her",
    "headline": "Senior backend engineer, distributed systems",
    "location": { "city": "Berlin", "country": "DE" },
    "handles": {
      "github": "alicechen",
      "website": "https://alice.career",
      "email": "alice@example.com",
      "linkedin": "alicechen-eng"
    }
  }
}
```

The `handles.email` SHOULD match the career object's `subject` value. Recruiters who land on a candidate's public endpoint and want to engage further reach out through one of these handles; if the candidate is interested, they reply with a tokenized URL granting permissioned access (§9).

#### `employment`

A position at an organization.

```json
{
  "type": "employment",
  "value": {
    "employer": "Stripe",
    "title": "Senior Software Engineer",
    "start_date": "2021-03-01",
    "end_date": "2024-08-15",
    "summary": "Worked on the financial reporting platform team."
  }
}
```

`end_date` MAY be null for current positions.

#### `education`

A program at an institution.

```json
{
  "type": "education",
  "value": {
    "institution": "TU Berlin",
    "program": "M.Sc. Computer Science",
    "start_date": "2017-10-01",
    "end_date": "2020-09-01"
  }
}
```

#### `project`

Something the subject built or shipped. Evidence is particularly important for this type since v0 does not offer cryptographic verification of project authorship.

```json
{
  "type": "project",
  "value": {
    "name": "Field Notes",
    "summary": "Cross-platform note-taking app for field researchers.",
    "role": "Sole engineer",
    "started_at": "2022-04-01",
    "ended_at": null,
    "platforms": ["iOS", "Android", "Web"]
  },
  "evidence": [
    { "type": "url", "url": "https://github.com/alice/field-notes", "label": "Source" },
    { "type": "url", "url": "https://apps.apple.com/...", "label": "iOS App" }
  ]
}
```

#### `publication`

Papers, articles, talks, books, podcasts, open-source contributions of substantial scope.

#### `credential`

A certification, license, or formal qualification. In v0, credentials are presented as `self_attested` claims with supporting evidence (a `document` evidence object, a URL to a public credential record); cryptographic issuer attestation is deferred to v0.1 (§15).

#### `skill`

A claim of capability. Skills SHOULD reference projects, employment, or other claims as evidence rather than standing alone.

```json
{
  "type": "skill",
  "value": {
    "name": "Distributed systems",
    "level": "advanced",
    "evidence_claims": ["clm_8f2a...", "clm_d1c4..."]
  }
}
```

#### `endorsement`

A vouch from a third party about a specific quality of the subject. Always `email_attested` (§7.2).

```json
{
  "type": "endorsement",
  "value": {
    "endorser_name": "Bob Müller",
    "endorser_role": "Engineering Manager",
    "context_claim": "clm_8f2a...",
    "summary": "Alice led the migration of our core payments service. Calm under pressure, technically rigorous."
  }
}
```

#### `availability`

Current openness to work. The protocol intentionally does not standardize an exhaustive enum here; this is the most volatile claim type and the one most likely to evolve.

```json
{
  "type": "availability",
  "value": {
    "status": "open_to_offers",
    "role_types": ["full_time", "contract"],
    "locations": { "remote": true, "cities": ["Berlin"] },
    "earliest_start": "2026-07-01"
  }
}
```

#### `preference`

Free-form preferences a candidate wants the querying agent to know. Deal-breakers, work style, role attributes that matter. Often `permissioned` rather than `public`.

#### `compensation`

A claim about compensation. The `value.type` field discriminates between current/historical compensation and target/desired compensation. Because of the strategic and privacy implications of compensation data, candidates SHOULD default `current_total` claims to `private`, and SHOULD generally only expose `target_total` claims at `permissioned` levels.

```json
{
  "type": "compensation",
  "value": {
    "type": "target_total",
    "base_min": 180000,
    "base_max": 220000,
    "currency": "EUR",
    "equity_required": true,
    "structure_notes": "Open to lower base with strong equity at early-stage."
  },
  "visibility": "permissioned"
}
```

The `value.type` field MUST be one of `target_total`, `current_total`, or `historical`. Compensation values SHOULD include `currency` as an ISO 4217 code. Snapshots SHOULD include `as_of` since values are time-sensitive.

The protocol does not standardize equity valuation methodology, total-compensation calculation rules, or comparative metrics. Candidates state their numbers and how they derived them; consumers reason about them.

#### `narrative`

Free-form prose context. Used for cover-letter-equivalent content, role-specific framing, or anything that doesn't fit a structured type.

```json
{
  "type": "narrative",
  "value": {
    "text": "I'm most interested in roles at the intersection of...",
    "scope": "general"
  }
}
```

### 6.3 Custom claim types

Implementations MAY define custom claim types using a namespaced identifier:

```json
{ "type": "x:security_clearance", "value": { ... } }
```

Conforming clients MUST NOT reject a career object containing custom claim types. Clients SHOULD surface them in raw form when they cannot interpret them.

## 7. Attestation

Every claim MUST carry an `attestation` object describing how the claim is backed.

v0 defines three attestation levels: `self_attested`, `email_attested`, and `derived`. Stronger cryptographic levels (`source_verified`, `issuer_attested`, `peer_attested` with key signatures) are outlined for v0.1 in §15.

### 7.1 `self_attested`

The subject said so. No external verification. Equivalent to a line on a resume.

```json
"attestation": { "level": "self_attested" }
```

The default for any claim added by the candidate without an attached attestation flow. Most claims in a v0 career object will be self-attested.

### 7.2 `email_attested`

The claim is backed by an endorser whose control of an email address has been verified by the server through a challenge-response flow at the time of endorsement creation. Used primarily for `endorsement` claims.

```json
"attestation": {
  "level": "email_attested",
  "endorser_email_domain": "acme.com",
  "endorser_email_local": "bob",
  "endorser_name": "Bob Müller",
  "verification": {
    "verification_id": "vfy_email_a3f9...",
    "verified_at": "2026-04-10T08:00:00Z",
    "verifier_url": "https://assay.bot",
    "verifier_is_subject_host": true,
    "challenge_method": "click_through_link",
    "payload_hash": "sha256:8f2a4c7d..."
  }
}
```

|Field                                |Required   |Description                                                                                  |
|-------------------------------------|-----------|---------------------------------------------------------------------------------------------|
|`endorser_email_domain`              |REQUIRED   |The domain part of the endorser's verified email address (e.g. `acme.com`).                  |
|`endorser_email_local`               |OPTIONAL   |The local part of the address (`bob` in `bob@acme.com`). Disclosed only with endorser opt-in.|
|`endorser_name`                      |RECOMMENDED|Human-readable endorser name as supplied during verification.                                |
|`verification.verification_id`       |REQUIRED   |Stable identifier for the verification record stored alongside the claim.                    |
|`verification.verified_at`           |REQUIRED   |Timestamp at which the endorser completed the challenge.                                     |
|`verification.verifier_url`          |REQUIRED   |URL identifying the server that performed the email challenge.                               |
|`verification.verifier_is_subject_host`|REQUIRED |Boolean. `true` if the verifier is the candidate's own hosting server (a conflict of interest).|
|`verification.challenge_method`      |REQUIRED   |One of the methods defined below.                                                            |
|`verification.payload_hash`          |REQUIRED   |SHA-256 hash over the canonicalized `value` of the parent claim at the time of verification. |

The domain part of the endorser's email MUST be disclosed; the local part is OPTIONAL and disclosed only with the endorser's explicit opt-in during the verification flow. This lets agents reason about endorser context (*"the endorser is at @stripe.com"*) without exposing personal email addresses by default.

To produce an email-attested endorsement, a Cairn server MUST:

1. Send a verification challenge to the endorser's stated email address, containing a unique single-use token bound to the specific endorsement payload.
2. On the endorser's response, capture the timestamp and the endorser's confirmation of the endorsement text (which the endorser MAY edit before confirming).
3. Compute `payload_hash` over the canonicalized parent claim `value` as confirmed.
4. Record the verification record under a stable `verification_id` stored alongside the parent claim.

`verifier_is_subject_host: true` means the candidate's own server performed the verification — the common case, but a conflict of interest. Agents SHOULD note this and weight accordingly. A third-party verifier (an independent email-verification service) yields a stronger record but is OPTIONAL.

#### 7.2.1 Challenge methods

The `challenge_method` field describes how the endorser proved control of the email address. v0 recognizes:

- **`click_through_link`** — the endorser clicked a unique link in the challenge email. Lowest friction, lowest trust. Demonstrates only that the recipient could read the email and act on a link.
- **`code_return`** — the endorser received a code by email and returned it through a separate channel (typically a dashboard URL the endorser navigates to manually). Modestly stronger because it requires two-channel interaction.

DKIM-verified signed replies and stronger cryptographic email-control proofs are deferred to v0.1 (§15).

Servers MAY support additional challenge methods using namespaced identifiers (`x:custom_method`). Querying agents that do not recognize a method SHOULD treat the verification as no stronger than `click_through_link`.

### 7.3 `derived`

The claim was composed by the server at query time from one or more underlying claims, in response to a `query_career` request (§10.1.1). The synthesis itself carries the server's attestation, not the subject's; the underlying source claims retain their original attestation and remain independently inspectable.

```json
"attestation": {
  "level": "derived",
  "derived_by": "https://assay.bot",
  "derived_at": "2026-05-10T14:32:00Z",
  "method": "llm_selection_and_summary",
  "derived_from": ["clm_8f2a...", "clm_d1c4...", "clm_a3f9..."]
}
```

|Field          |Required   |Description                                                                                  |
|---------------|-----------|---------------------------------------------------------------------------------------------|
|`derived_by`   |REQUIRED   |URL identifying the server that performed the synthesis.                                     |
|`derived_at`   |REQUIRED   |Timestamp at which the synthesis was performed.                                              |
|`method`       |REQUIRED   |Free-text label describing how the synthesis was produced. v0 does not standardize an enum.  |
|`derived_from` |REQUIRED   |List of source claim IDs used in the synthesis. Each MUST resolve via `get_claim` (§10.1.3). |

A derived claim MUST be supported by the claims listed in `derived_from`. Servers MUST NOT introduce factual content in a derived claim that is not supported by at least one of its sources.

A derived claim MUST NOT incorporate information from any source claim not visible to the requester. Visibility is enforced at the source-claim level before synthesis.

Derived claims MUST NOT be persisted as part of the career object. They exist only in the response to the request that produced them, and re-issuing the same request MAY yield different derived claims as the underlying career evolves.

Querying agents SHOULD treat the effective trust of a derived claim as the minimum of (a) the trust the agent assigns to the synthesizing server and (b) the weakest attestation level among the source claims listed in `derived_from`. Agents that prefer to bypass synthesis can traverse `derived_from` and reason directly over the source claims.

A claim with `attestation.level = derived` MUST NOT be cited in another claim's `evidence_claims` array; derived claims are transient and dangling references are forbidden.

### 7.4 Multiple attestations

A single underlying fact MAY be expressed as multiple claims with different attestation levels. For example, Alice's tenure at Stripe could appear as both a `self_attested` employment claim and an `email_attested` endorsement from her former manager corroborating it. Querying agents reconcile these as appropriate.

## 8. Evidence

The optional `evidence` array on any claim contains references to underlying material a third party can inspect. Evidence is distinct from attestation: attestation describes how the claim is backed; evidence describes what a curious party can go look at. Both can appear on the same claim.

In v0, evidence is exposed as references with content hashes for integrity but without cryptographic signature validation. Stronger evidence types (PAdES-signed documents, C2PA-signed images) are outlined in §15.

### 8.1 The evidence array

Every claim MAY carry zero or more evidence objects. Each evidence object has a `type` discriminator that determines its shape. Implementations MAY define custom evidence types using a namespaced identifier (`x:custom_type`); conforming clients MUST NOT reject claims containing custom evidence types and SHOULD surface them in raw form when they cannot interpret them.

### 8.2 The `url` evidence type

The simplest evidence type. A reference to a URL where the underlying material lives.

```json
{ "type": "url", "url": "https://github.com/alice/field-notes", "label": "Source repository" }
```

### 8.3 The `metric` evidence type

A metric value the candidate is reporting from an external system.

```json
{
  "type": "metric",
  "source": "GitHub",
  "metric": "commits",
  "value": 847,
  "as_of": "2026-05-08T..."
}
```

v0 does not specify a verification mechanism for these metrics. Agents SHOULD treat metric values as self-attested at the protocol level; live source-verified attestation is outlined in §15.

### 8.4 The `document` evidence type

A document is a file containing structured or semi-structured information that supports a claim. Common examples: offer letters, employment contracts, diploma scans, certificates, press releases.

```json
{
  "type": "document",
  "evidence_id": "ev_8f2a4c7d...",
  "document_url": "https://alice.career/evidence/offer-stripe.pdf",
  "content_hash": "sha256:8f2a4c7d...",
  "media_type": "application/pdf",
  "label": "Offer letter, Stripe (2021)",
  "uploaded_at": "2024-09-02T10:14:00Z",
  "extracted": {
    "method": "pdf_text",
    "fields": {
      "employer": "Stripe Payments Company",
      "title": "Senior Software Engineer",
      "start_date": "2021-03-15"
    }
  },
  "redactions": ["compensation_amount", "manager_name"]
}
```

|Field         |Required   |Description                                                                                                            |
|--------------|-----------|-----------------------------------------------------------------------------------------------------------------------|
|`evidence_id` |REQUIRED   |Stable identifier for this evidence object.                                                                            |
|`document_url`|REQUIRED   |Where the document can be retrieved. SHOULD respect the parent claim's visibility.                                     |
|`content_hash`|REQUIRED   |SHA-256 (or stronger) hash of the document contents, format `algo:hexdigest`.                                          |
|`media_type`  |REQUIRED   |IANA media type.                                                                                                       |
|`label`       |RECOMMENDED|Human-readable description.                                                                                            |
|`uploaded_at` |REQUIRED   |When the candidate added the document.                                                                                 |
|`extracted`   |OPTIONAL   |Structured fields extracted from the document.                                                                         |
|`redactions`  |OPTIONAL   |Names of fields the candidate has deliberately removed.                                                                |

The `content_hash` MUST cover the exact bytes of the file at `document_url`. Querying agents SHOULD verify the hash on retrieval and SHOULD treat mismatches as integrity failures. The hash provides integrity (the file you retrieved is the file the candidate intended to provide) but not authenticity (it does not prove the document came from any particular issuer). Issuer-attested documents via embedded signatures are outlined in §15.

Servers MAY extract structured fields from documents (via OCR, PDF text extraction, or form-aware parsing) and surface them in `extracted`. When extracted fields conflict with the parent claim's `value`, the server SHOULD surface the discrepancy rather than silently picking one.

The `redactions` array names fields the candidate has deliberately removed. Redactions MUST be honest — a document visually altered without declaring redactions is a forgery, not a redaction.

### 8.5 The `image` evidence type

A photograph or visual artifact supporting a claim. Common examples: photographs of work environments, conference badges, physical artifacts produced by the candidate, before/after photos of construction or design work.

```json
{
  "type": "image",
  "evidence_id": "ev_d1c4...",
  "image_url": "https://alice.career/evidence/badge-acme.jpg",
  "content_hash": "sha256:d1c4...",
  "media_type": "image/jpeg",
  "label": "Workplace badge, Acme HQ (2023)",
  "uploaded_at": "2023-11-04T15:22:00Z",
  "capture": {
    "captured_at": "2023-11-04T09:14:00Z",
    "device": "iPhone 14 Pro",
    "location_present": false
  }
}
```

The `capture` object summarizes EXIF data that bears on the image's context. Servers SHOULD extract this metadata at upload and store it alongside the image. Servers MUST NOT surface raw GPS coordinates or other sensitive EXIF fields unless the candidate explicitly opts in; the default `location_present` boolean reveals whether location data was originally embedded without disclosing the location itself.

Cryptographic provenance (C2PA signed images) is outlined in §15.

### 8.6 The `screenshot` evidence type

A digital capture of an on-screen artifact. Common examples: messaging-app threads, dashboards showing metrics, internal documents naming the candidate.

Screenshots are deliberately a distinct evidence type — not a subtype of `image` — because they have a different trust profile. Screenshots are by construction synthetic and trivially editable.

```json
{
  "type": "screenshot",
  "evidence_id": "ev_a3f9...",
  "image_url": "https://alice.career/evidence/slack-tech-lead.png",
  "content_hash": "sha256:a3f9...",
  "media_type": "image/png",
  "label": "Tech lead announcement, Acme Slack (Aug 2023)",
  "uploaded_at": "2023-08-22T18:00:00Z",
  "context": "Slack thread, internal #engineering channel, Acme",
  "redactions": ["other_participants", "channel_metadata"],
  "claimed_authenticity": "self_captured"
}
```

The `claimed_authenticity` field MAY be one of `self_captured`, `received_from_third_party`, or `extracted_from_archive`.

Screenshots default to the same trust level as self-attestation: the candidate is asserting that the screenshot depicts what they say it depicts. v0 provides no verification path for screenshots. Querying agents SHOULD weight screenshots accordingly — useful as supporting evidence alongside stronger attestation, rarely sufficient alone.

### 8.7 Multi-evidence corroboration

A claim MAY carry multiple evidence objects of any combination of types. The protocol does not aggregate them into a unified score; it surfaces them faithfully and leaves weighting to the querying agent.

A claim with `self_attested` attestation but multiple high-quality evidence items is still `self_attested` at the protocol level. Querying agents that reason about the evidence bundle MAY assign higher confidence in practice; the spec deliberately does not codify this.

## 9. Visibility and permissioning

Each claim has a `visibility` field with one of three values:

- **`public`** — returned to any client connecting to the public endpoint URL. No authentication required.
- **`permissioned`** — returned only to clients connecting via a tokenized endpoint URL whose token is valid. See §9.1.
- **`private`** — never returned by the protocol. Stored on the candidate's endpoint for the candidate's own reference and shared, if at all, only through human conversation downstream.

Conforming servers MUST enforce visibility at every request. A server MUST NOT return a `permissioned` claim to a client connecting via the public URL or via a URL whose token has expired or been revoked. A server MUST NOT return `private` claims under any circumstances.

### 9.1 Tokenized endpoint URLs

Permissioned access is granted by issuing a URL with an embedded token. The candidate generates such URLs through their server's hosting interface and shares them with specific recipients out-of-band: by email, in a LinkedIn message, in a job application form, or wherever else cold contact happens. The recipient's MCP client connects to the URL exactly as it would to any MCP endpoint. The token rides along.

Servers MUST accept tokens in a `t` query parameter and SHOULD also accept tokens as a path segment under `/t/`:

```
Public endpoint:        https://alice.career/mcp
Tokenized endpoint:     https://alice.career/mcp?t=opaque-random-string
                        https://alice.career/mcp/t/opaque-random-string
```

A v0 token is an **opaque random string** generated by the issuing server. It carries no signature and no embedded claims — its meaning is determined entirely by server-side state. The server maintains a record per issued token with at minimum the following fields:

|Field           |Required   |Description                                                            |
|----------------|-----------|-----------------------------------------------------------------------|
|`token_id`      |REQUIRED   |Stable identifier for the token (either the string itself or a hash of it).|
|`created_at`    |REQUIRED   |Issuance timestamp.                                                    |
|`expires_at`    |REQUIRED   |Expiration timestamp. Tokens MUST expire.                              |
|`audience_hint` |OPTIONAL   |Human-readable label, surfaced in the candidate's audit log.           |
|`purpose`       |RECOMMENDED|Free-text purpose, surfaced in the audit log.                          |
|`scope`         |REQUIRED   |MUST be `"permissioned"` in v0. Reserved for future expansion.         |
|`revoked`       |REQUIRED   |Boolean. `true` if the token has been revoked.                         |

Tokens MUST be generated using a cryptographically secure random source with at least 128 bits of entropy. Servers MUST verify the token's existence, expiry, and revocation status on every request before serving permissioned claims.

v0 tokens are **bearer-style**: any client holding the URL can use it. Recipients routinely forward candidate links within their hiring teams (to a hiring manager, to a panel, to an ATS), and that should just work. Fan-out from forwarding is made visible to the candidate via request fingerprinting (§9.4.1) rather than prevented at the access-control layer.

Audience-bound tokens (where the server enforces that only a specific recipient can use the URL) require cryptographic mechanisms outlined in §15.

### 9.2 Token issuance is not a protocol primitive

Token issuance is a candidate-side operation, performed through the candidate's hosting interface. It is **not** an MCP tool. The protocol's role is limited to defining the token format requirements and the server-side validation behaviors; the issuance UX, per-token controls, default expirations, and the revocation interface are implementation territory.

### 9.3 Revocation

The candidate can revoke any issued token at any time. Servers MUST honor revocation immediately and MUST refuse subsequent requests bearing the revoked token. Servers SHOULD maintain a revocation list keyed by `token_id`.

Revocation affects only the specific token. URLs derived from other tokens continue to work.

### 9.4 Audit logging

Servers MUST log access events involving permissioned data. Each log entry MUST include at minimum:

- `request_id` — a server-generated stable identifier for the request.
- `token_id` — the token's identifier (§9.1).
- `audience_hint` and `purpose`, if set on the token.
- `timestamp` — when the request was received.
- `claim_ids_returned` — claims appearing in the response.
- `client_fingerprint` — a structured fingerprint of the requesting client (§9.4.1).

Candidates MUST be able to view this log through their hosting interface.

For `query_career` requests (§10.1.1), the log entry MUST also record every source claim consulted during selection or synthesis, not only the claim IDs returned to the requester. This makes it visible to the candidate when a server reasoned over permissioned data even if that data did not appear verbatim in the response.

The audit log is what makes token forwarding (§9.1) visible to the candidate. A bearer-style token forwarded across a hiring panel produces multiple distinct fingerprints under the same `token_id`; the candidate sees fan-out, not just count.

### 9.4.1 Request fingerprinting

The protocol allows token forwarding by design (§9.1) — recruiters routinely share candidate links across hiring teams, and that should just work. But forwarding under a bearer token is also the main confidentiality leak: a single `token_id` may be exercised by an unknown number of accessors, and the candidate's audit log, keyed only by `token_id`, cannot distinguish "the recruiter visited the page 47 times" from "the link was forwarded to 47 different people."

Conforming servers MUST compute a per-request `client_fingerprint` and MUST surface it in the audit log alongside the `token_id`. The fingerprint is a deterministic function of observable per-request metadata plus any honest-signal identity the client supplies. Repeat accesses from the same client share a fingerprint; forwarded access from a new client produces a new one.

#### Fingerprint shape

```json
"client_fingerprint": {
  "id": "fp_d1c4e7...",
  "first_seen_at": "2026-05-10T10:00:00Z",
  "request_count": 12,
  "components": {
    "ip_prefix": "203.0.113.0/24",
    "user_agent": "AcmeRecruit/2.1 MCP-Client/1.0",
    "mcp_client_name": "AcmeRecruit",
    "mcp_client_version": "2.1.0",
    "client_identity": "talent@acme-recruiting.com"
  }
}
```

|Field                                |Required|Description                                                                                          |
|-------------------------------------|--------|-----------------------------------------------------------------------------------------------------|
|`id`                                 |REQUIRED|Stable hash over the components. Requests from the same accessor share the same `id` within a `token_id`.|
|`first_seen_at`                      |REQUIRED|Timestamp of the first observed request matching this fingerprint for the current `token_id`.       |
|`request_count`                      |REQUIRED|Number of requests observed from this fingerprint under the current `token_id`.                     |
|`components.ip_prefix`               |REQUIRED|Coarse-grained IP prefix. SHOULD be `/24` for IPv4, `/48` for IPv6. Full IPs MUST NOT be included.   |
|`components.user_agent`              |REQUIRED|User-Agent header sent by the client, truncated to 256 characters.                                   |
|`components.mcp_client_name`         |OPTIONAL|Client name from the MCP `initialize` handshake, if present.                                         |
|`components.mcp_client_version`      |OPTIONAL|Client version from the MCP `initialize` handshake, if present.                                      |
|`components.client_identity`         |OPTIONAL|Stable identifier the client claims for itself. In v0 typically an email address.                    |

Fingerprint composition MUST be deterministic. Conforming servers MUST include at minimum the two REQUIRED components; additional components SHOULD be included when available. Servers MUST document their fingerprint composition in `server_info.behaviors` (§10.3.1) so agents can reason about how stable the fingerprint will be across their requests.

#### Honest-signal client identity (client-supplied)

Conforming clients SHOULD send a `Cairn-Client-Identity` header (or the MCP-transport equivalent) with a stable identifier they are willing to be known by — in v0 typically an email address, organizational identifier, or domain. Clients that omit this receive a fingerprint computed from server-observable signals only, which is necessarily coarser and more easily evaded.

The asymmetry is the point: a mainstream MCP client that identifies itself produces a stable, recognizable fingerprint and earns proportionate trust from the candidate. An evasive client that omits identity, rotates IPs and User-Agents, and presents a different fingerprint on each request is visible to the candidate *as* an evasive client.

Cryptographic verification of client identity (counter-signed challenge-response) is outlined in §15.

#### What fingerprinting does and does not defend against

Fingerprinting makes token forwarding visible to the candidate. It does not prevent forwarding, does not invalidate forwarded URLs, and does not stop malicious clients from rotating their fingerprint by changing IPs and User-Agents between requests.

Defends against: silent fan-out under a bearer token, accidental forward-to-Slack patterns.

Does not defend against: a single recipient making many requests (no fan-out to detect), coordinated accessors using identical client configurations from different IPs deliberately designed to coalesce into one fingerprint, cached responses retained and re-shared by the original recipient without re-querying.

### 9.5 Tokens in URLs: security considerations

Tokens carried in URLs leak more easily than tokens carried in headers. They appear in browser history, server access logs, referrer headers, and copy-paste sharing. The pattern is well-understood — most modern unsubscribe links, document share URLs, and one-time access flows use it — and the convenience of single-artifact sharing outweighs the leakage risk for cold-query, where the data is already low-stakes by design. But implementations MUST mitigate the risks:

- Servers MUST require HTTPS for tokenized URLs.
- Servers MUST strip the token from their own access logs and SHOULD NOT include it in error responses or stack traces.
- Querying clients SHOULD treat the URL as sensitive and SHOULD NOT display the full URL in user-facing output.
- Servers MUST fingerprint requests over tokenized URLs (§9.4.1). This does not prevent forwarding but makes forwarding visible to the candidate as distinct fingerprints under the same `token_id`.

## 10. Protocol surface

A Cairn endpoint is an MCP server exposing the following tools and resources. Authorization is determined by the URL the client connects to (§9): tools called over the public URL return only `public` claims, while tools called over a tokenized URL return both `public` and `permissioned` claims, subject to the token's validity. `private` claims are never returned by any tool.

### 10.1 Tools

#### 10.1.1 `query_career` (REQUIRED)

Structured request for claims relevant to a stated information need, optionally informed by client context. The server selects, filters, and (where useful) synthesizes claims from the career object, subject to visibility, and returns them in standard Claim form.

```
Input: {
  "information_needed": string,
  "client"?: {
    "audience_email"?: string,
    "audience_hint"?: string,
    "role_context"?: string
  },
  "max_claims"?: number
}
Output: {
  "claims": Claim[]
}
```

`information_needed` is a free-text description of what the client is trying to learn (e.g. *"evidence of production React Native shipping in the last three years"*, *"leadership experience over teams larger than five"*). The server interprets this against the visible portion of the career object.

The `client` object is OPTIONAL informational context the agent provides about itself and its purpose. The server MAY use `client` fields to shape selection — e.g. prioritizing infrastructure work when `role_context` describes a distributed-systems role — but MUST NOT use them to expand visibility beyond what the connecting URL permits.

The server returns a list of `Claim` objects. Two kinds may appear:

1. **Stored claims** — claims as defined in §6, returned verbatim from the career object.
2. **Synthesized claims** — claims composed by the server at query time from one or more stored claims, with attestation `level: "derived"` (§7.3). A synthesized claim MUST NOT incorporate information from any source claim not visible to the requester, and MUST NOT introduce factual content not supported by its cited sources.

The server MUST NOT return a free-text `answer`, `summary`, or `confidence` field outside the claim structure. All output is claim-shaped so that querying agents apply consistent attestation reasoning and so that two conforming servers' outputs remain structurally comparable even when their selection logic differs.

The server's interpretation strategy is otherwise implementation-defined. Reference implementations MAY use the underlying agent's reasoning capability to select and synthesize claims; alternative implementations MAY use deterministic retrieval.

#### 10.1.2 `list_claims` (REQUIRED)

Structured listing of claims, with optional filters.

```
Input:  { "type"?: string, "since"?: ISO8601, "limit"?: number, "cursor"?: string }
Output: { "claims": Claim[], "next_cursor"?: string }
```

Derived claims (§7.3) MUST NOT appear in `list_claims` output. Listing returns only stored claims.

#### 10.1.3 `get_claim` (REQUIRED)

Retrieve a single claim by ID, with full attestation and evidence.

```
Input:  { "claim_id": string }
Output: { "claim": Claim }
```

`get_claim` MUST NOT return derived claims; derived claim IDs from a prior `query_career` response are not stable and not resolvable here.

### 10.2 Resources

#### 10.2.1 `identity` (REQUIRED)

The subject's identity claim, returned without authentication.

#### 10.2.2 `schema` (REQUIRED)

The schema version and JSON-LD context the server is using.

#### 10.2.3 `server_info` (REQUIRED)

Structured factual metadata about the server: protocol version, supported extensions, implementation identity, operator identity, declared conformance, and declared behaviors. Returned without authentication. The full structure is defined in §10.3.

### 10.3 Server self-description

A querying agent that lands on a Cairn endpoint needs to know what kind of server it is talking to: which protocol version, which extensions, who operates it, what behaviors to expect. The `server_info` resource provides this metadata.

In v0, all of `server_info` is **self-attested by the server**. The protocol does not yet support cryptographically signed third-party attestations of server behavior; agents that need stronger operator-identity or conformance guarantees are dependent on the v0.1 mechanisms outlined in §15.

#### 10.3.1 The `server_info` payload

```json
{
  "protocol_version": "cairn/0.1",
  "extensions": [],
  "implementation": {
    "name": "Assay Reference Server",
    "version": "0.3.2",
    "vendor": "ZabelTech",
    "vendor_url": "https://assay.bot",
    "source_url": "https://github.com/ZabelTech/Assay"
  },
  "operator": {
    "type": "hosted",
    "name": "Assay (assay.bot)",
    "url": "https://assay.bot",
    "contact_email": "operator@assay.bot",
    "privacy_policy_url": "https://assay.bot/privacy",
    "terms_url": "https://assay.bot/terms",
    "jurisdiction": "DE"
  },
  "conformance": {
    "required_tools": ["query_career", "list_claims", "get_claim"],
    "recommended_tools": [],
    "attestation_levels_enforced": ["self_attested", "email_attested", "derived"]
  },
  "behaviors": {
    "default_compensation_visibility": "private",
    "audit_logging": true,
    "token_log_stripping": true,
    "request_fingerprinting": true,
    "fingerprint_components": ["ip_prefix", "user_agent", "mcp_client_name", "mcp_client_version", "client_identity"]
  },
  "v0_1_extensions_supported": []
}
```

The `operator.type` field MUST be one of `hosted` (operated by a service provider), `self_hosted` (operated by the subject themselves), or `experimental` (development/research instance, not intended for production use).

`v0_1_extensions_supported` is an array of named extensions from the v0.1 RFC set (§15) that the server implements ahead of normative adoption. Conforming clients SHOULD ignore entries they do not recognize.

#### 10.3.2 What `server_info` does not contain

Servers MUST NOT include free-text "about us" or "trust statements" in `server_info`. The metadata is structured and factual by design. Implementations that wish to provide marketing content about themselves SHOULD do so on their `vendor_url` or `operator.privacy_policy_url`, not through the protocol.

Servers MUST NOT include numerical "trust scores," "reliability ratings," or other self-reported aggregate trust signals. The trust spectrum is the same one used for claim attestation: levels are determined by the attestation mechanism used, not by any number the server chose.

## 11. Versioning

The protocol uses [SemVer](https://semver.org/) for the schema version, prefixed with `cairn/`.

A career object's `schema_version` field declares the version it conforms to. Servers MUST be able to serve their declared version. Clients SHOULD support reading at least the latest minor versions of every major version they target.

Breaking changes (incompatible field renames, semantic changes to existing fields, removal of required fields) require a new major version. Additive changes (new optional fields, new claim types, new tools) require a new minor version.

The v0.1 release is expected to add the cryptographic mechanisms outlined in §15 as additive features, accompanied by a minor version bump.

## 12. Security considerations

- All Cairn endpoints SHOULD serve over HTTPS with a valid TLS certificate.
- Servers SHOULD rate-limit unauthenticated `query_career` requests to mitigate scraping and inference attacks.
- Servers SHOULD rate-limit document and image retrieval to mitigate scraping and bandwidth amplification attacks.
- Content hashes on rich evidence (§8.4, §8.5, §8.6) provide integrity but not authenticity. A querying agent verifying a hash confirms the file is the one the candidate published; it does not confirm the file came from any particular issuer. Stronger authenticity guarantees via embedded signature validation are outlined in §15.
- Screenshots provide no cryptographic guarantees and MUST NOT be treated as elevating attestation under any circumstances.
- Derived claims (§7.3) are server-mediated and inherit the trust of both the synthesizing server and their source claims. A compromised or malicious server can produce derived claims that misrepresent their sources; querying agents that depend on synthesis SHOULD be able to fall back to direct reasoning over `derived_from` source claims.
- Email-attested endorsements (§7.2) depend on the integrity of the endorser's email account and on the honesty of the verifying server. Email accounts get compromised; the verifying server is typically the candidate's own host (exposed by `verifier_is_subject_host`) and has a conflict of interest. Agents SHOULD weight email-attested claims accordingly.
- v0 does not provide cryptographic protection of any kind against host tampering with the career object. A malicious host can demote `private` claims to `public`, rewrite attestation metadata, fabricate claims, or forge audit log entries, and no v0 mechanism will detect this. Querying agents that need integrity guarantees against the host should require the host to support the subject signature mechanism outlined in §15.

## 13. Privacy considerations

- Career data is sensitive. Servers MUST default new claims to a sensible visibility (typically `permissioned`) rather than `public`.
- Servers SHOULD log access to permissioned claims and make the log available to the subject. For `query_career` calls, the log MUST capture source claims consulted in addition to claims returned (§9.4).
- Servers MUST honor revocation of URL tokens immediately. Cached results held by the querying agent are out of scope; the protocol cannot enforce them, only the subject's policy can.
- Rich evidence (documents, images, screenshots) carries higher privacy stakes than the structured claim fields it supports. Servers MUST default rich evidence to the visibility of its parent claim, never broader.
- Servers SHOULD strip GPS coordinates and other sensitive EXIF fields from images before serving, unless the candidate explicitly retains them. Servers SHOULD offer face-blurring and region-redaction tooling for images.
- Servers MUST NOT log full document contents in operator-accessible logs; only hashes, evidence IDs, and access timestamps.
- Servers SHOULD support encrypted-at-rest storage of original (unredacted) documents accessible only to the candidate, with only redacted copies exposed to the protocol.
- Querying agents SHOULD minimize the claims they request and retain. The principle of least privilege applies to careers as much as to APIs.
- Endorsers' email addresses are personal data. Servers MUST NOT disclose the local part of an endorser's email (§7.2) without explicit endorser opt-in during the verification flow, and MUST store the full address with the same protections applied to subject-private data. Servers SHOULD allow endorsers to revoke their endorsements and have their email records purged.
- Request fingerprinting (§9.4.1) is bidirectional: it makes recruiters' access patterns visible to candidates, not just candidates' data visible to recruiters. Servers MUST coarse-grain IP information in the fingerprint (prefix only, never full IP), MUST NOT include fields that uniquely identify a natural person beyond what the agent has chosen to disclose via `client_identity`, MUST truncate User-Agent strings to a reasonable maximum, and MUST document fingerprint composition in `server_info.behaviors.fingerprint_components`.
- The subject's email is a stable identifier across hosts. Implementations should make subjects aware that exposing it as a `public` `identity` handle enables linkage across sites.

## 14. Open questions in v0

The following are deliberately unresolved within v0's scope:

1. **Custom type registry.** Whether to operate a registry of common extensions (security clearances, professional licenses, industry-specific certs), and if so, on what governance model.
1. **Resource vs. tool access.** Whether the full career object should be exposed as an MCP resource, or whether all access should flow through tools. Leaning tools-only for v0.
1. **Verification freshness for email-attested claims.** Email-attested endorsements (§7.2) carry `verified_at` but no required staleness threshold. Whether to specify a default expiry beyond which email attestations are considered stale and SHOULD be re-solicited.
1. **Single-use tokens.** Whether to standardize a single-use token mode for one-shot resume-equivalent shares, or leave it as an implementation extension.
1. **Derivation method vocabulary.** Whether to standardize an enum of `method` values for derived claims (§7.3) — e.g. `llm_summary`, `aggregation`, `temporal_filter`, `selection_only` — so agents can mechanically reason about synthesis trust rather than parsing free-text labels.
1. **Derived-claim freshness semantics.** A `derived` claim's `derived_at` reflects synthesis time, not the freshness of underlying source claims. Whether agents should be required to surface the oldest timestamp among `derived_from` source claims rather than the synthesis timestamp.
1. **Fingerprint composition normativity.** §9.4.1 requires `ip_prefix` and `user_agent` and treats the other components as OPTIONAL. Whether to specify a fixed minimum component set so fingerprints are comparable across servers.
1. **Audit-log retention semantics.** Fingerprints persist information about querying agents on the candidate's side for as long as the audit log is retained. Whether to specify a default retention window.
1. **`availability` freshness.** This claim type is volatile and has no TTL. Whether to require a `valid_until` field or define a max-age beyond which `availability` claims SHOULD be ignored.
1. **`employment.end_date: null` ambiguity.** Currently means "current position" but is indistinguishable from "redacted" or "unfilled." Whether to add an explicit discriminator.

Resolved in v0:

- **Per-field visibility within a claim** — resolved as no. v0 supports visibility at the claim level only. Candidates who want fine-grained disclosure split the data into multiple claims with different visibility settings.
- **`request_access` as a protocol tool** — resolved as no. Cold-query is the protocol's scope (§1.1). Engagement requests happen out-of-band and the candidate responds with a tokenized URL.
- **Server-side trust signaling** — resolved as factual self-description only in v0 (§10.3). No free-text "trust statements," no self-reported scores. Signed third-party attestations are deferred to v0.1 (§15).
- **`query_career` output shape** — resolved as claim-shaped only. The tool returns `Claim[]` and no free-text `answer` or self-reported `confidence` score. Synthesis is permitted but MUST flow through the `derived` attestation level (§7.3).
- **Endorser identity floor in v0** — resolved as email-only. DID-signed endorsements are outlined for v0.1 (§15.5).
- **Subject identity** — resolved as email-based for v0 (§4). DID-based identity is outlined for v0.1 (§15.1).

## 15. Request for comments toward v0.1

The mechanisms below are deliberately out of scope for v0. They are listed here as RFC candidates for v0.1 so that prototypes and arguments can shape them before they harden into specification. Each entry sketches the mechanism, the value it would add, and the design questions it raises. None of these are normative in v0.

Servers MAY implement these mechanisms ahead of v0.1 and declare them in `server_info.v0_1_extensions_supported`; conforming clients MUST ignore extension names they do not recognize.

### 15.1 Decentralized Identifiers as canonical subject identity

**Mechanism.** The subject of a career object would be identified by a Decentralized Identifier (DID), most likely `did:key` for portability with a `did:web` alias for discoverable metadata. The `did:web` document would name the `did:key` in `alsoKnownAs`, so the canonical identity is host-independent and a subject moving between hosts retains the same identifier.

**Value.** Real portability of credentials, signatures, and tokens across hosts. Without DIDs, identity is the email address, which is portable but provides no cryptographic binding to a key — endorsements bound to "alice@example.com" depend on the operator's word that alice@example.com is the same person across hosts.

**Open questions.** Key rotation under `did:key` (the identifier is bound to a single key, so rotation changes the identifier); subsidiary signing keys for graceful rotation; X.509-to-DID mapping for embedded document signatures (§15.6); how multiple `did:web` aliases against one `did:key` should be reasoned about for subjects with multiple professional personas.

### 15.2 Subject signatures and canonicalization

**Mechanism.** OPTIONAL signatures from the subject's DID key over the canonicalized career object (full export) and individual claims (cold-query). Canonicalization via [RFC 8785 (JSON Canonicalization Scheme)](https://www.rfc-editor.org/rfc/rfc8785). Required algorithm: EdDSA (Ed25519); others optional.

**Value.** Cryptographic integrity defense against host tampering — modification of `value`, `attestation`, `evidence`, `visibility`, or timestamps; substitution of forged claims; fabrication of new claims. The v0 protocol provides no such defense; a hostile host can silently rewrite anything.

**Open questions.** Signed enumeration of claim IDs (closing the host-omits-claims gap that per-claim signatures cannot defend against); key custody declaration (operator-held vs. BYO-key) and how it surfaces in `server_info`; signature algorithm portfolio (ES256K, ES256 as alternatives to EdDSA); edit-cost UX for BYO-key users who must re-sign on every change.

### 15.3 Source-verified attestation

**Mechanism.** A new attestation level `source_verified` indicating that a claim is backed by a live or recent connection to a system of record, typically via OAuth — GitHub commits, App Store Connect ships, AWS certifications. The verification record includes the source, the verification timestamp, and an opaque `verification_id` for re-validation via `verify_claim`.

**Value.** The most commercially valuable trust signal in many practical cases. A senior backend role wants to see "847 merged PRs in this Stripe org, verified two weeks ago" more than it wants a self-attested employment claim. v0 surfaces metric values via the `metric` evidence type but does not verify them.

**Open questions.** Freshness semantics (max age, agent-side discounting); which sources to standardize first (GitHub, GitLab, App Store Connect, Google Scholar, others); how OAuth scope and consent surface to the candidate; how source-verification records are stored without retaining the OAuth tokens themselves.

### 15.4 Issuer-attested via Verifiable Credentials

**Mechanism.** A new attestation level `issuer_attested` backed by a [W3C Verifiable Credential 2.0](https://www.w3.org/TR/vc-data-model-2.0/) signed by a third-party issuer (employer, school, certifier). The credential's subject identifier matches the career object's subject DID (§15.1); the issuer is identified by their own DID. Server validation per the VC Data Model.

**Value.** Strong cryptographic backing for credentials the candidate already holds — university degrees, employer attestations, professional certifications. Aligns with the EU digital identity wallet ecosystem and the existing W3C credential infrastructure.

**Open questions.** OpenID4VC issuance and presentation flow integration; revocation propagation (W3C Status List, OCSP, CRL); how `verify_claim` exposes revocation discovery to querying agents; specific credential schemas (employment, education, certification) and their alignment with existing W3C profiles.

### 15.5 Peer-attested via DID signatures

**Mechanism.** A new attestation method `endorser_method: "did"` within `peer_attested` (or as an attestation level of its own), where the endorser signs the canonicalized endorsement `value` with their own DID key. The signature verifies against the endorser's DID Document.

**Value.** Cryptographically stronger than the email-attested endorsement in v0. An endorser with their own DID can vouch for the subject without depending on the candidate's hosting server to honestly record the verification — the signature is verifiable independent of the host.

**Open questions.** Coexistence with email-attested endorsements (the v0 baseline); whether to upgrade existing email-attested endorsements when the endorser obtains a DID; canonicalization scope (the signature should cover the endorsement value, not the envelope, so the candidate can adjust visibility without invalidating the endorsement).

### 15.6 Embedded document and image signature validation

**Mechanism.** Validation of cryptographic signatures embedded in evidence files: PAdES (PDF Advanced Electronic Signatures, mandated by eIDAS for qualified European signatures), CAdES (CMS-based for non-PDF documents), and C2PA manifests on images. A successfully validated embedded signature elevates the parent claim from `self_attested` to `issuer_attested`, with the signature's binding determining the issuer.

**Value.** Most candidates already hold signed PDFs — university diplomas, employer letters with qualified signatures, notarized documents. Without participating issuers, these documents can be elevated to full issuer attestation through their existing signatures. C2PA on images provides forge-resistant photographic evidence.

**Open questions.** X.509-to-DID mapping (PAdES signatures bind to X.509 subject DNs, not DIDs — the bridge needs a trust list or registry of canonical mappings); trust root configuration for European qualified certificates (EU Trusted Lists); whether C2PA validation should be REQUIRED for image evidence in v0.1 or remain RECOMMENDED until camera-side adoption is broader.

### 15.7 Signed JWT tokens with audience binding

**Mechanism.** Permissioning tokens become signed JWTs as in the prior draft, signed by the subject's DID key. Audience-bound tokens can be enforced by requiring the connecting client to counter-sign a server-issued challenge with the audience DID's key.

**Value.** Federated trust — a token issued by Alice's server could be honored by other Cairn-aware infrastructure without that infrastructure needing to query Alice's server's database. Audience binding makes forwarding ineffective for tokens intended to be tightly scoped.

**Open questions.** Coexistence with v0 opaque tokens (do servers support both? on a per-token basis?); challenge-response wire format (HTTP header pair, MCP `_meta` field, or a new MCP primitive); UX impact of audience binding on normal recruiter forwarding patterns within hiring teams.

### 15.8 Counter-signed client identity

**Mechanism.** Querying clients optionally cryptographically prove their claimed `client_identity` (§9.4.1) by signing a server-issued challenge nonce with the key bound to their identity DID. On success, the server records `client_identity_verified: true` in the fingerprint, and the candidate's audit log distinguishes verified accessors from those claiming an identity without proof.

**Value.** Closes the gap where evasive clients can claim a stable identity for fingerprint stability without actually being that identity. Required for any token model that wants to enforce audience binding.

**Open questions.** Challenge-response wire format (likely the same as §15.7); how verified identity persists across an MCP session vs. requiring re-verification per request; how this interacts with v0's bearer-style tokens (probably it doesn't — counter-signed identity is most valuable alongside audience-bound tokens).

### 15.9 DKIM-verified signed-reply email attestation

**Mechanism.** Adds a `challenge_method: "signed_reply"` to email attestation (§7.2.1) in which the endorser replies to the challenge email and the reply carries a valid DKIM signature from the stated domain. The DKIM signature provides cryptographic proof of domain control rather than mere clickthrough, raising the trust level of the email-attested endorsement.

**Value.** Strongest email-attested form available short of bringing in a full DID. Domain-bound rather than user-bound, but for endorsers from corporate domains this is often what matters ("the endorser is genuinely at @stripe.com, not just someone who could read a forwarded email").

**Open questions.** DKIM key rotation — the verification record's `verified_at` may fail to revalidate later if the DKIM key has rotated; whether to archive the DKIM key state at verification time; reply mailbox plumbing (operators need to host the reply address); how this composes with replied-via-mailing-list-server cases that strip or re-sign DKIM.

### 15.10 Per-request nonces

**Mechanism.** A client-supplied opaque per-request value (e.g. a `Cairn-Request-Nonce` header or MCP-transport equivalent metadata field) that the server records in the audit log alongside the request. The nonce does not affect access control — servers do not reject requests that omit it — and does not contribute to fingerprint identity. Its purpose is to let the candidate distinguish distinct accesses from cache replay or refresh in their audit log UI.

**Value.** Disambiguates "12 fresh accesses by the recruiter" from "1 request whose response was cached and re-displayed 12 times" in the candidate's audit log. Composes with the request fingerprinting in §9.4.1 to give the candidate richer signal about what's happening on the other side of a tokenized URL.

**Open questions.** Whether the nonce should be normatively required (transparency aid that all conforming clients SHOULD send) or remain a recommendation; transport binding (HTTP header vs. MCP `_meta` field on the JSON-RPC envelope); interaction with mid-stream cache layers that the candidate's server does not observe; whether the audit-log entry should distinguish "client sent a unique nonce" from "client did not send a nonce" from "client sent a previously-seen nonce" structurally rather than leaving it to UI interpretation.

### 15.11 `verify_claim` tool

**Mechanism.** A protocol-level MCP tool that re-runs verification on a single claim by ID. Behavior depends on attestation level: for source-verified claims (§15.3) the server would trigger a fresh check against the system of record; for issuer-attested claims (§15.4) it would re-validate the credential signature and check revocation status; for email-attested claims it would return the stored verification record. Output is a small structured envelope: `{ valid, verified_at, details }`.

**Value.** Gives querying agents a uniform way to refresh trust signals over time without re-fetching the entire claim set. Particularly important for the cryptographic attestation levels in §15.3 and §15.4, where revocations and certificate expirations propagate to agents through this tool rather than through any push mechanism. v0 omits it because v0's two real attestation mechanisms (self and email) don't have meaningful re-verification semantics — the email challenge cannot be re-run after the fact, and self-attestation has nothing to verify.

**Open questions.** Whether `verify_claim` should be REQUIRED or RECOMMENDED in v0.1 (probably REQUIRED once §15.3 or §15.4 land, since revocation propagation depends on it); rate-limiting and abuse considerations (re-verification triggers external system calls); behavior for derived claims (no-op, traverse to sources, or return aggregate status); structured `details` schema vs. free-form per attestation level.

## 16. References

- [Model Context Protocol](https://modelcontextprotocol.io)
- [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/)
- [RFC 2119 — Key words for use in RFCs](https://www.rfc-editor.org/rfc/rfc2119)
- [Schema.org](https://schema.org)

References cited only by §15 (v0.1 RFC) — listed for forward reference, not used normatively in v0:

- [W3C Decentralized Identifiers (DIDs)](https://www.w3.org/TR/did-core/)
- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [OpenID for Verifiable Credentials](https://openid.net/sg/openid4vc/)
- [RFC 8785 — JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785)
- [C2PA Content Provenance Specification](https://c2pa.org/specifications/)
- [ETSI EN 319 142 (PAdES)](https://www.etsi.org/deliver/etsi_en/319100_319199/31914201/)

-----

*This is v0. Argue with it.*
