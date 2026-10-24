import type { Client } from "../config";

/**
 * A ticket as the daemon reads it from a tracker: its client's config, description and comments. Not the contract's
 * Ticket, which is the dashboard's smaller view of one.
 */
export interface Ticket {
  client: Client;
  key: string;
  id: string;
  title: string;
  url: string;
  status: string;
  statusType: string;
  priority: string;
  labels: string[];
  description: string;
  comments: string[];
  /** A task you assigned with no ticket behind it: nothing about it is ever written to a tracker. */
  local?: boolean;
}

export type Query = { label: string } | { mine: true } | { key: string };
