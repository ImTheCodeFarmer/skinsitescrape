"use server";

import { revalidatePath } from "next/cache";
import { getSession, isAdmin } from "@/lib/auth";
import { connectChat, createRule, deleteRule, removeBot, saveToken, sendTest, setRuleEnabled, testRule, validateRule, type RuleInput, type RuleKind } from "@/lib/alerts";

export type ActionState = { ok?: boolean; error?: string; message?: string } | null;

async function owner() {
  const s = await getSession();
  if (!isAdmin(s)) throw new Error("Not allowed");
  return s!.steamId;
}

export async function saveTokenAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const r = await saveToken(await owner(), String(form.get("token") ?? ""));
    revalidatePath("/alerts");
    return r.ok ? { ok: true, message: `Saved. Your bot is @${r.username}.` } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

export async function connectChatAction(): Promise<ActionState> {
  try {
    const r = await connectChat(await owner());
    revalidatePath("/alerts");
    return r.ok ? { ok: true, message: `Connected to ${r.chatTitle}. A welcome message is on its way.` } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

export async function sendTestAction(): Promise<ActionState> {
  try {
    const r = await sendTest(await owner());
    revalidatePath("/alerts");
    return r.ok ? { ok: true, message: "Test sent. Check Telegram." } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

export async function removeBotAction(): Promise<void> {
  await removeBot(await owner());
  revalidatePath("/alerts");
}

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export async function createRuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const kind = String(form.get("kind") ?? "big_bet") as RuleKind;
    const input: RuleInput = {
      name: String(form.get("name") ?? ""),
      kind,
      site: String(form.get("site") ?? "") || null,
      game: String(form.get("game") ?? "").trim().toLowerCase() || null,
      playerId: String(form.get("playerId") ?? "").trim() || null,
      minWagered: num(form.get("minWagered")),
      minNetWin: num(form.get("minNetWin")),
      cooldownSeconds: Math.round((num(form.get("cooldownMinutes")) ?? 0) * 60),
    };
    const err = validateRule(input);
    if (err) return { ok: false, error: err };
    await createRule(await owner(), input);
    revalidatePath("/alerts");
    return { ok: true, message: "Alert added." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

export async function toggleRuleAction(id: number, enabled: boolean): Promise<void> {
  await setRuleEnabled(await owner(), id, enabled);
  revalidatePath("/alerts");
}

export async function deleteRuleAction(id: number): Promise<void> {
  await deleteRule(await owner(), id);
  revalidatePath("/alerts");
}

export async function testRuleAction(id: number): Promise<ActionState> {
  try {
    const r = await testRule(await owner(), id);
    revalidatePath("/alerts");
    return r.ok ? { ok: true, message: "Sample sent. Check Telegram." } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}
