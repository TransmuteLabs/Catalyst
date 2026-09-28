# catalyst-statusline — notes

## Moves out of the bare store keys: the guarantee boundary (#521 FIX6 Р9)

Earlier versions kept the open flag, the picker draft, the undo stack, the save
mark and the user themes each under one bare key (`statusline.open.v1`,
`statusline.draft.v1`, `statusline.undo.v1`, `statusline.saving.v1`,
`statusline.themes.v1`). The current version moves each bare key to its own
keyed records: it reads the bare key, writes the records, and then deletes the
bare key. `$.store` has no compare-and-delete, and the previous version honours
no lock. So if the previous version writes to the bare key between that read
and that delete, the write is lost. Running at the same time as the previous
version is not supported. Themes, and undo records and save marks that have
no saveId, are moved to keys derived from their content. An undo record's key
also carries its occurrence among equal records, so equal records stay
separate. Moved undo records are stamped below zero in source order; a moved
save mark is stamped −0.5: newer than all of them and older than any stamp
this version writes. A record whose key
already exists is not written again. So moving the same content again writes
nothing new, and changed content goes to a new key. The close marks of
sessions (`statusline.open-closed.v1:<session>`) belong to the current
version only: the previous version neither writes nor reads them.
A close mark stamped 7 days or more, or an open flag more than 7 days, past
the reading clock is taken as damage and deleted, so an environment whose
clock is 7 days or more behind the writer's deletes a fresh close mark, and a
closed panel may reopen.
