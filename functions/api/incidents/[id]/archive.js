import { error, findIncident, insertEvent, json, nowIso, parseJson } from "../../_lib.js";

export async function onRequestPost(context) {
    const incidentId = context.params.id;
    const incident = await findIncident(context.env, incidentId);
    if (!incident) return error("Incident not found.", 404);
    if (incident.status !== "Open") {
        return error("Only open incidents can be archived.", 409);
    }

    const body = await parseJson(context.request);
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) return error("Archive reason is required.");

    const deletedAt = nowIso();
    await context.env.DB.prepare(
        `UPDATE incidents
         SET status = 'Deleted',
             deleted_at = ?,
             deleted_reason = ?,
             updated_at = ?
         WHERE id = ?`
    ).bind(deletedAt, reason, deletedAt, incidentId).run();

    await insertEvent(context.env, incidentId, "archived", { deletedAt, reason });

    return json({ ok: true, deletedAt });
}
