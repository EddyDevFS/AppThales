import {
    REFERENCE_CATEGORIES,
    ensureExtendedSchema,
    error,
    json,
    listReferences,
    normalizeRecipient,
    nowIso,
    parseJson
} from "../_lib.js";

export async function onRequestPost(context) {
    await ensureExtendedSchema(context.env);
    const categoryKey = context.params.category;
    const body = await parseJson(context.request);

    if (categoryKey === "recipients") {
        const recipient = normalizeRecipient(body?.value);
        if (!recipient) return error("Recipient email is required.");

        await context.env.DB.prepare(
            `INSERT OR IGNORE INTO email_recipients (id, first_name, last_name, email, created_at)
             VALUES (?, ?, ?, ?, ?)`
        ).bind(
            recipient.id,
            recipient.firstName,
            recipient.lastName,
            recipient.email,
            nowIso()
        ).run();
    } else {
        const category = REFERENCE_CATEGORIES[categoryKey];
        if (!category) return error("Unknown reference category.", 404);

        const value = typeof body?.value === "string" ? body.value.trim() : "";
        if (!value) return error("Value is required.");

        await context.env.DB.prepare(
            `INSERT OR IGNORE INTO reference_items (category, value, created_at)
             VALUES (?, ?, ?)`
        ).bind(category, value, nowIso()).run();
    }

    const references = await listReferences(context.env);
    return json({ ok: true, references });
}

export async function onRequestDelete(context) {
    await ensureExtendedSchema(context.env);
    const categoryKey = context.params.category;
    const body = await parseJson(context.request);

    if (categoryKey === "recipients") {
        const email = typeof body?.value?.email === "string" ? body.value.email.trim().toLowerCase() : "";
        if (!email) return error("Recipient email is required.");

        await context.env.DB.prepare(
            `DELETE FROM email_recipients
             WHERE lower(email) = ?`
        ).bind(email).run();
    } else {
        const category = REFERENCE_CATEGORIES[categoryKey];
        if (!category) return error("Unknown reference category.", 404);

        const value = typeof body?.value === "string" ? body.value.trim() : "";
        if (!value) return error("Value is required.");

        await context.env.DB.prepare(
            `DELETE FROM reference_items
             WHERE category = ? AND value = ?`
        ).bind(category, value).run();
    }

    const references = await listReferences(context.env);
    return json({ ok: true, references });
}
