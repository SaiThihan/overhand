/**
 * Makes the relay's Ed25519 signing key. Prints the private half for `wrangler secret put SIGNING_KEY` and the public
 * half for RELAY_PUBLIC_KEY in packages/contract/src/links.ts. Run once per environment; nothing is written to disk.
 * Usage: bun relay/keygen.ts
 */
import { newKeyPair } from "@overhand/contract";

const k = await newKeyPair();
console.log(`SIGNING_KEY (secret: paste into \`bunx wrangler@4.151.1 secret put SIGNING_KEY\`):\n${k.priv}\n`);
console.log(`RELAY_PUBLIC_KEY (public: packages/contract/src/links.ts):\n${k.pub}`);
