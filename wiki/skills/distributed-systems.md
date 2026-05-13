---
kind: skill
slug: distributed-systems
updated_at: 2026-05-01
sources:
  - https://www.distributed-systems.net/index.php/books/ds4/
  - https://www.usenix.org/conferences/srecon
  - https://martin.kleppmann.com/2017/03/27/designing-data-intensive-applications.html
  - https://aphyr.com/tags/Jepsen
related:
  - staff-platform-engineer
  - fintech
---

# Distributed systems

The set of properties associated with designing, operating, and reasoning
about systems whose components are separated by an unreliable network.
Demand for this skill is concentrated in infrastructure, data, and
high-scale product teams.

## Signal

> sources: 1, 3

- Vocabulary: candidate can talk about replication, consensus, partitions,
  consistency levels (linearizable, sequential, eventual) without
  hand-waving.
- Failure-first reasoning: the candidate's design discussions start from
  what breaks rather than what works.
- Comfort with at-least-once vs. exactly-once semantics and the practical
  consequences (idempotence, dedup keys, transactional outbox patterns).

## Corroborating evidence

> sources: 1, 2, 3, 4

- `project` claims involving a stateful distributed system: replicated
  databases, message queues with delivery guarantees, leader-elected
  coordinators.
- `employment` claims at companies whose product stack is unavoidably
  distributed (payments, streaming, real-time collaboration, large-scale
  search).
- `publication` claims describing failure-mode analyses or postmortems of
  distributed-system incidents; SRECon talks are particularly strong signal.
- `endorsement` claims from peers describing concrete design decisions made
  (chose Raft over Paxos for X reason; chose at-least-once + dedup for Y
  reason).

## Caveats

> sources: 4

- "Used a distributed system" is not the same as "knows distributed
  systems." Many engineers operate a Kafka or DynamoDB without ever
  reasoning about its consistency properties.
- Jepsen-style empirical knowledge (knowing how named systems actually fail)
  is a distinct sub-skill from textbook knowledge. Some endorsers conflate
  them; some don't.
- The skill has a long tail. Most product engineering needs the first 20%
  of it; only platform/infra work routinely needs the rest.
