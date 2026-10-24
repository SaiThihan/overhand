import { expect, test } from "bun:test";
import { FRESH_MIN } from "@overhand/contract";
import { withDom } from "@/components/render.test-util";
import { MORNING } from "@/demo/moments";
import { nightAt } from "@/demo/night";

/** Fresh reads without a button: the app asks when it comes back into view, and a tab asks once per FRESH_MIN. */
withDom();

const MIN = 60_000;

test("coming back into view runs the look: on open, when the tab is shown, when the window gets focus", async () => {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useOnReturn } = await import("./fresh");
  let looks = 0;
  function Probe() {
    useOnReturn(() => {
      looks += 1;
    });
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Probe />));
  expect(looks).toBe(1);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(looks).toBe(2);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(looks).toBe(3);
  await act(async () => root.unmount());
  window.dispatchEvent(new Event("focus"));
  expect(looks).toBe(3);
});

test("a tab asks for a Slack pass once per FRESH_MIN, only when Slack's last read is old and none is running", async () => {
  const { freshAsks } = await import("./fresh");
  const s = nightAt(MORNING);
  const now = s.slackReadAt + 30 * MIN;
  const fresh = { ...s, accounts: [] };
  expect(freshAsks({ ...fresh, slackReadAt: now - 2 * MIN }, now)).toEqual([]);
  expect(freshAsks({ ...fresh, slackReadAt: 0 }, now)).toEqual([]); // Slack isn't set up
  const reading = { ...fresh, running: [{ name: "inbox", account: "a", cwd: "", startedAt: now, pid: 1 }] };
  expect(freshAsks(reading, now)).toEqual([]);
  expect(freshAsks(fresh, now)).toEqual(["/api/request/inbox"]);
  expect(freshAsks(fresh, now + 5 * MIN)).toEqual([]);
  expect(freshAsks(fresh, now + (FRESH_MIN + 1) * MIN)).toEqual(["/api/request/inbox"]);
});
