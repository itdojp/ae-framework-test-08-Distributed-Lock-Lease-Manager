----------------------------- MODULE GeneratedModule -----------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS 

VARIABLES 

Init == 
    

DefaultAction(param) ==
    /\ TRUE
    /\ UNCHANGED <<vars>>

Next == \/ \E param: DefaultAction(param)

Spec == Init /\ [][Next]_<<>>

TypeInvariant == 
    

SafetyProperty == SafetyCondition

============================================================================