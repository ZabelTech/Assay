# Cairn Protocol v0

**Status:** Draft. This document is a request for comments, not a frozen specification. Breaking changes are expected before v0.1. The goal of publishing it now is to make the design soft and visible while it can still be shaped by the engineers who will use it.

**Last updated:** 2026-05-11

**Editor:** ZabelTech

-----

## 1. Overview

The Cairn Protocol defines how a person's professional history is exposed as a live, structured, permissioned, machine-readable endpoint that AI agents can query.

It replaces the resume — a static document optimized for printers — with a queryable interface that returns evidence-backed answers. It does not specify what a hiring decision should look like. It specifies what the candidate-side data should look like, what claims about that data mean, how those claims can be verified, and how a recruiter's agent fetches them.

Cairn is a profile of the [Model Context Protocol](https://modelcontextprotocol.io). A Cairn endpoint is an MCP server that exposes a specific set of tools and resources defined here. Any MCP-compatible client can speak to it. Any conforming server interoperates with any conforming client.

### 1.1 Scope: cold-query only

Cairn governs the cold-query layer — the moment an agent first encounters a candidate's professional context and decides whether to engage. What happens after that — phone screens, written exchanges, offers, negotiations — happens between humans, off-protocol. Cairn deliberately does not model progressive disclosure across interview stages, conditional grants, or post-offer negotiation. Those are conversation problems, not data-shape problems, and the protocol's job ends once a recruiter and candidate are in contact.

## 2. Conformance

The keywords MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174).

A *conforming server* MUST implement all tools and resources marked REQUIRED in §10. A conforming server MUST accept and serve career objects that validate against the schema in §5–§9. A conforming server SHOULD implement all tools and resources marked RECOMMENDED.

A *conforming client* MUST be able to consume any career object that validates against this specification. A conforming client SHOULD respect the visibility metadata defined in §9 when displaying or forwarding claims.

## 3. Terminology

**Subject** — the person a career object describes. Identified by a DID (§4).

**Career object** — the top-level document served by a Cairn endpoint. Contains a collection of claims about the subject. Defined in §5.

**Claim** — an atomic assertion about the subject, with attached metadata describing who is asserting it and how it can be verified. Defined in §6.

**Attestation** — metadata on a claim describing the trust level and verification method. Defined in §7.

**Evidence** — links and references attached to a claim that allow third parties to inspect the underlying material. Defined in §8.

**Endpoint** — the URL at which a Cairn server is reachable. Speaks MCP over HTTP (or other MCP-supported transports).

**Issuer** — an entity (organization, school, employer, certifier) that signs verifiable credentials about a subject.

**Endorser** — an individual who signs a peer attestation about a subject.

**Querying agent** — an MCP client (typically operating on behalf of a recruiter, employer, or hiring system) that connects to a Cairn endpoint to read claims.

## 4. Identity

The subject of a career object MUST be identified by a [Decentralized Identifier (DID)](https://www.w3.org/TR/did-core/).

The canonical subject identifier is `did:key`. This method is host-independent: the identifier is derived directly from the subject's public key and can be resolved without any network call or hosting dependency. A subject who moves between hosts retains the same `did:key`, and credentials, tokens, and signatures bound to that identifier remain valid across the move. This is the property the protocol relies on to make a career portable across forty years and an unknown number of operators.

Conforming servers MUST support `did:key` as a subject identifier. Conforming servers SHOULD also support `did:web` as a complementary alias used for richer metadata — service endpoints, discoverable URLs, additional verification methods bound to a hosting context. Other DID methods (e.g., `did:ion`) MAY be supported.

A `did:key` looks like:

```
did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
```

Resolution of `did:key` is deterministic: the public key is decoded from the multibase suffix and the DID Document is generated locally with no network call.

### 4.1 The two-identifier pattern

The protocol expects most subjects to publish a `did:key` as their canonical identifier and additionally host a `did:web` document that names the `did:key` in its `alsoKnownAs` array. The `did:web` provides discoverable, host-bound metadata; the `did:key` provides portable identity.

A typical DID Document at `https://alice.career/.well-known/did.json`:

```json
{
  "@context": "https://www.w3.org/ns/did/v1",
  "id": "did:web:alice.career",
  "alsoKnownAs": [
    "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
  ],
  "verificationMethod": [
    {
      "id": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
      "publicKeyMultibase": "z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
    }
  ],
  "service": [
    {
      "id": "#cairn",
      "type": "CairnEndpoint",
      "serviceEndpoint": "https://alice.career/mcp"
    }
  ]
}
```

Career objects, claims, tokens, and credentials bound to the subject MUST use the `did:key` form as the value of `subject`, `iss`, and credential subject identifiers. The `did:web` MAY appear as an `alsoKnownAs` cross-reference or as a discoverable URL in `identity.handles` (§6.2), but is not the canonical identity.

Querying agents that encounter a `did:web` subject in older or non-conforming data SHOULD resolve the DID Document and follow `alsoKnownAs` to the canonical `did:key` before reasoning about the subject's identity.

### 4.2 Portability under host change

A subject who moves between hosts:

1. Stands up a new `did:web` at the new host with the same `did:key` in `alsoKnownAs`.
2. Updates the old host's `did:web` (if still reachable) to redirect or deprecate.
3. Re-issues any active permissioned tokens with `iss` set to the canonical `did:key`.
4. Retains all credentials, signatures, and historical attestations bound to the `did:key` — none of them need to be re-issued, because none of them were bound to the host.

This pattern makes the BYO-key requirement in §13 load-bearing: portability depends on the subject controlling the underlying signing key independently of the host. A subject whose key is held only by the hosted operator gains the structural benefit of `did:key` only as long as the operator continues to serve them.

### 4.3 Key rotation

`did:key` is bound to a single public key. Rotating the key changes the identifier. For long-lived professional identity, this is a significant constraint: a key compromise means identity loss, and there is no graceful rotation path within the `did:key` method alone.

For v0, the spec accepts this constraint and recommends that subjects treat their `did:key` private key as long-lived material protected accordingly — hardware key storage, offline backups, custody discipline appropriate to a decade-plus lifetime. Subsidiary signing keys for routine use, such that the long-lived identity key signs only delegations, are deferred to a later version (§15).

### 4.4 Identifiers for issuers, endorsers, and operators

Issuers, endorsers, and server operators SHOULD also be identified by DIDs so that signed claims and metadata can be cryptographically verified against a resolvable public key.

Organizations with persistent web hosting (employers, schools, certifying bodies, Cairn operators) SHOULD use `did:web`, since the discoverability and rich-metadata benefits outweigh portability concerns for entities with a stable web presence. Individuals (endorsers, self-hosted subjects) SHOULD use `did:key`. For endorsers who do not yet have any DID, verified-email identity (§7.4) is permitted as a fallback, with the trust implications described there.

## 5. The Career Object

A career object is the root document served by a Cairn endpoint. It has the following shape:

```json
{
  "@context": [
    "https://schema.org",
    "https://w3.org/ns/credentials/v2",
    "https://cairn.dev/schemas/v0"
  ],
  "schema_version": "cairn/0.1",
  "subject": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  "updated_at": "2026-05-10T14:32:00Z",
  "claims": [
    { ... },
    { ... }
  ],
  "signature": {
    "alg": "EdDSA",
    "key_id": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    "created_at": "2026-05-10T14:32:00Z",
    "value": "..."
  }
}
```

|Field           |Type              |Required|Description                                                         |
|----------------|------------------|--------|--------------------------------------------------------------------|
|`@context`      |array of strings  |REQUIRED|JSON-LD contexts. MUST include the Cairn v0 context.                |
|`schema_version`|string            |REQUIRED|The Cairn schema version this object conforms to.                   |
|`subject`       |DID               |REQUIRED|The identifier of the person this object describes.                 |
|`updated_at`    |ISO-8601 timestamp|REQUIRED|Last modification time of the career object.                        |
|`claims`        |array of Claim    |REQUIRED|The claims that make up the career. May be empty.                   |
|`signature`     |object            |OPTIONAL|Subject signature over the canonicalized career object. See §6.4.   |

The career object MAY contain additional implementation-specific fields. Conforming clients MUST ignore unrecognized top-level fields.

The career-object `signature` covers the entire document, including the full `claims` array. It is most useful for full-export scenarios — for example, the candidate downloading their own data, or a tokenized URL granting unfiltered access. It is **not** verifiable against a filtered response returned by a tool call subject to visibility (§9), because filtering changes the canonicalized bytes. For cold-query patterns where filtering applies, per-claim signatures (§6.1) are the practical form.

## 6. Claims

A claim is the atomic unit of the protocol. The career object is a collection of claims; everything queryable about a person is expressed as one.

### 6.1 Common claim fields

Every claim, regardless of type, has the following common shape:

```json
{
  "claim_id": "clm_8f2a4c7d...",
  "subject": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  "type": "employment",
  "value": { ... },
  "evidence": [ ... ],
  "attestation": { ... },
  "visibility": "public",
  "created_at": "2024-09-02T10:14:00Z",
  "updated_at": "2024-09-02T10:14:00Z",
  "signature": {
    "alg": "EdDSA",
    "key_id": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    "created_at": "2024-09-02T10:14:00Z",
    "value": "..."
  }
}
```

|Field        |Type              |Required|Description                                                       |
|-------------|------------------|--------|------------------------------------------------------------------|
|`claim_id`   |string            |REQUIRED|Stable, unique identifier for this claim within the career object.|
|`subject`    |DID               |REQUIRED|Always equal to the career object's subject.                      |
|`type`       |string            |REQUIRED|One of the standard types in §6.2 or a custom type per §6.3.      |
|`value`      |object            |REQUIRED|The claim's payload. Shape depends on `type`.                     |
|`evidence`   |array             |OPTIONAL|Links to underlying material. See §8.                             |
|`attestation`|object            |REQUIRED|Trust metadata. See §7.                                           |
|`visibility` |enum              |REQUIRED|`public`, `permissioned`, or `private`. See §9.                   |
|`created_at` |ISO-8601 timestamp|REQUIRED|When the claim was first added to the career object.              |
|`updated_at` |ISO-8601 timestamp|REQUIRED|When the claim was last modified.                                 |
|`signature`  |object            |OPTIONAL|Subject signature over the canonicalized claim envelope. See §6.4.|

The optional `signature` field is a signature from the subject covering the entire claim envelope (the claim object minus the `signature` field itself), per §6.4. When present, it defends against the host modifying `value`, `attestation`, `evidence`, `visibility`, or timestamps after the claim was authored. It does not defend against the host omitting claims from a response entirely — see §6.4 for the full threat model and §13 for security considerations. Derived claims (§7.5) MUST NOT carry a subject signature; they are server-generated and not authored by the subject.

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
      "email": "hello@alice.career",
      "linkedin": "alicechen-eng"
    }
  }
}
```

The `handles` object is the recommended place for contact information. Recruiters who land on a candidate's public endpoint and want to engage further reach out through one of these handles; if the candidate is interested, they reply with a tokenized URL granting permissioned access (§9).

#### `employment`

A position at an organization.

```json
{
  "type": "employment",
  "value": {
    "employer": "Stripe",
    "employer_id": "did:web:stripe.com",
    "title": "Senior Software Engineer",
    "start_date": "2021-03-01",
    "end_date": "2024-08-15",
    "summary": "Worked on the financial reporting platform team."
  }
}
```

`end_date` MAY be null for current positions. `employer_id` is OPTIONAL but enables cross-referencing with issuer-attested credentials.

#### `education`

A program at an institution.

```json
{
  "type": "education",
  "value": {
    "institution": "TU Berlin",
    "institution_id": "did:web:tu-berlin.de",
    "program": "M.Sc. Computer Science",
    "start_date": "2017-10-01",
    "end_date": "2020-09-01"
  }
}
```

#### `project`

Something the subject built or shipped. Evidence is particularly important for this type.

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

A certification, license, or formal qualification. Most credentials in production should be `issuer_attested` with a Verifiable Credential attached.

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

A vouch from a third party about a specific quality of the subject. Always either `issuer_attested` or `peer_attested`.

```json
{
  "type": "endorsement",
  "value": {
    "endorser": "did:web:bob.dev",
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

```json
{
  "type": "compensation",
  "value": {
    "type": "current_total",
    "base": 165000,
    "currency": "EUR",
    "equity_value_estimate": 40000,
    "bonus_target": 0.15,
    "as_of": "2026-04-01"
  },
  "visibility": "private"
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

> **Open question.** Whether to operate a registry of custom types so the most common extensions (security clearances, professional licenses, industry-specific certs) get standardized. Probably yes, post-v0.

### 6.4 Subject signatures and canonicalization

Subject signatures are an OPTIONAL integrity layer over the career object (§5) and individual claims (§6.1). They are produced by the subject's DID key and verifiable by any querying agent against the subject's DID Document.

Conforming servers MAY produce and serve subject signatures. Conforming clients MUST be able to consume career objects and claims regardless of whether signatures are present; clients that verify signatures MUST do so per the rules in this section.

#### 6.4.1 Signature shape

Both the career-object signature and the claim signature use the same shape:

```json
"signature": {
  "alg": "EdDSA",
  "key_id": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  "created_at": "2026-05-10T14:32:00Z",
  "value": "base64url-encoded-signature-bytes"
}
```

|Field       |Required|Description                                                                                            |
|------------|--------|-------------------------------------------------------------------------------------------------------|
|`alg`       |REQUIRED|Signature algorithm. Conforming implementations MUST support `EdDSA` (Ed25519). Others MAY be supported.|
|`key_id`    |REQUIRED|Verification method identifier in the subject's DID Document.                                          |
|`created_at`|REQUIRED|Timestamp at which the signature was produced.                                                         |
|`value`     |REQUIRED|Base64url-encoded signature bytes.                                                                     |

#### 6.4.2 Canonicalization

The signed bytes are produced by [JSON Canonicalization Scheme (RFC 8785)](https://www.rfc-editor.org/rfc/rfc8785) applied to the object with its `signature` field removed.

The procedure for signing:

1. Construct the object (career object or claim) without a `signature` field.
2. Canonicalize the object per RFC 8785.
3. Sign the canonicalized bytes with the subject's private key corresponding to `key_id`.
4. Attach the resulting `signature` object to the original.

The procedure for verifying:

1. Resolve the subject's DID Document and locate the verification method identified by `key_id`.
2. Construct a copy of the received object without its `signature` field.
3. Canonicalize the copy per RFC 8785.
4. Verify the signature against the canonicalized bytes using the resolved public key.

Conforming clients that verify signatures MUST treat verification failure as an integrity failure and SHOULD surface this to any human in the loop. Clients MAY refuse to act on claims whose signatures fail to verify.

#### 6.4.3 What signatures defend against

Subject signatures defend against the following classes of host tampering:

- Modification of a claim's `value`, `attestation`, `evidence`, `visibility`, or timestamps after the claim was authored.
- Substitution of a forged claim under an existing `claim_id`.
- Insertion of a fabricated claim into the career object's signed `claims` array (career-object signature only).

Subject signatures do **not** defend against:

- The host omitting claims from a response. A signed `claims` array in the full career object is verifiable only when the full array is returned; tools that filter by visibility (§9) return a subset, and no per-claim signature can prove the absence of other claims. A signed-enumeration mechanism for detecting omissions is deferred to a later version of the protocol.
- The host returning stale claims. The protocol does not currently specify a freshness binding between signature timestamps and response freshness.
- Audit log forgery. Audit logs are operator-generated and cannot be signed by the subject; their integrity depends on operator honesty.

#### 6.4.4 Key custody and the trust model

Subject signatures provide cryptographic defense against host tampering only to the extent that the host does not also control the signing key. A hosted Cairn operator that holds the subject's signing key can re-sign any modification it makes, reducing the threat model to operator trust — the same level as unsigned claims.

For signatures to provide independent integrity guarantees, the signing key MUST be controlled outside the operator. This typically means either a candidate-side device (a browser-resident key, a mobile wallet, a hardware key) or a separate signing service the candidate controls. Hosted operators SHOULD support BYO-key configurations (§13).

The protocol does not provide a cryptographic way to declare whether a given signature was produced by a host-held or subject-held key — that distinction is itself outside the cryptographic envelope. Agents reasoning about it depend on `server_info.behaviors.subject_key_custody` (§10.3.1) and on any third-party operator audits (§10.3.2).

#### 6.4.5 Derived claims and signatures

Derived claims (§7.5) MUST NOT carry a subject `signature` field, because derivations are authored by the server at query time, not by the subject. Servers MAY sign derived claims with their own DID key as part of `attestation.derived_by`-bound proof; this is OPTIONAL in v0 and not standardized.

## 7. Attestation

Every claim MUST carry an `attestation` object describing how the claim is backed.

There are five attestation levels:

### 7.1 `self_attested`

The subject said so. No external verification. Equivalent to a line on a resume.

```json
"attestation": { "level": "self_attested" }
```

### 7.2 `source_verified`

The claim is backed by a live or recent connection to a system of record, typically via OAuth.

```json
"attestation": {
  "level": "source_verified",
  "source": {
    "name": "GitHub",
    "url": "https://github.com/alicechen",
    "method": "oauth2"
  },
  "verified_at": "2026-05-08T09:14:00Z",
  "verification_id": "vfy_3a1c..."
}
```

The `verification_id` SHOULD reference a verification record the server can return on request via `verify_claim` (§10.1.4).

Source-verified claims SHOULD include the freshness window (`verified_at`). Querying agents MAY discount source-verified claims based on age.

### 7.3 `issuer_attested`

The claim is backed by a [W3C Verifiable Credential](https://www.w3.org/TR/vc-data-model-2.0/) signed by a third-party issuer.

```json
"attestation": {
  "level": "issuer_attested",
  "issuer": "did:web:stripe.com",
  "credential_id": "vc_b7e2...",
  "credential_url": "https://alice.career/credentials/vc_b7e2",
  "issued_at": "2024-09-02T10:14:00Z",
  "expires_at": null
}
```

The credential MUST be retrievable by the querying agent (subject to visibility, §9). The credential MUST verify against the issuer's DID Document.

### 7.4 `peer_attested`

The claim is backed by an individual endorser, typically over an `endorsement` claim. Two endorser identity methods are recognized, discriminated by the `endorser_method` field. DID-signed is preferred; verified-email is a documented fallback for endorsers who do not yet have a DID.

#### 7.4.1 `endorser_method: "did"` (preferred)

```json
"attestation": {
  "level": "peer_attested",
  "endorser_method": "did",
  "endorser": "did:web:bob.dev",
  "signature": "...",
  "signed_at": "2026-04-10T08:00:00Z"
}
```

The signature MUST verify against the endorser's DID Document, over the canonicalized `value` of the parent claim.

#### 7.4.2 `endorser_method: "verified_email"` (fallback)

```json
"attestation": {
  "level": "peer_attested",
  "endorser_method": "verified_email",
  "endorser_email_domain": "acme.com",
  "endorser_email_local": "bob",
  "endorser_name": "Bob Müller",
  "verification": {
    "verification_id": "vfy_email_a3f9...",
    "verified_at": "2026-04-10T08:00:00Z",
    "verifier": "did:web:assay.bot",
    "verifier_is_subject_host": true,
    "challenge_method": "click_through_link",
    "payload_hash": "sha256:8f2a4c7d..."
  }
}
```

The verified-email form is structurally weaker than the DID-signed form: there is no cryptographic key bound to the endorser, so trust in the endorsement transfers to trust in the `verifier` server. Querying agents SHOULD treat `verified_email` endorsements as weaker than DID-signed endorsements but stronger than `self_attested` claims by the subject.

|Field                       |Required   |Description                                                                                  |
|----------------------------|-----------|---------------------------------------------------------------------------------------------|
|`endorser_email_domain`     |REQUIRED   |The domain part of the endorser's verified email address (e.g. `acme.com`).                  |
|`endorser_email_local`      |OPTIONAL   |The local part of the address (`bob` in `bob@acme.com`). Disclosed only with endorser opt-in.|
|`endorser_name`             |RECOMMENDED|Human-readable endorser name as supplied during verification.                                |
|`verification.verification_id`|REQUIRED |Stable ID for the verification record, resolvable via `verify_claim` (§10.1.4).              |
|`verification.verified_at`  |REQUIRED   |Timestamp at which the endorser completed the challenge.                                     |
|`verification.verifier`     |REQUIRED   |DID of the server that performed the email challenge.                                        |
|`verification.verifier_is_subject_host`|REQUIRED|Boolean. `true` if `verifier` equals the candidate's `server_info.operator.did`.    |
|`verification.challenge_method`|REQUIRED|One of the methods defined below.                                                            |
|`verification.payload_hash` |REQUIRED   |Hash over the canonicalized `value` of the parent claim at the time of verification.         |

The domain part of the endorser's email MUST be disclosed; the local part is OPTIONAL and disclosed only with the endorser's explicit opt-in during the verification flow. This lets agents reason about endorser context (*"the endorser is at @stripe.com"*) without exposing personal email addresses by default.

To produce a verified-email endorsement, a Cairn server MUST:

1. Send a verification challenge to the endorser's stated email address, containing a unique single-use token bound to the specific endorsement payload.
2. On the endorser's response, capture the timestamp and the endorser's confirmation of the endorsement text (which the endorser MAY edit before confirming).
3. Compute `payload_hash` over the canonicalized parent claim `value` as confirmed.
4. Sign the verification record with the server's DID key and store it under a stable `verification_id` retrievable via `verify_claim`.

`verifier_is_subject_host: true` means the candidate's own server performed the verification — the common case, but a conflict of interest. Agents SHOULD note this and weight accordingly. A third-party verifier (an independent email-verification service) yields a stronger record but is OPTIONAL.

#### 7.4.3 Challenge methods

The `challenge_method` field describes how the endorser proved control of the email address. v0 recognizes:

- **`click_through_link`** — the endorser clicked a unique link in the challenge email. Lowest friction, lowest trust. Demonstrates only that the recipient could read the email and act on a link; vulnerable to email auto-clicking security scanners and to opportunistic forwarding.
- **`code_return`** — the endorser received a code by email and returned it through a separate channel (typically a dashboard URL the endorser navigates to manually). Modestly stronger because it requires two-channel interaction.
- **`signed_reply`** — the endorser replied to the challenge email and the reply carries a valid DKIM signature from the stated domain. When the domain's DKIM key is independently resolvable, this method provides cryptographic proof of domain control rather than mere clickthrough, and is the strongest of the three.

Servers MAY support additional challenge methods using namespaced identifiers (`x:custom_method`). Querying agents that do not recognize a method SHOULD treat the verification as no stronger than `click_through_link`.

Calls to `verify_claim` (§10.1.4) on a verified-email endorsement MUST return the full verification record, including the `verifier` DID and `challenge_method`, so agents can re-assess trust.

#### 7.4.4 Upgrading to DID

Servers SHOULD support re-issuing a `verified_email` endorsement under a DID signature when the endorser later obtains a DID. The re-issued claim is a new claim (new `claim_id`, new `created_at`) referencing the same underlying endorsement; the original verified-email claim MAY be retained, retired, or replaced at the candidate's discretion.

### 7.5 `derived`

The claim was composed by the server at query time from one or more underlying claims, in response to a `query_career` request (§10.1.1). The synthesis itself carries the server's attestation, not the subject's; the underlying source claims retain their original attestation and remain independently verifiable.

```json
"attestation": {
  "level": "derived",
  "derived_by": "did:web:assay.bot",
  "derived_at": "2026-05-10T14:32:00Z",
  "method": "llm_selection_and_summary",
  "derived_from": ["clm_8f2a...", "clm_d1c4...", "clm_a3f9..."]
}
```

|Field          |Required   |Description                                                                                  |
|---------------|-----------|---------------------------------------------------------------------------------------------|
|`derived_by`   |REQUIRED   |DID of the server performing the synthesis. Typically the operator DID in `server_info`.     |
|`derived_at`   |REQUIRED   |Timestamp at which the synthesis was performed.                                              |
|`method`       |REQUIRED   |Free-text label describing how the synthesis was produced. v0 does not standardize an enum.  |
|`derived_from` |REQUIRED   |List of source claim IDs used in the synthesis. Each MUST resolve via `get_claim` (§10.1.3). |

A derived claim MUST be supported by the claims listed in `derived_from`. Servers MUST NOT introduce factual content in a derived claim that is not supported by at least one of its sources.

A derived claim MUST NOT incorporate information from any source claim not visible to the requester. Visibility is enforced at the source-claim level before synthesis.

Derived claims MUST NOT be persisted as part of the career object. They exist only in the response to the request that produced them, and re-issuing the same request MAY yield different derived claims as the underlying career evolves.

Querying agents SHOULD treat the effective trust of a derived claim as the minimum of (a) the trust the agent assigns to the synthesizing server (per `server_info`, §10.3) and (b) the weakest attestation level among the source claims listed in `derived_from`. Agents that prefer to bypass synthesis can traverse `derived_from` and reason directly over the source claims.

A claim with `attestation.level = derived` MUST NOT be cited in another claim's `evidence_claims` array; derived claims are transient and dangling references are forbidden.

### 7.6 Multiple attestations

A single underlying fact MAY be expressed as multiple claims with different attestation levels. For example, Alice's tenure at Stripe could appear as both a `self_attested` employment claim and an `issuer_attested` employment claim. Querying agents reconcile these as appropriate.

### 7.7 Attestation via embedded document signatures

A `document` evidence object (§8.4) that carries a valid embedded cryptographic signature from an identifiable issuer MAY serve as the credential basis for an `issuer_attested` claim. This elevation path lets candidates present credentials they already possess — signed PDFs from universities, notarized contracts, government-issued documents — at full issuer-attestation trust, without requiring the original issuer to participate in the Cairn ecosystem.

When using a signed document for issuer attestation:

- The claim's `attestation.credential_url` MUST resolve to the signed document.
- The claim's `attestation.issuer` MUST match the identity bound to the signature (per the rules in §11).
- The server MUST validate the signature, certificate chain (where applicable), validity period, and revocation status before marking the document `signature.valid: true` and the claim `issuer_attested`.

Conforming servers MUST validate at least PAdES (PDF Advanced Electronic Signatures) signatures. Servers SHOULD also validate CAdES, C2PA manifests on documents, and W3C Verifiable Credentials embedded as document attachments. See §11 for the full credential-format rules.

## 8. Evidence

The optional `evidence` array on any claim contains references to underlying material a third party can inspect. Evidence is distinct from attestation: attestation describes *who says this is true*; evidence describes *what a curious party can go look at*. Both can appear on the same claim.

### 8.1 The evidence array

Every claim MAY carry zero or more evidence objects. Each evidence object has a `type` discriminator that determines its shape; the rest of this section defines the standard types. Implementations MAY define custom evidence types using a namespaced identifier (`x:custom_type`); conforming clients MUST NOT reject claims containing custom evidence types and SHOULD surface them in raw form when they cannot interpret them.

### 8.2 The `url` evidence type

The simplest evidence type. A reference to a URL where the underlying material lives.

```json
{ "type": "url", "url": "https://github.com/alice/field-notes", "label": "Source repository" }
```

### 8.3 The `verified_metric` evidence type

A specific metric pulled from a system of record, typically alongside a `source_verified` attestation.

```json
{
  "type": "verified_metric",
  "source": "GitHub",
  "metric": "commits",
  "value": 847,
  "verified_at": "2026-05-08T..."
}
```

### 8.4 The `document` evidence type

A document is a file containing structured or semi-structured information that supports a claim. Common examples: offer letters, employment contracts, diploma scans, certificates, press releases, signed agreements.

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
  "redactions": ["compensation_amount", "manager_name"],
  "signature": {
    "present": true,
    "format": "pades_b_lt",
    "issuer": "did:web:stripe.com",
    "valid": true,
    "verified_at": "2026-05-08T12:00:00Z"
  }
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
|`signature`   |OPTIONAL   |Embedded cryptographic signature metadata. Required if the document is the credential basis for `issuer_attested` (§7).|

The `content_hash` MUST cover the exact bytes of the file at `document_url`. Querying agents SHOULD verify the hash on retrieval and SHOULD treat mismatches as integrity failures.

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
    "location_present": false,
    "c2pa_present": true,
    "c2pa_valid": true
  }
}
```

The `capture` object summarizes EXIF and provenance data that bears on the image's authenticity. Servers SHOULD extract this metadata at upload and store it alongside the image. Servers MUST NOT surface raw GPS coordinates or other sensitive EXIF fields unless the candidate explicitly opts in; the default `location_present` boolean reveals whether location data was originally embedded without disclosing the location itself.

When [C2PA](https://c2pa.org/) provenance signatures are present, servers SHOULD verify them and report validity in `c2pa_valid`. C2PA-signed images are meaningfully harder to forge than unsigned ones, and querying agents will increasingly weight them accordingly.

### 8.6 The `screenshot` evidence type

A digital capture of an on-screen artifact. Common examples: messaging-app threads, dashboards showing metrics, internal documents naming the candidate.

Screenshots are deliberately a distinct evidence type — not a subtype of `image` — because they have a different trust profile. Photographs of physical objects can carry C2PA provenance from the capture device; screenshots are by construction synthetic and trivially editable.

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

Screenshots default to the same trust level as self-attestation: the candidate is asserting that the screenshot depicts what they say it depicts. The protocol does not provide a verification path for screenshots beyond what is true of any self-attested claim. Querying agents SHOULD weight screenshots accordingly — useful as supporting evidence alongside stronger primary attestation, rarely sufficient alone.

### 8.7 Multi-evidence corroboration

A claim MAY carry multiple evidence objects of any combination of types. The protocol does not aggregate them into a unified score; it surfaces them faithfully and leaves weighting to the querying agent. When a claim has both `issuer_attested` evidence (a signed document, a VC) and supporting evidence of other types, the claim's overall attestation level is determined by the strongest evidence; supporting evidence remains valuable as inspection material.

A claim with only `self_attested` attestation but multiple high-quality evidence items is still `self_attested` at the protocol level. Querying agents that reason about the evidence bundle MAY assign higher confidence in practice; the spec deliberately does not codify this.

## 9. Visibility and permissioning

Each claim has a `visibility` field with one of three values:

- **`public`** — returned to any client connecting to the public endpoint URL. No authentication required.
- **`permissioned`** — returned only to clients connecting via a tokenized endpoint URL whose token is valid. See §9.1.
- **`private`** — never returned by the protocol. Stored on the candidate's endpoint for the candidate's own reference and shared, if at all, only through human conversation downstream.

Conforming servers MUST enforce visibility at every request. A server MUST NOT return a `permissioned` claim to a client connecting via the public URL or via a URL whose token has expired, been revoked, or fails signature verification. A server MUST NOT return `private` claims under any circumstances.

### 9.1 Tokenized endpoint URLs

Permissioned access is granted by issuing a URL with an embedded token. The candidate generates such URLs through their server's hosting interface (typically a dashboard or admin tool — not through the protocol itself) and shares them with specific recipients out-of-band: by email, in a LinkedIn message, in a job application form, or wherever else cold contact happens. The recipient's MCP client connects to the URL exactly as it would to any MCP endpoint. The token rides along.

Servers MUST accept tokens in a `t` query parameter and SHOULD also accept tokens as a path segment under `/t/`:

```
Public endpoint:        https://alice.career/mcp
Tokenized endpoint:     https://alice.career/mcp?t=eyJhbGc...
                        https://alice.career/mcp/t/eyJhbGc...
```

A token is a JWT with the following claims:

```json
{
  "iss": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  "jti": "tok_a3f9...",
  "scope": "permissioned",
  "audience": "did:web:acme-recruiting.com",
  "audience_hint": "Acme Talent",
  "iat": 1746316800,
  "exp": 1748908800,
  "purpose": "Senior Backend Engineer role"
}
```

|Field          |Required   |Description                                                            |
|---------------|-----------|-----------------------------------------------------------------------|
|`iss`          |REQUIRED   |Issuer DID. MUST equal the career object's canonical subject (the `did:key` form, per §4).|
|`jti`          |REQUIRED   |Unique token identifier. Used for revocation and audit.                |
|`scope`        |REQUIRED   |MUST be `"permissioned"` in v0. Reserved for future expansion.         |
|`audience`     |OPTIONAL   |DID of the intended recipient. If present, servers MAY enforce binding.|
|`audience_hint`|OPTIONAL   |Human-readable label, surfaced in the candidate's audit log.           |
|`iat`          |REQUIRED   |Issuance timestamp.                                                    |
|`exp`          |REQUIRED   |Expiration timestamp. Tokens MUST expire.                              |
|`purpose`      |RECOMMENDED|Free-text purpose, surfaced in the audit log.                          |

The token MUST be signed by the subject's DID key (the same key advertised in the subject's DID Document). Servers MUST verify the signature, expiration, and integrity before serving permissioned claims.

Servers MAY enforce audience binding by requiring the connecting client to authenticate as the named audience (for example, by presenting a counter-signed challenge). Servers MAY also treat audience as informational, in which case the URL is bearer-style and works for anyone who holds it. Implementations SHOULD support both modes and let the candidate choose per-token.

The bearer-style default is recommended for most cold-query use cases. Recruiters routinely forward candidate links within their hiring teams (to a hiring manager, to a panel, to an ATS), and that should just work. Candidates who prefer stricter handling can issue audience-bound tokens or share only public-level data.

### 9.2 Token issuance is not a protocol primitive

Token issuance is a candidate-side operation, performed through the candidate's hosting interface. It is **not** an MCP tool. The protocol's only role is defining the token format and signature requirements; everything else — the issuance UX, per-token controls, default expirations, the revocation interface — is implementation territory.

This is deliberate. Earlier drafts included a `request_access` MCP tool through which a querying agent could ask the candidate for a token. That design conflated the cold-query layer with the conversation that follows a successful cold encounter, and was removed. Recruiters who want to engage a candidate they have discovered should reach out through the contact handles in the candidate's `identity` claim. The candidate, if interested, replies with a tokenized URL.

### 9.3 Revocation

The candidate can revoke any issued token at any time. Servers MUST honor revocation immediately and MUST refuse subsequent requests bearing the revoked token. Servers SHOULD maintain a revocation list keyed by `jti`.

Revocation affects only the specific token. URLs derived from other tokens — for example, a URL the candidate shared with a different recruiter — continue to work.

### 9.4 Audit logging

Servers MUST log access events involving permissioned data. Each log entry MUST include at minimum: the token's `jti`, the `audience_hint` and `purpose` if set, the request timestamp, and the claim IDs returned. Candidates MUST be able to view this log through their hosting interface.

For `query_career` requests (§10.1.1), the log entry MUST also record every source claim consulted during selection or synthesis, not only the claim IDs returned to the requester. This makes it visible to the candidate when a server reasoned over permissioned data even if that data did not appear verbatim in the response.

### 9.5 Tokens in URLs: security considerations

Tokens carried in URLs leak more easily than tokens carried in headers. They appear in browser history, server access logs, referrer headers, and copy-paste sharing. The pattern is well-understood — most modern unsubscribe links, document share URLs, and one-time access flows use it — and the convenience of single-artifact sharing outweighs the leakage risk for cold-query, where the data is already low-stakes by design. But implementations MUST mitigate the risks:

- Servers MUST require HTTPS for tokenized URLs.
- Servers MUST strip the token from their own access logs and SHOULD NOT include it in error responses or stack traces.
- Querying clients SHOULD treat the URL as sensitive and SHOULD NOT display the full URL in user-facing output.
- Tokens MUST have reasonable expirations. Implementations SHOULD default to 60–90 days and SHOULD NOT issue tokens with expirations longer than 1 year by default (longer-lived tokens MAY be issued with explicit candidate confirmation).

> **Open question.** Whether servers should support a "single-use" mode where a token is invalidated after first successful access. Useful for one-shot resume-equivalent shares; adds complexity for normal multi-query interactions. Currently leaning OPTIONAL.

## 10. Protocol surface

A Cairn endpoint is an MCP server exposing the following tools and resources. Authorization is determined by the URL the client connects to (§9): tools called over the public URL return only `public` claims, while tools called over a tokenized URL return both `public` and `permissioned` claims, subject to the token's validity. `private` claims are never returned by any tool.

### 10.1 Tools

#### 10.1.1 `query_career` (REQUIRED)

Structured request for claims relevant to a stated information need, optionally informed by client context. The server selects, filters, and (where useful) synthesizes claims from the career object, subject to visibility, and returns them in standard Claim form.

```
Input: {
  "information_needed": string,
  "client"?: {
    "audience"?: DID,
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

The `client` object is OPTIONAL informational context the agent provides about itself and its purpose. If the request is made over an audience-bound tokenized URL (§9.1), `client.audience` MUST match the token's `audience` claim or the request MUST be refused. Otherwise, the server MAY use `client` fields to shape selection — e.g. prioritizing infrastructure work when `role_context` describes a distributed-systems role — but MUST NOT use them to expand visibility beyond what the connecting URL permits.

The server returns a list of `Claim` objects. Two kinds may appear:

1. **Stored claims** — claims as defined in §6, returned verbatim from the career object.
2. **Synthesized claims** — claims composed by the server at query time from one or more stored claims, with attestation `level: "derived"` (§7.5). A synthesized claim MUST NOT incorporate information from any source claim not visible to the requester, and MUST NOT introduce factual content not supported by its cited sources.

The server MUST NOT return a free-text `answer`, `summary`, or `confidence` field outside the claim structure. All output is claim-shaped so that querying agents apply consistent attestation reasoning and so that two conforming servers' outputs remain structurally comparable even when their selection logic differs.

The server's interpretation strategy is otherwise implementation-defined. Reference implementations MAY use the underlying agent's reasoning capability to select and synthesize claims; alternative implementations MAY use deterministic retrieval.

#### 10.1.2 `list_claims` (REQUIRED)

Structured listing of claims, with optional filters.

```
Input:  { "type"?: string, "since"?: ISO8601, "limit"?: number, "cursor"?: string }
Output: { "claims": Claim[], "next_cursor"?: string }
```

Derived claims (§7.5) MUST NOT appear in `list_claims` output. Listing returns only stored claims.

#### 10.1.3 `get_claim` (REQUIRED)

Retrieve a single claim by ID, with full attestation and evidence.

```
Input:  { "claim_id": string }
Output: { "claim": Claim }
```

`get_claim` MUST NOT return derived claims; derived claim IDs from a prior `query_career` response are not stable and not resolvable here.

#### 10.1.4 `verify_claim` (RECOMMENDED)

Re-run verification on a specific claim. For source-verified claims this triggers a fresh check. For issuer-attested claims this re-validates the credential signature.

```
Input:  { "claim_id": string }
Output: {
  "valid": boolean,
  "verified_at": ISO8601,
  "details": object
}
```

`verify_claim` is not meaningful for `derived` claims; servers MAY return an error or MAY validate the underlying `derived_from` set and report aggregate status.

### 10.2 Resources

#### 10.2.1 `identity` (REQUIRED)

The subject's identity claim and DID, returned without authentication.

#### 10.2.2 `schema` (REQUIRED)

The schema version and JSON-LD context the server is using.

#### 10.2.3 `server_info` (REQUIRED)

Structured factual metadata about the server: protocol version, supported extensions, implementation identity, operator identity, declared conformance, declared behaviors, and any third-party attestations. Returned without authentication. The full structure is defined in §10.3.

> **Open question.** Whether to expose the full career object as an MCP resource (filtered by visibility), or require all access to flow through tools. Tools-only is simpler to reason about; resource access is more idiomatic MCP. Leaning tools-only for v0.

### 10.3 Server self-description and trust

A querying agent that lands on a Cairn endpoint needs to know what kind of server it is talking to: which protocol version, which extensions, who operates it, what guarantees they make, whether the implementation has been independently tested. The `server_info` resource provides this metadata. The trust model around it is intentionally structured so that a server cannot credibly inflate its own reputation.

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
    "did": "did:web:assay.bot",
    "privacy_policy_url": "https://assay.bot/privacy",
    "terms_url": "https://assay.bot/terms",
    "jurisdiction": "DE"
  },
  "conformance": {
    "required_tools": ["query_career", "list_claims", "get_claim"],
    "recommended_tools": ["verify_claim"],
    "attestation_levels_enforced": [
      "self_attested",
      "source_verified",
      "issuer_attested",
      "peer_attested",
      "derived"
    ]
  },
  "behaviors": {
    "default_compensation_visibility": "private",
    "audit_logging": true,
    "token_log_stripping": true,
    "audience_binding_default": "bearer",
    "subject_signing_supported": true,
    "subject_key_custody": "byo_key"
  },
  "attestations": [
    {
      "type": "conformance_test",
      "issuer": "did:web:cairn-protocol.org",
      "credential_url": "https://assay.bot/.well-known/cairn-conformance.jwt",
      "issued_at": "2026-04-12T...",
      "expires_at": "2026-10-12T..."
    }
  ]
}
```

The `operator.type` field MUST be one of `hosted` (operated by a service provider), `self_hosted` (operated by the subject themselves), or `experimental` (development/research instance, not intended for production use).

`behaviors.subject_signing_supported` declares whether the server produces subject signatures (§6.4) on career objects and claims. `behaviors.subject_key_custody` MUST be one of `operator_held` (the server controls the subject's signing key), `byo_key` (the subject controls the key, the server only relays signatures produced elsewhere), or `mixed` (the operator supports both modes and the choice is per-subject). Agents reasoning about signature trust SHOULD weight `byo_key` signatures more strongly than `operator_held` signatures; see §6.4.4.

#### 10.3.2 Self-attested vs attested metadata

The values in `protocol_version`, `extensions`, `implementation`, `operator`, `conformance`, and `behaviors` are `self_attested` by default — they describe what the server claims about itself. Querying agents SHOULD treat these as informational unless backed by signed third-party attestations.

The `attestations` array contains Verifiable Credentials issued by parties other than the server itself, attesting to specific server properties. Each attestation MUST be a VC verifiable per §11. Common attestation types (defined in companion documents, not enumerated normatively in v0):

- **`conformance_test`** — a credential issued by a test runner stating that the implementation passed a specific version of the Cairn conformance suite at a specific time.
- **`security_audit`** — a credential issued by an independent auditor stating that the implementation was reviewed against a defined scope on a specific date.
- **`operator_identity`** — a credential issued by a trust authority (eIDAS qualified trust service provider, or equivalent) confirming that the operator's claimed legal identity matches what is at the privacy policy URL.

The protocol does not bless any specific issuer of these attestations. Querying agents decide which issuers they trust, the same way TLS clients decide which Certificate Authorities to trust. Conformance test issuers, in particular, are expected to multiply over time — the test suite itself will be open-source and runnable by anyone, and a server may collect attestations from several independent runners.

#### 10.3.3 Querying agent guidance

Agents SHOULD use `server_info` to answer questions like:

- *Is this a hosted service or a personal instance?* — `operator.type`.
- *Has the implementation been tested for conformance, and how recently?* — presence and freshness of `conformance_test` attestations.
- *Does the server enforce the privacy defaults I care about?* — `behaviors`, weighted against any `security_audit` attestation that verified those behaviors.
- *Does the server support the extensions I rely on?* — `extensions`.
- *Should I trust this server's `derived` synthesis, or traverse to source claims?* — `operator.type`, conformance attestations, and the agent's own policy.

Agents MAY refuse to query servers whose `server_info` does not include attestations they require, just as TLS clients refuse to connect to servers presenting unverifiable certificates. This is the structural defense against unattested servers misrepresenting their behaviors.

#### 10.3.4 What `server_info` does not contain

Servers MUST NOT include free-text "about us" or "trust statements" in `server_info`. The metadata is structured and factual by design. Trust is communicated through cryptographically signed attestations, not through prose that an LLM-based agent would parse and weight credulously. Implementations that wish to provide marketing content about themselves SHOULD do so on their `vendor_url` or `operator.privacy_policy_url`, not through the protocol.

Servers MUST NOT include numerical "trust scores," "reliability ratings," or other self-reported aggregate trust signals. The trust spectrum is the same one used for claim attestation: levels are determined by who is making the assertion, not by what number the asserter chose.

## 11. Verifiable Credentials

Issuer-attested claims rely on [W3C Verifiable Credentials 2.0](https://www.w3.org/TR/vc-data-model-2.0/). Cairn does not redefine the credential format; it specifies how credentials embed in the protocol:

- A claim's `attestation.credential_url` MUST resolve to a retrievable credential document.
- The credential's subject identifier MUST match the career object's `subject` DID.
- The credential's issuer MUST match the claim's `attestation.issuer`.
- Conforming servers SHOULD support [OpenID4VC](https://openid.net/sg/openid4vc/) for credential issuance and presentation flows.

### 11.1 Credential formats

The following credential formats are recognized as the basis for `issuer_attested` claims. Conforming servers MUST validate at least the formats marked REQUIRED.

- **W3C Verifiable Credentials** (REQUIRED) — JSON-LD or JWT serialization per the W3C VC Data Model 2.0.
- **PAdES** (REQUIRED) — PDF Advanced Electronic Signatures, profiles B-B, B-T, B-LT, B-LTA. The dominant signature format for European signed documents and the format mandated by eIDAS for qualified signatures.
- **CAdES** (RECOMMENDED) — CMS Advanced Electronic Signatures, for documents in non-PDF containers.
- **C2PA manifests on documents** (RECOMMENDED) — content-provenance signatures embedded in document metadata.

A document evidence object whose embedded signature satisfies these requirements SHALL be considered a Verifiable Credential for the purposes of this protocol, regardless of whether it conforms to the W3C VC JSON-LD or JWT serialization. The credential's subject identifier is determined by the signature's binding (the document's named subject, the certificate's subject DN, or an explicit DID reference within the document metadata).

### 11.2 Validation requirements

To accept a credential as the basis for an `issuer_attested` claim, the server MUST:

1. Verify the signature is cryptographically valid against the issuer's certificate or DID Document.
1. Verify the signing certificate or key was active at the time of signature.
1. Check available revocation information (CRL, OCSP, or W3C Status List) and confirm the credential has not been revoked.
1. Verify that the issuer's identity, as expressed in the certificate or DID Document, matches the `attestation.issuer` field on the parent claim.

A credential that fails any of these checks MUST NOT be used to mark a claim `issuer_attested`. Calls to `verify_claim` (§10.1.4) MUST re-run these validation steps and return updated results — this is how credential revocations propagate to querying agents over time.

Specific credential schemas (employment, education, certification) will be defined in companion documents, aligned with existing W3C work where possible.

## 12. Versioning

The protocol uses [SemVer](https://semver.org/) for the schema version, prefixed with `cairn/`.

A career object's `schema_version` field declares the version it conforms to. Servers MUST be able to serve their declared version. Clients SHOULD support reading at least the latest minor versions of every major version they target.

Breaking changes (incompatible field renames, semantic changes to existing fields, removal of required fields) require a new major version. Additive changes (new optional fields, new claim types, new tools) require a new minor version.

## 13. Security considerations

- All Cairn endpoints SHOULD serve over HTTPS with a valid TLS certificate.
- Servers MUST verify URL token signatures before honoring permissioned requests. See §9.5 for considerations specific to tokens carried in URLs.
- Servers SHOULD rate-limit unauthenticated `query_career` requests to mitigate scraping and inference attacks.
- Servers SHOULD rate-limit document and image retrieval to mitigate scraping and bandwidth amplification attacks.
- Issuers SHOULD use key rotation and publish revocation lists; clients SHOULD check revocation when verifying credentials.
- Content hashes on rich evidence prevent silent substitution of documents or images after a claim is queried. Querying agents SHOULD verify hashes on retrieval.
- Subject signatures (§6.4) are OPTIONAL in v0 but RECOMMENDED for hosted deployments that support BYO-key custody. Signatures defend against host modification of claim values, attestation metadata, evidence references, and visibility settings after authoring. They do not defend against omission of claims from a response, nor against stale-response or audit-log integrity failures. Agents SHOULD verify any signatures present and SHOULD weight unsigned claims and `operator_held` signed claims as offering similar host-trust guarantees; only `byo_key` signatures (§10.3.1) provide meaningful independence from the host's good behavior.
- Embedded signature validation depends on certificate and DID infrastructure outside the protocol's control. Servers SHOULD maintain reasonable trust roots (e.g., EU Trusted Lists for eIDAS qualified certificates) and SHOULD document their trust configuration in `server_info.behaviors`.
- Screenshots provide no cryptographic guarantees and MUST NOT be treated as elevating attestation under any circumstances.
- Derived claims (§7.5) are server-mediated and inherit the trust of both the synthesizing server and their source claims. A compromised or malicious server can produce derived claims that misrepresent their sources; querying agents that depend on synthesis SHOULD weight `server_info` attestations accordingly and SHOULD be able to fall back to direct reasoning over `derived_from` source claims.
- Verified-email endorsements (§7.4.2) depend on the integrity of the endorser's email account and on the honesty of the verifying server. Email accounts get compromised more easily than DID keys, and the verifying server is typically the candidate's own host — a conflict of interest exposed by `verifier_is_subject_host`. Agents SHOULD weight verified-email endorsements accordingly, and especially when both `verifier_is_subject_host: true` and `challenge_method: click_through_link` apply.
- The subject's signing key is the most sensitive material on the candidate side. With `did:key` as the canonical subject identifier (§4), the signing key *is* the identity: loss of the key is loss of the identity, and possession of the key is sufficient to act as the subject. Hosted implementations MUST allow subjects to export their key and SHOULD support BYO-key configurations. The export MUST yield key material the subject can use to stand up a new endpoint at a different host (or self-hosted) without changing the canonical `did:key` identifier — this is what makes the portability property in §4.2 real rather than ceremonial.

## 14. Privacy considerations

- Career data is sensitive. Servers MUST default new claims to a sensible visibility (likely `permissioned`) rather than `public`.
- Servers SHOULD log access to permissioned claims and make the log available to the subject. For `query_career` calls, the log MUST capture source claims consulted in addition to claims returned (§9.4).
- Servers MUST honor revocation of URL tokens immediately. Cached results held by the querying agent are out of scope; the protocol cannot enforce them, only the subject's policy can.
- Rich evidence (documents, images, screenshots) carries higher privacy stakes than the structured claim fields it supports. Servers MUST default rich evidence to the visibility of its parent claim, never broader.
- Servers SHOULD strip GPS coordinates and other sensitive EXIF fields from images before serving, unless the candidate explicitly retains them. Servers SHOULD offer face-blurring and region-redaction tooling for images.
- Servers MUST NOT log full document contents in operator-accessible logs; only hashes, evidence IDs, and access timestamps.
- Servers SHOULD support encrypted-at-rest storage of original (unredacted) documents accessible only to the candidate, with only redacted copies exposed to the protocol.
- Querying agents SHOULD minimize the claims they request and retain. The principle of least privilege applies to careers as much as to APIs.
- The subject's DID is a stable, public identifier. Implementations should make subjects aware that linking it across sites enables tracking.
- Endorsers' email addresses are personal data. Servers MUST NOT disclose the local part of an endorser's email (§7.4.2) without explicit endorser opt-in during the verification flow, and MUST store the full address with the same protections applied to subject-private data. Servers SHOULD allow endorsers to revoke their endorsements and have their email records purged.

## 15. Open questions

The following are deliberately unresolved in v0:

1. **Custom type registry.** Whether to operate a registry of common extensions (security clearances, professional licenses, industry-specific certs), and if so, on what governance model.
1. **Audience binding default.** Whether servers should default to enforcing audience binding on URL tokens (stricter, slightly more friction for normal recruiter forwarding) or to bearer-style access (looser, lower friction). Currently leaning bearer-style as default with audience-bound mode available.
1. **Resource vs. tool access.** Whether the full career object should be exposed as an MCP resource, or whether all access should flow through tools.
1. **Verification freshness semantics.** Whether the protocol should specify maximum acceptable ages for source-verified attestations, or leave this to clients.
1. **Multi-DID subjects.** Whether a subject can have multiple DIDs (e.g., one personal, one professional) and how cross-references work. With the §4 two-identifier pattern this becomes specifically: how a subject can maintain multiple `did:web` aliases (different domains, different professional personas) against a single canonical `did:key`, and how agents should reason about partial overlap between such personas.
1. **Subsidiary signing keys and rotation.** `did:key` (§4) is bound to a single public key and offers no graceful rotation path. A subsidiary-key model — where a long-lived identity key signs short-lived signing-key delegations, and routine signatures use the delegated keys — would preserve the canonical identifier across rotations. This is a substantive cryptographic addition deferred from v0 because it raises agent-side complexity (delegation chain verification) and benefits from coordination with the W3C DID Resolution and Verifiable Credentials work on key-management trust chains.
1. **Single-use tokens.** Whether to standardize a single-use token mode for one-shot resume-equivalent shares, or leave it as an implementation extension.
1. **X.509-to-DID mapping for embedded signatures.** PAdES signatures carry X.509 certificates with subject DNs, not DIDs. The mapping from X.509 subject to a Cairn issuer DID needs to be specified more precisely. Likely solution: a registry or trust list mapping known certificate authorities to canonical DIDs.
1. **C2PA validation requirement level.** Whether to require C2PA validation for images in v0.1 (currently SHOULD), or wait until camera-side adoption is broader.
1. **Conformance test issuance governance.** Who runs the canonical test suite, and how multiple independent issuers of `conformance_test` attestations coordinate. Currently the answer is "no canonical issuer; agents pick whom to trust."
1. **Attestation retroactivity for documents.** When a candidate uploads a signed document that should retroactively elevate a previously `self_attested` claim to `issuer_attested`, whether the elevation is automatic or requires explicit candidate action. Probably the latter.
1. **Derivation method vocabulary.** Whether to standardize an enum of `method` values for derived claims (§7.5) — e.g. `llm_summary`, `aggregation`, `temporal_filter`, `selection_only` — so agents can mechanically reason about synthesis trust rather than parsing free-text labels.
1. **Derived-claim freshness semantics.** A `derived` claim's `derived_at` reflects synthesis time, not the freshness of underlying source claims. Whether agents should be required to surface the oldest `verified_at` among `derived_from` source claims rather than the synthesis timestamp.
1. **Signed enumeration of claims.** Per-claim signatures (§6.4) defend against modification but not against the host omitting claims from a response. A signed enumeration — for example, a subject-signed Merkle root over `claim_id` values, or a per-response signed claim manifest — would close that gap, at the cost of additional ceremony on every read. Deferred to v0.1.
1. **Signature algorithm portfolio.** v0 requires `EdDSA` (Ed25519) support. Whether `ES256K` (secp256k1) or `ES256` (P-256) should also be REQUIRED, given their prevalence in existing wallets and key-management systems, is deferred.
1. **Whether to upgrade subject signatures from OPTIONAL to RECOMMENDED in v0.1.** The current design treats them as opt-in to ease initial implementation; once BYO-key infrastructure is more widely deployed, signing SHOULD likely become the default for hosted operators.

The following are now resolved:

- **Per-field visibility within a claim** — resolved as no. v0 supports visibility at the claim level only. Candidates who want fine-grained disclosure split the data into multiple claims with different visibility settings.
- **`request_access` as a protocol tool** — resolved as no. Cold-query is the protocol's scope (§1.1). Engagement requests happen out-of-band and the candidate responds with a tokenized URL.
- **Server-side trust signaling** — resolved as factual self-description plus signed third-party attestations (§10.3). No free-text "trust statements," no self-reported scores.
- **`query_career` output shape** — resolved as claim-shaped only. The tool returns `Claim[]` and no free-text `answer` or self-reported `confidence` score. Synthesis is permitted but MUST flow through the `derived` attestation level (§7.5) so that provenance is preserved and the §10.3.4 prohibition on self-reported aggregate trust signals is not relocated into the query path.
- **Endorser identity floor** — resolved as both methods permitted. DID-signed endorsements remain preferred; verified-email endorsements (§7.4.2) are accepted as a fallback with the structural trust downgrade exposed via `endorser_method` and `verifier_is_subject_host`. The email domain is always disclosed; the local part is opt-in.

Comments, alternatives, and prototypes addressing any of the remaining open questions are welcome. See [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## 16. References

- [Model Context Protocol](https://modelcontextprotocol.io)
- [W3C Decentralized Identifiers (DIDs)](https://www.w3.org/TR/did-core/)
- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [OpenID for Verifiable Credentials](https://openid.net/sg/openid4vc/)
- [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/)
- [RFC 2119 — Key words for use in RFCs](https://www.rfc-editor.org/rfc/rfc2119)
- [RFC 8785 — JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785)
- [Schema.org](https://schema.org)

-----

*This is v0. Argue with it.*
