// Preloaded into the fork run. The fork node drops idle sockets after 5 s, and a test blocked in execFileSync
// cannot see that, so its next fetch writes to a closed socket; pipelining 0 opens a new socket per request.
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(new Agent({ pipelining: 0 }));
