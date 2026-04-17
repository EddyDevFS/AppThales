import { ensureExtendedSchema, error, findIncident, json } from "../../_lib.js";

export async function onRequestDelete(context) {
    await ensureExtendedSchema(context.env);
    const incidentId = context.params.id;
    const incident = await findIncident(context.env, incidentId);
    if (!incident) return error("Incident not found.", 404);

    await context.env.DB.prepare(
        `DELETE FROM incident_details
         WHERE incident_id = ?`
    ).bind(incidentId).run();

    await context.env.DB.prepare(
        `DELETE FROM incident_events
         WHERE incident_id = ?`
    ).bind(incidentId).run();

    await context.env.DB.prepare(
        `DELETE FROM incidents
         WHERE id = ?`
    ).bind(incidentId).run();
    return json({ ok: true });
}
