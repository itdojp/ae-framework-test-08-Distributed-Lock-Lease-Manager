------------------------------ MODULE LeaseManager ------------------------------
EXTENDS Naturals, Sequences

CONSTANTS Owners, MaxToken

VARIABLES holder, token, expired

Init ==
  /\ holder = "NONE"
  /\ token = 0
  /\ expired = FALSE

Acquire(o) ==
  /\ o \in Owners
  /\ holder = "NONE"
  /\ holder' = o
  /\ token' = token + 1
  /\ expired' = FALSE

Renew(o) ==
  /\ o \in Owners
  /\ holder = o
  /\ ~expired
  /\ holder' = holder
  /\ token' = token
  /\ expired' = FALSE

Release(o) ==
  /\ o \in Owners
  /\ holder = o
  /\ ~expired
  /\ holder' = "NONE"
  /\ token' = token
  /\ expired' = expired

Expire ==
  /\ holder # "NONE"
  /\ expired = FALSE
  /\ holder' = "NONE"
  /\ token' = token
  /\ expired' = TRUE

Next ==
  \/ \E o \in Owners : Acquire(o)
  \/ \E o \in Owners : Renew(o)
  \/ \E o \in Owners : Release(o)
  \/ Expire

InvSingleHolder ==
  holder = "NONE" \/ holder \in Owners

InvTokenMonotonic ==
  token \in Nat /\ token <= MaxToken

Spec == Init /\ [][Next]_<<holder, token, expired>>

=============================================================================
