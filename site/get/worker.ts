// get.overhand.dev: serves the installer, so `curl -fsSL https://get.overhand.dev | sh` installs Overhand, and the
// release files at /download/<latest|v1.2.3>/<file> (DOWNLOAD in links.ts), redirected to their public copy on GitHub
// (REPO's releases). Until a release is there it serves a "not public yet" script; no commit or redeploy flips it, and any
// other answer (GitHub down) serves the installer, which explains its own failure.
import { REPO_URL, SITE } from "@overhand/contract/links";
import installer from "../../release/install.sh";

const FILES = `${REPO_URL}/releases`;
const notYet = `#!/bin/sh
echo "Overhand isn't public yet. Watch ${SITE} for the first release."
exit 1
`;

export default {
  async fetch(req: Request): Promise<Response> {
    const file = new URL(req.url).pathname.match(/^\/download\/(latest|v\d+\.\d+\.\d+[\w.-]*)\/([\w.-]+)$/);
    if (file) {
      const [, tag, name] = file;
      return Response.redirect(tag === "latest" ? `${FILES}/latest/download/${name}` : `${FILES}/download/${tag}/${name}`, 302);
    }
    const probe = await fetch(`${FILES}/latest/download/SHA256SUMS`, { method: "HEAD", redirect: "manual" }).catch(() => undefined);
    return new Response(probe?.status === 404 ? notYet : installer, {
      headers: { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "no-store" },
    });
  },
};
