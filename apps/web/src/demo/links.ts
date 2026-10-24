/** Where every link in the demo goes: example.com, so a click never opens a stranger's account. */
const HOST = "https://example.com";

/** A page on the demo's stand-in host: a sample repo, or a page in it (`sampleUrl("example/shop", "actions")`). */
export const sampleUrl = (...path: string[]): string => [HOST, ...path.filter(Boolean)].join("/");

/** A sample repo's pull request (`https://example.com/example/shop/pull/311`). */
export const samplePr = (repo: string, n: number): string => sampleUrl(repo, "pull", String(n));
