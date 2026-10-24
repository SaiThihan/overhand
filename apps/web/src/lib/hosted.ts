import { APP_ORIGINS } from "@overhand/contract";
import { DEMO } from "@/demo/demo";

/** This page is the hosted dashboard (the relay's origin): it reaches its daemon over WebRTC, not HTTP. */
export const HOSTED = typeof location !== "undefined" && APP_ORIGINS.includes(location.origin) && !DEMO;
