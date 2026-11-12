                                                                                                    
     Debrief — criticism processed: verified, fixed, recorded (11be13c + e3a4c95)                        
                                                                                                         
     Every point was checked against the repo rather than argued. Scorecard:                             
                                                                                                         
     The critic was right about, and we fixed in code:                                                   
                                                                                                         
     1. "17ms vs 99.6s is a run-length artifact" — measured and confirmed: naive lag grows linearly at   
        0.996 s-lag/s (49.8s@50s / 99.6s@100s / 199.2s@200s). The TH04 law's lag is horizon-invariant (  
        ~17ms at any run length). The honest unit is lag-growth rate vs bounded steady state — the M-5   
        bench now prints the horizon-invariance table and the load profile.                              
     2. "Single-run numbers" — M-12 now runs 3 seeds: naive 144/152/144 done (19–21% waste share),       
        budgeted 180/180 on every seed, trace-hash stable per seed. M-2's timing spread (0.85×–2.62×)    
        is now recorded, and the headline is the counted metric (247,977 → 0 allocations, exact).        
     3. "Determinism competition (batch-invariant kernels)" — scope corrected: our x87/SSE finding is    
        interpreter-vs-JIT within one engine, a different mechanism. The SKU is engine-controlled        
        systems (games/backtesting); for LLM traces our replayable object is the orchestration trace —   
        complementary, not competing.                                                                    
     4. "Crowded runtime → differentiate via capacity proof" — the M-12 bench now prints the             
        counterfactual capacity proof: 2,904,464 tokens / 200 tasks, target ≤60min → required quota 48,  
        408 TPM, projected 387min at current quota, three levers (raise quota / 7× tenants / shed 20%).  
         The measurement-product wedge is demonstrated.                                                  
     5. "Baseline fairness" — verified (M-2's naive side is documented good-faith idiom) and             
        formalized: every bench header must now state baseline competence + metric semantics.            
                                                                                                         
     Corrected framing: "1998's mistakes" retired — the honest line is the agent layer rebuilt known     
     distributed-systems failures without the operational discipline; the lab measures what that         
     discipline is worth.                                                                                
                                                                                                         
     Open items, honestly: cross-platform determinism matrix (needs CI), network pathology in the        
     provider model (jitter/timeouts/partial failures) for the ingestion-fleet harness, and real         
     traffic traces (needs a partner).                                                                   
                                                                                                         
     The steer I'm adopting: measurement-first capacity proof for ingestion/agent fleets — the M-12      
     bench is the seed of it, and the capacity-proof output is the product's core artifact, already      
     working.                                                                                            
                                                                                                         
     Ready to build the network-pathology layer into the harness next, if you want to keep iterating     
     on the deciding experiment. 

                                                                 
  ┃       on the deciding experiment. || Yes. Old systems that ran under severe constraints (tiny        
  ┃  memory, fixed frame budgets, slow networks, no garbage collector) solved problems that modern       
  ┃  agent fleets are rediscovering. I’ll tie each one to a specific agent-era pain and say where the    
  ┃  analogy breaks, since I haven’t verified the lab’s code yet.                                        
  ┃                                                                                                      
  ┃  1. Quake’s and id’s frame-budget discipline (1990s)                                                 
  ┃                                                                                                      
  ┃  Constraint: a fixed 16.7 ms or 33 ms frame budget, where missing it means visible stutter.          
  ┃  Transferable idea: every subsystem gets a per-tick allocation, and when the budget is exceeded      
  ┃  the system degrades in predefined steps (lower detail, skip non-critical work) instead of           
  ┃  stalling.                                                                                           
  ┃  Agent-era analogue: per-session token and wall-clock budgets with a degradation ladder: cheaper     
  ┃  model, fewer sub-agents, shorter context, then a hard stop.                                         
  ┃  Where it fits the research: this is the same primitive as your M-11 and M-5 claims, and the         
  ┃  lineage is well documented. It gives you a vocabulary for buyers: “frame budget” maps to “SLO       
  ┃  budget per request.”                                                                                
  ┃  Break point: game frames are uniform. Agent work is heavy-tailed, so a fixed per-tick budget can    
  ┃  starve rare long tasks. You’d need budgets that adapt to the tail, not just a fixed cap.            
  ┃                                                                                               

2. Early Unix pipes and the 16-bit era’s bounded buffers                                            
  ┃                                                                                                      
  ┃  Constraint: tiny memory, so every pipe had a small fixed buffer and writers blocked when readers    
  ┃  fell behind.                                                                                        
  ┃  Transferable idea: backpressure by construction. A producer that outruns its consumer blocks,       
  ┃  instead of queueing unboundedly in memory.                                                          
  ┃  Agent-era analogue: the failure in the sources I found is the opposite: agents enqueue more work    
  ┃  during a rate-limit stall, and then everything fires at once. The fix is bounded queues with        
  ┃  explicit admission control at the producer, not retries at the consumer.                            
  ┃  Break point: pipes assume one machine. Across providers with independent rate limits, you need      
  ┃  admission control based on token-bucket estimates from several limits, which is harder than a       
  ┃  single fixed buffer.                                                                                
  ┃                                                                                                      
  ┃  3. TCP congestion control (Jacobson, 1988)                                                          
  ┃                                                                                                      
  ┃  Constraint: the internet collapsed in 1986 because senders retransmitted aggressively into a        
  ┃  congested network. Van Jacobson’s fix was AIMD: additive increase on success, multiplicative        
  ┃  decrease on loss.                                                                                   
  ┃  Transferable idea: it’s the most direct answer to the retry storm. Senders probe for capacity       
  ┃  slowly and back off sharply when they see signs of overload, and no sender has to know the global   
  ┃  load.                                                                                               
  ┃  Agent-era analogue: adaptive concurrency limits per provider. Rather than fixed retry counts,       
  ┃  each client tracks its own allowed in-flight requests and shrinks them on 429s.                     
  ┃  Why it matters for you: this is a stronger answer to the thundering herd than jittered backoff      
  ┃  alone. The sources I found say jitter only postpones amplification in a sustained outage and        
  ┃  doesn’t bound it. AIMD bounds the sending rate. That’s the kind of mechanism a capacity-proof       
  ┃  product can measure.                                                                                
  ┃  Break point: TCP’s loss signal is cheap and immediate. 429s are rate-limit signals that often       
  ┃  arrive late, and LLM request durations vary much more than packet RTTs.                             
  ┃                                                                                                      
  ┃  4. Lotus 1-2-3 and the spreadsheet recalculation model (1983)                                       
  ┃                                                                                                      
  ┃  Constraint: recalculating an entire sheet on every edit was too slow, so the design had to track    
  ┃  dependencies and recompute only what changed.                                                       
  ┃  Transferable idea: dependency-tracked incremental recomputation. Only the cells downstream of a     
  ┃  change are recalculated.                                                                            
  ┃  Agent-era analogue: agent context is a dependency graph too. When one tool result changes, only     
  ┃  the reasoning steps that depend on it should re-run. Most current frameworks replay the whole       
  ┃  conversation, which is why cost grows roughly quadratically, as one source noted.                   
  ┃  Break point: LLM steps aren’t pure functions. Their outputs can change even with identical inputs,  
  ┃   as the Thinking Machines work showed. Incremental recomputation only pays off if you can cache     
  ┃  the outputs you’re reusing.               

5. Video game netcode: rollback and lockstep (GGPO, late 1990s to 2000s)                            
  ┃                                                                                                      
  ┃  Constraint: two players over a bad network need the same game state without waiting for each        
  ┃  other.                                                                                              
  ┃  Transferable idea: speculate forward, then roll back and replay when the real input arrives. The    
  ┃  replay is only correct if the simulation is deterministic, which connects directly to your          
  ┃  deterministic-replay pitch.                                                                         
  ┃  Agent-era analogue: speculative execution of tool calls. Start the likely next step, and discard    
  ┃  or replay it when the real result differs.                                                          
  ┃  Break point: rollback needs the replayed step to be deterministic. Model calls aren’t, unless you   
  ┃  control batching, as the Thinking Machines work shows. So rollback for agents would have to         
  ┃  replay recorded outputs, not recompute them.                                                        
  ┃                                                                                                      
  ┃  6. Telephone switching and Erlang’s queueing theory (1909 onward)                                   
  ┃                                                                                                      
  ┃  Constraint: a fixed number of circuits, and calls that arrive randomly.                             
  ┃  Transferable idea: Erlang B and C give closed-form answers to “how many circuits do I need for      
  ┃  this blocking probability at this traffic load?” It’s the original capacity-proof math.             
  ┃  Agent-era analogue: exactly your target #2 product. Given arrival rates and provider concurrency    
  ┃  limits, Erlang-style models predict how many workers you need for a target wait time, before you    
  ┃  buy servers.                                                                                        
  ┃  Why it’s strong: this is 110 years of validated theory, and it answers the procurement question     
  ┃  directly. Buyers understand “we need N servers for this SLA” as a number.                           
  ┃  Break point: Erlang assumes Poisson arrivals and independent calls. Agent traffic is bursty and     
  ┃  correlated, because one user action can spawn a fan-out. You’d need heavy-tailed or self-similar    
  ┃  traffic models, which is a real research gap.                                                       
  ┃                                                                                                      
  ┃  7. Smalltalk and early Xerox PARC’s image-based persistence                                         
  ┃                                                                                                      
  ┃  Constraint: storage was expensive, so the whole system state was a snapshot that could be resumed.  
  ┃  Transferable idea: checkpointing the full state, so a process can resume rather than restart.       
  ┃  Agent-era analogue: Anthropic’s own writeup says it built resume-from-checkpoint systems because    
  ┃  restarts were expensive and frustrating. Temporal does this with event history instead of           
  ┃  snapshots.                                                                                          
  ┃  Break point: full-image snapshots are large. Agent state includes long context windows, so          
  ┃  checkpoint size is itself a cost to optimize.                                                       
  ┃                                                                                                      
  ┃  8. Mainframe batch scheduling and JCL (1960s–70s)                                                   
  ┃                                                                                                      
  ┃  Constraint: jobs ran for hours, so operators needed restart points, dependency ordering, and cost   
  ┃  accounting per job.                                                                                 
  ┃  Transferable idea: chargeback and job-level accounting. Each job has a declared resource budget,    
  ┃  and its spend is attributed to a team.                                                              
  ┃  Agent-era analogue: per-agent and per-team spend attribution with hard limits. Most of the $47K-    
  ┃  type incidents I found were unattributed, so no one owned the spend.                                
  ┃  Why it matters: the buyer is often a finance or platform team, not an engineer. Chargeback is how   
  ┃  they think.                                                                                         
  ┃                                                                                                      
  ┃  Where the analogies mostly fail                                                                     
  ┃                                                                                                      
  ┃  Be wary of transfer-by-metaphor. The strongest transfers share a structure: a shared scarce         
  ┃  resource, a feedback signal, and an admission or degradation policy. Several of these analogies     
  ┃  share only the vocabulary. Three checks are worth applying before you put one in a pitch:           
  ┃                                                                                                      
  ┃  Is the resource actually scarce in the same way? Tokens and provider rate limits are, frame time    
  ┃  is, but allocation churn may not be for agents.                                                     
  ┃  Is the signal fast enough? TCP gets loss within an RTT. 429s and long LLM calls come late and       
  ┃  noisy.                                                                                              
  ┃  Is the workload stationary? Erlang and AIMD assume mostly steady traffic. Agent traffic is heavy-   
  ┃  tailed and bursty, and that is where the research gap is.                                           
  ┃  Where I’d spend effort                                                                              
  ┃                                                                                                      
  ┃  The two strongest candidates are AIMD for adaptive concurrency per provider and Erlang-style        
  ┃  capacity planning extended to bursty fan-out traffic. Both have decades of theory, both map to a    
  ┃  buyer’s question (how many concurrent calls and how many servers), and both can be validated with   
  ┃  a simulator against a rate-limited mock provider. The frame-budget and degradation ideas from       
  ┃  games are the best vocabulary for the product, and the netcode and spreadsheet ideas are worth      
  ┃  keeping as research directions rather than v1 features.     
