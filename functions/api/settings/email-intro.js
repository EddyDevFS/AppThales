import { ensureExtendedSchema, error, getSettings, json, nowIso, parseJson } from "../_lib.js";

export async function onRequestPost(context) {
    await ensureExtendedSchema(context.env);
    const body = await parseJson(context.request);
    if (!body) return error("Invalid JSON body.");

    const value = typeof body.value === "string" ? body.value.trim() : "";
    const updatedAt = nowIso();

    await context.env.DB.prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('emailIntro', ?, ?)
         ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at`
    ).bind(value, updatedAt).run();

    const settings = await getSettings(context.env);
    return json({ ok: true, settings });
}
