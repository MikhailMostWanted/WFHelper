import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import type context from "../context";
import {
  DEFAULT_REWARD_FIELD_STYLE,
  isRewardOverlayField,
  normalizeRewardFieldStyle,
  normalizeRewardOverlayLayout,
  type RewardOverlayEditState,
} from "../../config/shared/rewardOverlayLayout";
import { REWARD_EDIT_STATE } from "../../config/shared/ipcChannels";
import { asRecord } from "../ipcValidators";

export function createRewardEditor(options: {
  ctx: typeof context;
  persist: () => boolean;
  applySaved: (state: RewardOverlayEditState) => void;
}) {
  const { ctx } = options;
  let session: {
    owner: WebContents;
    state: RewardOverlayEditState;
  } | null = null;
  let revision = 0;
  const savedScale = () =>
    ctx.overlaySettings.overlayWindowScales?.reward ?? ctx.overlaySettings.overlayScale ?? 1;
  function savedState(): RewardOverlayEditState {
    return {
      sessionId: null,
      revision,
      layout: normalizeRewardOverlayLayout(ctx.overlaySettings.rewardLayout),
      selectedField: "platinumValue",
      previewCount: 4,
      previewVariant: "rewards",
      scale: savedScale(),
    };
  }
  function state(): RewardOverlayEditState {
    return session?.state ?? savedState();
  }
  function publish(): RewardOverlayEditState {
    revision += 1;
    if (session) session.state.revision = revision;
    const next = state();
    if (session && !session.owner.isDestroyed()) session.owner.send(REWARD_EDIT_STATE, next);
    return next;
  }
  function finish(save: boolean): void {
    if (!session) return;
    const current = session;
    if (save) {
      const previous = ctx.overlaySettings;
      ctx.overlaySettings = {
        ...previous,
        rewardLayout: normalizeRewardOverlayLayout(current.state.layout),
        overlayWindowScales: { ...previous.overlayWindowScales, reward: current.state.scale },
      };
      if (!options.persist()) {
        ctx.overlaySettings = previous;
        throw new Error("Could not save reward layout");
      }
    }
    current.owner.removeListener("destroyed", cancel);
    current.owner.removeListener("render-process-gone", cancel);
    current.owner.removeListener("did-start-navigation", navigation);
    session = null;
    const next = publish();
    if (save) options.applySaved(next);
    if (!current.owner.isDestroyed()) current.owner.send(REWARD_EDIT_STATE, next);
  }
  function cancel(): void {
    finish(false);
  }
  function navigation(_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean): void {
    if (mainFrame && !inPlace) cancel();
  }
  function requireSession(token: unknown, owner?: WebContents) {
    if (!session || token !== session.state.sessionId || (owner && owner !== session.owner)) {
      throw new Error("Reward editor session is no longer active");
    }
    return session;
  }
  function begin(owner: WebContents): RewardOverlayEditState {
    if (session) {
      if (session.owner === owner) return state();
      throw new Error("Reward editor is already open");
    }
    const initial = state();
    session = {
      owner,
      state: { ...initial, sessionId: randomUUID() },
    };
    owner.on("destroyed", cancel);
    owner.on("render-process-gone", cancel);
    owner.on("did-start-navigation", navigation);
    return publish();
  }
  function update(token: unknown, raw: unknown, owner?: WebContents): RewardOverlayEditState {
    const current = requireSession(token, owner);
    const command = asRecord(raw);
    if (!command) throw new Error("Invalid reward editor command");
    const draft = current.state;
    const field = command.field;
    switch (command.type) {
      case "field": {
        const patch = asRecord(command.patch);
        if (
          !isRewardOverlayField(field) ||
          !patch ||
          Object.keys(patch).some((key) => !["x", "y", "scale", "color", "hidden"].includes(key))
        )
          throw new Error("Invalid reward field");
        for (const key of ["x", "y", "scale"]) {
          if (key in patch && (typeof patch[key] !== "number" || !Number.isFinite(patch[key])))
            throw new Error("Invalid reward field number");
        }
        if ("hidden" in patch && typeof patch.hidden !== "boolean")
          throw new Error("Invalid visibility");
        if (
          "color" in patch &&
          patch.color !== null &&
          (typeof patch.color !== "string" || !/^#[\da-f]{6}$/i.test(patch.color))
        )
          throw new Error("Invalid field color");
        draft.layout.fields[field] = normalizeRewardFieldStyle({
          ...(draft.layout.fields[field] ?? DEFAULT_REWARD_FIELD_STYLE),
          ...patch,
        });
        break;
      }
      case "select":
        if (!isRewardOverlayField(field)) throw new Error("Invalid reward field");
        draft.selectedField = field;
        break;
      case "reset":
        if (field === undefined) draft.layout = { version: 1, fields: {} };
        else if (isRewardOverlayField(field)) delete draft.layout.fields[field];
        else throw new Error("Invalid reward field");
        break;
      case "preview":
        if (
          ![1, 2, 3, 4].includes(Number(command.count)) ||
          typeof command.count !== "number" ||
          typeof command.variant !== "string" ||
          !["rewards", "missing", "scanning", "error"].includes(String(command.variant))
        )
          throw new Error("Invalid preview");
        draft.previewCount = command.count as RewardOverlayEditState["previewCount"];
        draft.previewVariant = command.variant as RewardOverlayEditState["previewVariant"];
        break;
      case "scale":
        if (typeof command.scale !== "number" || !Number.isFinite(command.scale))
          throw new Error("Invalid overlay scale");
        draft.scale = Math.min(1.5, Math.max(0.75, command.scale));
        break;
      default:
        throw new Error("Unknown reward editor command");
    }
    return publish();
  }
  return {
    begin,
    update,
    state,
    savedState,
    end: (token: unknown, save: unknown, owner?: WebContents) => {
      requireSession(token, owner);
      if (typeof save !== "boolean") throw new Error("Invalid save flag");
      finish(save);
      return { ok: true as const };
    },
  };
}
