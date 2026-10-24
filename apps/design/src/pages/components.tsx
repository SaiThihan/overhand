/**
 * Components: every primitive in apps/web/src/components/ui, in its variants and states. Hover and focus are forced
 * with `.is-hover` and `.is-focus`, which force.ts gives the dashboard's own `:hover` and `:focus-visible` rules;
 * pressed is a toggle's `aria-pressed`, the only pressed look the dashboard draws.
 */

import { Info, Pause, Settings, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useWords } from "@/app/theme";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DEMO_REFUSAL } from "@/demo/demo";
import { fmt } from "@/lib/format";
import type { Entry } from "../catalog";

const Row = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap items-center gap-3">{children}</div>;

const VARIANTS = [
  ["primary", "Go ahead"],
  ["outline", "See proof"],
  ["answer", "Merge"],
  ["state", "Pause"],
  ["danger", "Turn off"],
  ["ghost", "Open Work"],
  ["link", "Settings"],
] as const;

/** Every button level side by side, in one state. */
function Buttons({ className, disabled }: { className?: string; disabled?: boolean }) {
  return (
    <Row>
      {VARIANTS.map(([v, label]) => (
        <Button key={v} variant={v} className={className} disabled={disabled}>
          {label}
        </Button>
      ))}
    </Row>
  );
}

const SIZES = ["xs", "sm", "default", "lg"] as const;
const ICONS = ["icon-xs", "icon-sm", "icon", "icon-lg"] as const;

/** The project field, as Settings asks for it. */
const field = (className?: string, extra: { disabled?: boolean; invalid?: boolean; value?: string } = {}) => (
  <div className="grid max-w-sm gap-1.5">
    <Label htmlFor={`f-${className ?? "x"}-${String(extra.disabled)}`}>Project name</Label>
    <Input
      id={`f-${className ?? "x"}-${String(extra.disabled)}`}
      className={className}
      placeholder="Booking app"
      disabled={extra.disabled}
      aria-invalid={extra.invalid || undefined}
      defaultValue={extra.value}
    />
  </div>
);

const area = (className?: string, extra: { disabled?: boolean; invalid?: boolean; value?: string } = {}) => (
  <Textarea
    aria-label="What should the agent do?"
    className={`max-w-md ${className ?? ""}`}
    placeholder="Make the invite page friendlier"
    disabled={extra.disabled}
    aria-invalid={extra.invalid || undefined}
    defaultValue={extra.value}
  />
);

const switches = (className?: string, disabled?: boolean) => (
  <Row>
    {[false, true].map((on) => (
      <span key={String(on)} className="flex items-center gap-2 text-sm">
        <Switch className={className} disabled={disabled} defaultChecked={on} aria-label={on ? "Sound on" : "Sound off"} />
        {on ? "On" : "Off"}
      </span>
    ))}
  </Row>
);

const tabs = (className?: string, variant: "default" | "line" = "default", disabled = false) => (
  <Tabs defaultValue="projects">
    <TabsList variant={variant}>
      <TabsTrigger value="projects">Projects</TabsTrigger>
      <TabsTrigger value="accounts" className={className}>
        Accounts
      </TabsTrigger>
      <TabsTrigger value="look" disabled={disabled}>
        Look
      </TabsTrigger>
    </TabsList>
    <TabsContent value="projects" className="pt-2 text-sm text-muted-foreground">
      The projects your agents work on.
    </TabsContent>
  </Tabs>
);

const PROJECTS = ["Online shop", "Booking app", "Company website", "Mobile app"];
const select = (className?: string, disabled?: boolean, open?: boolean) => (
  <Select defaultValue="Booking app" disabled={disabled} open={open}>
    <SelectTrigger className={className} aria-label="Project">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {PROJECTS.map((p) => (
        <SelectItem key={p} value={p}>
          {p}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const popover = (className?: string, disabled?: boolean, open?: boolean) => (
  <Popover open={open}>
    <PopoverTrigger asChild>
      <Button variant="outline" className={className} disabled={disabled}>
        <Settings aria-hidden="true" />
        Quick settings
      </Button>
    </PopoverTrigger>
    <PopoverContent className="grid gap-2 text-sm">
      <b>Quiet mode</b>
      <span className="text-muted-foreground">Heavy jobs wait until it ends.</span>
    </PopoverContent>
  </Popover>
);

/** The toasts the dashboard raises, said once when the frame opens. */
function Toasts() {
  const w = useWords();
  const said = useRef(false);
  useEffect(() => {
    if (said.current) return;
    said.current = true;
    toast(fmt(w.connectDone, { service: "GitHub" }));
    toast(w.pushDone);
    toast.error(DEMO_REFUSAL);
  }, [w]);
  return <p className="text-sm text-muted-foreground">Toasts rise from the bottom of the screen.</p>;
}

/** Every primitive in components/ui. */
export const COMPONENTS: Entry[] = [
  {
    id: "button",
    group: "components",
    title: "Button",
    about:
      "The button hierarchy: one primary per surface; outline for anything else that acts; the answer is the one control in the needs-you orange; state is pause and resume; danger only stops or removes, behind a confirm; ghost and link only navigate.",
    states: {
      default: () => <Buttons />,
      hover: () => <Buttons className="is-hover" />,
      focus: () => <Buttons className="is-focus" />,
      pressed: function Pressed() {
        const w = useWords();
        return (
          <fieldset className="seg flex gap-1.5" aria-label={w.sceneSetting}>
            <Button variant="outline" size="xs" aria-pressed>
              {w.sceneOn}
            </Button>
            <Button variant="outline" size="xs" aria-pressed={false}>
              {w.sceneStill}
            </Button>
          </fieldset>
        );
      },
      disabled: () => <Buttons disabled />,
      sizes: () => (
        <div className="grid gap-3">
          <Row>
            {SIZES.map((s) => (
              <Button key={s} size={s} variant="outline">
                {s}
              </Button>
            ))}
          </Row>
          <Row>
            {ICONS.map((s) => (
              <Button key={s} size={s} variant="outline" aria-label={`Pause (${s})`}>
                <Pause />
              </Button>
            ))}
          </Row>
        </div>
      ),
    },
    notes: {
      pressed: "A choice that's picked (aria-pressed), as in Quick settings: the one pressed look Overhand draws.",
      disabled: "Also how a button looks while its action runs: it's disabled until the answer comes back.",
    },
  },
  {
    id: "badge",
    group: "components",
    title: "Badge",
    passive: "a label, not a control: it never takes hover or focus in Overhand",
    states: {
      default: () => (
        <Row>
          <Badge>agent</Badge>
          <Badge variant="secondary">In Review</Badge>
          <Badge variant="destructive">needs-owner</Badge>
          <Badge variant="outline">Medium</Badge>
          <Badge variant="ghost">draft</Badge>
          <Badge variant="link">BOOK-88</Badge>
        </Row>
      ),
    },
  },
  {
    id: "input",
    group: "components",
    title: "Input",
    states: {
      default: () => field(),
      hover: () => field("is-hover"),
      focus: () => field("is-focus"),
      filled: () => field(undefined, { value: "Booking app" }),
      invalid: () => field(undefined, { invalid: true, value: "booking  app!" }),
      disabled: () => field(undefined, { disabled: true, value: "Booking app" }),
    },
  },
  {
    id: "textarea",
    group: "components",
    title: "Textarea",
    states: {
      default: () => area(),
      hover: () => area("is-hover"),
      focus: () => area("is-focus"),
      filled: () => area(undefined, { value: "Make the invite page friendlier" }),
      invalid: () => area(undefined, { invalid: true }),
      disabled: () => area(undefined, { disabled: true }),
    },
  },
  {
    id: "label",
    group: "components",
    title: "Label",
    passive: "names a field; it takes the field's states (Input shows them)",
    states: {
      default: () => field(),
      "with a disabled field": () => field(undefined, { disabled: true }),
    },
  },
  {
    id: "switch",
    group: "components",
    title: "Switch",
    states: {
      default: () => switches(),
      hover: () => switches("is-hover"),
      focus: () => switches("is-focus"),
      disabled: () => switches(undefined, true),
      small: () => (
        <Row>
          <Switch size="sm" aria-label="Small, off" />
          <Switch size="sm" defaultChecked aria-label="Small, on" />
        </Row>
      ),
    },
  },
  {
    id: "tabs",
    group: "components",
    title: "Tabs",
    about: "Settings' sections. The middle tab takes each forced state; the last one is disabled where the state is.",
    states: {
      default: () => tabs(),
      hover: () => tabs("is-hover"),
      focus: () => tabs("is-focus"),
      disabled: () => tabs(undefined, "default", true),
      line: () => tabs(undefined, "line"),
    },
  },
  {
    id: "skeleton",
    group: "components",
    title: "Skeleton",
    about: "What a pane shows while its data loads: grey blocks from the ink scale in the shape of its content, never a spinner.",
    passive: "a placeholder, not a control: it holds still and takes no hover or focus",
    states: {
      lines: () => (
        <div className="hud-pane max-w-md gap-3">
          <b>Work reports</b>
          <SkeletonRows label="Building the report…" rows={4} />
        </div>
      ),
      list: () => (
        <div className="hud-pane max-w-md gap-3">
          <b>Pick projects</b>
          <SkeletonRows label="Asking GitHub for your repositories…" rows={4} row="h-8" />
        </div>
      ),
      choices: () => (
        <div className="hud-pane max-w-md gap-3">
          <b>Agent</b>
          <div className="flex flex-wrap gap-2">
            {["w-24", "w-28", "w-20"].map((size) => (
              <Skeleton key={size} className={`h-9 rounded-(--radius-control) ${size}`} />
            ))}
          </div>
        </div>
      ),
    },
    notes: {
      lines: "Text that's coming: lines of different lengths, so they read as text.",
      list: "A list that's coming: one block per row, the rows' own height.",
      choices: "Choices that are coming: pills, the shape of the buttons they'll be.",
    },
  },
  {
    id: "alert",
    group: "components",
    title: "Alert",
    passive: "a message, not a control: it never takes hover or focus",
    states: {
      default: () => (
        <Alert className="max-w-lg">
          <Info aria-hidden="true" />
          <AlertDescription>Sample projects and people. Nothing here touches anything real.</AlertDescription>
        </Alert>
      ),
      destructive: function Destructive() {
        const w = useWords();
        return (
          <Alert variant="destructive" className="max-w-lg border-bad/60">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription className="text-foreground">{w.bannerUnreachable}</AlertDescription>
          </Alert>
        );
      },
    },
  },
  {
    id: "select",
    group: "components",
    title: "Select",
    states: {
      default: () => select(),
      hover: () => select("is-hover"),
      focus: () => select("is-focus"),
      disabled: () => select(undefined, true),
      open: () => select(undefined, false, true),
    },
    frame: { height: 300, only: ["open"] },
  },
  {
    id: "popover",
    group: "components",
    title: "Popover",
    about: "A floating layer on frosted glass, as Quick settings opens from the header.",
    states: {
      default: () => popover(),
      hover: () => popover("is-hover"),
      focus: () => popover("is-focus"),
      disabled: () => popover(undefined, true),
      open: () => popover(undefined, false, true),
    },
    frame: { height: 240, only: ["open"] },
  },
  {
    id: "tooltip",
    group: "components",
    title: "Tooltip",
    passive: "it's closed or open; its trigger is a Button with Button's states",
    states: {
      open: () => (
        <div className="grid h-40 place-items-center">
          <Tooltip open>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Pause all agents">
                <Pause />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Pause all agents (P)</TooltipContent>
          </Tooltip>
        </div>
      ),
    },
    frame: { height: 200 },
  },
  {
    id: "dialog",
    group: "components",
    title: "Dialog",
    passive: "an overlay, shown open; the controls inside it are Buttons with their own states",
    states: {
      open: () => (
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Pair this phone</DialogTitle>
              <DialogDescription>Scan the code with your phone's camera to see Needs you there.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      ),
    },
    frame: { height: 360 },
  },
  {
    id: "alert-dialog",
    group: "components",
    title: "Confirm",
    about: "Asks before something that interrupts work: danger for stopping or removing, primary when nothing is lost.",
    passive: "an overlay, shown open; the controls inside it are Buttons with their own states",
    states: (() => {
      const confirm = (tone: "danger" | "primary", title: string, body: string, go: string) =>
        function Confirm() {
          const w = useWords();
          return (
            <AlertDialog open>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{title}</AlertDialogTitle>
                  <AlertDialogDescription>{body}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{w.cancel}</AlertDialogCancel>
                  <AlertDialogAction variant={tone}>{go}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          );
        };
      return {
        danger: confirm("danger", "Stop BOOK-88?", "Its agent stops now; the branch and its commits stay.", "Stop it"),
        primary: confirm("primary", "Restart the daemon?", "Running agents pick up where they were in a few seconds.", "Restart"),
      };
    })(),
    frame: { height: 360 },
  },
  {
    id: "sheet",
    group: "components",
    title: "Drawer",
    about: "Every drawer slides in from the right on a computer and rises from the bottom on a phone.",
    passive: "an overlay, shown open; the controls inside it are Buttons with their own states",
    states: {
      right: () => (
        <Sheet open>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>BOOK-88</SheetTitle>
              <SheetDescription>Booking times out when the clinic has many slots.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      ),
      bottom: () => (
        <Sheet open>
          <SheetContent side="bottom" className="rounded-t-2xl">
            <SheetHeader>
              <SheetTitle>BOOK-88</SheetTitle>
              <SheetDescription>Booking times out when the clinic has many slots.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      ),
    },
    frame: { height: 420 },
  },
  {
    id: "command",
    group: "components",
    title: "Command list",
    about: "The parts the command bar is built from. The real command bar, with its commands, is under Patterns.",
    passive: "an overlay, shown open; its rows highlight as the arrow keys move",
    states: {
      results: () => (
        <CommandDialog open>
          <CommandInput placeholder="Type a command or a request" />
          <CommandList>
            <CommandGroup heading="Open">
              <CommandItem>Work</CommandItem>
              <CommandItem>Crew</CommandItem>
              <CommandItem>Health</CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      ),
      "no match": () => (
        <CommandDialog open>
          <CommandInput placeholder="Type a command or a request" value="thehe" />
          <CommandList>
            <CommandEmpty>Nothing matches.</CommandEmpty>
          </CommandList>
        </CommandDialog>
      ),
    },
    frame: { height: 420 },
  },
  {
    id: "sonner",
    group: "components",
    title: "Toasts",
    passive: "a toast is said and goes; it has no states beyond its kind",
    states: { said: () => <Toasts /> },
    frame: { height: 300 },
  },
];
