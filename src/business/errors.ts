// Errors the business layer reports with a code instead of UI text (docs/i18n.md):
// the UI maps the code and its parameters to a message. `message` stays an English
// description for logs and the console.

/** Why a .mixmap.json file (or a sync peer's data) was rejected. */
export type ExchangeErrorCode =
  /** The file is not JSON. */
  | "not_json"
  /** No `format: "mixmap"`. */
  | "wrong_format"
  /** `version` is not 1 or 2; params: version. */
  | "unsupported_version"
  /** params: field. */
  | "not_text"
  /** params: field. */
  | "not_number"
  /** params: field. */
  | "not_list"
  /** params: field. */
  | "not_object"
  /** params: field. */
  | "bad_rating"
  /** params: field. */
  | "bad_tags"
  /** params: field. */
  | "self_link"
  /** params: field, kind. */
  | "unknown_kind"
  /** params: from, to. */
  | "link_without_track"
  /** params: track. */
  | "node_without_track";

export class ExchangeError extends Error {
  readonly code: ExchangeErrorCode;
  readonly params: Readonly<Record<string, string>>;

  constructor(code: ExchangeErrorCode, params: Record<string, string> = {}) {
    super(`Not a valid .mixmap.json file: ${code} ${JSON.stringify(params)}`);
    this.name = "ExchangeError";
    this.code = code;
    this.params = params;
  }
}

/** Why a link could not be written. */
export type LinkErrorCode =
  /** params: rating. */
  "bad_rating" | "self_link" | "not_found";

export class LinkError extends Error {
  readonly code: LinkErrorCode;
  readonly params: Readonly<Record<string, string>>;

  constructor(code: LinkErrorCode, params: Record<string, string> = {}) {
    super(`Link error: ${code} ${JSON.stringify(params)}`);
    this.name = "LinkError";
    this.code = code;
    this.params = params;
  }
}
