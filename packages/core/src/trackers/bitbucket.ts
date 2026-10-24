/** Bitbucket Cloud credentials (Bitbucket hosts PRs; it isn't a ticket tracker). */
import { basic, CFG, secret } from "../env";

/** The config's bitbucket section; throws when a Bitbucket client has none. */
export function bitbucket(): NonNullable<typeof CFG.bitbucket> {
  if (!CFG.bitbucket) throw new Error("a client uses Bitbucket but overhand.config.json has no bitbucket section");
  return CFG.bitbucket;
}

/** The Basic auth header for the Bitbucket API. */
export function bitbucketAuth(): string {
  return basic(bitbucket().email, secret(bitbucket().secret));
}
