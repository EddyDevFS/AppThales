import { error, findIncident, insertEvent, json, nowIso } from "../../_lib.js";

export async function onRequestPost(context) {
    const incidentId = context.params.id;
    const incident = await findIncident(context.env, incidentId);

    if (!incident) return error("Incident not found.", 404);
    if (incident.status !== "Open") {
        return error("Only open incidents can be resolved.", 409);
    }

    const resolvedAt = nowIso();
    await context.env.DB.prepare(
        `UPDATE incidents
         SET status = 'Resolved',
             resolved_at = ?,
             updated_at = ?
         WHERE id = ?`
    ).bind(resolvedAt, resolvedAt, incidentId).run();

    await insertEvent(context.env, incidentId, "resolved", { resolvedAt });

    return json({ ok: true, resolvedAt });
}
