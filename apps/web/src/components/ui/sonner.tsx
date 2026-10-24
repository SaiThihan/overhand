import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/app/theme";

/** Toasts styled from the active theme's tokens, in its appearance. */
const Toaster = (props: ToasterProps) => (
  <Sonner
    theme={useTheme().light ? "light" : "dark"}
    className="toaster group !font-sans"
    position="bottom-center"
    toastOptions={{
      classNames: {
        toast: "m-toast !bg-popover !text-popover-foreground !border-border",
        // a tap target on touch screens: Sonner draws its buttons 24px high
        actionButton: "pointer-coarse:!h-11",
        cancelButton: "pointer-coarse:!h-11",
      },
    }}
    {...props}
  />
);

export { Toaster };
