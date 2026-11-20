# Redeem: money properties

The oracle for every change to redeem (spec `docs/specs/redeem.md` in the workspace). Tests and reviewers check code against this file and `allowlist.ts`; changing either needs Harman's approval.

| #   | Property | Checked by |
| --- | -------- | ---------- |
| R1  | **What is redeemable.** A part is offered only with a non-zero balance and a non-zero payout. Parent outcome tokens: once the parent market resolved. A child's UP and DOWN: once the parent resolved, that child's parent outcome pays, and the child resolved. A losing option and an unresolved child get no calls. A failed resolution read offers nothing and says the read failed. | unit tests, fork tests |
| R2  | **Amounts.** Each part redeems the full balance the redeeming wallet holds, read on-chain at build. Each `approve` equals the amount the next redeem call pulls, names the exact router that call goes to, and is never unbounded. | calldata decode, property tests (`fc.bigInt`) |
| R3  | **Where the sDAI goes.** A trade wallet redeem is one `batchExecute` on the connected account's own trade wallet, and the sDAI stays in that trade wallet: the batch holds no `transfer`. A connected wallet redeem is sent from that account, and the sDAI lands there. | calldata decode, fork tests |
| R4  | **Calldata matches the allow-list.** Every call is in `allowlist.ts` for the chain. Token addresses come from `wrappedOutcome(i)` of the session's own markets, never from the indexer. `redeemPositions` names sDAI and the session's parent market. `redeemConditionalToCollateral` names sDAI, a child market of this session, outcome indexes `[1, 0]` with amounts in that order (UP, DOWN), and the child's own parent outcome index. No native value, no `delegatecall`. | runtime decode, unit tests |
| R5  | **Payout shown.** The payout is `floor(amount × payoutNumerator / payoutDenominator)` from the resolved conditions on-chain, summed per wallet. It is display only and never part of a call. | unit tests, fork test comparing it with the balance change |
| R6  | **Reviewed intent.** A run signs only the parts and amounts shown when Redeem was pressed. A balance or resolution that changed between review and build stops the run for a new review. | driver tests |
| R7  | **No double redeem.** Across retry, resume and recovery, each part is redeemed at most once per run. The connected wallet path follows the liquidity flow's L8 and L9 rules for stored sends and atomic batches. After a run, balances and the list are read again. | driver and fork tests |
| R8  | **Runtime decode.** Before the wallet opens, each transaction (each call of a batch) is decoded against R2 to R4 with the connected account as sender. A departure stops the run as `unlisted`, with no prompt and no stored send. | driver tests |
| R9  | **No floats on amounts.** No `number`, `parseFloat` or `Math.*` on an amount, payout or balance path; they are `bigint`. | lint, review |
