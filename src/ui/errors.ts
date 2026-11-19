import {
  ExchangeError,
  type ExchangeErrorCode,
  LinkError,
  type LinkErrorCode,
} from "@/business/errors";
import { m } from "@/paraglide/messages.js";

/** Why a .mixmap.json file was rejected, by code (business/errors.ts). */
const EXCHANGE_MESSAGES: Record<
  ExchangeErrorCode,
  (p: Readonly<Record<string, string>>) => string
> = {
  bad_rating: (p) => m.error_exchange_bad_rating({ field: p.field ?? "" }),
  bad_tags: (p) => m.error_exchange_bad_tags({ field: p.field ?? "" }),
  link_without_track: (p) =>
    m.error_exchange_link_without_track({ from: p.from ?? "", to: p.to ?? "" }),
  node_without_track: (p) => m.error_exchange_node_without_track({ track: p.track ?? "" }),
  not_json: () => m.error_exchange_not_json(),
  not_list: (p) => m.error_exchange_not_list({ field: p.field ?? "" }),
  not_number: (p) => m.error_exchange_not_number({ field: p.field ?? "" }),
  not_object: (p) => m.error_exchange_not_object({ field: p.field ?? "" }),
  not_text: (p) => m.error_exchange_not_text({ field: p.field ?? "" }),
  self_link: (p) => m.error_exchange_self_link({ field: p.field ?? "" }),
  unknown_kind: (p) => m.error_exchange_unknown_kind({ field: p.field ?? "", kind: p.kind ?? "" }),
  unsupported_version: (p) => m.error_exchange_unsupported_version({ version: p.version ?? "" }),
  wrong_format: () => m.error_exchange_wrong_format(),
};

const LINK_MESSAGES: Record<LinkErrorCode, (p: Readonly<Record<string, string>>) => string> = {
  bad_rating: (p) => m.error_link_bad_rating({ rating: p.rating ?? "" }),
  not_found: () => m.error_link_not_found(),
  self_link: () => m.error_link_self_link(),
};

/**
 * The text to show for an error: business errors by their code (translated), others
 * by their message. Backend errors arrive as "command: status text"; only the text is
 * kept.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof ExchangeError) {
    return m.error_exchange({ reason: EXCHANGE_MESSAGES[e.code](e.params) });
  }
  if (e instanceof LinkError) return LINK_MESSAGES[e.code](e.params);
  const s = e instanceof Error ? e.message : String(e);
  return s.replace(/^[a-z_]+: \d{3} /, "");
}
