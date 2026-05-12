# Your Career Is an API

The resume is dead.

It just hasn’t stopped moving yet.

We designed it for printers. We froze it as PDF. We trained AI to read it. Now we use AI to undo what we asked candidates to do.

This is absurd.

This is about to stop.

-----

Two things changed.

Agents are in the hiring loop. Sourcing. Screening. Scheduling. Reference-checking. The work that used to live in a recruiter’s inbox now lives in software calling a model. Not in slides. In production.

And we got a standard for letting agents query live, permissioned context. The plumbing for the agent era.

Together they make the resume a fax.

If a program reads your application, why hand it a printout?

-----

Here is the shift.

A career stops being a document.

It becomes an endpoint.

Instead of uploading a CV, you share a URL. The URL is alive. It speaks a protocol. It answers questions.

*Has this person shipped React Native to production? When did they leave Stripe? Are they open to remote? Show me three projects involving distributed systems.*

The endpoint answers. With evidence. With provenance. With the candidate in control.

This is what hiring looks like when the reader is software.

-----

This works for both sides.

Today candidates compress themselves into two pages. They guess what matters. They cut the project that mattered most because it didn’t fit. They write keywords for a parser they cannot see.

The recruiter receives the compressed version. They guess what was lost. They guess again at scale, across hundreds of candidates.

Both sides are guessing.

Endpoints end the guessing.

A candidate presents everything. Everything they have done. Everything they can prove. Comprehensively. Without having to choose what matters before knowing who is asking.

A recruiter asks the questions their role demands. They get the slice that matters. Not a document optimized for a job no one is hiring for.

Win-win.

-----

And the endpoint stays current.

Every shipped project. Every promotion. Every endorsement that lands. The endpoint reflects what you have done — not a snapshot from when you last applied.

You update once. Every querying agent sees the update.

No more hunting for the latest version of your CV. No more *“let me send you the updated one.”* The endpoint is the updated one. Always.

-----

The hard part is not the protocol.

The hard part is trust.

An endpoint that lets anyone claim anything is a JSON resume. Same lying, prettier syntax.

So every claim carries its receipt.

*Self-attested.* The candidate said so.

*Source-verified.* Pulled live from the system of record. 847 PRs in this org. Now.

*Issuer-attested.* Signed by a third party. Your bootcamp. Your former employer. Your client. Cryptographic. Independent. Held by you.

*Peer-attested.* A known person on the record.

The protocol does not pick a winner. It makes the receipt visible. The querying agent decides how to weight it.

We are not inventing crypto. We are joining the ecosystem already standing up — verifiable credentials, OpenID4VC, the rails the EU is laying for digital identity. These standards are coming for careers whether we build for them or not. So we build for them.

-----

Two commitments.

The endpoint is yours.

Self-host it. Five-dollar VPS. Docker container. The data lives where you decide. No platform deplatforms you. No acquisition rewrites the terms. No central breach leaks ten million careers at once. You decide who sees what, for how long.

A career is a thing you carry between jobs for forty years. The infrastructure that holds it should not be optional to own.

The protocol is open. The convenience is paid.

Most candidates will not run a server. So we run one. Same protocol. Same data model. Same exit. If we ever get worse, you `docker run` your way out in an afternoon.

This is the shape of every protocol-era company that survives.

-----

The deeper thesis is not about hiring.

This is the first decade where ordinary people will participate in agent-to-agent commerce on equal footing.

Your calendar will negotiate with my calendar.

Your purchase agent will query a vendor’s product agent.

Your career agent will be queried by an employer’s screening agent.

Every domain will face the same question.

*What is the canonical, queryable, person-controlled representation of this thing?*

For careers, the answer is now.

-----

PDFs solved document portability.

This solves career legibility.

The future job application is not *upload your CV.*

It is *share your endpoint.*

The resume database. The keyword screen. The LinkedIn graph. The recruiter inbox.

Once careers are endpoints, they are all legacy.

We are building the layer that replaces them.
