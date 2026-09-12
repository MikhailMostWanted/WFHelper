import { sanitizeWfmSlug } from "../config/shared/wfm";
import { withScope } from "./logger";
import { requestRedirectTarget, requestV2 } from "./wfmClient";
import { WfmApiError } from "./wfmTypes";

const log = withScope("wfmProfileSlug");

const SLUG_FROM_LOCATION = /\/profile\/([^/?#]+)\/reviews\/?$/;

/** Where a profile name lives on warframe.market. "unresolved" is the lookup
 *  failing rather than an answer, so a caller that writes must refuse instead of
 *  falling back to the name: a near miss lands on a different real user. */
type ProfileSlugResolution =
  | { kind: "resolved"; slug: string }
  | { kind: "not-found" }
  | { kind: "unresolved" };

interface WfmUserEnvelope {
  data?: { slug?: unknown; ingameName?: unknown } | null;
}

function decodedSlug(captured: string): string | null {
  try {
    return sanitizeWfmSlug(decodeURIComponent(captured));
  } catch {
    return null;
  }
}

/** A HEAD that did not redirect means one of three things alike: WFM serves the
 *  name itself, there is no such profile, or the probe failed. The account route
 *  tells them apart, but it is keyed by the minted slug and is case sensitive
 *  ("seganku" answers, "Seganku" 404s), so the name is folded before asking. */
async function confirmServedName(name: string): Promise<ProfileSlugResolution> {
  const candidate = sanitizeWfmSlug(name.toLowerCase());
  if (!candidate) return { kind: "not-found" };

  let envelope: WfmUserEnvelope;
  try {
    envelope = (await requestV2(
      "GET",
      `/user/${encodeURIComponent(candidate)}`,
    )) as WfmUserEnvelope;
  } catch (err) {
    if (err instanceof WfmApiError && err.status === 404) return { kind: "not-found" };
    log.warn(`[Slug] profile lookup failed for ${name}:`, String(err));
    return { kind: "unresolved" };
  }

  const slug = sanitizeWfmSlug(envelope?.data?.slug);
  const served = typeof envelope?.data?.ingameName === "string" ? envelope.data.ingameName : "";
  if (!slug) {
    log.warn(`[Slug] profile for ${name} carries no usable slug`);
    return { kind: "unresolved" };
  }
  // Folding can collide, so the account WFM served has to be the one we traded
  // with. Without this a near miss writes a review to a different real user.
  if (served.trim().toLowerCase() !== name.trim().toLowerCase()) {
    log.warn(`[Slug] ${candidate} belongs to ${served || "someone else"}, not ${name}`);
    return { kind: "not-found" };
  }
  return { kind: "resolved", slug };
}

/** The slug warframe.market serves a profile name under, read back from WFM
 *  itself. WFM mints it - lowercased, edge punctuation stripped, spaces turned
 *  into hyphens, underscores kept only sometimes - so no local rule reproduces
 *  it and no caller may invent one. */
export async function probeProfileSlug(name: string): Promise<ProfileSlugResolution> {
  const trimmed = String(name || "").trim();
  if (!trimmed) return { kind: "not-found" };

  let location: string | null;
  try {
    location = await requestRedirectTarget(`/profile/${encodeURIComponent(trimmed)}/reviews/`);
  } catch (err) {
    // Only backpressure throws; a failed probe answers null and is sorted below.
    log.warn(`[Slug] redirect probe refused for ${trimmed}:`, String(err));
    return { kind: "unresolved" };
  }

  const captured = location ? SLUG_FROM_LOCATION.exec(location)?.[1] : null;
  if (!captured) return confirmServedName(trimmed);

  const slug = decodedSlug(captured);
  // The redirect already said the name is not the slug, so a target the
  // allowlist refuses leaves nothing safe to write to.
  if (!slug) log.warn(`[Slug] redirect target for ${trimmed} is not a slug: ${captured}`);
  return slug ? { kind: "resolved", slug } : { kind: "unresolved" };
}
