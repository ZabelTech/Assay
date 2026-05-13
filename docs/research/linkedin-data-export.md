# LinkedIn data export — research notes

**Status:** research, not a design.
**Last verified:** 2026-05-13.
**Question:** how can a candidate get a complete dump of their own LinkedIn data into a form an Assay/Cairn server can ingest?

This document surveys the surfaces LinkedIn exposes today. It does not propose
a connector. Concrete schema mapping (LinkedIn → Cairn claims, §6 of the spec)
is left to a follow-up.

-----

## TL;DR

There are four ways to get LinkedIn data out, ranked by completeness and
sanctioned-ness for a candidate exporting *their own* data:

| Path | Coverage | Programmatic? | Who can use it | Verdict for Assay |
|---|---|---|---|---|
| Self-service ZIP archive ("Get a copy of your data") | **High** — work history, education, skills, endorsements (given/received), recommendations (given/received), connections, messages, posts, comments | No. User-initiated download. | Everyone | **Primary path today.** Universal, but manual; candidate uploads the ZIP to a Cairn import CLI/tool. |
| Member Data Portability API (DMA, 3rd party) | High — same conceptual surface as the ZIP, plus a Changelog event stream | Yes, OAuth | **EU/EEA/Switzerland members only.** App-review gated. | Best programmatic path — but only for a fraction of users until LinkedIn expands geography. |
| Sign In with LinkedIn (OIDC) + Profile Details API | **Low** — identity + at most current job & most recent school | Yes, OAuth | Everyone (Lite); Plus tier is partnership-gated | Useful for verifying the candidate's LinkedIn handle in `identity.handles`, not for importing career data. |
| Scraping | Variable | Yes, but violates ToS | n/a | Out of scope. Against the spirit of a candidate-controlled protocol. See §5. |

The pragmatic recommendation: **build the ZIP-archive importer first** (works
for everyone, no API approval, no geo restriction), and treat the Member Data
Portability API as a v0.1 path once an EU-resident candidate needs live sync.

-----

## 1. Self-service ZIP archive — "Get a copy of your data"

User-facing flow: **Settings & Privacy → Data privacy → Get a copy of your data → Request archive.**

### 1.1 Two tiers

LinkedIn offers two tiers of export from the same UI:

1. **Fast file** — a subset chosen with checkboxes (e.g. just *Connections*).
   Emailed in minutes.
2. **Larger archive ("fast file with other data")** — everything the account
   has. Emailed within ~24 hours; download window is **72 hours** after
   delivery.

The archive is a ZIP of CSV and JSON files. The candidate only receives files
for the categories they actually have data in — no `Certifications.csv` if
they've never added a certification.

### 1.2 Files reported in the full archive

The files below are consistently reported across LinkedIn Help and
third-party walkthroughs. **The exact filenames and column lists drift between
account types and over time; the importer must tolerate variation.** Treat
this list as the floor, not the contract.

- **Profile section** — work history, education, skills, summary/headline,
  certifications, languages, projects, publications, patents, honors,
  volunteering, courses (whichever the member has filled in).
- `Connections.csv` — first-degree connections. Columns: first name, last
  name, company, position, **email (often blank — opt-in)**, connection date.
- `Endorsements_Given.csv` and `Endorsements_Received.csv` — endorser/endorsee
  name, skill, date, accepted/pending status, profile URL of the other party.
- `Recommendations_Given.csv` and `Recommendations_Received.csv` — full
  recommendation text, the other party's name/company/title, date.
- `Comments.csv` — comments left on LinkedIn (excluding Groups), with content
  and link.
- `Shares.csv` — short-form posts.
- `Articles/` — long-form articles, typically as HTML files.
- `Messages.csv` — direct messages.

### 1.3 What this means for Assay

This is the **richest export LinkedIn offers any user today**, and the only
one that ships with the candidate's full work history, full education
history, full skills list, and **email-attested endorsements** in primary
form. That last point matters: endorsements in the archive are signal Cairn
already knows how to model (§7.2 of the spec, `email_attested`), assuming
the importer carries the endorser's email forward and Cairn re-issues a
verification challenge.

The cost: the candidate has to log into linkedin.com, click the button, wait
~24 hours, and upload the ZIP. There is no API to automate the request. For
the self-hosted Cairn server, the import path is:

```
candidate ──downloads ZIP──> linkedin.com
        ──uploads ZIP──> cairn-server (admin CLI or UI)
                           │
                           ├─ parse CSVs
                           ├─ map to claims (§6)
                           └─ stage for review before publishing
```

Endorsements/recommendations imported from the archive arrive *unverified*
from Cairn's perspective — the archive is self-issued, so an endorsement
in the ZIP is no stronger than `self_attested` until the Cairn server
emails the endorser and gets a challenge response. The importer should:

1. Stage endorsements with the endorser's email (when present) and the
   skill/text/date intact.
2. Mark them `self_attested` pending verification.
3. Offer the candidate a "send verification emails" step that triggers the
   normal §7.2 challenge flow, after which the claim is upgraded to
   `email_attested`.

### 1.4 Open questions for the importer design

- The archive does **not** include the endorser's email for most rows; emails
  ride along only when the connection opted in to "Allow connections to
  export my email." Plan for 80–90% empty.
- Filenames and schemas drift. We need a small fixture corpus of real
  archives from different accounts before committing to parser shape.
- Long-form articles arrive as HTML, not Markdown. Decide whether `project`
  claims (§6) wrap them by reference (URL only) or by content.

-----

## 2. Member Data Portability API (DMA, 3rd party)

Documentation: Microsoft Learn,
`learn.microsoft.com/en-us/linkedin/dma/member-data-portability/member-data-portability-3rd-party/`
(current version tag at time of writing: `li-dma-data-portability-2025-11`).

This is LinkedIn's response to the EU **Digital Markets Act**. It is the only
LinkedIn API surface that returns the candidate's *complete* profile-and-
activity dataset programmatically.

### 2.1 Two APIs

- **Member Snapshot API** — point-in-time bulk read across data **domains**
  (profile, positions, education, skills, endorsements, recommendations,
  connections/invitations, messages, social actions, posts, etc.).
- **Member Changelog API** — event stream of changes since a watermark.
  Useful for keeping a Cairn endpoint live against LinkedIn instead of
  re-importing periodically.

The exact list of `domain` enum values is in the developer-portal API
reference, which is behind a 403 to anonymous requests and was **not
confirmed in this research pass**. The values cited in third-party SDKs
(e.g. microfox-ai/microfox's `linkedin-member-data-portability` package)
do not enumerate them either. Surface this gap when scoping the connector;
do not assume coverage matches the ZIP archive without checking the live
schema.

### 2.2 Access

- OAuth scope: **`r_dma_portability_3rd_party`**.
- Member-side variant for first-party (member's own app, e.g. a candidate
  running their own connector against their own account): **`r_dma_portability_self_serve`**, via the
  "Member Data Portability (Member)" product.
- App-review gated. Request flow: create a LinkedIn Developers app →
  Products tab → request access → submit business email (verified), legal
  name, registered address, website, privacy policy.
- Consent grant duration: **up to 1 year** before re-consent.

### 2.3 The blocker: geography

> Only LinkedIn users from the European Economic Area are allowed to consent
> to share their LinkedIn data with 3rd party developer applications.
> Members not located in the EU/EEA or Switzerland will receive error
> messages if they try to consent.

This is hard-coded on LinkedIn's side. A US-based candidate cannot use this
API today regardless of how the Cairn server is configured. That makes it a
**second-tier path for Assay**: when it works it's strictly better than the
ZIP, but it won't work for most candidates until LinkedIn expands the
geographic scope (which is a regulatory question, not a technical one).

### 2.4 What this means for Assay

This is the right v0.1+ path for a live LinkedIn → Cairn sync, but only for
EU/EEA/CH candidates. The Member Changelog API is what would make a Cairn
endpoint "stay current" — claim-set deltas would flow without a re-upload.

If/when implemented, the OAuth artifact also unlocks something the ZIP path
cannot: **`source_verified` attestation** (spec §15, v0.1 RFC). A position
or education entry pulled live from a LinkedIn token tied to the candidate
is the same trust class as a GitHub-OAuth-verified commit history. The ZIP
path can never reach that level — it's a file the candidate could have
edited before uploading.

-----

## 3. Sign In with LinkedIn (OIDC) and Profile Details API

These are the "open to everyone" developer surfaces. They do not carry full
career data — but they do something useful for Cairn: **verify the
candidate's LinkedIn handle** so `identity.handles.linkedin` in the career
object (§6.2) is not just a self-attested string.

### 3.1 OIDC `/v2/userinfo`

Scopes: `openid profile email`.
Claims: `sub`, `name`, `given_name`, `family_name`, `picture`, `email`,
`email_verified`, `locale`. **No work history, education, or skills.**

The `email_verified` claim is the interesting one: it gives Cairn a
second pathway to subject email verification (§4.1) by trusting LinkedIn's
verification rather than re-running a challenge — though §4.1 currently
mandates `click_through_link` or `code_return`, so adopting OIDC-as-
verification would be a spec amendment, not a free win.

### 3.2 Profile Details API (`/identityMe`)

Three tiers:

- **Development / Lite** — name, profile URL, photo, primary email.
- **Plus** — additionally `primaryCurrentExperience` (current job only) and
  `mostRecentEducation` (most recent school only). Requires
  `r_most_recent_education`. Plus tier is partnership-gated; rate limits
  are negotiated.

There is **no public API tier that returns full work history, full education
history, skills, endorsements, or recommendations.** Anything more than
"current job + most recent school" requires either the DMA portability API
(§2) or the ZIP archive (§1).

### 3.3 What this means for Assay

Useful but narrow. The natural integration is:

- Use OIDC at candidate onboarding to confirm `identity.handles.linkedin`
  resolves to a real account the candidate controls.
- Use the verified email from OIDC to cross-check against the candidate's
  Cairn subject email (§4).
- Do **not** treat OIDC as a data-import path.

-----

## 4. "Save to PDF" / resume export

LinkedIn's UI has a "Save to PDF" button on a profile (More → Save to PDF).
Web-only, English-only profile language. The output is a flat PDF resume.

Not a programmatic interface, less complete than the ZIP archive, and a
strict subset of what the archive carries. **No reason to use this as the
import path for Cairn** — if the candidate is going to interact with
LinkedIn's UI anyway, send them down the §1 path.

-----

## 5. Scraping — explicitly not recommended

The legal landscape (US, Ninth Circuit):

- *hiQ v. LinkedIn* (2019, reaffirmed 2022): scraping **publicly accessible**
  LinkedIn pages does not violate the **CFAA** (it isn't "unauthorized
  access" under federal computer-crime law).
- *LinkedIn v. hiQ* on remand (Dec 2022): permanent injunction against hiQ
  on **state-law contract claims** — hiQ breached LinkedIn's User Agreement,
  and additionally used fake accounts and bypassed login walls.

Net effect: scraping public LinkedIn data is not a federal crime in the US,
but it does breach LinkedIn's ToS and exposes the scraper to a contract
claim. Anything behind a login is worse on both axes.

For Assay specifically, scraping is also against the spirit of the protocol.
Cairn is built on the premise that the candidate controls and authorizes
what flows about them. A scrape-based importer would import a candidate's
LinkedIn data without LinkedIn's consent and, depending on what's scraped,
potentially without the consent of the candidate's *connections* (the
recommendations and endorsements they've received). That's the wrong
direction. Recommend explicitly out-of-scope for any official Cairn
connector.

-----

## 6. Recommendation

Build in this order:

1. **ZIP-archive importer.** Universal, sanctioned, covers the full career
   surface. Lands as a CLI subcommand alongside `claim add`:
   `cli linkedin import ./linkedin-export.zip --review`. Stages claims as
   `self_attested` pending review, surfaces endorsements with attached
   emails for the candidate to fire §7.2 challenges against.
2. **OIDC handle verification.** Tiny: a one-shot OAuth round-trip that
   stamps the `identity.handles.linkedin` field with a verification record
   the candidate's hosting UI can display. No new claim types.
3. **(v0.1) DMA Snapshot + Changelog connector** for EU/EEA/CH candidates.
   Pulls live, supports `source_verified` attestation, hooks into the
   `r_dma_portability_3rd_party` scope. Requires Cairn server registration
   as a LinkedIn developer app.

Explicitly **not** on the roadmap:

- Scraping.
- Resume-PDF parsing as an import path — strictly worse than the ZIP.
- Plus-tier Profile Details API as an import path — too narrow to justify
  the partnership process.

-----

## 7. What I could not confirm

Per Rule 11 (fail loud), surfacing gaps in this pass:

- **Exact filename list and column schemas** in the current LinkedIn full
  archive. The §1.2 list is consensus across third-party writeups but no
  authoritative LinkedIn doc enumerates it; we need a real archive (or
  several, across account vintages) before committing to a parser.
- **`domain` enum values** on the Member Snapshot API. The reference page
  on `learn.microsoft.com` returns 403 to unauthenticated WebFetch from
  this environment, and the third-party SDKs that wrap the API don't
  republish the enum. Need to either fetch the docs from a different
  environment, or apply for developer access and read the schema directly.
- **Whether the DMA Changelog event types cover endorsements/recommendations
  add-remove events**, or only the candidate's own profile edits. Same
  source-access problem as above.

None of these gaps block the §6 recommendation (start with the ZIP
importer); they all block scoping the §2 connector.

-----

## Sources

- LinkedIn Help — [Download your account data](https://www.linkedin.com/help/linkedin/answer/a1339364/downloading-your-account-data)
- LinkedIn Help — [Member portability APIs](https://www.linkedin.com/help/linkedin/answer/a6214075)
- LinkedIn Legal — [DMA Portability API Terms](https://www.linkedin.com/legal/l/portability-api-terms)
- Microsoft Learn — [Member Data Portability (3rd Party)](https://learn.microsoft.com/en-us/linkedin/dma/member-data-portability/member-data-portability-3rd-party/?view=li-dma-data-portability-2025-11)
- Microsoft Learn — [Member Data Portability (Member)](https://learn.microsoft.com/en-us/linkedin/dma/member-data-portability/member-data-portability-member/?view=li-dma-data-portability-2025-11)
- Microsoft Learn — [Sign In with LinkedIn using OpenID Connect](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2)
- Microsoft Learn — [Profile Details API (/identityMe)](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/verified-on-linkedin/api-reference/identity-me)
- Microsoft Learn — [Profile API](https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api)
- LinkedIn Help — [Save a profile as a PDF](https://www.linkedin.com/help/linkedin/answer/a541960)
- California Lawyers Association — [Ninth Circuit holds data scraping is legal in hiQ v. LinkedIn](https://calawyers.org/privacy-law/ninth-circuit-holds-data-scraping-is-legal-in-hiq-v-linkedin/)
- IAPP — [Data scraping and the implications of the latest LinkedIn–hiQ court ruling](https://iapp.org/news/a/data-scraping-and-the-implications-of-the-latest-linkedin-hiq-court-ruling)
