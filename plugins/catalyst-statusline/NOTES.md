# catalyst-statusline — notes

## Host premise (#551 D1)

Read in the host code of 2.1.283 and 2.1.284: every `$.store.set` and
`$.store.delete` takes a file lock and does a full read-modify-write of the
store's JSON; `get` and `keys` take no lock; there is no compare-and-set. The
store holds at most 4 MiB of serialized JSON, and a key longer than 256
characters is refused — for `get` as well as for `set`. The protocol below
relies on one property only: separate `set` and `delete` calls on different
keys do not lose each other. "get → decide → delete" is never taken to be
atomic anywhere.

## Records of the previous versions (#551 D8)

The previous versions' records are read only. This version never writes them
again, and deletes one only when its own age is past MARK_KEEP (7 days), or
never:

| Record | Read by | Taken over as | Written | Deleted |
|---|---|---|---|---|
| open flag `statusline.open.v1:<token>` | restore, marks, prune | adopted as the open `v1:<token>`, fresh by `at`, else `t` | never | age past MARK_KEEP |
| bare flag `statusline.open.v1` | restore | adopted as `v1:legacy-<session>` at order (0, 0) | never | age past MARK_KEEP, when it has an age |
| close marks `statusline.open-closed.v1:<s>`, `statusline.open-closed.v2:<s>:<e>:<n>` | every read of marks | counted in the greatest mark | never | age past MARK_KEEP, and not held (below) |
| epoch `statusline.epoch.v1` | the first restore | counted in the epoch read | never | never |
| drafts `statusline.draft.v1:<s>`, the bare slot | the draft read | a copy of this version, fresh `t`, when it is the newest | never | age past MARK_KEEP |
| save marks, undo records, their bare keys | the mark and undo reads | shown as they were; hidden by a done record or a tombstone | never | never |
| bare themes map `statusline.themes.v1` | the themes read | moved to the keyed themes | never | never |
| snapshot `sess:<s>` | restore and listing-based read-back | ranked by the clock window, then (seq, origin, n); the next write is this version's | never | age `seq / 1000` past MARK_KEEP |

A record of the previous versions whose order is damaged is not counted and
stays. A key built from a session id (`statusline.draft.v1:<s>`,
`statusline.open-closed.v1:<s>`, `sess:<s>`) longer than 256 characters is not
read: the host refuses it, and could not have written it.

The boundary. A process of the previous version that wakes up between the read
of its record and that record's deletion by age loses the record. A writer of
the previous version that keeps writing a closed flag again (its keepalive
reads no marks) keeps the close mark alive as long as it lives: its flag is
restorable in every listing, so the mark is held and the restore does not open
the panel. Once that writer stops, its flag goes stale within FLAG_TTL, and the
next prune collects the mark. A live writer of the previous version refreshes
its flag and draft more often than KEEP_ALIVE_MS, so the boundary concerns only
the idle records of the previous versions: a writer of the previous version
idle for longer than FLAG_TTL that writes its flag again between the listing of
a prune that did not hold the mark and the mark's deletion finds its flag fresh
and the mark gone — a case of the first sentence. Running alongside the
previous version is supported within this boundary.

## Open flags and close marks: order without the clock (#551 FIX9, #551 D3–D7)

Every record of this version is a publication: `<ns>[.<digest>]:<writerId>:<seq>`,
where `writerId` is one `crypto.randomUUID()` per environment, `seq` is the
environment's one counter, zero-padded to 16 digits, and `digest` is the 64-bit
FNV-1a of the session for the types kept per session (the session itself lives
in the value; the digest only filters a listing). A key is set once. A delete
names a key read in the same pass or confirmed by this environment's own
landed `set` — never one built from an open, a token, a pointer or a session.
Without `crypto.randomUUID`, or with one that answers another form, every
publication is refused, said once as `store-writer-id`; there is no fallback
id from the clock. A record of this version off its key form or its value
schema is damage: it is deleted at its first read by its exact key, whatever
its age, said once as `store-damage`.

Open flags and close marks are ordered by (epoch, counter), never by the
clock. The first restore of an environment that reads the store takes its
epoch past the greatest one it read — in the epoch records
`statusline.epoch.v3`, in `statusline.epoch.v1` and in every flag and mark —
and tries to publish it; a restore of another generation of the same
environment that meets that try in flight waits for it. The epoch is the
environment's whether that write landed or was refused (FIX9f Р6). Every later
read of a flag or mark whose epoch is at or past the environment's epoch, on
any pass, raises the epoch past it (#551 FIX9c Р1) — the prune's read at an
open as well, by the same rule (FIX9f Р5). A flag or mark write that takes a
counter, at epoch E, takes it only after an epoch record at E or past it landed
from this environment: until it has, the write first publishes one again, and
when that is refused the write is refused as well, said once per epoch in a
generation as «эпоха не записана» (Р11). The epoch writes of an environment run
one after another, and one whose epoch a landed record already holds or passed
is not made (FIX9f Р2). The bootstrap and the prune delete the epoch records
below the greatest one read (the bootstrap's own landed epoch included); the
greatest is never deleted, and equal greatest ones of different environments
all stay. When the epoch past the greatest one read would not be below
`Number.MAX_SAFE_INTEGER` — at the first restore or at a later read — no epoch
is taken, and when the counter reaches `Number.MAX_SAFE_INTEGER`: the
environment's order is spent, its flag and mark writes are refused as
«порядок исчерпан», said once, and the stored records stay (FIX9d); a spent
order stays spent for the life of the process, whatever the store holds later.
Two environments may take the same epoch only when each one's first restore
reads the store before the other's epoch lands there; their writes are then
ordered by the counters alone.

An open is an `openId` (the environment's writer id and counter) with its
order (e, n). An explicit open reads the close marks of its session first and
raises the epoch by them, then takes its order, then publishes its flag
`statusline.open.v3.<digest>:…` `{session, openId, e, n, at}`. A publication
again — at every draft write of the open panel and at the keepalive tick —
reads the session's marks first and, in the same synchronous run as its
`set`, takes a new key with the same order: the order never changes, the key
never repeats, and the earlier publications of the open are deleted only after
the new one landed. When a mark of the session at or past the open's order is
read, the open is withdrawn instead: nothing is published, its own
publications are deleted and the keepalive stops, said once
(`picker-open-withdrawn`); the panel on the screen stays, a reload does not
open it. A publication that lands after its open ended — closed, retired by a
rebind, or withdrawn — deletes itself by its own key, never the current
panel's. For flags, a stale generation publishes and deletes nothing: its
publications are sources for the new state of the same environment (FIX9c Р3,
FIX9f Р3; a flag publication carries the session and openId the panel held when
it began, FIX9f Р4). The separate `settleMark` exception completes publication
of a closing mark begun by a live generation: it finishes a close that already
happened, including its freshness tail and cleanup of its own marks (Q12).
A rebind retires the open and deletes its confirmed publications
even when the new open's publication is refused (FIX5 Ч8). The restore retains
the session and order of every adopted v1 source in `v1Sources`; adoption only
clears v3 sources. Retirement publishes a mark at each retained v1 source's
own order (the bare flag's is (0, 0)), not a newly allocated higher order. This
closes the retained legacy flag without closing a foreign opening ordered
after it (AR-5). Retirement marks use the same late-publication and per-session
deduplication tail as close marks (AR-8).

A flag restores only while `−CLOCK_SKEW ≤ now − at < FLAG_TTL`, FLAG_TTL being
3 days and CLOCK_SKEW 5 minutes; a flag without a numeric age — `at`, else `t`
for the previous versions — never restores. A flag is open only while its
order is past the greatest mark of its session over all marks the restore
read, of every form; a listed mark or flag gone at its read makes the restore
list the keys again and read the marks and flags it has not read yet, and the
flags judged are those the last listing holds and whose read found them (Р2,
FIX9f Р1). The boundary of that snapshot: a write that lands after the last
listing, with no listed record gone at its read, is seen by the next restore
only. The restore deletes this version's marks below that greatest one and
this version's flags that are closed or not fresh, of every session, each by
the key read. Among the open, fresh flags of its own session it takes the open
of the greatest order (the lesser openId at a tie) and publishes its own copy
of it — same openId and order, a new key — as its last step; the adopted
publications of the session are deleted only after that copy landed, and are
never the new state's own. The 0.5.1 records (`statusline.open-closed.v1:<session>`
and flags with `t`) are read as epoch 0, counter `t`; the bare 0.5.0 flag is
epoch 0, counter 0, so it opens the panel only in a session with no close mark.

A close ends the open, then writes its mark `statusline.open-closed.v3.<digest>:…`
`{session, e, n, at}` at a new order, then deletes the confirmed publications
of the open and of the opens it retired. A mark whose `set` resolved later than
`at + CLOCK_SKEW` is published again, same order, fresh `at`, until one lands
within CLOCK_SKEW, a `set` is refused (`picker-close-mark-late`), or the clock
reread after a landed `set` is refused. Clock refusal includes nonpositive or
nonfinite answers, a read hanging past STORE_HANG_MS, and a refused deadline;
it emits one `picker-close-mark-clock` diagnosis per physical mark, without a
second `clock-now` diagnosis. The landed mark stays and closes the panel;
refused clock rereads stop republication, not completion of the close or its
confirmed-flag cleanup. The earlier goes only after the later landed.
Once its mark landed, the close deletes the lower of it and the greatest earlier
mark this environment wrote for that session — at a tie of order the earlier
stamp — so in the settled state an environment keeps one mark per session (Р10);
a store that refuses every delete grows by a mark per close, with a diagnostic
for each refused delete. No mark is deleted to make room.

The prune at an open reads every flag, mark, draft and epoch record of one
listing first and judges them after, except the records of the session whose
panel is open at that moment in the state that prunes (a mark's session of the
previous versions is read from its key). It deletes this version's flags that
are not fresh (FLAG_TTL, and from the future past CLOCK_SKEW), marks of every
form older than MARK_KEEP by their age that are not held, this version's drafts
older than 7 days, the epoch records below the greatest, and the previous
versions' flags and drafts older than MARK_KEEP. A mark is held — not aged
out — while the same listing holds a restorable flag of its session that the
mark closes, unless a greater mark of that session is listed: the greater
closes all the lesser does. In the texts: a flag «перестаёт открывать панель
через 3 суток после последней записи и удаляется при открытии панели, кроме записей сессии, чья панель сейчас открыта»; a mark
«удаляется при открытии панели, если старше 7 дней и не закрывает действующего флага своей сессии, кроме записей сессии, чья панель сейчас открыта» (FLAG_EXPIRES, MARK_EXPIRES).

## Drafts (#551 D2)

A draft write publishes `statusline.draft.v3.<digest>:…` `{session, t, …}`; a
landed one deletes this environment's lower drafts of the session, one below a
higher own one deletes itself. The draft read takes the newest of the session
by (t, this version over the keyed v1 over the bare slot, key), deletes this
version's older ones by the keys read, and gives a newest one of the previous
version a copy of this version with a fresh `t`. A draft whose write was
refused stays in memory with the stamp of that write until a later write lands
it; a stored draft of its session stamped later supersedes it.

## Session snapshots (#551 D2)

The logical key `sess:<id>` stays the key of the write queue's maps. A write
goes out as a publication `statusline.sess.v3.<digest>:…` carrying its session;
a landed one deletes this environment's lower publications of the session, and
one below a higher own one deletes itself — a late landing is under a key of
its own and writes nothing over. Restore ranks the session's publications and
`sess:<id>` by the clock window first, then (seq, origin, n). A seq more than
24 hours ahead of the current clock ranks below every in-window snapshot and
never advances the learned order. It can still supply restored figures when
there is no in-window candidate; its clock diagnostic is emitted once per
episode. A successful restore validates the snapshot before learning it and
normalizes the stored value only once, including when pending data wins
(AR-2, AR-11).

Read-back lists and reads the current session's v3 publications and its listed
bare v1 key, even when this environment has no confirmed publication. Valid
foreign values advance the learned order within the clock window; malformed
v1 values remain untouched and are not learned or re-diagnosed by read-back
(AR-1, AR-10). The current generation is checked after each awaited store
read; session identity and its epoch are checked before learning. Read-back is
limited to once per 15-second process-relative window. If this environment's
newest confirmed publication is gone, and has not meanwhile been superseded
locally, the newest value is published again.

The prune counts sessions as groups (the digest of a publication, the session
of a `sess:<id>` key). Beyond SESS_KEEP groups, the capacity pass excludes
sessions this environment still writes, deletes the lowest eligible groups
and publications below each eligible group's newest, ranked by the same window
rule. A v1 `sess:<id>` is deleted only past MARK_KEEP by its `seq / 1000` age,
so a future v1 remains read-only. A publication another process makes between
the read and delete stays.
AR-2b / Q3 / R2-1: immediately after the cadence gate, prune synchronously
claims the generation's in-flight flag and a module-counter pass token before
any await. Each keys/get/delete call is bounded by STORE_HANG_MS; settlements
update the pass pulse with the process clock. Triggers during a live pass return
without parking or queuing. If an after callback is dropped, the next trigger
past the pulse deadline replaces the hung token and starts a new pass. Await
continuations and the bounded delete entry require the current generation and
token; a replaced or stopped pass cannot act. Finally releases only its own
token's flag, and a new generation starts with no pass in flight. Prune reads its own clock through the
request-ticketed `readClock`. Every time-dependent verdict of that pass uses
that local clock: window membership, ranking and v1 age. Before the capacity
gate, every session v3 payload is read once and checked by the reader's schema;
damage is deleted by its exact key and diagnosed. Out-of-window v3 copies are
deleted even in protected groups and below capacity, with the capacity pass
reusing those reads and never deleting a key twice. Window membership is a
verdict on the pass clock: a record judged outside is deleted in this pass even
if live clocks catch its order before `delete`. The guarantee requires a prune
whose pass clock is before that catchup (the 25-hour fixture has a one-hour
margin beyond the window). A refused pass clock permits only damage cleanup:
no window-, age- or capacity-based deletion, no wall-clock fallback, no advance
of `pruneAt`, and one `prune-clock-unavailable` diagnostic per generation; the
next trigger retries. Only a successful pass clock advances the existing
STORE_HANG_MS cadence. Clock answers must be finite positive numbers;
`clock.after(STORE_HANG_MS)` bounds each `clock.now` read, and a refused timer
refuses the read without an unbounded wait. Pending reads also carry a request
token and process-clock pulse. A subsequent clock request or an entry into the
start/restore, settled-restore, timer/action queue, recovery, verify or effort
gate rejects reads past that pulse deadline, even when after dropped its
callback. This fallback requires a subsequent trigger; it does not add a timer.
Success and refusal both advance the applied request ticket; an older result
cannot change the latest clock failure state, and a reply after the deadline
cannot apply. The deadline has its own rejection handler: a synchronous now
throw before the race is created, combined with a refused cancel and a later
timer callback, leaves no unhandled deadline rejection.

FIX5 R1/R2/R6: a clean prune closes both refusal and hung episodes. A damage
`delete` that rejects without reaching its deadline retains the per-key
`store-damage` diagnostic and does not stop the next key in the pass; only the
private `PruneDeadline` rejection stops damage cleanup. Generation changes are
recorded as `stale-session snapshot prune` at every `current()` check; token
replacement within the same generation stays silent. The unread StoreIO damage
closure and the token assignment overwritten synchronously at replacement have
been removed.
FIX6b Р8′: in the out-of-window and capacity stages a delete refused before its deadline is said in the `session-snapshot-prune` episode and the pass goes on (no other key is deleted in its place); a deadline in a stage stops the pass and wins over its refusals; a pass with any refused delete, damage deletes included, ends only the hung episode.
Ключ с отказом, чей digest до вытеснения стал действующим, выпадает из вытесняемых (`aged` до чтений или `evicted` после них), и вытеснение берёт на один свежий ключ больше — это правильная ёмкость.

FIX5 R4: after the success request-order gate, a stale generation cannot have `clockFailed=true`: that flag requires a newer applied refusal ticket, which would have returned at the order gate; the removed live-return branch was a no-op (single removal: 907 pass / 0 fail).
Доказательство опирается на монотонность `clockReqSeq` / `clockAppliedSeq` между поколениями; продакшн её держит (`register → wipeState` счётчики не трогает, `hooks/statusline.ts:6669–6671`); стендовый шов `__resetState` (`hooks/statusline.ts:7226–7228`) её снимает — путь только стенда.

FIX5 R5: the first refresh await boundary is independently held by U25
(`U16-first-only`), not masked by the second boundary on every input. The U16/U27
pair remains; U28 independently holds the rearm boundary. U25 still rejects a
superseded success changing the new state's failure flag at the request-order
line, independently of the removed success live-return branch.

The io-null queue-parking branches have been removed (AR-9.5). The only
`sessEnqueue` callers are `sessWrite`, whose item carries `ioOf($)`, and
`requeueNewest`, whose two callers are in `verifyStore` with that gather's
`ioOf($)`. A copy-failure item is returned already settled and never enqueued.
No queued item waits to borrow a store handle; every released item uses its
own store handle. The separate nullable handles in `landedLate` and
`landedPub` remain: a stale generation's late landing must not reuse its host.

## Undo and save marks (#551 D2)

A save's saveId is the writer's id and counter. Its mark is a publication
`statusline.saving.v3:…` `{saveId, t, fields, values}`, deleted by its key at
the end of the save. Its undo record is a series of revisions
`statusline.undo.v3:…` `{saveId, t, at, fields, prev, written}`; the revision
of a saveId that stands is the one with the greatest (at of its ticket, key) —
last writer by the ticket, not by the landing — and a save deletes its earlier
revision only after the next landed. A trim at the restore, an undo and the
cap publish a new revision and delete the revisions they read, by their keys.
The records of the previous versions are shown as they were: moved undo
records are stamped below zero in source order and the moved save mark −0.5,
newer than all of them and older than any stamp this version gives. A revision
of this version hides the previous version's record of its saveId; taking off
such a record publishes a tombstone (a revision with `src` naming it), and
taking off a mark of the previous version publishes a done record
`{src, done: true, t, srcSaveId, srcT}`. A done record hides only the source
whose key, saveId and source timestamp all match; a later legacy write to the
same bare key with a different saveId or timestamp remains visible (AR-4).
Done-record GC deletes the record when its source is absent from the listing
or its current saveId/timestamp no longer matches. A tombstone is deleted
only when its source is no longer present; a listed matching source keeps its
marker. When an undo took off every revision of a saveId of
this version only, a revision of the save that lands later brings the record
back; the next undo finds its fields at their `prev` values and takes it off.

## Capacity (#551 D9)

A key's length is `|ns| + 17 (per-session types) + 54`: at most 96, whatever
the session id or theme name; a legacy theme key whose name would pass 256 is
`legacy-theme-<hash of name and content>`. A refused `set` — the 4 MiB store,
the 256-character key — refuses the publication and leaves the one before it.
No mark is deleted to make room.
