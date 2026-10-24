/** A request from Overhand's own CLI on this machine: it carries the local key, as `localHeaders` sends it. */
import { LOCAL_HEADER, localKey } from "../src/devices";

/** `new Request(url, init)` with this install's local key added to its headers. */
export function localRequest(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set(LOCAL_HEADER, localKey());
  return new Request(url, { ...init, headers });
}
