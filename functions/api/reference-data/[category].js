import { REFERENCE_CATEGORIES, error, json, listReferences, nowIso, parseJson } from "../_lib.js";

export async function onRequestPost(context) {
    const categoryKey = context.params.category;
    const category = REFERENCE_CATEGORIES[categoryKey];
    if (!category) return error("Unknown reference category.", 404);

    const body = await parseJson(context.request);
    const value = typeof body?.value === "string" ? body.value.trim() : "";
    if (!value) return error("Value is required.");

    await context.env.DB.prepare(
        `INSERT OR IGNORE INTO reference_items (category, value, created_at)
         VALUES (?, ?, ?)`
    ).bind(category, value, nowIso()).run();

    const references = await listReferences(context.env);
    return json({ ok: true, references });
}
