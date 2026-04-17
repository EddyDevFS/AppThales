import { ensureExtendedSchema, error, findIncident, getSettings, json } from "../../_lib.js";

function buildEmailSubject(incident) {
    return `${incident.errorType} - Batch : ${incident.batchNumber} - PART NUMBER : ${incident.partNumber}`;
}

function buildEmailBody(incident, emailIntro) {
    const lines = ["Bonjour,", ""];

    if (emailIntro) lines.push(emailIntro, "");

    lines.push(`Incident ID: ${incident.id}`);
    lines.push(`Supplier: ${incident.supplier}`);
    lines.push(`Buyer: ${incident.buyer}`);
    lines.push(`Operator: ${incident.operator}`);
    lines.push(`Batch: ${incident.batchNumber}`);
    lines.push(`Part number: ${incident.partNumber}`);
    lines.push(`Quantity affected: ${incident.quantity}`);
    lines.push(`Rejection reasons: ${incident.errorType || "None."}`);
    lines.push("");
    lines.push("Comments:");
    lines.push(incident.comment || "None.");
    lines.push("");
    lines.push("Reference / Evidence:");
    lines.push(incident.referenceNotes || "None.");

    return lines.join("\r\n");
}

export async function onRequestGet(context) {
    await ensureExtendedSchema(context.env);
    const incidentId = context.params.id;
    const incident = await findIncident(context.env, incidentId);
    if (!incident) return error("Incident not found.", 404);
    if (!incident.recipients.length) return error("No recipient selected for this incident.");

    const settings = await getSettings(context.env);
    const subject = buildEmailSubject(incident);
    const body = buildEmailBody(incident, settings.emailIntro || "");
    const to = incident.recipients.map((recipient) => recipient.email);
    const params = new URLSearchParams({
        subject,
        body
    });

    return json({
        ok: true,
        to,
        subject,
        body,
        mailtoUrl: `mailto:${encodeURIComponent(to.join(","))}?${params.toString()}`,
        warning: incident.attachments.length
            ? "Web email drafts cannot attach incident files automatically. Add attachments manually in your mail client."
            : ""
    });
}
