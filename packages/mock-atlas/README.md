# @foresight/mock-atlas

One local process that plays the two off-chain services the stack needs:

- **Kleros Atlas** : SIWE auth (`GetNonce`/`Login` with real signature recovery), user/email
  operations, role restrictions, and the `POST /ipfs/file` upload endpoint (returns a real
  CIDv1 as plain text, deterministic per content).
- **IPFS gateway** : `GET /ipfs/<cid>` serves back exactly what was uploaded, so files pushed
  by the web app round-trip to the indexer.

```
yarn workspace @foresight/mock-atlas start   # or: yarn mock-atlas (root)
```

Wire-up (done automatically by `yarn local-stack` and playwright's webServer):

```
NEXT_PUBLIC_ATLAS_URI=http://127.0.0.1:4747        # web
ENVIO_IPFS_GATEWAY=http://127.0.0.1:4747/ipfs      # indexer
```

Port defaults to `4747`; override with `MOCK_ATLAS_PORT`. State (files, users) is in-memory
and resets on restart.
